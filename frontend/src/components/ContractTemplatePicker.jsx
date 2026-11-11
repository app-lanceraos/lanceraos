// src/components/ContractTemplatePicker.jsx
//
// The five contract templates as real radio inputs inside a radiogroup: arrow keys move between them, Space chooses, the
// focus ring is visible, each card is at least 44px tall. Nothing is preselected: a contract starts from a deliberate
// choice. Each card shows the template's label, its description and the titles of its sections ("What's inside").
import { OWNER_COPY } from '@/pages/contractCopy'

export default function ContractTemplatePicker({ templates, value, onChange, disabled = false, error }) {
  return (
    <fieldset
      role="radiogroup" aria-describedby={error ? 'contract-template-error' : undefined}
      style={{ border: 'none', margin: 0, padding: 0, minWidth: 0 }}
    >
      <legend className="fos-label" style={{ padding: 0, marginBottom: 8 }}>Template</legend>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 12 }}>
        {templates.map((template) => {
          const selected = value === template.key
          return (
            <label
              key={template.key}
              style={{
                display: 'flex', gap: 12, alignItems: 'flex-start', minHeight: 44, padding: '14px 16px',
                background: selected ? 'var(--accent-glow)' : 'var(--bg-surface)',
                border: `1.5px solid ${selected ? 'var(--accent)' : 'var(--border-subtle)'}`,
                borderRadius: 'var(--radius-lg)', cursor: disabled ? 'default' : 'pointer', opacity: disabled ? 0.7 : 1,
              }}
            >
              <input
                type="radio" name="contract-template" value={template.key} checked={selected} disabled={disabled}
                onChange={() => onChange(template.key)}
                style={{ marginTop: 3, width: 18, height: 18, flexShrink: 0, accentColor: 'var(--accent)' }}
              />
              <span style={{ minWidth: 0 }}>
                <span style={{ display: 'block', fontWeight: 700, fontSize: '0.92rem', color: 'var(--text-primary)' }}>{template.label}</span>
                <span style={{ display: 'block', margin: '2px 0 8px', fontSize: '0.8rem', color: 'var(--text-secondary)', lineHeight: 1.5 }}>{template.description}</span>
                <span style={{ display: 'block', fontSize: '0.7rem', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em', color: 'var(--text-tertiary)' }}>
                  {OWNER_COPY.whatsInside}
                </span>
                <ul style={{ margin: '4px 0 0', paddingLeft: 16, fontSize: '0.76rem', color: 'var(--text-secondary)', lineHeight: 1.55 }}>
                  {template.section_titles.map((title) => <li key={title}>{title}</li>)}
                </ul>
              </span>
            </label>
          )
        })}
      </div>
      {error && <p id="contract-template-error" className="fos-error" role="alert">{error}</p>}
    </fieldset>
  )
}
