import React, { useEffect, useRef, useState } from 'react';
import api, { getCookie } from '@/lib/api';
import { useEditor } from '../state/EditorContext';
import { templateToDesignData } from '../adapter/designDataAdapter';
import { CloseIcon } from './Icons';

// Phase 5 — the real fix: Preview used to be the SAME canvas tree
// re-rendered read-only (see this file's own prior revision) — a second,
// local approximation of what an invoice actually looks like, with no
// relationship to the real canonical renderer (apps/invoices/
// design_renderer.py) beyond "hopefully implements the same rules." That
// is exactly the drift risk CLAUDE.md documents this codebase hitting
// (and fixing) once already for the OLD GrapesJS editor's own gallery
// cards (20 August 2026, "gallery previews + color_variant wiring") —
// the fix there was a real backend-rendered HTML endpoint embedded via a
// plain iframe (see components/design-editor/DesignLivePreview.jsx). This
// is the same fix for this editor's own Preview action.
//
// design_render_preview (apps/invoices/views_design_editor.py) is
// POST-only and takes an arbitrary in-memory design_data body —
// DesignLivePreview.jsx's own plain `<iframe src="...">` pattern (a GET,
// by design id or by base_template/color_variant query params) can't
// carry this: an unsaved, in-editor template has no design id at all,
// and a full design_data payload (arbitrary canvas JSON) doesn't fit
// safely in a URL. There is no GET variant of this endpoint (confirmed
// directly against apps/invoices/urls.py/views_design_editor.py).
//
// A first attempt fetched the HTML via the shared axios instance and
// injected it into the iframe via `srcDoc` (+ a `<base href>` fixing the
// relative-URL-resolves-against-the-wrong-origin bug CLAUDE.md's 18
// August 2026 entry documents InvoiceView.jsx hitting first). That got
// the URLs right but a real, LIVE side-by-side comparison against
// DesignLivePreview.jsx's own working gallery-card preview (same design,
// same backend) found a second, more fundamental problem `<base href>`
// can't fix: an `srcDoc` iframe's document is a genuinely separate,
// cross-origin document from wherever its HTML text was fetched — its
// own @font-face requests back to the backend's `/static/...` font URLs
// were CORS-blocked, silently falling back to system fonts. A real
// top-level (well, iframe-level) NAVIGATION is not subject to CORS at
// all — exactly why DesignLivePreview.jsx's own plain `<iframe src>` GET
// never had this problem — so this now does a genuine navigation
// instead: a hidden `<form method="post" target="...">` submitted into a
// named iframe, POSTing straight to the backend origin. A plain HTML
// form can only ever send flat string fields, never a nested JSON
// object, so `design_render_preview` was extended (this same phase) to
// also accept `design_data` as a JSON-encoded string, not only a real
// JSON body's native object — see that view's own updated docstring.
//
// The real tradeoff this creates: once the iframe navigates to the
// backend's own origin, this (frontend) page can no longer read its
// contents or detect a failure from the iframe itself (ordinary
// same-origin policy — the exact same limitation DesignLivePreview.jsx's
// own cross-origin iframe already silently accepts). So a real request
// is made via axios FIRST, discarding the HTML text, purely to surface a
// genuine 422 (DesignRenderError) as its own specific message before the
// iframe ever navigates — the iframe only ever mounts (and only ever
// shows a real render) once that pre-check has already succeeded.
const RENDER_PREVIEW_PATH = '/invoices/designs/render-preview/';
// The real, absolute backend URL a plain HTML form's own `action` needs
// (relative paths in `action` would resolve against THIS frontend
// origin, not the backend) — api.defaults.baseURL already carries the
// full `http://host:port/api` prefix every other real call in this app
// goes through, so this is exactly the same URL api.post(RENDER_PREVIEW_PATH)
// above hits, just spelled out for a `<form action="...">` instead of axios.
const RENDER_PREVIEW_URL = `${api.defaults.baseURL}${RENDER_PREVIEW_PATH}`;

// design_render_preview treats a legacy-shaped design_data or a missing
// base_template/color_variant honestly — there is nothing analogous to
// read off a brand-new, never-saved design in the bare /editor-v2 sandbox
// route (designMeta is null there, see EditorContext.jsx's own comment on
// why: nothing has ever been fetched from the server for it to carry).
// 'professional'/'' are the exact same defaults design_render_preview's
// own view function falls back to server-side when these are omitted
// entirely (request.data.get('base_template', 'professional') /
// request.data.get('color_variant', '')) — so an unsaved sandbox design
// previews using the identical default a real save-then-preview round
// trip would also resolve to.
const DEFAULT_BASE_TEMPLATE = 'professional';
const DEFAULT_COLOR_VARIANT = '';

function buildPayload(template, designMeta) {
  const { designData } = templateToDesignData(template);
  return {
    designData,
    baseTemplate: designMeta?.base_template || DEFAULT_BASE_TEMPLATE,
    colorVariant: designMeta?.color_variant || DEFAULT_COLOR_VARIANT,
  };
}

// A 422 from design_render_preview (DesignRenderError, see that view's
// own docstring) is a REAL second validation layer beyond this editor's
// own client-side validateTemplate — surfaced here as its own distinct,
// specific message rather than folded into the generic
// network/server-error copy below, so a genuine backend rejection never
// reads like an unrelated connectivity problem.
async function extractErrorMessage(err) {
  if (err.response?.status === 422) {
    let payload = err.response.data;
    if (payload instanceof Blob) {
      try {
        payload = JSON.parse(await payload.text());
      } catch {
        payload = null;
      }
    }
    return payload?.error || 'The server rejected this design and could not render it.';
  }
  if (err.response) return 'Something went wrong rendering this preview. Please try again.';
  return 'Could not reach the server. Check your connection and try again.';
}

