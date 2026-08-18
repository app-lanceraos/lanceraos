# apps/invoices/views_portal.py
"""
Client Portal — invoice content, Step 12. Lives in apps.invoices (not
apps.clients) per INVOICES_CLIENTS_TECHNICAL_SPEC.md Section 2's
one-directional dependency rule: "Portal content — viewing invoices,
posting/reading comments, submitting payment claims — imports the
client-identity/session utility from apps.clients." Every import below
crosses that direction only (apps.invoices -> apps.clients), never the
reverse — confirmed the same way Step 11 confirmed apps.clients had zero
apps.invoices imports; see this step's own tests.

Two real portal-entry semantics, both landing on portal_invoice_view_html:
  - A SAVED client's invoice (invoice.client_id set): visiting it mints/
    renews a full ClientPortalSession for that client (via
    apps.clients.portal.issue_or_renew_session) — one click on any
    invoice link grants access to that client's entire portal (list +
    every other invoice), matching Step 11's Client.portal_token link as
    a second real entry point into the exact same session mechanism.
  - A ONE-TIME client's invoice (invoice.client_id is null,
    is_one_time_client=True): renders the identical page, but creates NO
    ClientPortalSession — there's no Client row to attach one to. Access
    is scoped to this exact invoice only, via its own view_token.

portal_invoice_view_html itself now serves the actual FROZEN PDF inline
once one exists (see that view's own docstring and DECISIONS.md's
frozen-PDF-vs-live-render entry) — render_invoice_portal_html
(pdf_generator.py) is no longer called from there at all. It's still the
real, shared HTML renderer for invoice_preview_as_client (below) — a
structurally separate, freelancer-only endpoint that deliberately DOES
want CURRENT data, for any status including still-draft — so the
one-shared-renderer principle (never a hand-built reimplementation of
the PDF layout) still holds for that one remaining consumer.
"""
import logging

from django.core.cache import cache
from django.http import HttpResponse
from django.shortcuts import get_object_or_404
from django.utils import timezone
from django.views.decorators.clickjacking import xframe_options_exempt
from rest_framework import status
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response

from core.events import emit
from core.observability import get_client_ip, get_user_agent

from apps.clients.portal import is_freelancer_previewing_portal, issue_or_renew_session, resolve_session_from_request

from .comments import broadcast_comment, broadcast_read_state, upload_comment_attachment
from .email_service import fetch_invoice_pdf_bytes
from .models import Invoice, InvoiceComment, InvoiceViewEvent
from .pdf_generator import render_invoice_portal_html
from .serializers_claims import PaymentClaimSerializer, PortalClaimCreateSerializer
from .serializers_comments import CommentCreateSerializer, InvoiceCommentSerializer
from .serializers_portal import PortalInvoiceDetailSerializer, PortalInvoiceListSerializer

logger = logging.getLogger(__name__)

# Tighter than the freelancer side's 30/hour (_check_moderate_rate_limit,
# views.py) but not as tight as Step 11's fully-anonymous 5/email-hr —
# a portal comment poster already holds a real, unguessable
# ClientPortalSession (harder to script-spam than a bare email field),
# just with less accountability behind it than an authenticated
# freelancer account. Keyed by client, not IP/email — the session
# itself is the identity here.
PORTAL_COMMENT_RATE_LIMIT_PER_HOUR = 15


def _check_portal_comment_rate_limit(client):
    key = f'ratelimit_portal_comment_{client.pk}'
    count = cache.get(key, 0)
    if count >= PORTAL_COMMENT_RATE_LIMIT_PER_HOUR:
        return True
    cache.set(key, count + 1, timeout=3600)
    return False


# Tighter still than comments — a payment claim is a deliberate,
# infrequent action (not a back-and-forth conversation), so a lower
# ceiling doesn't cost a real user anything. Keyed by client.pk for a
# saved-client session, or invoice.pk for a one-time-client submission
# (see portal_invoice_claims — there's no Client row to key by in that
# case), never IP/email.
PORTAL_CLAIM_RATE_LIMIT_PER_HOUR = 5


def _check_portal_claim_rate_limit(identifier):
    key = f'ratelimit_portal_claim_{identifier}'
    count = cache.get(key, 0)
    if count >= PORTAL_CLAIM_RATE_LIMIT_PER_HOUR:
        return True
    cache.set(key, count + 1, timeout=3600)
    return False


