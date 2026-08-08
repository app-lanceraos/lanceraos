# apps/clients/views.py
import logging

from django.core.cache import cache
from django.db.models import Q
from django.shortcuts import get_object_or_404
from django.utils import timezone
from rest_framework import status
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from core.events import emit

from .models import FLAG_TYPE_CHOICES, Client, ClientNote, ClientTag
from .serializers import ClientListSerializer, ClientNoteSerializer, ClientSerializer, ClientTagSerializer

logger = logging.getLogger(__name__)


def _check_moderate_rate_limit(action, user):
    """
    CLAUDE.md rule 12's 'moderate' tier for data-mutation endpoints —
    an explicit Django-cache check, never DRF's scoped-throttle
    mechanism (confirmed dead config in v1; see STANDARDS.md). Keyed
    per-user per-action, mirroring apps.admin_panel's
    _admin_action_rate_limited shape, so unrelated actions on this
    resource don't share one budget. Returns True (and increments) if
    the request should be rejected.
    """
    key = f'ratelimit_clients_{action}_{user.pk}'
    count = cache.get(key, 0)
    if count >= 30:
        return True
    cache.set(key, count + 1, timeout=3600)
    return False


def _too_many_requests(message):
    return Response({'error': message}, status=status.HTTP_429_TOO_MANY_REQUESTS)


# ══════════════════════════════════════════════════════════════════
# CLIENT LIST / CREATE
# ══════════════════════════════════════════════════════════════════

@api_view(['GET', 'POST'])
@permission_classes([IsAuthenticated])
def client_list(request):
    """
    GET: filterable/searchable/sortable client list for the authenticated
    user, per INVOICES_CLIENTS_TECHNICAL_SPEC.md Section 7.
    POST: delegates to client_create — kept on this same view function
    since Django/DRF route one URL to one callable and this project never
    uses class-based views (CLAUDE.md rule 1); client_create still exists
    as its own independently-named, independently-testable function per
    STANDARDS.md's verb_noun convention.
    """
    if request.method == 'POST':
        return client_create(request)

    qs = Client.objects.filter(user=request.user)

    filter_param = request.query_params.get('filter', 'active')
    if filter_param == 'active':
        qs = qs.filter(is_active=True)
    elif filter_param == 'flagged':
        qs = qs.filter(is_flagged=True)
    elif filter_param == 'archived':
        qs = qs.filter(is_active=False)
    elif filter_param == 'new_this_month':
        start_of_month = timezone.now().replace(day=1, hour=0, minute=0, second=0, microsecond=0)
        qs = qs.filter(created_at__gte=start_of_month)
    elif filter_param == 'with_overdue':
        # apps.invoices doesn't exist yet — there's no overdue data to
        # filter on. An empty queryset is more honest than silently
        # falling back to "all", which would make this filter look like
        # it matched every client rather than none.
        qs = qs.none()
    # filter=all (or anything unrecognized) applies no is_active filter.

    search = request.query_params.get('search', '').strip()
    if search:
        qs = qs.filter(Q(name__icontains=search) | Q(email__icontains=search) | Q(company__icontains=search))

    sort = request.query_params.get('sort', 'name')
    if sort in ('total_invoiced', 'overdue'):
        # Both need real Invoice data to mean anything, and apps.invoices
        # doesn't exist yet — this app is deliberately being built ahead
        # of it, per the spec's build order. Falling back to name-sort
        # rather than reaching into a nonexistent app; revisit once
        # Invoice exists and Client has a real reverse relation to it.
        logger.info('[CLIENTS] sort=%s requested but not yet supported (apps.invoices does not exist); falling back to name.', sort)
        qs = qs.order_by('name')
    elif sort == 'recent':
        qs = qs.order_by('-created_at')
    else:
        qs = qs.order_by('name')

    try:
        limit = min(max(int(request.query_params.get('limit', 50)), 1), 200)
    except ValueError:
        limit = 50
    try:
        offset = max(int(request.query_params.get('offset', 0)), 0)
    except ValueError:
        offset = 0

    total = qs.count()
    page = qs[offset:offset + limit]

    return Response({
        'results': ClientListSerializer(page, many=True).data,
        'total': total,
        'limit': limit,
        'offset': offset,
    })


def client_create(request):
    """Creates a new client owned by the authenticated user. Emits ClientCreated."""
    if _check_moderate_rate_limit('create', request.user):
        return _too_many_requests('Too many clients created recently. Please try again later.')

    serializer = ClientSerializer(data=request.data, context={'request': request})
    if not serializer.is_valid():
        return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)

    client = serializer.save(user=request.user)
    emit('ClientCreated', client_id=str(client.pk), user_id=str(request.user.pk))
    logger.info('[CLIENTS] Created client %s for user %s.', client.pk, request.user.pk)
    return Response(ClientListSerializer(client).data, status=status.HTTP_201_CREATED)


