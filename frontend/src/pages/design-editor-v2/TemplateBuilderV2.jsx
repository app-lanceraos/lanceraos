// The LanceraOS Template Builder, v2 — a standalone project merged into
// frontend/ (see DECISIONS.md's merge entry). Reached via
// /invoices/designs/editor-v2 (a bare, unlinked dev sandbox, no real
// design behind it — the hardcoded initial state, unchanged) and, for
// real backend integration, /invoices/designs/:id/build (a real, owned
// InvoiceDesign row). As of the gallery-wiring phase, /:id/build IS
// linked from the real product UI — DesignGallery.jsx's Edit/Use
// template/Start blank/AI-seed actions all route a real,
// schema_version: 2 design here; only a pre-existing legacy-shaped
// design still opens GrapesJS's DesignEditor.jsx (below) instead. Both
// editors are shell-less and coexist deliberately during this soak
// period — see this editor's own "Open in the classic editor" fallback
// (Toolbar.jsx and the legacy-status screen below) and DECISIONS.md's
// merge entry.
import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import useTitle from '@/hooks/useTitle';
import api from '@/lib/api';
import FosAlert from '@/components/FosAlert';
import { EditorProvider, useEditor } from './state/EditorContext';
import { designDataToTemplate } from './adapter/designDataAdapter';
import { useKeyboardShortcuts } from './hooks/useKeyboardShortcuts';
import Toolbar from './components/Toolbar/Toolbar';
import ElementLibraryPanel from './components/Panels/ElementLibraryPanel';
import ShapeLibraryPanel from './components/Panels/ShapeLibraryPanel';
import LayersPanel from './components/Panels/LayersPanel';
import PropertiesPanel from './components/Panels/PropertiesPanel';
import EditorCanvas from './components/Canvas/EditorCanvas';
import PreviewModal from './components/PreviewModal';
import ContextMenu from './components/ContextMenu';
import Tooltip from './components/Tooltip';
import { ChevronLeftIcon, ChevronRightIcon } from './components/Icons';
import './styles/tokens.css';
import './styles/editor.css';

const LEFT_WIDTH = 240;
const RIGHT_WIDTH = 280;
// Prompt 24 item 2: wide enough to fully contain the 22px toggle button
// plus a few px of breathing room on both sides when collapsed — the
// previous 24px was narrower than the button's own footprint, so the
// button spilled past the column's (and, for the right panel, the app's
// own outer) edge.
const RAIL_WIDTH = 32;