# Same 5/hour-by-client-or-invoice shape as claims (Step 15's own
# instruction — a real, if minor, attack surface regardless of low
# stakes; consistency with the established pattern matters more here
# than a bespoke lighter limit) — a genuinely separate counter/cache-key
# prefix, though, so submitting claims and acknowledging don't share one
# budget and starve each other.
PORTAL_ACKNOWLEDGE_RATE_LIMIT_PER_HOUR = 5


def _check_portal_acknowledge_rate_limit(identifier):
    key = f'ratelimit_portal_acknowledge_{identifier}'
    count = cache.get(key, 0)
    if count >= PORTAL_ACKNOWLEDGE_RATE_LIMIT_PER_HOUR:
        return True
    cache.set(key, count + 1, timeout=3600)
    return False


def _record_invoice_view_if_appropriate(invoice, request):
    """
    The one real "a client viewed this invoice" side effect, called
    exactly once (from portal_invoice_view_html) — never from
    invoice_preview_as_client below, which is a structurally separate,
    freelancer-only endpoint with no view-tracking code path to guard in
    the first place.

    ONE shared guard check gates BOTH real side effects together (the
    Sent->Viewed status transition and the InvoiceViewEvent write) —
    not two separate calls to is_freelancer_previewing_portal that could
    drift out of sync. Per the spec: a freelancer who clicked their own
    client's magic link without logging out of their own LanceraOS
    account first must never have that count as a real client view.
    """
    if is_freelancer_previewing_portal(request):
        return

    InvoiceViewEvent.objects.create(
        invoice=invoice, source='platform_view',
        ip_address=get_client_ip(request), user_agent=get_user_agent(request)[:300],
    )

    if invoice.status == 'sent':
        invoice.status = 'viewed'
        invoice.save(update_fields=['status'])

    emit('InvoiceViewed', invoice_id=str(invoice.pk), user_id=str(invoice.user_id))


@api_view(['GET'])
@permission_classes([AllowAny])
def portal_invoice_list(request):
    """
    The client's own invoice list — portal-session-authenticated via
    apps.clients.portal.resolve_session_from_request, NOT apps.users
    auth (there is no freelancer login involved on this side at all).
    401, not empty-list, when no valid session is present — a client
    with no session shouldn't see "you have zero invoices," they should
    see "you're not logged in."

    FIXED (real, confirmed bug — see DECISIONS.md): this used to return
    EVERY invoice for the resolved client, including draft and
    created-but-never-sent ones — a client who already has portal access
    via one real sent invoice could see (and know about) invoices that
    genuinely never reached them by any means. Now excludes 'draft' and
    'created' — the same "has this actually been delivered by some real
    means" boundary this app already draws everywhere else an invoice's
    reachability matters (e.g. invoice_pdf's own live-vs-frozen split,
    InvoiceDetailPanel's "hasn't been sent" banner): status only ever
    advances past 'created' via invoice_mark_sent or the real /send/ —
    manual or platform, either way a genuine real-world delivery event —
    so 'status not in (draft, created)' is exactly "reached the client by
    some real means," not a new, independently-invented definition.
    """
    client = resolve_session_from_request(request)
    if client is None:
        return Response({'error': 'No active portal session.'}, status=status.HTTP_401_UNAUTHORIZED)

    invoices = (
        Invoice.objects.filter(client=client)
        .exclude(status__in=('draft', 'created'))
        .order_by('-issue_date', '-created_at')
    )
    return Response(PortalInvoiceListSerializer(invoices, many=True).data)


@api_view(['GET'])
@permission_classes([AllowAny])
def portal_invoice_detail(request, pk):
    """
    A single invoice's client-visible detail — scoped to invoices
    belonging to the resolved Client only. A real 404, not 403, for any
    invoice belonging to someone else (a different client of this same
    freelancer, or a different freelancer entirely) — this must not
    confirm to an unauthorized viewer that a given invoice id even
    exists, the same reasoning portal_invoice_view_html's own unknown-
    token handling already follows.
    """
    client = resolve_session_from_request(request)
    if client is None:
        return Response({'error': 'No active portal session.'}, status=status.HTTP_401_UNAUTHORIZED)

    invoice = get_object_or_404(Invoice, pk=pk, client=client)
    return Response(PortalInvoiceDetailSerializer(invoice).data)