export default function PreviewModal({ onClose }) {
  const { template, designMeta } = useEditor();
  // idle is never actually shown — load() fires from the mount effect
  // before first paint's own state ever renders — kept only as the
  // pre-effect default so `status` always has a defined value.
  const [status, setStatus] = useState('loading');
  const [message, setMessage] = useState('');
  const [pdfState, setPdfState] = useState({ status: 'idle', message: '' });
  const formRef = useRef(null);
  const iframeName = useRef(`v2-preview-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`).current;

  useEffect(() => {
    let cancelled = false;
    setStatus('loading');
    setMessage('');

    async function load() {
      const { designData, baseTemplate, colorVariant } = buildPayload(template, designMeta);
      try {
        // The pre-check: a real request through the shared axios instance
        // (real CSRF header, real cookie auth), discarding the HTML text —
        // this is what actually catches a genuine backend rejection, since
        // the form-submitted iframe navigation below can never report one
        // back to this page once it crosses to the backend's own origin.
        await api.post(RENDER_PREVIEW_PATH, {
          design_data: designData, base_template: baseTemplate, color_variant: colorVariant,
        }, { responseType: 'text' });
        if (cancelled) return;
        // Ensures the (non-httpOnly) csrftoken cookie exists before the
        // hidden form reads it — same trigger endpoint api.js's own
        // ensureCsrfCookie uses, called directly here since a plain form
        // submission bypasses axios's interceptor entirely.
        await api.get('/auth/csrf/');
        if (cancelled) return;
        setStatus('ready');
      } catch (err) {
        if (cancelled) return;
        setStatus('error');
        setMessage(await extractErrorMessage(err));
      }
    }

    load();
    return () => {
      cancelled = true;
    };
    // Deliberately fetched once, at the moment Preview opens — the
    // backdrop blocks interaction with the live canvas underneath while
    // this modal is open, so `template` can't actually change out from
    // under an already-open preview.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Submits the real navigation into the named iframe the instant the
  // pre-check above has confirmed this design actually renders — the
  // iframe element itself only exists in the DOM once `status === 'ready'`
  // (see the JSX below), so this can't fire against a target that isn't
  // there yet.
  useEffect(() => {
    if (status === 'ready' && formRef.current) {
      formRef.current.submit();
    }
  }, [status]);

  // Task 3 (optional bonus) — the same design_data, `?output=pdf`, fetched
  // via axios (a real PDF has every font embedded directly in the file by
  // WeasyPrint itself — no external font request, so this blob approach
  // never hits the CORS problem the HTML preview above worked around) and
  // opened in a new tab via a same-origin blob: URL, the identical
  // pattern this codebase already established for a real invoice's own
  // Download button (InvoiceView.jsx). The tab is opened synchronously,
  // before the request resolves, and only then navigated — opening it
  // after an `await` risks a real browser popup-blocker treating it as
  // untrusted, since it would no longer be directly inside the click's
  // own event handler.
  const handlePreviewPdf = async (e) => {
    e.stopPropagation();
    if (pdfState.status === 'loading') return;
    const win = window.open('', '_blank');
    setPdfState({ status: 'loading', message: '' });
    try {
      const { designData, baseTemplate, colorVariant } = buildPayload(template, designMeta);
      const res = await api.post(RENDER_PREVIEW_PATH, {
        design_data: designData, base_template: baseTemplate, color_variant: colorVariant,
      }, { params: { output: 'pdf' }, responseType: 'blob' });
      const blobUrl = URL.createObjectURL(res.data);
      if (win) win.location.href = blobUrl;
      setPdfState({ status: 'idle', message: '' });
    } catch (err) {
      if (win) win.close();
      setPdfState({ status: 'error', message: await extractErrorMessage(err) });
    }
  };

  const { designData, baseTemplate, colorVariant } = buildPayload(template, designMeta);

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-actions">
        <button className="modal-btn" onClick={handlePreviewPdf} disabled={pdfState.status === 'loading'}>
          {pdfState.status === 'loading' ? 'Preparing…' : 'Preview as PDF'}
        </button>
        <button className="modal-btn" onClick={onClose}>
          Close preview <CloseIcon size={12} />
        </button>
      </div>
      <div className="v2-preview-frame-wrap" onClick={(e) => e.stopPropagation()}>
        {status === 'loading' && <div className="v2-preview-status">Rendering preview…</div>}
        {status === 'error' && <div className="v2-preview-status v2-preview-status--error">{message}</div>}
        {status === 'ready' && (
          <>
            {/* A real, genuine navigation (not a `srcDoc` HTML injection)
                so the loaded document's own @font-face requests resolve
                same-origin against the backend, exactly like a top-level
                page load would — see this file's own header comment. */}
            <form ref={formRef} method="post" action={RENDER_PREVIEW_URL} target={iframeName} hidden>
              <input type="hidden" name="design_data" value={JSON.stringify(designData)} />
              <input type="hidden" name="base_template" value={baseTemplate} />
              <input type="hidden" name="color_variant" value={colorVariant} />
              <input type="hidden" name="csrfmiddlewaretoken" value={getCookie('csrftoken') || ''} />
            </form>
            <iframe title="Invoice preview" name={iframeName} className="v2-preview-iframe" />
          </>
        )}
        {pdfState.status === 'error' && (
          <div className="v2-preview-status v2-preview-status--error v2-preview-status--pdf">{pdfState.message}</div>
        )}
      </div>
    </div>
  );
}
