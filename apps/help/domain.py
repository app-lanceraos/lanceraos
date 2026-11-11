# apps/help/domain.py
"""The two value types of the Help library: a Topic and a Guide. Frozen, plain data; no Django, no apps.*."""
from dataclasses import dataclass


@dataclass(frozen=True)
class Topic:
    slug: str
    title: str
    blurb: str


@dataclass(frozen=True)
class Guide:
    """
    One hand-written help guide. `blocks` is a tuple of plain dicts built only by the builders in guides/__init__.py
    (p, steps, note, link). `ui_labels` are the exact on-screen words the text quotes in straight double quotes (H16);
    `sources` the repo files it was written from; `checked_on` the date it was last checked against them.
    """
    slug: str
    title: str
    topic: str
    summary: str
    keywords: tuple
    blocks: tuple
    related: tuple
    ui_labels: tuple
    sources: tuple
    checked_on: str
