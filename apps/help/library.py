# apps/help/library.py
"""
The assembled guide library and the pure validator over it (Prompt 24, Part 2). LIBRARY is built once at import from the
topic modules; LIBRARY_VERSION is a content hash (first 12 hex characters of a SHA-256 of what is SERVED) that invalidates
the answer cache by itself whenever a guide's words change. `problems()` returns human sentences, one per problem, each
naming the guide; it is the single source of truth for `manage.py check` (checks.py) and `check_help_library`.
"""
import hashlib
import json
import re
from datetime import date
from pathlib import Path

from . import constants as c
from .guides import load_guides
from .links import LINK_TARGETS
from .prompts import render_guide_for_model
from .text import phrase_regex

LIBRARY = load_guides()
BY_SLUG = {g.slug: g for g in LIBRARY}
TOPIC_BY_SLUG = {t.slug: t for t in c.TOPICS}

_SLUG_RE = re.compile(r'^[a-z0-9]+(?:-[a-z0-9]+)*$')
_QUOTED_RE = re.compile(r'"([^"]*)"')
_DATE_RE = re.compile(r'^\d{4}-\d{2}-\d{2}$')
_SENTENCE_BREAK_RE = re.compile(r'[.!?]\s+\S')
_CURLY = '‘’“”'


def library_version(guides=LIBRARY):
    """First 12 hex characters of the SHA-256 of what is served: slug, title, topic, summary, keywords, blocks, related."""
    canonical = json.dumps(
        [[g.slug, g.title, g.topic, g.summary, list(g.keywords), list(g.blocks), list(g.related)] for g in guides],
        sort_keys=True, ensure_ascii=False, default=list, separators=(',', ':'))
    return hashlib.sha256(canonical.encode('utf-8')).hexdigest()[:12]


LIBRARY_VERSION = library_version()


_BANNED_RES = tuple((p, phrase_regex(p)) for p in c.BANNED_PHRASES)
_STYLE_RES = tuple((p, phrase_regex(p)) for p in c.STYLE_WORDS)
_NUMBER_WORD_RE = re.compile(r'(?<![A-Za-z])(' + '|'.join(c.NUMBER_WORDS) + r')(?![A-Za-z])', re.IGNORECASE)


def block_texts(block):
    """The shown strings of one block (label for a link; every item for steps)."""
    if block['type'] == 'steps':
        return list(block['items'])
    if block['type'] == 'link':
        return [block['label']]
    return [block['text']]


def shown_texts(guide):
    """Every string a reader can see: title, summary, then every block's strings."""
    texts = [guide.title, guide.summary]
    for block in guide.blocks:
        texts.extend(block_texts(block))
    return texts


def quoted_labels(guide):
    """The strings inside straight double quotes in the guide's p / steps / note text."""
    found = []
    for block in guide.blocks:
        if block['type'] in ('p', 'note', 'steps'):
            for text in block_texts(block):
                found.extend(_QUOTED_RE.findall(text))
    return found


def number_words(guides=LIBRARY):
    """Every spelled-out number in shown text, as (slug, word, sentence) - for the human review of decision H15."""
    found = []
    for g in guides:
        for text in shown_texts(g):
            for sentence in re.split(r'(?<=[.!?])\s+', text):
                for match in _NUMBER_WORD_RE.finditer(sentence):
                    found.append((g.slug, match.group(1), sentence))
    return found


_frontend_cache = {}


def _frontend_text(root):
    """All frontend source text (js/jsx) except test fixtures, __tests__ and *.test.* files, joined; cached per root."""
    key = str(root)
    if key not in _frontend_cache:
        parts = []
        for path in (Path(root) / 'frontend' / 'src').rglob('*'):
            if path.suffix not in ('.js', '.jsx') or any(x in path.parts for x in ('test-fixtures', '__tests__')):
                continue
            if '.test.' in path.name:
                continue
            parts.append(path.read_text(encoding='utf-8', errors='ignore'))
        _frontend_cache[key] = '\n'.join(parts)
    return _frontend_cache[key]


def _static_routes(root):
    text = (Path(root) / 'frontend' / 'src' / 'App.jsx').read_text(encoding='utf-8')
    return {r for r in re.findall(r'path="([^"]+)"', text) if ':' not in r and '*' not in r}


# A query form of a link is allowed only when the target page really reads it. Each entry: the query key, the frontend
# file that defines the accepted values, and a regex that captures the file's list of them.
QUERY_CHECKS = {
    '/settings': ('tab', 'frontend/src/pages/Settings.jsx', r"VALID_TABS = \[([^\]]*)\]"),
    '/tax': ('view', 'frontend/src/pages/taxHelpers.js', r"VIEWS = \[(.*?)\n\]"),
}


