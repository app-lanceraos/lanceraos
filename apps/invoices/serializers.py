# apps/invoices/serializers.py
"""
Explicit `fields=` allowlists only, never `Meta.exclude` — same discipline
apps.clients.serializers established (see that module's own docstring for
the FreelancerProfileSerializer vulnerability this pattern exists to avoid).

currency validation reuses apps.clients.serializers.validate_currency_code
rather than duplicating it — Step 4's models.py left a comment pointing
here specifically so this wouldn't get reinvented.
"""
from rest_framework import serializers

from apps.clients.models import Client
from apps.clients.serializers import validate_currency_code

from .design_schema import validate_design_data_schema
from .models import Invoice, InvoiceDesign, InvoiceItem, InvoicePartialPayment, InvoicePreset, InvoicePresetItem, _today


class InvoiceItemSerializer(serializers.ModelSerializer):
    class Meta:
        model = InvoiceItem
        fields = ['id', 'description', 'quantity', 'unit_price', 'total', 'sort_order']
        read_only_fields = ['id', 'total']  # total is computed on save(), never client-supplied


class InvoicePartialPaymentSerializer(serializers.ModelSerializer):
    class Meta:
        model = InvoicePartialPayment
        fields = ['id', 'amount', 'currency', 'rate_to_usd', 'source', 'payment_date', 'notes', 'recorded_at']
        # rate_to_usd is captured server-side (anchor-currency lookup), never client-supplied.
        read_only_fields = ['id', 'rate_to_usd', 'recorded_at']

    def validate_currency(self, value):
        return validate_currency_code(value)

    def validate_amount(self, value):
        if value <= 0:
            raise serializers.ValidationError('Payment amount must be greater than zero.')
        # mark_paid pre-fills exactly the outstanding balance, so it can
        # never violate this by construction — this check specifically
        # targets invoice_add_payment (manual partial-payment entry via
        # this serializer), where a user can type any number. Compares the
        # raw amount directly against outstanding_amount, matching
        # update_paid_status()'s own existing convention of summing
        # partial_payments.amount directly with no currency conversion
        # (a real, separate, pre-existing simplification — not something
        # this check changes or is scoped to fix).
        invoice = self.context.get('invoice')
        if invoice is not None and value > invoice.outstanding_amount:
            raise serializers.ValidationError(
                f'Payment amount cannot exceed the outstanding balance of {invoice.outstanding_amount} {invoice.currency}.'
            )
        return value


