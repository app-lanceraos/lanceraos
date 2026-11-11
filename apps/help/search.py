# apps/help/search.py
"""
Plain lexical search over the guide library (decision H1; Prompt 24, Part 4): BM25 over title (x3), keywords (x3), summary
(x2) and body (x1), a deterministic light stemmer, curated synonym groups, a bonus for a multi-word keyword found whole in
the question, and two thresholds on COVERAGE (the share of the question's own terms that a guide matches):
  * MIN_COVERAGE_TO_LIST - a guide may be listed (search results, "closest guides");
  * MIN_COVERAGE_FOR_AI  - the GATE: the model is called only if the best match reaches this.
Terms of the earlier question weigh 0.5 and count only for ranking, only when the current question is very short, and never
toward coverage - so a follow-up can be understood but can never open the gate by itself (decision H2).
Pure: no database, no network, no library beyond the standard library.
"""
import math
import re
from collections import Counter
from dataclasses import dataclass

from . import constants as c
from .library import BY_SLUG, LIBRARY

STOPWORDS = frozenset((
    'how do i can the a an to of for my me is are what where when why which and or in on it this that with from be do does '
    'did will would should could please help want need get make let you your lanceraos'
).split())

_TOKEN_RE = re.compile(r'[a-z0-9]+')

# Curated synonym groups: the words a Pakistani freelancer types and the app's own words. Every group stays small; every
# member is stemmed on load. Tuned only in Part 10a, from the tune set and the guides (never from a held-out question).
SYNONYM_GROUPS = (
    ('invoice', 'bill', 'billing'),
    ('client', 'customer', 'buyer', 'employer'),
    ('payment', 'paid', 'pay', 'payout', 'received', 'income', 'earning'),
    ('expense', 'spending', 'cost', 'spent'),
    ('proposal', 'pitch', 'bid', 'quote'),
    ('contract', 'agreement'),
    ('sign', 'signature', 'esign', 'signed'),
    ('password', 'passcode'),
    ('2fa', 'otp', 'authenticator', 'verification'),
    ('pkr', 'rupee', 'rupees', 'rs'),
    ('payoneer', 'wise', 'transferwise'),
    ('csv', 'spreadsheet', 'statement'),
    ('tax', 'fbr', 'ntn', 'return'),
    ('recurring', 'repeat', 'monthly', 'repeating'),
    ('send', 'sent', 'email', 'deliver'),
    ('create', 'make', 'new', 'add'),
    ('delete', 'remove', 'erase'),
    ('remind', 'reminder', 'chase', 'late', 'overdue'),
    ('login', 'signin', 'log'),
    ('device', 'session', 'devices', 'sessions'),
)


def stem(word):
    """
    A small, deterministic stemmer (no library). Plural endings first (first match that keeps 3+ letters: ies -> y, sses -> ss,
    es, s; a word ending in ss keeps its s), then verb endings (ing, ed), then a trailing e: so invoice/invoices, create/created,
    send/sending and settings/setting all meet. It only has to be consistent: the same function stems the guides and the question.
    """
    w = word
    for suffix, repl in (('ies', 'y'), ('sses', 'ss'), ('es', ''), ('s', '')):
        if w.endswith(suffix) and not (suffix == 's' and w.endswith('ss')):
            cand = w[:-len(suffix)] + repl
            if len(cand) >= 3:
                w = cand
                break
    for suffix in ('ing', 'ed'):
        if w.endswith(suffix) and len(w) - len(suffix) >= 3:
            w = w[:-len(suffix)]
            break
    if len(w) > 3 and w.endswith('e'):
        w = w[:-1]
    return w


def tokens(text):
    """Lowercase word tokens of a text (letters and digits)."""
    return _TOKEN_RE.findall((text or '').lower())


def terms(text):
    """Stemmed content terms of a text: stopwords and one-character tokens dropped. Order kept, duplicates kept."""
    return [stem(t) for t in tokens(text) if len(t) > 1 and t not in STOPWORDS]


def _build_synonyms():
    table = {}
    for group in SYNONYM_GROUPS:
        stems = set()
        for word in group:
            stems.update(stem(t) for t in tokens(word))
        for s in stems:
            table.setdefault(s, set()).update(stems)
    return {k: frozenset(v) for k, v in table.items()}


_SYN = _build_synonyms()


def expand(term):
    """The term (already stemmed) plus its synonym-group members."""
    return _SYN.get(term, frozenset((term,)))


@dataclass(frozen=True)
class Match:
    guide: object
    score: float
    coverage: float
    in_title_or_keywords: bool