def _resolve_invoice_pdf_bytes_for_view(invoice):
    """
    STRICTER than fetch_invoice_pdf_bytes' own contract, deliberately — a
    blank pdf_url here is treated as "genuinely not ready yet," never as
    "render live instead." This is the real, confirmed fix for a real
    drift bug (see DECISIONS.md): build_portal_context used to pull the
    freelancer's CURRENT FreelancerProfile (business name, logo, payment
    methods, signature) fresh on every single view, even though the
    invoice's own fields are frozen (is_editable blocks changes past
    draft) — so a freelancer editing their profile after sending an
    invoice silently changed what "View Invoice" showed a client days
    later, while the actual downloadable PDF stayed correctly frozen. Two
    documents, same invoice, able to disagree.

    Once a real pdf_url DOES exist, this still calls fetch_invoice_pdf_bytes
    — its own self-heal chain (re-upload+retry, then a live-render
    fallback only as a last resort under a genuine Cloudinary-side
    failure) is left exactly as-is here, matching Download's own
    resilience for that narrow, infrequent case: by the time a real
    pdf_url was ever set, the invoice was genuinely frozen at some point,
    so self-heal there is real recovery, not routine, every-view
    behavior — a fundamentally different risk profile than the "current
    profile data on literally every request" bug this function exists to
    close.
    """
    if not invoice.pdf_url:
        return None
    return fetch_invoice_pdf_bytes(invoice)


@api_view(['GET'])
@permission_classes([AllowAny])
def portal_invoice_view_html(request, view_token):
    """
    The real invoice VIEW. REWORKED (see DECISIONS.md's frozen-PDF-vs-
    live-render entry): now serves the ACTUAL FROZEN PDF inline — the
    exact same bytes portal_invoice_pdf_download serves as an attachment
    — instead of live-rendering the shared HTML template from CURRENT
    invoice+profile data on every single request. Every real path that
    can reach this endpoint (the "View Invoice Online" email link, the
    portal list, the PDF's own QR code / "Pay online" link, the
    freelancer's own "View Invoice" button) was traced directly, not
    assumed: every one only exists for a created-or-beyond invoice, which
    already has — or will shortly have, via _finalise_invoice's own
    background render+store — a real stored pdf_url. A draft invoice's
    view_token is never exposed through any of those paths at all (no
    email is ever sent for a draft, the wizard's own "Preview PDF" action
    hits a completely different, freelancer-authenticated endpoint,
    apps/invoices/views.py's invoice_pdf, and the client-portal list now
    excludes draft/created entirely — see this same DECISIONS.md entry's
    portal-list-scoping half).

    When no frozen PDF exists yet (the invoice was only just finalised
    and the background task hasn't landed, or a total infrastructure
    failure), this returns a real 503 with a clear, specific error rather
    than ever falling back to a live re-render — the exact drift problem
    this rework closes. Content-Type text/html is gone from this view's
    own successful path entirely; render_invoice_portal_html/
    build_portal_context remain used elsewhere (invoice_preview_as_client,
    below — a structurally separate, freelancer-only preview with a
    fundamentally different intent: showing CURRENT data on purpose, for
    any status including still-draft, currently unreachable from the
    frontend UI since Preview-as-Client's own button was removed — see
    that view's own docstring) but are no longer called from here at all.

    Session minting + view-tracking (issue_or_renew_session,
    _record_invoice_view_if_appropriate) both still fire unconditionally,
    regardless of which branch produced the response — a client who
    followed a real link should still be tracked as having visited, even
    in the rare case where the PDF isn't ready yet. Public/unauthenticated
    by design (view_token itself is the credential) — a real 404 for an
    unknown token, not a redirect or an empty page, so an invalid link
    doesn't look like "this invoice was deleted" or leak which tokens
    almost matched.
    """
    invoice = get_object_or_404(Invoice, view_token=view_token)

    pdf_bytes = _resolve_invoice_pdf_bytes_for_view(invoice)
    if pdf_bytes is not None:
        response = HttpResponse(pdf_bytes, content_type='application/pdf')
        response['Content-Disposition'] = f'inline; filename="{invoice.invoice_number or "invoice"}.pdf"'
    else:
        response = Response(
            {'error': "This invoice isn't ready to view yet. Please check back in a moment."},
            status=status.HTTP_503_SERVICE_UNAVAILABLE,
        )

    if invoice.client_id:
        issue_or_renew_session(invoice.client, request, response)
    # else: a one-time client's invoice — no Client row to attach a
    # session to. Access stays scoped to this exact invoice's own
    # view_token, per the spec's "no portal, no session" rule.

    _record_invoice_view_if_appropriate(invoice, request)

    return response


