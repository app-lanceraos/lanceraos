# apps/payments/views_import.py
"""
The payment import API (Prompt 12, backend only). Function views, every query scoped to request.user,
every response `Cache-Control: no-store`. The two upload endpoints accept multipart only: a JSON body
is a 415, which also keeps parsed rows out of ApiRequestLog (multipart bodies are never captured).

Errors are {"error": "<sentence>", "code": "<machine code>"}; they never contain file content.
"""
import json
import logging

from django.db.models import Count
from rest_framework import status
from rest_framework.decorators import api_view, parser_classes, permission_classes
from rest_framework.parsers import JSONParser, MultiPartParser
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from core.observability import log_event
from core.ratelimit import rate_limited

from apps.payments.constants import IMPORT_MAX_BYTES, PAYMENT_SOURCE_LABELS
from apps.payments.http import no_store, too_many_requests
from apps.payments.importing.commit import commit_plan, safe_file_name, undo_batch
from apps.payments.importing.errors import ImportFileError, ImportProblem, ImportRefused
from apps.payments.importing.plan import build_plan, plan_payload
from apps.payments.models import PaymentImportBatch

logger = logging.getLogger(__name__)

PREVIEWS_PER_HOUR = 20
COMMITS_PER_HOUR = 10
UNDOS_PER_HOUR = 10
READS_PER_HOUR = 240
BATCH_LIST_LIMIT = 20
# multipart framing and the other form fields on top of the file itself
UPLOAD_OVERHEAD_BYTES = 64 * 1024


def _problem_response(problem):
    return Response({'error': problem.message, 'code': problem.code}, status=problem.http_status)


def _read_upload(request):
    """-> (raw bytes, file name). Refuses oversize before parsing the body, and never trusts the type."""
    declared = request.META.get('CONTENT_LENGTH')
    if declared and declared.isdigit() and int(declared) > IMPORT_MAX_BYTES + UPLOAD_OVERHEAD_BYTES:
        raise ImportFileError('file_too_large', 'This file is larger than 2 MB. Split it by year and import each part.')
    upload = request.FILES.get('file')
    if upload is None:
        raise ImportRefused('no_file', 'Choose a CSV file to upload.')
    name = safe_file_name(upload.name)
    if not name.lower().endswith(('.csv', '.txt')):
        raise ImportFileError('not_csv', 'Upload a .csv file.')
    raw = upload.read(IMPORT_MAX_BYTES + 1)
    if len(raw) > IMPORT_MAX_BYTES:
        raise ImportFileError('file_too_large', 'This file is larger than 2 MB. Split it by year and import each part.')
    return raw, name


def _json_field(request, key, expected, default=None):
    """A form field that carries JSON (multipart cannot nest objects). Missing -> `default`."""
    text = request.data.get(key)
    if text in (None, ''):
        return default
    try:
        value = json.loads(text)
    except (TypeError, ValueError, RecursionError):  # RecursionError: a deeply nested '[[[[...' string
        raise ImportRefused(f'bad_{key}', f'The {key.replace("_", " ")} could not be read.') from None
    if not isinstance(value, expected):
        raise ImportRefused(f'bad_{key}', f'The {key.replace("_", " ")} has the wrong shape.')
    return value


def _source_field(request):
    source = (request.data.get('source') or '').strip() or None
    if source is not None and source not in PAYMENT_SOURCE_LABELS:
        raise ImportRefused('bad_source', 'Unknown source.')
    return source


def batch_payload(batch, remaining):
    return {
        'id': str(batch.pk), 'source': batch.source, 'file_name': batch.file_name,
        'created_at': batch.created_at.isoformat(), 'rows_total': batch.rows_total, 'imported': batch.imported,
        'skipped_duplicate': batch.skipped_duplicate, 'skipped_not_income': batch.skipped_not_income,
        'skipped_invalid': batch.skipped_invalid, 'skipped_unselected': batch.skipped_unselected,
        'remaining': remaining, 'undone_at': batch.undone_at.isoformat() if batch.undone_at else None,
    }