class InvoiceSerializer(serializers.ModelSerializer):
    """
    Write representation — create/edit. The view enforces
    `is_editable` (status == 'draft') before this serializer is ever
    reached for an update; this serializer itself doesn't re-check status,
    since that's a per-action concern, not a field-validation one.

    `client` is scoped to the requesting user's own clients in __init__
    (not Client.objects.all(), DRF's default) — otherwise a user could
    pass another user's client id and silently attach their invoice to
    someone else's CRM record. Deliberately not a custom validate_client()
    instead: scoping the queryset means a foreign client id gets DRF's own
    standard "does not exist" rejection, identical to a genuinely
    nonexistent id — no separate message that would distinguish "not
    yours" from "doesn't exist" at all.

    `status`/`invoice_number`/`view_token`/`pdf_url`/`sent_via_platform`/
    `amount_paid` and every other lifecycle/derived field are deliberately
    absent from `fields` — they only ever change via their own dedicated
    action endpoints (finalise/send/mark-paid/etc.), never through this
    general-purpose create/update path.

    `client_name`/`client_email` are explicitly overridden to
    `required=False, allow_blank=True` — the model fields themselves have
    no `blank=True` (a real, non-blank CharField/EmailField is still the
    right shape for a *finalised* invoice), but this serializer is also
    what backs autosave on a still-draft invoice (Step 6 rework, the
    Gmail-compose-style flow): opening "New Invoice" creates a genuinely
    empty draft before the user has typed anything, and every field
    edit — including clearing the client fields back to blank — autosaves
    through this same path. A draft with no client info yet is a valid,
    permissive save state, the same way an empty Gmail draft is valid.
    Only `invoice_finalise` (apps/invoices/views.py) gates on real
    content being present, and today it only checks for at least one
    line item, not client info — see that view's own docstring for the
    now-recorded mismatch between what finalise arguably *should* check
    and what it *actually* checks; deliberately not changed here, since
    tightening finalise's validation is a separate decision from this
    autosave rework.
    """
    items = InvoiceItemSerializer(many=True, required=False)
    client_name = serializers.CharField(required=False, allow_blank=True, default='')
    client_email = serializers.EmailField(required=False, allow_blank=True, default='')
    # Overrides the ModelSerializer-auto-generated field (which inherits
    # the model field's `null=False`, rejecting an explicit `null` outright
    # before `validate()` ever runs) — `allow_null=True` here so clearing
    # the date in the wizard/autosave reaches `validate()` below, which
    # silently re-defaults it to today rather than 400ing or persisting a
    # NULL the DB column doesn't even allow.
    issue_date = serializers.DateField(required=False, allow_null=True)

    class Meta:
        model = Invoice
        fields = [
            'id', 'client', 'client_name', 'client_email', 'client_company', 'client_address',
            'client_phone', 'currency', 'tax_rate', 'discount_amount', 'issue_date', 'due_date', 'notes', 'terms',
            'reminders_enabled', 'late_fee_enabled', 'late_fee_rate', 'is_recurring',
            'recurring_interval_days', 'recurring_auto_send', 'is_one_time_client', 'items',
        ]
        read_only_fields = ['id']

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        request = self.context.get('request')
        if request is not None:
            self.fields['client'].queryset = Client.objects.filter(user=request.user)

    def validate_currency(self, value):
        return validate_currency_code(value)

    def validate(self, attrs):
        """
        due_date, once set, must be on or after issue_date — same-day is
        legal (e.g. an invoice issued and due immediately), only strictly
        BEFORE issue_date is rejected. Real cross-field validation (item 6
        of the verification pass, boundary corrected in the bug-hardening
        round that found `<=` was wrongly rejecting the legal same-day
        case), not left to the frontend alone. due_date itself stays
        optional at this layer (autosave on an incomplete draft must stay
        permissive, matching client_name/client_email's own established
        precedent above) — it's REQUIRED at the one real "leaving draft"
        gate instead (invoice_finalise/_finalise_and_send/_mark_sent's own
        draft branch, apps/invoices/views.py).

        A cleared issue_date (explicit `null` — allowed only because the
        field above overrides the model's own `null=False` default) is
        silently re-defaulted to today via the model's own `_today()`
        (not a bare `date.today()` — this app runs USE_TZ=False on PKT,
        and `_today()` is the one place that distinction is already
        codified) rather than rejected or persisted as NULL, which the DB
        column doesn't allow anyway. This mirrors what a brand-new
        invoice already gets for free from the model field's own
        `default=_today` — the only gap was an EXISTING invoice's autosave
        explicitly clearing the field back to null, which bypasses that
        model-level default entirely since it's a real value being
        assigned, not an omitted field.

        The due_date/issue_date comparison below is only actually checked
        when THIS request is touching one of the two fields — falls back
        to the instance's own current value for whichever side a partial
        (autosave) update doesn't touch, so a due_date-only PATCH is still
        checked against the invoice's real saved issue_date. Deliberately
        does NOT re-validate a pair that was already saved before this
        rule existed and isn't part of this request at all — a legacy
        invoice with a stale/blank due_date must stay editable for every
        OTHER field (client_name, notes, ...) without being blocked by a
        comparison neither field of which the caller is even touching
        right now.
        """
        if 'issue_date' in attrs and attrs['issue_date'] is None:
            attrs['issue_date'] = _today()

        if 'issue_date' not in attrs and 'due_date' not in attrs:
            return attrs
        issue_date = attrs.get('issue_date', getattr(self.instance, 'issue_date', None))
        due_date = attrs.get('due_date', getattr(self.instance, 'due_date', None))
        if due_date and issue_date and due_date < issue_date:
            raise serializers.ValidationError({'due_date': 'Due date cannot be before the issue date.'})
        return attrs

    def create(self, validated_data):
        items_data = validated_data.pop('items', [])
        invoice = Invoice.objects.create(**validated_data)
        for item_data in items_data:
            InvoiceItem.objects.create(invoice=invoice, **item_data)
        invoice.recalculate_totals()
        invoice.save(update_fields=['subtotal', 'tax_amount', 'total'])
        return invoice

    def update(self, instance, validated_data):
        items_data = validated_data.pop('items', None)
        for attr, value in validated_data.items():
            setattr(instance, attr, value)
        instance.save()
        if items_data is not None:
            instance.items.all().delete()
            for item_data in items_data:
                InvoiceItem.objects.create(invoice=instance, **item_data)
        instance.recalculate_totals()
        instance.save(update_fields=['subtotal', 'tax_amount', 'total'])
        return instance


