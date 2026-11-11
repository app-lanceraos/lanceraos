// src/components/ContractSectionsEditor.jsx
//
// The contract's sections as collapsible cards (Prompt 23, F5 and F6). A collapsed card shows its number, title, a one-line
// escaped preview and an amber "Needs your text" chip when it still holds a [[blank]]. Sections that hold a blank start
// expanded. Reorder with Move up / Move down (buttons, keyboard-friendly; no drag and drop). An empty section is allowed in
// a draft: sending refuses it.
//
// Local state is ONLY which cards are open. The sections themselves are the page's (`sections` / `onChange`), each with a
// local React `key` that is never sent. `jumpTo` ({ key, token }) opens a section, focuses its text and selects its first
// blank; it is how the "Blanks to fill" list and the Send dialog take a person to the problem.
import { useEffect, useRef, useState } from 'react'
import { ChevronDown, ChevronRight, ChevronUp, Plus, Trash2 } from 'lucide-react'

import { ProposalCounter, ProposalTextArea, ProposalTextField } from '@/components/ProposalFields'
import { OWNER_COPY } from '@/pages/contractCopy'
import {
  CONTRACT_LIMITS, findPlaceholders, moveSection, newSection, nextPlaceholder, sectionPreview,
} from '@/pages/contractHelpers'
import { charCount } from '@/pages/proposalHelpers'

export const sectionTextId = (key) => `contract-section-text-${key}`
export const sectionTitleId = (key) => `contract-section-title-${key}`

const hasBlank = (section) => findPlaceholders(section.title).length + findPlaceholders(section.text).length > 0
const hasContent = (section) => Boolean(String(section.title ?? '').trim() || String(section.text ?? '').trim())

function selectBlank(key, from) {
  const element = document.getElementById(sectionTextId(key))
  if (!element) return null
  const blank = nextPlaceholder(element.value, from)
  if (!blank) return null
  element.focus()
  element.setSelectionRange(blank.start, blank.end)
  // Scroll the textarea itself so the selected blank is in view (a selection does not always scroll one).
  const lineHeight = parseFloat(globalThis.getComputedStyle?.(element)?.lineHeight) || 22
  const line = element.value.slice(0, blank.start).split('\n').length - 1
  element.scrollTop = Math.max(0, line * lineHeight - element.clientHeight / 2)
  element.scrollIntoView?.({ block: 'center' })
  return blank
}