class Index:
    """Weighted term frequencies of a set of guides, built once. Tests build one over a hand-made library."""

    def __init__(self, guides):
        self.guides = tuple(guides)
        self.weighted = []        # per guide: Counter(term -> weighted tf)
        self.tk_terms = []        # per guide: set of terms of title + keywords
        self.phrases = []         # per guide: list of tuples of stems (multi-word keywords)
        for g in self.guides:
            tf = Counter()
            body = ' '.join(text for b in g.blocks for text in (b['items'] if b['type'] == 'steps' else [b.get('text') or b.get('label', '')]))
            for field, text in (('title', g.title), ('keywords', ' '.join(g.keywords)), ('summary', g.summary), ('body', body)):
                for t in terms(text):
                    tf[t] += c.FIELD_WEIGHTS[field]
            self.weighted.append(tf)
            self.tk_terms.append(set(terms(g.title)) | set(terms(' '.join(g.keywords))))
            self.phrases.append([tuple(stem(t) for t in tokens(k)) for k in g.keywords if len(tokens(k)) > 1])
        n = len(self.guides)
        self.lengths = [sum(tf.values()) for tf in self.weighted]
        self.avg_length = (sum(self.lengths) / n) if n else 1.0
        df = Counter()
        for tf in self.weighted:
            df.update(tf.keys())
        self.idf = {t: math.log(1 + (n - d + 0.5) / (d + 0.5)) for t, d in df.items()}

    def _term_score(self, term, i):
        """BM25 score of one query term for guide i: the best of the term and its synonyms (a synonym counts a bit less)."""
        tf_map = self.weighted[i]
        best = 0.0
        for variant in expand(term):
            tf = tf_map.get(variant, 0)
            if not tf:
                continue
            norm = tf * (c.BM25_K1 + 1) / (tf + c.BM25_K1 * (1 - c.BM25_B + c.BM25_B * self.lengths[i] / self.avg_length))
            value = self.idf.get(variant, 0.0) * norm * (1.0 if variant == term else 0.8)
            best = max(best, value)
        return best

    def find(self, query, previous='', limit=c.SEARCH_RESULT_LIMIT):
        current = terms(query)
        if not current:
            return []
        distinct = list(dict.fromkeys(current))
        earlier = []
        if len(distinct) < c.PREVIOUS_ONLY_BELOW_TERMS:
            earlier = [t for t in dict.fromkeys(terms(previous)) if t not in distinct]
        query_stems = [stem(t) for t in tokens(query)]
        out = []
        for i, g in enumerate(self.guides):
            score = sum(self._term_score(t, i) for t in distinct)
            score += c.PREVIOUS_TERM_WEIGHT * sum(self._term_score(t, i) for t in earlier)
            for phrase in self.phrases[i]:
                if _contains_run(query_stems, phrase):
                    score += c.PHRASE_BONUS * max(self.idf.get(t, 0.0) for t in phrase)
            matched = [t for t in distinct if any(v in self.weighted[i] for v in expand(t))]
            if not matched or score <= 0:
                continue
            coverage = len(matched) / len(distinct)
            in_tk_terms = [t for t in matched if any(v in self.tk_terms[i] for v in expand(t))]
            in_tk = bool(in_tk_terms)
            # A guide whose TITLE / KEYWORDS carry more of the question's own terms is a better answer than one that merely
            # repeats a single term many times in its body, so the score grows with that share.
            score *= 1 + c.TK_COVERAGE_BONUS * len(in_tk_terms) / len(distinct)
            out.append((score, i, Match(g, round(score, 6), coverage, in_tk)))
        out.sort(key=lambda row: (-row[0], row[1]))
        return [m for _s, _i, m in out[:limit]]


def _contains_run(haystack, needle):
    n = len(needle)
    return n > 0 and any(tuple(haystack[k:k + n]) == needle for k in range(len(haystack) - n + 1))


_default = {'index': None}


def default_index():
    """The index over the real library, built once, at first use."""
    if _default['index'] is None:
        _default['index'] = Index(LIBRARY)
    return _default['index']


def find(query, previous='', limit=c.SEARCH_RESULT_LIMIT, index=None):
    """The best matches for a query (strings already redacted for search), best first."""
    return (index or default_index()).find(query, previous, limit)


def gate(matches):
    """True only when the best match covers enough of the question AND hit its title or keywords. No match, no model call."""
    return bool(matches) and matches[0].coverage >= c.MIN_COVERAGE_FOR_AI and matches[0].in_title_or_keywords


def listable(matches):
    """The matches good enough to show as results or as "closest guides", in rank order."""
    return [m for m in matches if m.coverage >= c.MIN_COVERAGE_TO_LIST and m.in_title_or_keywords]


def popular():
    """The six guides of the start screen, in the configured order (those that exist)."""
    return [BY_SLUG[s] for s in c.POPULAR_SLUGS if s in BY_SLUG]