function EditorShell() {
  const [previewOpen, setPreviewOpen] = useState(false);
  const togglePreview = () => setPreviewOpen((v) => !v);
  useKeyboardShortcuts({ onPreviewToggle: togglePreview });

  const { leftPanelCollapsed, toggleLeftPanel, rightPanelCollapsed, toggleRightPanel, dirty, designId } = useEditor();

  // Unsaved-changes browser warning — matches DesignEditor.jsx's own
  // convention exactly. Only meaningful in real (designId) mode: the bare
  // sandbox route has nothing server-side to lose. Only catches an actual
  // tab close/refresh/URL navigation — an in-app client-side navigate()
  // bypasses beforeunload entirely, which is why Toolbar's own "Back to
  // designs" button carries its own separate window.confirm guard.
  useEffect(() => {
    if (!designId) return;
    function handleBeforeUnload(e) {
      if (!dirty) return;
      e.preventDefault();
      e.returnValue = '';
    }
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [designId, dirty]);

  return (
    <div className="app-shell">
      <Toolbar onPreview={togglePreview} />
      <div
        className="workspace"
        style={{
          gridTemplateColumns: `${leftPanelCollapsed ? RAIL_WIDTH : LEFT_WIDTH}px 1fr ${rightPanelCollapsed ? RAIL_WIDTH : RIGHT_WIDTH}px`,
        }}
      >
        {/* Prompt 24 item 1: the toggle sits inline in a small header row
            (label + icon-only button, normal flow — not a dedicated
            full-width strip, not absolutely positioned over the panel's
            own content) when expanded; collapsed, `.panel-wrap` just
            centers the lone button in the narrow rail — see item 2's own
            comment on why that's a distinct layout, not the same button
            re-positioned. Prompt 30 item 1: tooltips use `placement=
            "bottom"` here since these buttons sit right under the
            toolbar — a "top" tooltip would clip against/behind it. */}
        <div className={`panel-wrap${leftPanelCollapsed ? ' panel-wrap--collapsed' : ''}`}>
          {leftPanelCollapsed ? (
            <Tooltip label="Expand panel" placement="bottom">
              <button className="panel-toggle-btn" onClick={toggleLeftPanel} aria-label="Expand elements panel">
                <ChevronRightIcon />
              </button>
            </Tooltip>
          ) : (
            <>
              <div className="panel-header">
                <span className="panel-header__label">Elements</span>
                <Tooltip label="Collapse panel" placement="bottom">
                  <button className="panel-toggle-btn" onClick={toggleLeftPanel} aria-label="Collapse elements panel">
                    <ChevronLeftIcon />
                  </button>
                </Tooltip>
              </div>
              <div className="panel">
                <ElementLibraryPanel />
                <div style={{ height: 1, background: 'var(--border-glass)', margin: '16px 0' }} />
                <ShapeLibraryPanel />
                <div style={{ height: 1, background: 'var(--border-glass)', margin: '16px 0' }} />
                <LayersPanel />
              </div>
            </>
          )}
        </div>
        <EditorCanvas />
        <div className={`panel-wrap panel-wrap--right${rightPanelCollapsed ? ' panel-wrap--collapsed' : ''}`}>
          {rightPanelCollapsed ? (
            <Tooltip label="Expand panel" placement="bottom">
              <button className="panel-toggle-btn" onClick={toggleRightPanel} aria-label="Expand properties panel">
                <ChevronLeftIcon />
              </button>
            </Tooltip>
          ) : (
            <>
              <div className="panel-header">
                <span className="panel-header__label">Properties</span>
                <Tooltip label="Collapse panel" placement="bottom">
                  <button className="panel-toggle-btn" onClick={toggleRightPanel} aria-label="Collapse properties panel">
                    <ChevronRightIcon />
                  </button>
                </Tooltip>
              </div>
              <PropertiesPanel />
            </>
          )}
        </div>
      </div>
      {previewOpen && <PreviewModal onClose={() => setPreviewOpen(false)} />}
      <ContextMenu />
    </div>
  );
}

// Loads a real, owned InvoiceDesign (production schema_version: 2 only)
// from the backend before the editor ever mounts, and owns every honest
// failure state this route can hit — a legacy-shape design (predates
// this editor; designDataToTemplate itself throws on anything that
// isn't real schema_version: 2, see that function's own guard), a
// design that doesn't exist or isn't this user's (GET /invoices/designs/
// {id}/ is scoped to request.user and returns a real 404 for both cases
// — this backend has no separate 403 for "exists but not yours"), and a
// genuine network/5xx failure — never a silently blank editor.
function LoadedTemplateBuilder({ id }) {
  const navigate = useNavigate();
  const [state, setState] = useState({ status: 'loading', template: null, meta: null, message: '' });

  useEffect(() => {
    let cancelled = false;
    setState({ status: 'loading', template: null, meta: null, message: '' });

    async function load() {
      let data;
      try {
        const res = await api.get(`/invoices/designs/${id}/`);
        data = res.data;
      } catch (err) {
        if (cancelled) return;
        if (err.response?.status === 404) {
          setState({ status: 'error', message: "This design doesn't exist, or isn't yours to edit." });
        } else if (err.response) {
          setState({ status: 'error', message: 'Something went wrong loading this design. Please try again.' });
        } else {
          setState({ status: 'error', message: 'Could not reach the server. Check your connection and try again.' });
        }
        return;
      }

      try {
        const { template } = designDataToTemplate(data.design_data);
        if (cancelled) return;
        setState({
          status: 'ready',
          template,
          meta: { name: data.name, base_template: data.base_template, color_variant: data.color_variant },
          message: '',
        });
      } catch {
        if (cancelled) return;
        setState({
          status: 'legacy',
          message:
            "This design was built before this editor existed and uses an older format it can't open. " +
            'Duplicate a ready-made template to start a new design here, or use the original Template Builder to keep editing this one.',
        });
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [id]);

  if (state.status === 'loading') {
    return <div className="v2-route-status">Loading design…</div>;
  }

  if (state.status === 'error' || state.status === 'legacy') {
    return (
      <div className="v2-route-status">
        <FosAlert type={state.status === 'legacy' ? 'warning' : 'error'}>{state.message}</FosAlert>
        {state.status === 'legacy' && (
          <button className="tbtn" style={{ marginTop: 12 }} onClick={() => navigate(`/invoices/designs/${id}/edit`)}>
            Open in the classic editor
          </button>
        )}
      </div>
    );
  }

  return (
    <EditorProvider key={id} initialTemplate={state.template} designId={id} designMeta={state.meta}>
      <EditorShell />
    </EditorProvider>
  );
}

export default function TemplateBuilderV2() {
  useTitle('Template Builder v2 — LanceraOS');
  const { id } = useParams();

  if (id) return <LoadedTemplateBuilder id={id} />;

  return (
    <EditorProvider>
      <EditorShell />
    </EditorProvider>
  );
}