# ══════════════════════════════════════════════════════════════════
# CLIENT DETAIL
# ══════════════════════════════════════════════════════════════════

@api_view(['GET', 'PUT'])
@permission_classes([IsAuthenticated])
def client_detail(request, pk):
    """Retrieves or updates a single client owned by the authenticated user."""
    client = get_object_or_404(Client, pk=pk, user=request.user)

    if request.method == 'GET':
        return Response(ClientListSerializer(client).data)

    if _check_moderate_rate_limit('update', request.user):
        return _too_many_requests('Too many updates. Please try again later.')

    serializer = ClientSerializer(client, data=request.data, context={'request': request})
    if not serializer.is_valid():
        return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)
    serializer.save()
    logger.info('[CLIENTS] Updated client %s.', client.pk)
    return Response(ClientListSerializer(client).data)


# ══════════════════════════════════════════════════════════════════
# ARCHIVE / RESTORE / FLAG
# ══════════════════════════════════════════════════════════════════

@api_view(['POST'])
@permission_classes([IsAuthenticated])
def client_archive(request, pk):
    """Archives a client (is_active=False) — never deletes. Emits ClientArchived."""
    if _check_moderate_rate_limit('archive', request.user):
        return _too_many_requests('Too many archive actions. Please try again later.')

    client = get_object_or_404(Client, pk=pk, user=request.user)
    if not client.is_active:
        return Response({'error': 'This client is already archived.'}, status=status.HTTP_400_BAD_REQUEST)

    client.is_active = False
    client.save(update_fields=['is_active', 'updated_at'])
    emit('ClientArchived', client_id=str(client.pk), user_id=str(request.user.pk))
    logger.info('[CLIENTS] Archived client %s.', client.pk)
    return Response(ClientListSerializer(client).data)


@api_view(['POST'])
@permission_classes([IsAuthenticated])
def client_restore(request, pk):
    """Restores an archived client (is_active=True). No event — ClientRestored isn't in the spec's event catalog."""
    if _check_moderate_rate_limit('restore', request.user):
        return _too_many_requests('Too many restore actions. Please try again later.')

    client = get_object_or_404(Client, pk=pk, user=request.user)
    if client.is_active:
        return Response({'error': 'This client is not archived.'}, status=status.HTTP_400_BAD_REQUEST)

    client.is_active = True
    client.save(update_fields=['is_active', 'updated_at'])
    logger.info('[CLIENTS] Restored client %s.', client.pk)
    return Response(ClientListSerializer(client).data)


@api_view(['POST'])
@permission_classes([IsAuthenticated])
def client_flag(request, pk):
    """
    Flags or clears a flag on a client. Manual only, per the decisions
    doc — auto_flagged (score-threshold-derived flagging) is reserved on
    the model but has no logic firing yet. Emits ClientFlagged on flag,
    not on clear (only the catalog event, per the spec).
    Body: {"clear": true} to unflag, or {"flag_type": "...", "flag_reason": "..."} to flag.
    """
    if _check_moderate_rate_limit('flag', request.user):
        return _too_many_requests('Too many flag actions. Please try again later.')

    client = get_object_or_404(Client, pk=pk, user=request.user)

    if request.data.get('clear'):
        client.is_flagged = False
        client.flag_reason = ''
        client.flag_type = ''
        client.flagged_at = None
        client.save(update_fields=['is_flagged', 'flag_reason', 'flag_type', 'flagged_at', 'updated_at'])
        logger.info('[CLIENTS] Cleared flag on client %s.', client.pk)
        return Response(ClientListSerializer(client).data)

    flag_reason = (request.data.get('flag_reason') or '').strip()
    flag_type = (request.data.get('flag_type') or '').strip()
    if not flag_reason:
        return Response({'error': 'A reason is required to flag a client.'}, status=status.HTTP_400_BAD_REQUEST)
    if flag_type and flag_type not in dict(FLAG_TYPE_CHOICES):
        return Response({'error': 'Invalid flag_type.'}, status=status.HTTP_400_BAD_REQUEST)

    client.is_flagged = True
    client.flag_type = flag_type
    client.flag_reason = flag_reason
    client.flagged_at = timezone.now()
    client.save(update_fields=['is_flagged', 'flag_type', 'flag_reason', 'flagged_at', 'updated_at'])
    emit('ClientFlagged', client_id=str(client.pk), user_id=str(request.user.pk), flag_type=flag_type)
    logger.info('[CLIENTS] Flagged client %s (type=%s).', client.pk, flag_type)
    return Response(ClientListSerializer(client).data)


# ══════════════════════════════════════════════════════════════════
# NOTES
# ══════════════════════════════════════════════════════════════════