class RecurringSeriesSettingsSerializer(serializers.ModelSerializer):
    """
    Step 16 — the narrow allowance invoice_detail's PUT handler uses for a
    recurring ROOT invoice past its own draft status: exactly these two
    fields, nothing else, regardless of the root's own status (a root may
    be long past Created/Sent by the time someone wants to change the
    series going forward). Deliberately its own small serializer rather
    than teaching InvoiceSerializer to conditionally allow more fields
    for one specific case — matching this app's own explicit-fields
    discipline (see this module's own top docstring) rather than a
    body-content-sniffing exception bolted onto the general-purpose one.
    """
    class Meta:
        model = Invoice
        fields = ['recurring_interval_days', 'recurring_auto_send']


class DueDateOnlySerializer(serializers.ModelSerializer):
    """
    Bug-hardening round — the narrow allowance invoice_detail's PUT
    handler uses for a non-draft, non-terminal invoice's "Change Due
    Date" More-menu action: exactly this one field, nothing else,
    mirroring RecurringSeriesSettingsSerializer's own established
    pattern immediately above (a real, small, dedicated serializer for
    one specific narrow case, not a body-content-sniffing exception
    bolted onto the general-purpose InvoiceSerializer). due_date must
    still be on or after the invoice's own real, already-frozen
    issue_date — same `>=` boundary InvoiceSerializer.validate() itself
    enforces (see that method's own docstring for the same-day
    reasoning), re-derived here since this serializer's Meta.fields
    deliberately excludes issue_date entirely (it's immutable past
    draft — this action changes ONLY due_date).
    """
    class Meta:
        model = Invoice
        fields = ['due_date']

    def validate_due_date(self, value):
        if value is None:
            raise serializers.ValidationError('A due date is required.')
        if self.instance and self.instance.issue_date and value < self.instance.issue_date:
            raise serializers.ValidationError('Due date cannot be before the issue date.')
        return value


