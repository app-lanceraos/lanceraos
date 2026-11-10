# core/email_html.py
"""
The small branded HTML wrapper and the single-line helper that every platform-built email body uses. Promoted out of
apps/proposals/emails.py (Prompt 22, Part 0) so Contracts does not carry a second copy. The code is identical to the
original; `_money` and `_date` stay local to each app (`_money` needs apps.invoices.models.CURRENCY_SYMBOLS, and core/
imports nothing from apps/).
"""
import re

_WHITESPACE = re.compile(r'\s+')
_CONTROL = re.compile(r'[\x00-\x1f\x7f]')


def one_line(text, limit=None):
    """Collapses every run of whitespace/control characters to one space; optionally caps the length."""
    cleaned = _WHITESPACE.sub(' ', _CONTROL.sub(' ', text or '')).strip()
    return cleaned[:limit].rstrip() if limit else cleaned


def html_wrapper(body_html):
    """Minimal branded HTML wrapper — same brand tokens as the rest of the app's emails."""
    return f"""<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/></head>
<body style="margin:0;padding:0;background:#f4f6f8;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f6f8;padding:28px 16px;">
<tr><td align="center">
<table width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;">
  <tr><td style="background:#1a3a5c;border-radius:10px 10px 0 0;padding:18px 32px;">
    <span style="font-size:18px;font-weight:800;color:#fff;letter-spacing:-0.5px;">LanceraOS</span>
  </td></tr>
  <tr><td style="background:#fff;padding:32px;border-radius:0 0 10px 10px;">
    {body_html}
  </td></tr>
  <tr><td style="padding:16px;text-align:center;">
    <p style="margin:0;font-size:11px;color:#94a3b8;">LanceraOS &bull; lanceraos.com</p>
  </td></tr>
</table>
</td></tr>
</table>
</body>
</html>"""
