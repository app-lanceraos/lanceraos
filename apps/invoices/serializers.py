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

from .models import Invoice, InvoiceItem, InvoicePartialPayment, InvoicePreset, InvoicePresetItem


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
    """
    items = InvoiceItemSerializer(many=True, required=False)

    class Meta:
        model = Invoice
        fields = [
            'id', 'client', 'client_name', 'client_email', 'client_company', 'client_address',
            'client_phone', 'currency', 'tax_rate', 'discount_amount', 'due_date', 'notes', 'terms',
            'reminders_enabled', 'late_fee_enabled', 'late_fee_rate', 'is_recurring',
            'recurring_interval_days', 'recurring_auto_send', 'is_one_time_client', 'items',
        ]
        read_only_fields = ['id']

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        request = self.context.get('request')
        if request is not None:
            self.fields['client'].queryset = Client.objects.filter(user=request.user)

    def validate_client_name(self, value):
        value = value.strip()
        if not value:
            raise serializers.ValidationError('Client name is required.')
        return value

    def validate_currency(self, value):
        return validate_currency_code(value)

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
            'rate_to_usd_at_issue', 'pdf_url', 'pdf_generated_at',
            'issue_date', 'due_date', 'paid_date', 'sent_at',
            'notes', 'terms',
            'reminders_enabled', 'reminder_count', 'last_reminder_sent_at',
            'late_fee_enabled', 'late_fee_rate',
            'is_recurring', 'recurring_interval_days', 'recurring_auto_send', 'recurring_paused',
            'next_recurring_date',
            'escalation_required', 'escalation_dismissed',
            'is_one_time_client', 'client_acknowledged', 'client_acknowledged_at',
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