class InvoiceListSerializer(serializers.ModelSerializer):
    """
    Read representation for list/detail GET responses — includes the
    computed properties (days_overdue/outstanding_amount/is_editable)
    the spec calls for, plus nested line items.
    """
    items = InvoiceItemSerializer(many=True, read_only=True)
    days_overdue = serializers.IntegerField(read_only=True)
    outstanding_amount = serializers.DecimalField(max_digits=12, decimal_places=2, read_only=True)
    is_editable = serializers.BooleanField(read_only=True)

    class Meta:
        model = Invoice
        fields = [
            'id', 'invoice_number', 'status', 'sent_via_platform', 'view_token',
            'client', 'client_name', 'client_email', 'client_company', 'client_address', 'client_phone',
            'currency', 'subtotal', 'tax_rate', 'tax_amount', 'discount_amount', 'total', 'amount_paid',
            'refunded_amount',
            'rate_to_usd_at_issue', 'pdf_url', 'pdf_generated_at',
            'issue_date', 'due_date', 'paid_date', 'sent_at',
            'notes', 'terms',
            'reminders_enabled', 'reminder_count', 'last_reminder_sent_at',
            'late_fee_enabled', 'late_fee_rate',
            'is_recurring', 'recurring_interval_days', 'recurring_auto_send', 'recurring_paused',
            'next_recurring_date', 'recurring_failure_count', 'parent_invoice',
            'escalation_required', 'escalation_dismissed',
            'is_one_time_client', 'client_acknowledged', 'client_acknowledged_at',
            'formal_notice_sent_at',
            'days_overdue', 'outstanding_amount', 'is_editable',
            'items', 'created_at', 'updated_at',
        ]


class InvoicePresetItemSerializer(serializers.ModelSerializer):
    class Meta:
        model = InvoicePresetItem
        fields = ['id', 'description', 'quantity', 'unit_price', 'sort_order']
        read_only_fields = ['id']


class InvoicePresetSerializer(serializers.ModelSerializer):
    """Same client-ownership scoping as InvoiceSerializer, and for the same reason."""
    items = InvoicePresetItemSerializer(many=True, required=False)

    class Meta:
        model = InvoicePreset
        fields = [
            'id', 'name', 'description', 'include_client', 'client', 'client_name', 'client_email',
            'client_company', 'currency', 'tax_rate', 'discount_amount', 'payment_terms', 'notes',
            'terms', 'late_fee_enabled', 'late_fee_rate', 'is_default', 'items',
            'created_at', 'updated_at',
        ]
        read_only_fields = ['id']

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        request = self.context.get('request')
        if request is not None:
            self.fields['client'].queryset = Client.objects.filter(user=request.user)

    def validate_name(self, value):
        value = value.strip()
        if not value:
            raise serializers.ValidationError('Preset name is required.')
        return value

    def validate_currency(self, value):
        return validate_currency_code(value)

    def create(self, validated_data):
        items_data = validated_data.pop('items', [])
        preset = InvoicePreset.objects.create(**validated_data)
        for item_data in items_data:
            InvoicePresetItem.objects.create(preset=preset, **item_data)
        return preset

    def update(self, instance, validated_data):
        items_data = validated_data.pop('items', None)
        for attr, value in validated_data.items():
            setattr(instance, attr, value)
        instance.save()
        if items_data is not None:
            instance.items.all().delete()
            for item_data in items_data:
                InvoicePresetItem.objects.create(preset=instance, **item_data)
        return instance


class InvoiceDesignSerializer(serializers.ModelSerializer):
    """
    Step 8 — the real validated contract Step 8b's canvas editor builds
    against. `source` defaults to 'custom' here on create (the model's
    own field default is 'builtin', a Step 4 placeholder from before any
    design CRUD existed — see DECISIONS.md for why that's fine to leave
    on the model and just override at this layer: design_duplicate is
    the only path that legitimately wants 'builtin', and it sets the
    field explicitly rather than relying on either default).
    """
    class Meta:
        model = InvoiceDesign
        fields = [
            'id', 'name', 'base_template', 'source', 'color_variant',
            'design_data', 'is_default', 'created_at', 'updated_at',
        ]
        read_only_fields = ['id', 'created_at', 'updated_at']

    def validate_name(self, value):
        value = value.strip()
        if not value:
            raise serializers.ValidationError('Design name is required.')
        return value

    def validate_design_data(self, value):
        errors = validate_design_data_schema(value)
        if errors:
            raise serializers.ValidationError(errors)
        return value

    def create(self, validated_data):
        validated_data.setdefault('source', 'custom')
        return super().create(validated_data)