@api_view(['GET'])
@permission_classes([AllowAny])
def portal_invoice_pdf_download(request, view_token):
    """
    Real, public PDF download for the invoice VIEW page (frontend's own
    `/invoice/<token>/` route, see DECISIONS.md) — added alongside that
    page since the shared invoice templates have no Download link of
    their own (confirmed directly: no template references pdf_url or any
    download affordance), and the freelancer-facing GET
    /api/invoices/<pk>/pdf/ is IsAuthenticated/owner-scoped, unreachable
    by an actual client with no LanceraOS account. Same
    view_token-is-the-credential trust model as portal_invoice_view_html
    right above (AllowAny, real 404 for an unknown token) — this is a
    read-only, side-effect-free action (no view-tracking, no session
    minting) unlike that view, so it doesn't duplicate any of its side
    effects.

    Reuses fetch_invoice_pdf_bytes — the exact same self-heal chain
    invoice_pdf/invoice_send/the reminder task all already rely on, not a
    second, parallel fetch implementation — so this download is resilient
    to the same Cloudinary ACL condition invoice_pdf's own rework fixes
    for the freelancer-facing side (see that view's own docstring).
    """
    invoice = get_object_or_404(Invoice, view_token=view_token)

    pdf_bytes = fetch_invoice_pdf_bytes(invoice)
    if pdf_bytes is None:
        return Response(
            {'error': "Could not prepare this invoice's PDF right now. Please try again shortly."},
            status=status.HTTP_502_BAD_GATEWAY,
        )

    response = HttpResponse(pdf_bytes, content_type='application/pdf')
    response['Content-Disposition'] = f'attachment; filename="{invoice.invoice_number or "invoice"}.pdf"'
    return response


@xframe_options_exempt
@api_view(['GET'])
@permission_classes([IsAuthenticated])
def invoice_preview_as_client(request, pk):
    """
    Preview-as-Client — freelancer-facing, reachable from
    InvoiceDetailPanel, NOT the public portal. Renders the exact same
    HTML render_invoice_portal_html produces for a real client (the same
    shared renderer portal_invoice_view_html uses), inside an
    authenticated-app context — the frontend wraps this in an iframe with
    its own persistent "You're previewing as [client]" banner (pure React
    chrome, never part of the shared template itself, so the two render
    paths' actual markup never diverges).

    FIXED (item 14 of the verification pass — real, confirmed bug, root-
    caused by reproducing it directly rather than guessing): this
    response was silently blocked from ever rendering inside that iframe
    by Django's own clickjacking protection — X_FRAME_OPTIONS='DENY' in
    production (config/settings.py, SECURITY HEADERS block) and Django's
    own framework default of 'DENY' in DEBUG (never overridden here), so
    every browser refused to display the framed content in BOTH
    environments, not just prod. @xframe_options_exempt is a narrow,
    single-view exception — @permission_classes([IsAuthenticated]) above
    still fully gates who can reach it at all, so this doesn't weaken
    clickjacking protection for anything else in the app. Not a broken
    InvoiceDetailPanel refactor after all — confirmed directly, the
    button/modal wiring itself was always correct.

    Deliberately does NOT call apps.clients.portal.issue_or_renew_session
    (confirmed directly: not imported anywhere in this module) — this is
    the freelancer's own authenticated request, never a real portal
    entry, and must never mint a real ClientPortalSession. Also never
    calls _record_invoice_view_if_appropriate — a freelancer previewing
    their own invoice is not a client view to track, and this endpoint
    has no view-tracking code path to guard in the first place.

    Requires a real client — a one-time-client invoice has no portal
    identity to preview as (there's no Client, no portal_token, nothing
    a real client would ever visit for this invoice beyond its own
    view_token page, which already renders identically either way).
    """
    invoice = get_object_or_404(Invoice, pk=pk, user=request.user)
    if not invoice.client_id:
        return Response(
            {'error': 'This invoice has no client to preview as — it was created for a one-time client.'},
            status=status.HTTP_400_BAD_REQUEST,
        )

    html = render_invoice_portal_html(invoice)
    return HttpResponse(html, content_type='text/html')


