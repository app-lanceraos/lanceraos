# apps/help/views.py
"""
The five Help endpoints (Prompt 24, Part 7). Function views, `@no_store` outside `@api_view`, `IsAuthenticated`, every
response `Cache-Control: no-store` (errors included). There is no database table: every read is the in-memory library, so
the query count cannot depend on the library size or the question. Nothing a person typed is logged by these views, not even
when it is rejected. CSRF behaves exactly as on the Proposals POST endpoints (the default authentication classes).
"""
from rest_framework import status
from rest_framework.exceptions import ParseError, UnsupportedMediaType
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from core.public_http import no_store
from core.ratelimit import rate_limited

from . import constants as c
from . import copy, service
from .library import BY_SLUG
from .text import normalise, strip_markup


def _error(message, code=status.HTTP_400_BAD_REQUEST):
    return Response({'error': message}, status=code)


def _body(request):
    """The JSON body as a dict; anything else (a list, text, null, malformed JSON, a wrong content type) is an empty dict."""
    try:
        data = request.data
    except (ParseError, UnsupportedMediaType):
        return {}
    return data if isinstance(data, dict) else {}


def _too_many():
    return _error(copy.ERR_TOO_MANY, status.HTTP_429_TOO_MANY_REQUESTS)


@no_store
@api_view(['GET'])
@permission_classes([IsAuthenticated])
def list_guides(request):
    """The topics with their guides, and the six popular guides."""
    if rate_limited(f'help:read:{request.user.pk}', c.READS_PER_HOUR):
        return _too_many()
    return Response(service.guide_index())


@no_store
@api_view(['GET'])
@permission_classes([IsAuthenticated])
def get_guide(request, slug):
    """One guide with its blocks and related guides, or a 404."""
    if rate_limited(f'help:read:{request.user.pk}', c.READS_PER_HOUR):
        return _too_many()
    payload = service.guide_detail(slug)
    if payload is None:
        return _error(copy.ERR_GUIDE_NOT_FOUND, status.HTTP_404_NOT_FOUND)
    return Response(payload)


@no_store
@api_view(['GET'])
@permission_classes([IsAuthenticated])
def search_guides(request):
    """Up to eight guides matching ?q= (two to 120 characters)."""
    if rate_limited(f'help:search:{request.user.pk}', c.SEARCH_PER_HOUR):
        return _too_many()
    query = strip_markup(normalise(request.query_params.get('q', '')))
    if len(query) < c.SEARCH_MIN_CHARS:
        return _error(copy.ERR_SEARCH_SHORT)
    if len(query) > c.SEARCH_MAX_CHARS:
        return _error(copy.ERR_SEARCH_LONG)
    return Response(service.search_payload(query))


@no_store
@api_view(['POST'])
@permission_classes([IsAuthenticated])
def ask_question(request):
    """
    One question (and optionally the one before it) -> guides, usually with a written answer. AI off, busy or failing is a
    200 with outcome guides_only; only a bad request (400) or the hourly hard cap (429) is an error.
    """
    if rate_limited(f'help:ask:hour:{request.user.pk}', c.ASK_PER_HOUR):
        return _too_many()
    body = _body(request)
    raw_question = body.get('question')
    if not isinstance(raw_question, str):
        return _error(copy.ERR_QUESTION_MISSING)
    question = normalise(raw_question)
    if not question:
        return _error(copy.ERR_QUESTION_MISSING)
    if len(question) < c.QUESTION_MIN_CHARS:
        return _error(copy.ERR_QUESTION_SHORT)
    if len(question) > c.QUESTION_MAX_CHARS:
        return _error(copy.ERR_QUESTION_LONG)
    previous = body.get('previous_question')
    if previous is None:
        previous = ''
    elif not isinstance(previous, str) or len(normalise(previous)) > c.PREVIOUS_QUESTION_MAX_CHARS:
        return _error(copy.ERR_PREVIOUS_BAD)
    result = service.answer_question(
        question, previous, user=request.user, request_id=getattr(request, 'request_id', None))
    return Response(service.ask_payload(result))


@no_store
@api_view(['POST'])
@permission_classes([IsAuthenticated])
def rate_answer(request):
    """A thumbs up or down on an answer: written as a counts-only audit row (no text)."""
    if rate_limited(f'help:rate:{request.user.pk}', c.RATE_PER_HOUR):
        return _too_many()
    body = _body(request)
    helpful = body.get('helpful')
    if not isinstance(helpful, bool):
        return _error(copy.ERR_RATE_HELPFUL)
    slugs = body.get('guides')
    if (not isinstance(slugs, list) or not 1 <= len(slugs) <= c.ASK_GUIDE_LIMIT
            or not all(isinstance(s, str) and s in BY_SLUG for s in slugs)):
        return _error(copy.ERR_RATE_GUIDES)
    service.record_rating(request.user, helpful, list(dict.fromkeys(slugs)))
    return Response({'ok': True})
