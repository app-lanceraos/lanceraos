# apps/help/guides/__init__.py
"""
The guide builders and the loader of the topic modules. A guide is PYTHON DATA (decision H14): every block is built by one of
p / steps / note / link below, each of which validates its own shape at import time and raises ValueError naming the
offending text, so a typo fails `manage.py check` and every test instead of production traffic. The wider rules (digits,
banned words, ui_labels, links against the real routes) are in apps/help/library.py `problems()`.
"""
import importlib

from .. import constants as c
from ..domain import Guide
from ..links import LINK_TARGETS


def _text(value, what, limit):
    if not isinstance(value, str) or not value.strip():
        raise ValueError(f'{what} must be a non-empty string, got {value!r}')
    if len(value) > limit:
        raise ValueError(f'{what} is {len(value)} characters, the limit is {limit}: {value[:60]!r}')
    return value


def p(text):
    """A paragraph."""
    return {'type': 'p', 'text': _text(text, 'a paragraph', c.P_MAX)}


def steps(*items):
    """A numbered procedure; the page numbers it, so no number belongs inside an item."""
    if not c.STEPS_MIN <= len(items) <= c.STEPS_MAX:
        raise ValueError(f'a steps block needs {c.STEPS_MIN}-{c.STEPS_MAX} items, got {len(items)}')
    return {'type': 'steps', 'items': [_text(item, 'a step', c.STEP_MAX) for item in items]}


def note(text):
    """A caveat a person would trip on."""
    return {'type': 'note', 'text': _text(text, 'a note', c.NOTE_MAX)}


def link(label, to):
    """A button to an in-app screen; `to` must be in links.LINK_TARGETS."""
    _text(label, 'a link label', c.LINK_LABEL_MAX)
    if to not in LINK_TARGETS:
        raise ValueError(f'link {label!r} points to {to!r}, which is not in LINK_TARGETS')
    return {'type': 'link', 'label': label, 'to': to}


def guide(slug, title, topic, summary, keywords, blocks, related=(), ui_labels=(), sources=(), checked_on=''):
    """Builds a frozen Guide; lists become tuples and each block is copied."""
    for block in blocks:
        if not isinstance(block, dict) or block.get('type') not in c.BLOCK_TYPES:
            raise ValueError(f'{slug}: every block must be built with p, steps, note or link, got {block!r}')
    return Guide(
        slug=slug, title=title, topic=topic, summary=summary, keywords=tuple(keywords),
        blocks=tuple({k: (tuple(v) if isinstance(v, list) else v) for k, v in block.items()} for block in blocks),
        related=tuple(related), ui_labels=tuple(ui_labels), sources=tuple(sources), checked_on=checked_on)


def load_guides():
    """All guides in display order: topic order, then the order written inside each topic module."""
    guides = []
    for topic in c.TOPICS:
        name = f'apps.help.guides.{topic.slug.replace("-", "_")}'
        guides.extend(importlib.import_module(name).GUIDES)
    return tuple(guides)