@api_view(['GET', 'POST'])
@permission_classes([AllowAny])
def portal_invoice_comments(request, pk):
    """
    The client's own side of the unified two-way thread
    (apps/invoices/views.py's invoice_comments is the freelancer's side
    of the exact same InvoiceComment rows). Portal-session-authenticated,
    scoped to the resolved client's own invoices only — same 401/404
    discipline Step 12 established (401 with no session at all; a real
    404, not the client's own comments on someone else's invoice, since
    get_object_or_404 is scoped to client=client).

    GET marks every currently-unread, FREELANCER-authored comment as
    read (read_by_client_at), mirroring invoice_comments' own read-
    marking exactly, just the other direction — EXCEPT while
    is_freelancer_previewing_portal(request) is True (item 9 of the
    verification pass — a real, confirmed gap: this guard was already
    wired into the POST path below, but never into GET's own read-
    marking, so a freelancer who visits their own client's real portal
    link without logging out first would falsely mark their own
    messages as "seen by the client" just by looking. The comments
    themselves still return normally either way — only the read
    timestamp is skipped.

    POST creates a real, permanent InvoiceComment (author_type='client',
    client_name/client_email snapshotted from the resolved Client —
    never client-supplied, per serializers_comments.py's own docstring)
    and broadcasts it to the invoice's WebSocket thread group. Rate
    limited tighter than the freelancer side (see
    PORTAL_COMMENT_RATE_LIMIT_PER_HOUR above).

    Also rejects the freelancer-preview-mode case (Step 14 gap-closing —
    Step 13 wired is_freelancer_previewing_portal into the Sent->Viewed
    transition and InvoiceViewEvent logging only; this endpoint never got
    it, confirmed directly against DECISIONS.md's own Step 13 entry
    having no mention of it). A freelancer who clicked their own client's
    real portal link without logging out of their own account first must
    never have a message they post there misattributed as a real client
    message.
    """
    client = resolve_session_from_request(request)
    if client is None:
        return Response({'error': 'No active portal session.'}, status=status.HTTP_401_UNAUTHORIZED)

    invoice = get_object_or_404(Invoice, pk=pk, client=client)

    if request.method == 'GET':
        if not is_freelancer_previewing_portal(request):
            # ids captured BEFORE the update, not re-derived afterward —
            # see invoice_comments' own identical comment (views.py) for
            # why (item 3 of the 16 August 2026 second verification pass).
            newly_read_ids = list(InvoiceComment.objects.filter(
                invoice=invoice, author_type='freelancer', read_by_client_at__isnull=True,
            ).values_list('id', flat=True))
            if newly_read_ids:
                InvoiceComment.objects.filter(id__in=newly_read_ids).update(read_by_client_at=timezone.now())
                broadcast_read_state(invoice, 'read_by_client_at', newly_read_ids)
        comments = invoice.comments.all()
        return Response(InvoiceCommentSerializer(comments, many=True).data)

    if is_freelancer_previewing_portal(request):
        return Response(
            {'error': "You're previewing this portal as its own freelancer — messages can't be posted from preview mode."},
            status=status.HTTP_403_FORBIDDEN,
        )

    if _check_portal_comment_rate_limit(client):
        return Response(
            {'error': 'Too many messages. Please try again later.'}, status=status.HTTP_429_TOO_MANY_REQUESTS,
        )

    attachment_url = ''
    file = request.FILES.get('attachment')
    if file:
        result = upload_comment_attachment(file)
        if isinstance(result, Response):
            return result
        attachment_url = result

    serializer = CommentCreateSerializer(data=request.data)
    if not serializer.is_valid():
        return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)

    comment = serializer.save(
        invoice=invoice, author_type='client', client_name=client.name, client_email=client.email,
        source='portal', attachment_url=attachment_url,
    )
    broadcast_comment(comment)
    emit('CommentPosted', invoice_id=str(invoice.pk), user_id=str(invoice.user_id), comment_id=str(comment.pk), author_type='client')
    logger.info('[INVOICES] Comment posted by client on invoice %s.', invoice.invoice_number)
    return Response(InvoiceCommentSerializer(comment).data, status=status.HTTP_201_CREATED)