export default function ContractSectionsEditor({
  sections, onChange, errors, serverError, disabled = false, jumpTo = null,
}) {
  const rowErrors = errors?.rows || {}
  const listError = errors?.list || serverError
  const [open, setOpen] = useState(() => new Set(sections.filter(hasBlank).map((section) => section.key)))
  const [confirming, setConfirming] = useState(null) // key of the section whose removal is being confirmed
  const [status, setStatus] = useState(null) // { key, text } for the "no blanks" line
  const lastBlankEnd = useRef({})
  const focusAfter = useRef(null) // { type: 'title', key } | { type: 'header', key } | { type: 'blank', key }

  const atLimit = sections.length >= CONTRACT_LIMITS.SECTION_MAX
  const totalText = sections.reduce((total, section) => total + charCount(section.text), 0)

  const toggle = (key) => setOpen((current) => {
    const next = new Set(current)
    if (next.has(key)) next.delete(key)
    else next.add(key)
    return next
  })
  const setSection = (key, patch) => onChange(sections.map((section) => (section.key === key ? { ...section, ...patch } : section)))

  // Focus that has to wait for a re-render (a new card's title, a neighbour's header, a jumped-to blank).
  useEffect(() => {
    const target = focusAfter.current
    if (!target) return
    focusAfter.current = null
    if (target.type === 'title') document.getElementById(sectionTitleId(target.key))?.focus()
    else if (target.type === 'header') document.getElementById(`contract-section-header-${target.key}`)?.focus()
    else if (target.type === 'blank') selectBlank(target.key, 0)
  })

  const jumpToken = jumpTo?.token
  useEffect(() => {
    if (!jumpTo?.key) return
    setOpen((current) => new Set(current).add(jumpTo.key))
    focusAfter.current = { type: 'blank', key: jumpTo.key }
    // The open card renders on the next pass; the effect above then selects the blank (or focuses the text).
    const frame = setTimeout(() => {
      if (!selectBlank(jumpTo.key, 0)) document.getElementById(sectionTextId(jumpTo.key))?.focus()
    }, 0)
    return () => clearTimeout(frame)
    // Only a new jump request does anything.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jumpToken])

  function addSection() {
    const section = newSection()
    onChange([...sections, section])
    setOpen((current) => new Set(current).add(section.key))
    focusAfter.current = { type: 'title', key: section.key }
  }

  function removeSection(index) {
    const section = sections[index]
    const neighbour = sections[index + 1] || sections[index - 1]
    onChange(sections.filter((entry) => entry.key !== section.key))
    setConfirming(null)
    if (neighbour) focusAfter.current = { type: 'header', key: neighbour.key }
  }

  function move(index, delta) {
    const next = moveSection(sections, index, delta)
    if (next !== sections) {
      onChange(next)
      focusAfter.current = { type: 'header', key: sections[index].key }
    }
  }

  function nextBlank(section) {
    const element = document.getElementById(sectionTextId(section.key))
    const from = lastBlankEnd.current[section.key] ?? 0
    const blank = element ? selectBlank(section.key, from) : null
    if (blank) {
      lastBlankEnd.current[section.key] = blank.end
      setStatus(null)
    } else {
      setStatus({ key: section.key, text: OWNER_COPY.noBlank })
    }
  }

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap', marginBottom: 10 }}>
        <span style={{ fontSize: '0.78rem', color: 'var(--text-tertiary)' }}>{OWNER_COPY.sectionCount(sections.length, CONTRACT_LIMITS.SECTION_MAX)}</span>
        <span style={{ display: 'inline-flex', gap: 6 }}>
          <button type="button" className="fos-btn fos-btn-ghost" style={{ padding: '4px 10px', fontSize: '0.76rem' }} onClick={() => setOpen(new Set(sections.map((s) => s.key)))} disabled={!sections.length}>
            {OWNER_COPY.expandAll}
          </button>
          <button type="button" className="fos-btn fos-btn-ghost" style={{ padding: '4px 10px', fontSize: '0.76rem' }} onClick={() => setOpen(new Set())} disabled={!sections.length}>
            {OWNER_COPY.collapseAll}
          </button>
        </span>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {sections.map((section, index) => {
          const isOpen = open.has(section.key)
          const problems = rowErrors[section.key] || {}
          const blank = hasBlank(section)
          const bodyId = `contract-section-body-${section.key}`
          const number = index + 1
          return (
            <div key={section.key} style={{ background: 'var(--bg-surface-2)', border: `1px solid ${problems.title || problems.text ? 'var(--status-red)' : 'var(--border-subtle)'}`, borderRadius: 'var(--radius-md)' }}>
              <div style={{ display: 'flex', alignItems: 'stretch', gap: 4, padding: 4 }}>
                <button
                  type="button" id={`contract-section-header-${section.key}`} aria-expanded={isOpen} aria-controls={bodyId}
                  onClick={() => toggle(section.key)}
                  style={{ flex: 1, minWidth: 0, minHeight: 44, display: 'flex', alignItems: 'center', gap: 10, textAlign: 'left', background: 'none', border: 'none', padding: '6px 8px', cursor: 'pointer', color: 'inherit', font: 'inherit' }}
                >
                  {isOpen ? <ChevronDown size={16} aria-hidden="true" style={{ flexShrink: 0 }} /> : <ChevronRight size={16} aria-hidden="true" style={{ flexShrink: 0 }} />}
                  <span style={{ minWidth: 0, flex: 1 }}>
                    <span style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                      <span style={{ fontSize: '0.68rem', fontWeight: 600, color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>{number}</span>
                      <span style={{ fontSize: '0.88rem', fontWeight: 700, color: section.title.trim() ? 'var(--text-primary)' : 'var(--text-tertiary)', overflowWrap: 'anywhere' }}>
                        {section.title.trim() || OWNER_COPY.untitledSection}
                      </span>
                      {blank && (
                        <span style={{ fontSize: '0.68rem', fontWeight: 700, padding: '2px 8px', borderRadius: 'var(--radius-full)', background: 'var(--status-amber-bg)', color: 'var(--status-amber-text)' }}>
                          {OWNER_COPY.needsText}
                        </span>
                      )}
                    </span>
                    {!isOpen && section.text.trim() && (
                      <span style={{ display: 'block', marginTop: 2, fontSize: '0.76rem', color: 'var(--text-tertiary)', overflowWrap: 'anywhere' }}>{sectionPreview(section.text)}</span>
                    )}
                  </span>
                </button>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 2, flexShrink: 0 }}>
                  <button type="button" className="fos-btn fos-btn-ghost" style={{ padding: 8, minWidth: 36, minHeight: 36 }} onClick={() => move(index, -1)} disabled={disabled || index === 0} aria-label={`${OWNER_COPY.moveUp}: section ${number}`} data-tooltip={OWNER_COPY.moveUp}>
                    <ChevronUp size={15} aria-hidden="true" />
                  </button>
                  <button type="button" className="fos-btn fos-btn-ghost" style={{ padding: 8, minWidth: 36, minHeight: 36 }} onClick={() => move(index, 1)} disabled={disabled || index === sections.length - 1} aria-label={`${OWNER_COPY.moveDown}: section ${number}`} data-tooltip={OWNER_COPY.moveDown}>
                    <ChevronDown size={15} aria-hidden="true" />
                  </button>
                </span>
              </div>

              {isOpen && (
                <div id={bodyId} style={{ padding: '4px 12px 12px', display: 'flex', flexDirection: 'column', gap: 10 }}>
                  <ProposalTextField
                    id={sectionTitleId(section.key)} label={OWNER_COPY.sectionTitleLabel} value={section.title} disabled={disabled} error={problems.title}
                    onChange={(text) => setSection(section.key, { title: text })}
                    counter={<ProposalCounter count={charCount(section.title)} max={CONTRACT_LIMITS.SECTION_TITLE_MAX} />}
                  />
                  <ProposalTextArea
                    id={sectionTextId(section.key)} label={OWNER_COPY.sectionTextLabel} value={section.text} rows={8} disabled={disabled} error={problems.text}
                    onChange={(text) => { delete lastBlankEnd.current[section.key]; setSection(section.key, { text }) }}
                    counter={<ProposalCounter count={charCount(section.text)} max={CONTRACT_LIMITS.SECTION_TEXT_MAX} />}
                  />
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                    <button type="button" className="fos-btn fos-btn-ghost" onClick={() => nextBlank(section)} disabled={disabled} style={{ fontSize: '0.8rem' }}>
                      {OWNER_COPY.nextBlank}
                    </button>
                    <span role="status" style={{ fontSize: '0.76rem', color: 'var(--text-tertiary)' }}>
                      {status?.key === section.key ? status.text : ''}
                    </span>
                    <span style={{ flex: 1 }} />
                    {confirming === section.key ? (
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                        <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>{OWNER_COPY.removeConfirm}</span>
                        <button type="button" className="fos-btn fos-btn-danger" style={{ padding: '4px 12px', fontSize: '0.78rem' }} onClick={() => removeSection(index)} disabled={disabled}>{OWNER_COPY.removeYes}</button>
                        <button type="button" className="fos-btn fos-btn-ghost" style={{ padding: '4px 12px', fontSize: '0.78rem' }} onClick={() => setConfirming(null)}>{OWNER_COPY.removeNo}</button>
                      </span>
                    ) : (
                      <button
                        type="button" className="fos-btn fos-btn-ghost" style={{ color: 'var(--status-red-text)', fontSize: '0.8rem' }} disabled={disabled}
                        onClick={() => (hasContent(section) ? setConfirming(section.key) : removeSection(index))}
                      >
                        <Trash2 size={14} aria-hidden="true" /> {OWNER_COPY.removeSection}
                      </button>
                    )}
                  </div>
                </div>
              )}
            </div>
          )
        })}
      </div>

      {listError && <p className="fos-error" role="alert" style={{ marginTop: 8 }}>{listError}</p>}

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap', marginTop: 10 }}>
        <button
          type="button" onClick={addSection} disabled={disabled || atLimit}
          style={{ flex: '1 1 220px', background: 'none', border: '1.5px dashed var(--border-default)', borderRadius: 'var(--radius-md)', minHeight: 44, cursor: disabled || atLimit ? 'not-allowed' : 'pointer', opacity: disabled || atLimit ? 0.5 : 1, color: 'var(--accent)', fontSize: '0.82rem', fontWeight: 500, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}
        >
          <Plus size={14} aria-hidden="true" /> {atLimit ? OWNER_COPY.sectionsLimit : OWNER_COPY.addSection}
        </button>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: '0.74rem', color: 'var(--text-tertiary)' }}>
          {OWNER_COPY.totalTextLabel} <ProposalCounter count={totalText} max={CONTRACT_LIMITS.TOTAL_TEXT_MAX} />
        </span>
      </div>
    </div>
  )
}
