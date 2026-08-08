# core/events.py
"""
Minimal, synchronous event dispatch registry — deliberately not a framework.

Why this exists now: apps/invoices (Module 2) needs a way for a status
transition (InvoicePaid, InvoiceSent, etc.) to trigger multiple independent
side effects — an AuditLog write, a WebSocket push, a notification — without
the code that performs the transition needing to know about every side
effect that currently cares, or every side effect that gets added later.
A plain function call chain would couple those side effects directly to
the transition code; this decouples them.

Why it's minimal: no class hierarchy, no async dispatch, no persistence or
replay. on()/emit() is the entire surface. Building more than this now would
be speculative — Invoices/Clients is the first and, as of this writing, only
consumer.

apps/users stays on its existing inline send_email()/log_event() calls for
now and is NOT retrofitted onto this registry as part of this change. That
is a known, deliberate, deferred cost — not an oversight discovered later.
Retrofitting apps/users would touch a large, already-audited surface for no
functional gain (nothing there currently needs multiple independent
subscribers to the same action), so it's left alone until a real reason to
touch it appears. See DECISIONS.md for the same reasoning on record.
"""
import logging
from collections import defaultdict
from typing import Callable

logger = logging.getLogger(__name__)

_HANDLERS: dict[str, list[Callable]] = defaultdict(list)


def on(event_name: str):
    """Decorator — registers the wrapped function as a handler for event_name."""
    def decorator(func: Callable) -> Callable:
        _HANDLERS[event_name].append(func)
        return func
    return decorator


def emit(event_name: str, **payload) -> None:
    """
    Calls every handler registered for event_name, in registration order,
    passing payload as keyword arguments.

    Each handler call is individually wrapped in its own try/except: a
    broken handler is logged and skipped, never allowed to break the
    request that triggered the event or prevent the remaining handlers
    from running. Same defensive posture as v1's Notification.create()
    channel-layer guard, generalized to every handler on every event.
    """
    for handler in _HANDLERS.get(event_name, []):
        try:
            handler(**payload)
        except Exception:
            logger.exception(
                'Handler %s failed for event %s (payload=%s)',
                getattr(handler, '__name__', handler), event_name, payload,
            )