def _resolve_portal_write_access(request, pk):
    """
    Shared access resolution for portal-side WRITE actions that need one
    of the two real portal-entry shapes Step 12 established — a saved
    client's portal session, OR a one-time client proving ownership of
    that exact invoice via its own view_token in the request body (per
    Step 12's "no portal, no session" rule: a one-time client never gets
    a ClientPortalSession at all, so the token itself is the credential —
    the same real one portal_invoice_view_html already trusts for this
    invoice). Extracted this pass (Step 15) since portal_invoice_claims
    (Step 14) and portal_invoice_acknowledge (Step 15) both need the
    identical resolution, not a second hand-copied version of it.

    Looks up by bare pk first (not yet scoped to client__isnull/
    is_one_time_client) so a genuinely unknown pk still 404s; every other
    outcome (a saved-client invoice with no session, a one-time invoice
    with a missing/wrong token) normalizes to the same 401, never a 404
    that would confirm which specific reason applies.

    Returns (invoice, client_name, client_email, rate_limit_key) on
    success, or a Response (401) on failure — callers check
    isinstance(result, Response), the same convention
    upload_comment_attachment already established in this module.
    """
    client = resolve_session_from_request(request)
    if client is not None:
        invoice = get_object_or_404(Invoice, pk=pk, client=client)
        return invoice, client.name, client.email, str(client.pk)

    invoice = get_object_or_404(Invoice, pk=pk)
    # request.data is the parsed BODY — empty for a real GET request, so a
    # one-time client reading (not writing) needs the token from the query
    # string instead. request.data checked first, unchanged for every
    # existing POST caller.
    submitted_token = request.data.get('view_token') or request.query_params.get('view_token')
    if invoice.client_id or not invoice.is_one_time_client or not submitted_token or submitted_token != invoice.view_token:
        return Response({'error': 'No active portal session.'}, status=status.HTTP_401_UNAUTHORIZED)
    return invoice, invoice.client_name, invoice.client_email, str(invoice.pk)


@api_view(['GET', 'POST'])
@permission_classes([AllowAny])
def portal_invoice_claims(request, pk):
    """
    Payment claim submission — Step 14 (freelancer-side list/confirm/
    reject: apps/invoices/views.py's invoice_claims/invoice_claim_confirm/
    invoice_claim_reject). Access resolution shared with
    portal_invoice_acknowledge via _resolve_portal_write_access above.

    GET (item 5 of the 16 August 2026 second verification pass — real,
    confirmed gap: there was previously no way for a client to see
    whether their own submitted claim was confirmed/rejected at all)
    lists every claim on this invoice, newest first, reusing
    PaymentClaimSerializer directly — the exact same freelancer-facing
    read representation, not a second, redundant portal-specific one,
    since none of its fields (the client's own submission data, status,
    and the freelancer's own review_note if rejected) are sensitive to
    the client who submitted them. A one-time client reads this via its
    own view_token in the query string (?view_token=...), since a GET
    has no request body to carry it in — see _resolve_portal_write_access's
    own query_params fallback, above.

    POST rejects the submission outright (never silently drops it) when
    is_freelancer_previewing_portal(request) is True — the same guard
    portal_invoice_view_html applies to view-tracking and this pass just
    added to portal_invoice_comments, applied here for the same reason:
    a freelancer clicking their own client's real portal link without
    logging out first must never have a claim attributed to "the client"
    that was actually them clicking around their own preview. GET has no
    such guard — reading claim status has no write side effect to
    misattribute, matching portal_invoice_comments' own GET (which
    returns the thread regardless of preview mode; only ITS read-marking
    side effect is preview-guarded).

    Two real, confirmed bugs fixed this pass (see DECISIONS.md):
    (1) Nothing stopped a second claim being submitted while a real
    pending one already existed — now rejected outright, before either of
    the two checks below, with a specific "already being reviewed"
    message. (2) A client submitting a claim against an invoice that's
    already fully paid (outstanding_amount already 0 — whether from a
    previously CONFIRMED claim or a direct payment recorded elsewhere)
    was already being rejected, but only by validate_amount_claimed's
    generic "cannot exceed the outstanding balance of 0.00 USD" message —
    and that message, along with every other field-keyed
    serializer.errors entry, was NEVER ACTUALLY REACHING the client at
    all: ClientPortal.jsx's ClaimModal only ever reads a flat top-level
    `e.response?.data?.error` string, which DRF's default
    `{field: [messages]}` error shape doesn't provide, so every real
    validation message silently fell back to a generic "Could not submit
    — please try again." The already-paid-in-full case is now caught
    explicitly with its own specific message before the serializer even
    runs; every OTHER serializer validation error (e.g. a partial
    overpayment against a still-positive balance) now has its real first
    message re-surfaced under that same top-level `error` key instead of
    silently vanishing behind the generic fallback.
    """
    result = _resolve_portal_write_access(request, pk)
    if isinstance(result, Response):
        return result
    invoice, client_name, client_email, rate_limit_key = result

    if request.method == 'GET':
        return Response(PaymentClaimSerializer(invoice.payment_claims.all(), many=True).data)

    if is_freelancer_previewing_portal(request):
        return Response(
            {'error': "You're previewing this portal as its own freelancer — payment claims can't be submitted from preview mode."},
            status=status.HTTP_403_FORBIDDEN,
        )

    if _check_portal_claim_rate_limit(rate_limit_key):
        return Response({'error': 'Too many claims submitted. Please try again later.'}, status=status.HTTP_429_TOO_MANY_REQUESTS)

    if invoice.outstanding_amount <= 0:
        return Response({'error': 'This invoice has already been paid in full.'}, status=status.HTTP_400_BAD_REQUEST)

    if invoice.payment_claims.filter(status='pending').exists():
        return Response({'error': 'A payment claim is already being reviewed for this invoice.'}, status=status.HTTP_400_BAD_REQUEST)

    serializer = PortalClaimCreateSerializer(data=request.data, context={'invoice': invoice})
    if not serializer.is_valid():
        first_error = next(iter(serializer.errors.values()))[0] if serializer.errors else 'Invalid submission.'
        return Response({'error': str(first_error)}, status=status.HTTP_400_BAD_REQUEST)

    claim = serializer.save(invoice=invoice, client_name=client_name, client_email=client_email)
    emit('PaymentClaimSubmitted', invoice_id=str(invoice.pk), user_id=str(invoice.user_id), claim_id=str(claim.pk))
    logger.info('[INVOICES] Payment claim submitted on invoice %s.', invoice.invoice_number)
    return Response(PaymentClaimSerializer(claim).data, status=status.HTTP_201_CREATED)