@api_view(['GET', 'POST'])
@permission_classes([IsAuthenticated])
def client_notes(request, pk):
    """Lists or creates private, freelancer-authored notes for a client."""
    client = get_object_or_404(Client, pk=pk, user=request.user)

    if request.method == 'GET':
        notes = client.client_notes.select_related('author').all()
        return Response(ClientNoteSerializer(notes, many=True).data)

    if _check_moderate_rate_limit('note_create', request.user):
        return _too_many_requests('Too many notes added recently. Please try again later.')

    serializer = ClientNoteSerializer(data=request.data, context={'request': request})
    if not serializer.is_valid():
        return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)
    note = serializer.save(client=client, author=request.user)
    logger.info('[CLIENTS] Note added to client %s.', client.pk)
    return Response(ClientNoteSerializer(note).data, status=status.HTTP_201_CREATED)


@api_view(['PUT', 'DELETE'])
@permission_classes([IsAuthenticated])
def client_note_detail(request, pk, note_id):
    """
    Updates or permanently deletes a private note. Hard delete — no
    soft-delete/legal significance for this data.

    The update path was missing from Step 2's original scope — a real
    gap, not a deliberate immutability choice: unlike InvoiceComment
    (deliberately immutable per the spec, no updated_at at all),
    ClientNote has always carried a real updated_at field and was never
    designed as append-only. See DECISIONS.md for the record of this gap
    and why it's being closed here rather than left queued.
    """
    action = 'note_delete' if request.method == 'DELETE' else 'note_update'
    if _check_moderate_rate_limit(action, request.user):
        message = (
            'Too many note deletions. Please try again later.' if request.method == 'DELETE'
            else 'Too many note updates. Please try again later.'
        )
        return _too_many_requests(message)

    client = get_object_or_404(Client, pk=pk, user=request.user)
    note = get_object_or_404(ClientNote, pk=note_id, client=client)

    if request.method == 'DELETE':
        note.delete()
        logger.info('[CLIENTS] Note %s deleted from client %s.', note_id, client.pk)
        return Response(status=status.HTTP_204_NO_CONTENT)

    serializer = ClientNoteSerializer(note, data=request.data, context={'request': request})
    if not serializer.is_valid():
        return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)
    serializer.save()
    logger.info('[CLIENTS] Note %s updated on client %s.', note_id, client.pk)
    return Response(ClientNoteSerializer(note).data)


# ══════════════════════════════════════════════════════════════════
# ANALYTICS
# ══════════════════════════════════════════════════════════════════

@api_view(['GET'])
@permission_classes([IsAuthenticated])
def client_analytics(request, pk):
    """
    Returns payment_stats (totals + the reliability score/breakdown) for
    a client. The endpoint's shape is final now per the spec; every
    number is genuinely zero/None, not faked, until apps.invoices exists
    and Client._invoices_for_scoring has a real reverse relation to see.
    """
    client = get_object_or_404(Client, pk=pk, user=request.user)
    return Response(client.payment_stats)


# ══════════════════════════════════════════════════════════════════
# TAGS
# ══════════════════════════════════════════════════════════════════

@api_view(['GET', 'POST'])
@permission_classes([IsAuthenticated])
def client_tags(request):
    """Lists or creates the authenticated user's client tags (global, not scoped to one client)."""
    if request.method == 'GET':
        tags = ClientTag.objects.filter(user=request.user)
        return Response(ClientTagSerializer(tags, many=True).data)

    if _check_moderate_rate_limit('tag_create', request.user):
        return _too_many_requests('Too many tags created recently. Please try again later.')

    serializer = ClientTagSerializer(data=request.data, context={'request': request})
    if not serializer.is_valid():
        return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)
    tag = serializer.save(user=request.user)
    logger.info('[CLIENTS] Tag %s created for user %s.', tag.pk, request.user.pk)
    return Response(ClientTagSerializer(tag).data, status=status.HTTP_201_CREATED)


@api_view(['POST'])
@permission_classes([IsAuthenticated])
def client_tag_attach(request, pk, tag_id):
    """Attaches an existing tag (owned by the same user) to a client."""
    if _check_moderate_rate_limit('tag_attach', request.user):
        return _too_many_requests('Too many tag actions. Please try again later.')

    client = get_object_or_404(Client, pk=pk, user=request.user)
    tag = get_object_or_404(ClientTag, pk=tag_id, user=request.user)
    client.tags.add(tag)
    logger.info('[CLIENTS] Tag %s attached to client %s.', tag.pk, client.pk)
    return Response(ClientListSerializer(client).data)


@api_view(['DELETE'])
@permission_classes([IsAuthenticated])
def client_tag_detach(request, pk, tag_id):
    """Detaches a tag from a client. Does not delete the tag itself, which may still be attached to other clients."""
    if _check_moderate_rate_limit('tag_detach', request.user):
        return _too_many_requests('Too many tag actions. Please try again later.')

    client = get_object_or_404(Client, pk=pk, user=request.user)
    tag = get_object_or_404(ClientTag, pk=tag_id, user=request.user)
    client.tags.remove(tag)
    logger.info('[CLIENTS] Tag %s detached from client %s.', tag.pk, client.pk)
    return Response(ClientListSerializer(client).data)
