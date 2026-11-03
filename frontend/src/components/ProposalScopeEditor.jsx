// src/components/ProposalScopeEditor.jsx
//
// Optional titled sections ("Deliverables", "Timeline", "Out of scope"…) —
// up to 10, each a plain-text title and body. An all-blank section is allowed
// to sit in the editor and is simply not sent.
import { ChevronDown, ChevronUp, Plus, Trash2 } from 'lucide-react'

import { ProposalCounter, ProposalTextArea, ProposalTextField } from './ProposalFields'
import { blankSection, charCount, LIMITS } from '@/pages/proposalHelpers'

export default function ProposalScopeEditor({ sections, onChange, errors, serverError, disabled = false }) {
  const rowErrors = errors?.rows || {}
  const listError = errors?.list || serverError

  const setSection = (index, patch) => onChange(sections.map((section, i) => (i === index ? { ...section, ...patch } : section)))
  const removeSection = (index) => onChange(sections.filter((_, i) => i !== index))
  const moveSection = (index, direction) => {
    const target = index + direction
    if (target < 0 || target >= sections.length) return
    const next = [...sections]
    ;[next[index], next[target]] = [next[target], next[index]]
    onChange(next)
  }

  const atLimit = sections.length >= LIMITS.scopeSections

  return (
    <div>
      {sections.length === 0 && (
        <p style={{ margin: '0 0 10px', fontSize: '0.82rem', color: 'var(--text-tertiary)' }}>
          No sections yet. Add one to spell out deliverables, timeline or what is not included.
        </p>
      )}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {sections.map((section, index) => {
          const problems = rowErrors[section.key] || {}
          return (
            <div key={section.key} style={{ background: 'var(--bg-surface-2)', border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-md)', padding: 12 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                <span style={{ fontSize: '0.68rem', fontWeight: 600, color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Section {index + 1}</span>
                <div style={{ display: 'flex', gap: 2 }}>
                  <button type="button" className="fos-btn fos-btn-ghost" style={{ padding: 4 }} onClick={() => moveSection(index, -1)} disabled={disabled || index === 0} aria-label={`Move section ${index + 1} up`}>
                    <ChevronUp size={14} />
                  </button>
                  <button type="button" className="fos-btn fos-btn-ghost" style={{ padding: 4 }} onClick={() => moveSection(index, 1)} disabled={disabled || index === sections.length - 1} aria-label={`Move section ${index + 1} down`}>
                    <ChevronDown size={14} />
                  </button>
                  <button type="button" className="fos-btn fos-btn-ghost" style={{ padding: 4, color: 'var(--status-red-text)' }} onClick={() => removeSection(index)} disabled={disabled} aria-label={`Remove section ${index + 1}`}>
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <ProposalTextField
                  label="Title" value={section.title} disabled={disabled} error={problems.title}
                  onChange={(text) => setSection(index, { title: text })}
                  counter={<ProposalCounter count={charCount(section.title)} max={LIMITS.scopeTitle} />}
                />
                <ProposalTextArea
                  label="Text" value={section.text} rows={4} disabled={disabled} error={problems.text}
                  onChange={(text) => setSection(index, { text })}
                  counter={<ProposalCounter count={charCount(section.text)} max={LIMITS.scopeText} />}
                />
              </div>
            </div>
          )
        })}
      </div>
      {listError && <p className="fos-error" role="alert" style={{ marginTop: 8 }}>{listError}</p>}
      <button
        type="button" onClick={() => onChange([...sections, blankSection()])} disabled={disabled || atLimit}
        style={{ width: '100%', marginTop: 10, background: 'none', border: '1.5px dashed var(--border-default)', borderRadius: 'var(--radius-md)', padding: 10, cursor: disabled || atLimit ? 'not-allowed' : 'pointer', opacity: disabled || atLimit ? 0.5 : 1, color: 'var(--accent)', fontSize: '0.82rem', fontWeight: 500, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}
      >
        <Plus size={14} /> {atLimit ? `Maximum of ${LIMITS.scopeSections} sections reached` : 'Add section'}
      </button>
    </div>
  )
}