def _query_problem(slug, to, root):
    path, _, query = to.partition('?')
    if not query:
        return None
    rule = QUERY_CHECKS.get(path)
    if rule is None:
        return f'{slug}: link {to} has a query, but no page that reads it is known.'
    key, rel, pattern = rule
    name, _, value = query.partition('=')
    if name != key:
        return f'{slug}: link {to} uses ?{name}=, but {path} reads ?{key}=.'
    match = re.search(pattern, (Path(root) / rel).read_text(encoding='utf-8'), re.DOTALL)
    if not match or not re.search(r"['=]" + re.escape(value) + r"['\"]?", match.group(1)):
        return f'{slug}: link {to}: {rel} does not list {key}={value}.'
    return None


_DEFAULT = object()


def problems(guides=None, *, repo_root=None, topics=_DEFAULT, popular=_DEFAULT, expected_slugs=_DEFAULT):
    """
    Returns a list of human sentences, one per problem, each naming the guide. Pure unless `repo_root` is given (then the
    repo checks run: sources exist, every ui_label appears in the frontend source, every link is a real route).
    With `guides=None` the real library, topics, popular list and the 48 expected slugs are checked; with a list given,
    topics / popular / expected_slugs are checked only when passed (tests use hand-made libraries).
    """
    real = guides is None
    guides = LIBRARY if real else tuple(guides)
    if topics is _DEFAULT:
        topics = c.TOPICS if real else None
    if popular is _DEFAULT:
        popular = c.POPULAR_SLUGS if real else None
    if expected_slugs is _DEFAULT:
        expected_slugs = c.EXPECTED_SLUGS if real else None
    out = []
    slugs = [g.slug for g in guides]
    titles = [g.title for g in guides]
    topic_slugs = {t.slug for t in topics} if topics is not None else None

    for g in guides:
        s = g.slug
        if slugs.count(s) > 1:
            out.append(f'{s}: the slug is used by more than one guide.')
        if not _SLUG_RE.match(s) or not c.SLUG_MIN <= len(s) <= c.SLUG_MAX:
            out.append(f'{s}: the slug must be kebab-case, {c.SLUG_MIN}-{c.SLUG_MAX} characters.')
        if titles.count(g.title) > 1:
            out.append(f'{s}: the title is used by more than one guide.')
        if not g.title or len(g.title) > c.TITLE_MAX or g.title.endswith('.'):
            out.append(f'{s}: the title must be 1-{c.TITLE_MAX} characters with no trailing period.')
        if topic_slugs is not None and g.topic not in topic_slugs:
            out.append(f'{s}: the topic {g.topic!r} does not exist.')
        summary = g.summary
        if not c.SUMMARY_MIN <= len(summary) <= c.SUMMARY_MAX:
            out.append(f'{s}: the summary is {len(summary)} characters, it must be {c.SUMMARY_MIN}-{c.SUMMARY_MAX}.')
        if not summary.endswith('.') or _SENTENCE_BREAK_RE.search(summary):
            out.append(f'{s}: the summary must be one sentence that ends with a period.')
        kws = list(g.keywords)
        if not c.KEYWORDS_MIN <= len(kws) <= c.KEYWORDS_MAX:
            out.append(f'{s}: it has {len(kws)} keywords, it needs {c.KEYWORDS_MIN}-{c.KEYWORDS_MAX}.')
        if len(set(kws)) != len(kws):
            out.append(f'{s}: a keyword is repeated.')
        for k in kws:
            if k != k.lower() or not c.KEYWORD_MIN_CHARS <= len(k) <= c.KEYWORD_MAX_CHARS:
                out.append(f'{s}: the keyword {k!r} must be lowercase, {c.KEYWORD_MIN_CHARS}-{c.KEYWORD_MAX_CHARS} characters.')

        # blocks
        if not c.BLOCKS_MIN <= len(g.blocks) <= c.BLOCKS_MAX:
            out.append(f'{s}: it has {len(g.blocks)} blocks, it needs {c.BLOCKS_MIN}-{c.BLOCKS_MAX}.')
        if not any(b['type'] in ('p', 'steps') for b in g.blocks):
            out.append(f'{s}: it needs at least one paragraph or steps block.')
        for b in g.blocks:
            if b['type'] == 'link' and b['to'] not in LINK_TARGETS:
                out.append(f'{s}: the link {b["to"]!r} is not in LINK_TARGETS.')
            if b['type'] == 'steps' and not c.STEPS_MIN <= len(b['items']) <= c.STEPS_MAX:
                out.append(f'{s}: a steps block has {len(b["items"])} items, it needs {c.STEPS_MIN}-{c.STEPS_MAX}.')
            limit = {'p': c.P_MAX, 'note': c.NOTE_MAX, 'link': c.LINK_LABEL_MAX}.get(b['type'])
            for t in block_texts(b):
                if limit and len(t) > limit:
                    out.append(f'{s}: a {b["type"]} block is {len(t)} characters, the limit is {limit}.')
                if b['type'] == 'steps' and len(t) > c.STEP_MAX:
                    out.append(f'{s}: a step is {len(t)} characters, the limit is {c.STEP_MAX}.')
        if len(render_guide_for_model(g)) > c.GUIDE_MAX_PROMPT_CHARS:
            out.append(f'{s}: its prompt text is {len(render_guide_for_model(g))} characters, the limit is {c.GUIDE_MAX_PROMPT_CHARS}.')

        # shown text rules
        for t in shown_texts(g):
            if re.search(r'[0-9]', t):
                out.append(f'{s}: a digit in shown text (decision H15): {t[:70]!r}')
            bad = sorted({ch for ch in t if ch in c.MARKUP_CHARS})
            if bad:
                out.append(f'{s}: markup character(s) {"".join(bad)} in: {t[:70]!r}')
            if any(ch in t for ch in _CURLY):
                out.append(f'{s}: a curly quote in: {t[:70]!r} (use straight quotes).')
            for phrase, rx in _BANNED_RES:
                if rx.search(t):
                    out.append(f'{s}: the banned phrase "{phrase}" in: {t[:70]!r}')
            for phrase, rx in _STYLE_RES:
                if rx.search(t):
                    out.append(f'{s}: the style word "{phrase}" in: {t[:70]!r}')

        # related
        if len(g.related) > c.RELATED_MAX:
            out.append(f'{s}: it has {len(g.related)} related guides, the limit is {c.RELATED_MAX}.')
        for r in g.related:
            if r not in slugs:
                out.append(f'{s}: the related guide {r!r} does not exist.')
            if r == s:
                out.append(f'{s}: it lists itself as related.')

        # ui_labels <-> quoted text
        quoted = quoted_labels(g)
        for b in g.blocks:
            if b['type'] in ('p', 'note', 'steps'):
                for t in block_texts(b):
                    if t.count('"') % 2:
                        out.append(f'{s}: an odd number of straight double quotes in: {t[:70]!r}')
        if set(quoted) != set(g.ui_labels):
            only_text = sorted(set(quoted) - set(g.ui_labels))
            only_labels = sorted(set(g.ui_labels) - set(quoted))
            out.append(f'{s}: quoted words and ui_labels differ (quoted only: {only_text}; ui_labels only: {only_labels}).')
        for label in g.ui_labels:
            if not c.UI_LABEL_MIN <= len(label) <= c.UI_LABEL_MAX:
                out.append(f'{s}: the ui label {label!r} must be {c.UI_LABEL_MIN}-{c.UI_LABEL_MAX} characters.')
        for b in g.blocks:
            if b['type'] == 'link' and '"' in b['label']:
                out.append(f'{s}: a link label contains a quote.')

        # sources and date
        if not g.sources:
            out.append(f'{s}: it lists no sources.')
        if len(set(g.sources)) != len(g.sources):
            out.append(f'{s}: a source is listed twice.')
        if not _DATE_RE.match(g.checked_on or ''):
            out.append(f'{s}: checked_on must be YYYY-MM-DD, got {g.checked_on!r}.')
        else:
            try:
                if date.fromisoformat(g.checked_on) > date.today():
                    out.append(f'{s}: checked_on {g.checked_on} is in the future.')
            except ValueError:
                out.append(f'{s}: checked_on {g.checked_on!r} is not a real date.')

    if topics is not None:
        for t in topics:
            if not any(g.topic == t.slug for g in guides):
                out.append(f'topic {t.slug}: it has no guide.')
    if popular is not None:
        if len(popular) != c.POPULAR_COUNT or len(set(popular)) != len(popular):
            out.append(f'popular: it must be {c.POPULAR_COUNT} unique slugs.')
        for slug in popular:
            if slug not in slugs:
                out.append(f'popular: {slug} is not a guide.')
    if expected_slugs is not None:
        if set(slugs) != set(expected_slugs):
            out.append(f'the library differs from Appendix A (missing: {sorted(set(expected_slugs) - set(slugs))}; '
                       f'extra: {sorted(set(slugs) - set(expected_slugs))}).')

    if repo_root is not None:
        root = Path(repo_root)
        routes = _static_routes(root)
        text = _frontend_text(root)
        for g in guides:
            for src in g.sources:
                if not (root / src).exists():
                    out.append(f'{g.slug}: the source {src} does not exist.')
            for label in g.ui_labels:
                if label not in text:
                    out.append(f'{g.slug}: the label "{label}" does not appear in the frontend source.')
            for b in g.blocks:
                if b['type'] == 'link':
                    path = b['to'].partition('?')[0]
                    if path not in routes:
                        out.append(f'{g.slug}: the link {b["to"]} is not a static route in App.jsx.')
                    else:
                        issue = _query_problem(g.slug, b['to'], root)
                        if issue:
                            out.append(issue)
    return out
