import React, { useEffect } from 'react';
import { useEditor } from '../state/EditorContext';
import { CloseIcon } from './Icons';

// Real version history — GET/POST against
// apps.invoices.views.design_versions_list/design_version_restore
// (see EditorContext.jsx's fetchVersions/restoreVersion). Restoring is
// non-destructive on the server: it copies the chosen version's own
// design_data onto the live row and saves, which itself creates a brand
// new version for the restored content — nothing already in this list is
// ever deleted or overwritten by a restore.
export default function VersionHistoryModal({ onClose }) {
  const { versions, versionsLoading, versionsError, restoringVersionId, fetchVersions, restoreVersion } = useEditor();

  useEffect(() => {
    fetchVersions();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleRestore = async (version) => {
    if (
      !window.confirm(
        `Restore version ${version.version_number}? Your current unsaved canvas edits (if any) will be replaced. ` +
          'This does not delete any history — restoring creates a new version, so the version you\'re on now stays reachable too.'
      )
    ) {
      return;
    }
    const ok = await restoreVersion(version.id);
    if (ok) onClose();
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="version-modal"
        onClick={(e) => e.stopPropagation()}
        style={{
          background: 'var(--bg-panel, #1c1a22)',
          border: '1px solid var(--border-glass)',
          borderRadius: 10,
          padding: 20,
          width: 380,
          maxHeight: '70vh',
          overflowY: 'auto',
          color: 'var(--text-primary)',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <h3 style={{ margin: 0, fontSize: 15 }}>Version history</h3>
          <button className="modal-btn" onClick={onClose} aria-label="Close version history">
            <CloseIcon size={12} />
          </button>
        </div>

        {versionsLoading && <p style={{ fontSize: 13, opacity: 0.7 }}>Loading versions…</p>}
        {versionsError && <p style={{ fontSize: 13, color: 'var(--danger, #e03131)' }}>{versionsError}</p>}
        {!versionsLoading && !versionsError && versions.length === 0 && (
          <p style={{ fontSize: 13, opacity: 0.7 }}>No saved versions yet — your first real save creates one.</p>
        )}

        {!versionsLoading && versions.length > 0 && (
          <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
            {versions.map((version) => (
              <li
                key={version.id}
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  padding: '8px 10px',
                  border: '1px solid var(--border-glass)',
                  borderRadius: 8,
                }}
              >
                <div>
                  <div style={{ fontSize: 13, fontWeight: 600 }}>Version {version.version_number}</div>
                  <div style={{ fontSize: 11, opacity: 0.65 }}>{new Date(version.created_at).toLocaleString()}</div>
                </div>
                <button
                  className="modal-btn"
                  disabled={restoringVersionId === version.id}
                  onClick={() => handleRestore(version)}
                >
                  {restoringVersionId === version.id ? 'Restoring…' : 'Restore'}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