@api_view(['POST'])
@permission_classes([AllowAny])
def portal_invoice_acknowledge(request, pk):
    """
    Client Acknowledgment — Step 15. Same access model as claims (a
    saved client's portal session, or a one-time client's invoice via
    its own view_token), and the identical freelancer-preview guard
    (this is the fifth real call site for is_freelancer_previewing_portal,
    per this step's own task framing — after the Sent->Viewed transition,
    InvoiceViewEvent logging, comment posting, and claim submission).

    ONE-TIME only: sets client_acknowledged=True/client_acknowledged_at=now()
    the first time. Idempotent on every later call — a client clicking
    twice (or the frontend re-POSTing after a flaky network response)
    gets back the EXISTING timestamp with a 200, never a 409/400. There
    is no unacknowledge path anywhere in this app, by design — a
    permanent record, same trust posture as InvoiceComment's own
    immutability and the frozen PDF.
    """
    result = _resolve_portal_write_access(request, pk)
    if isinstance(result, Response):
        return result
    invoice, _client_name, _client_email, rate_limit_key = result

    if is_freelancer_previewing_portal(request):
        return Response(
            {'error': "You're previewing this portal as its own freelancer — this invoice can't be acknowledged from preview mode."},
            status=status.HTTP_403_FORBIDDEN,
        )

    if invoice.client_acknowledged:
        return Response({'client_acknowledged': True, 'client_acknowledged_at': invoice.client_acknowledged_at})

    if _check_portal_acknowledge_rate_limit(rate_limit_key):
        return Response({'error': 'Too many attempts. Please try again later.'}, status=status.HTTP_429_TOO_MANY_REQUESTS)

    invoice.client_acknowledged = True
    invoice.client_acknowledged_at = timezone.now()
    invoice.save(update_fields=['client_acknowledged', 'client_acknowledged_at'])

    emit('InvoiceAcknowledged', invoice_id=str(invoice.pk), user_id=str(invoice.user_id))
    logger.info('[INVOICES] Invoice %s acknowledged by client.', invoice.invoice_number)
    return Response(
        {'client_acknowledged': True, 'client_acknowledged_at': invoice.client_acknowledged_at},
        status=status.HTTP_201_CREATED,
    )
