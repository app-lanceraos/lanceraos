// src/pages/design-editor/EditorTopBar.jsx
import { ArrowLeft, Eye, EyeOff, Redo2, Save, Undo2 } from 'lucide-react'

const SAMPLE_ROW_OPTIONS = [3, 8, 20]

export default function EditorTopBar({
  name, onNameChange, onBack, onUndo, onRedo, canUndo, canRedo,
  sampleRows, onSampleRowsChange, previewing, onTogglePreview, onSave, saving,
}) {
  return (
    <div style={{
      height: 56, flexShrink: 0, display: 'flex', alignItems: 'center', gap: 12,
      padding: '0 16px', background: 'var(--bg-surface)', borderBottom: '1px solid var(--border-default)',
    }}>
      <button
        onClick={onBack}
        aria-label="Back to designs"
        style={{
          display: 'flex', alignItems: 'center', gap: 6, background: 'none', border: 'none',
          cursor: 'pointer', color: 'var(--text-secondary)', fontSize: '0.85rem', fontWeight: 600, padding: '6px 8px',
        }}
      >
        <ArrowLeft size={16} /> Designs
      </button>

      <div style={{ width: 1, height: 24, background: 'var(--border-default)' }} />

      <input
        value={name}
        onChange={(e) => onNameChange(e.target.value)}
        placeholder="Untitled design"
        style={{
          border: 'none', background: 'transparent', fontSize: '0.95rem', fontWeight: 700,
          color: 'var(--text-primary)', outline: 'none', minWidth: 160,
        }}
      />

      <div style={{ flex: 1 }} />

      <button onClick={onUndo} disabled={!canUndo} aria-label="Undo" className="fos-btn fos-btn-ghost" style={{ padding: 8 }}>
        <Undo2 size={16} />
      </button>
      <button onClick={onRedo} disabled={!canRedo} aria-label="Redo" className="fos-btn fos-btn-ghost" style={{ padding: 8 }}>
        <Redo2 size={16} />
      </button>

      <div style={{ width: 1, height: 24, background: 'var(--border-default)' }} />

      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <span style={{ fontSize: '0.78rem', color: 'var(--text-tertiary)' }}>Sample rows</span>
        {SAMPLE_ROW_OPTIONS.map((n) => (
          <button
            key={n}
            onClick={() => onSampleRowsChange(n)}
            style={{
              padding: '4px 10px', borderRadius: 999, fontSize: '0.78rem', fontWeight: 600, cursor: 'pointer',
              border: sampleRows === n ? '1px solid var(--accent)' : '1px solid var(--border-default)',
              background: sampleRows === n ? 'var(--accent-glow)' : 'transparent',
              color: sampleRows === n ? 'var(--accent-dim)' : 'var(--text-secondary)',
            }}
          >
            {n}
          </button>
        ))}
      </div>

      <div style={{ width: 1, height: 24, background: 'var(--border-default)' }} />

      <button onClick={onTogglePreview} className="fos-btn fos-btn-ghost" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        {previewing ? <EyeOff size={15} /> : <Eye size={15} />} {previewing ? 'Exit Preview' : 'Preview'}
      </button>

      <button onClick={onSave} disabled={saving} className="fos-btn fos-btn-accent" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        {saving ? <span className="fos-spinner" /> : <Save size={15} />} {saving ? 'Saving…' : 'Save'}
      </button>
    </div>
  )
}