@no_store
@api_view(['POST'])
@permission_classes([IsAuthenticated])
@parser_classes([MultiPartParser])
def import_preview(request):
    """
    Reads the uploaded CSV and returns the full plan: what each row is, which rows the person already
    has, the column mapping used. Writes NOTHING (no payment, no batch, no audit row).
    """
    if rate_limited(f'payments:import_preview:{request.user.pk}', PREVIEWS_PER_HOUR):
        return too_many_requests()
    try:
        raw, name = _read_upload(request)
        source = _source_field(request)
        mapping = _json_field(request, 'mapping', dict)
        plan = build_plan(request.user, raw, source, mapping)
    except ImportProblem as problem:
        return _problem_response(problem)
    return Response(plan_payload(plan, name))


@no_store
@api_view(['POST'])
@permission_classes([IsAuthenticated])
@parser_classes([MultiPartParser])
def import_commit(request):
    """
    Uploads the SAME file again with the person's choices; the server rebuilds the plan from the bytes
    and creates the chosen payments in one transaction, or refuses (409 if the ledger changed since the
    preview). Audits counts only, after the transaction has committed.
    """
    if rate_limited(f'payments:import_commit:{request.user.pk}', COMMITS_PER_HOUR):
        return too_many_requests()
    try:
        raw, name = _read_upload(request)
        source = _source_field(request)
        if source is None:
            raise ImportRefused('source_required', 'Choose where this money arrived (Wise, Payoneer, a bank...).')
        mapping = _json_field(request, 'mapping', dict)
        if mapping is None:
            raise ImportRefused('bad_mapping', 'The column mapping is required.')
        include_rows = _json_field(request, 'include_rows', list)
        fingerprint = (request.data.get('plan_fingerprint') or '').strip()
        batch = commit_plan(request.user, raw, name, source, mapping, fingerprint, include_rows)
    except ImportProblem as problem:
        return _problem_response(problem)

    log_event(
        'payment_import_committed', user=request.user, request=request,
        metadata={
            'batch_id': str(batch.pk), 'source': batch.source, 'rows_total': batch.rows_total,
            'imported': batch.imported, 'skipped_duplicate': batch.skipped_duplicate,
            'skipped_not_income': batch.skipped_not_income, 'skipped_invalid': batch.skipped_invalid,
            'skipped_unselected': batch.skipped_unselected,
        },
    )
    return Response({'batch': batch_payload(batch, batch.imported)}, status=status.HTTP_201_CREATED)


@no_store
@api_view(['GET'])
@permission_classes([IsAuthenticated])
def import_batch_list(request):
    """The user's most recent imports (newest first, at most 20) with how many of their payments remain."""
    if rate_limited(f'payments:import_batches:{request.user.pk}', READS_PER_HOUR):
        return too_many_requests()
    batches = (
        PaymentImportBatch.objects.filter(user=request.user)
        .annotate(remaining=Count('payments'))
        .order_by('-created_at')[:BATCH_LIST_LIMIT]
    )
    return Response({'results': [batch_payload(batch, batch.remaining) for batch in batches]})


@no_store
@api_view(['DELETE'])
@permission_classes([IsAuthenticated])
@parser_classes([JSONParser])
def import_batch_undo(request, pk):
    """Undo a whole import: removes its payments that nothing is linked to and reports the ones kept."""
    if rate_limited(f'payments:import_undo:{request.user.pk}', UNDOS_PER_HOUR):
        return too_many_requests()
    if not isinstance(request.data, dict) or request.data.get('confirm') is not True:
        return Response(
            {'error': 'Confirm that you want to undo this import.', 'code': 'confirm_required'},
            status=status.HTTP_400_BAD_REQUEST,
        )
    try:
        result = undo_batch(request.user, pk)
    except ImportProblem as problem:
        return _problem_response(problem)
    log_event(
        'payment_import_undone', user=request.user, request=request,
        metadata={'batch_id': str(pk), 'removed': result['removed'], 'kept': result['kept']},
    )
    return Response(result)
