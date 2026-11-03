// src/components/ProposalItemsEditor.jsx
//
// The priced line items of a proposal draft. Money is typed as TEXT
// (inputMode="decimal"), never type=number — see ProposalFields.jsx. Each
// row's total is the exact figure the server will store (computeProposalTotals,
// half-even), passed in by the page so the rows and the totals block can never
// disagree. Rows carry a client-only `key`; an all-blank row is allowed to sit
// in the editor and is simply not sent.
import { ChevronDown, ChevronUp, Plus, Trash2 } from 'lucide-react'

import { ProposalTextField } from './ProposalFields'
import { blankItem, formatProposalMoney, LIMITS } from '@/pages/proposalHelpers'

export default function ProposalItemsEditor({ items, onChange, currency, lineTotals, errors, serverError, disabled = false }) {
  const rowErrors = errors?.rows || {}
  const listError = errors?.list || serverError

  const setItem = (index, patch) => onChange(items.map((item, i) => (i === index ? { ...item, ...patch } : item)))
  const addItem = () => onChange([...items, blankItem()])
  const removeItem = (index) => {
    const next = items.filter((_, i) => i !== index)
    onChange(next.length ? next : [blankItem()])
  }
  const moveItem = (index, direction) => {
    const target = index + direction
    if (target < 0 || target >= items.length) return
    const next = [...items]
    ;[next[index], next[target]] = [next[target], next[index]]
    onChange(next)
  }

  const atLimit = items.length >= LIMITS.items

  return (
    <div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {items.map((item, index) => {
          const problems = rowErrors[item.key] || {}
          return (
            <div key={item.key} style={{ background: 'var(--bg-surface-2)', border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-md)', padding: 12 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                <span style={{ fontSize: '0.68rem', fontWeight: 600, color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Item {index + 1}</span>
                <div style={{ display: 'flex', gap: 2 }}>
                  <button type="button" className="fos-btn fos-btn-ghost" style={{ padding: 4 }} onClick={() => moveItem(index, -1)} disabled={disabled || index === 0} aria-label={`Move item ${index + 1} up`}>
                    <ChevronUp size={14} />
                  </button>
                  <button type="button" className="fos-btn fos-btn-ghost" style={{ padding: 4 }} onClick={() => moveItem(index, 1)} disabled={disabled || index === items.length - 1} aria-label={`Move item ${index + 1} down`}>
                    <ChevronDown size={14} />
                  </button>
                  <button type="button" className="fos-btn fos-btn-ghost" style={{ padding: 4, color: 'var(--status-red-text)' }} onClick={() => removeItem(index)} disabled={disabled} aria-label={`Remove item ${index + 1}`}>
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <ProposalTextField
                  label="Description" value={item.description} disabled={disabled} error={problems.description}
                  onChange={(text) => setItem(index, { description: text })} placeholder="What you will deliver"
                />
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: 8 }}>
                  <ProposalTextField
                    label="Quantity" inputMode="decimal" value={item.quantity} disabled={disabled} error={problems.quantity}
                    onChange={(text) => setItem(index, { quantity: text })}
                  />
                  <ProposalTextField
                    label={`Unit price (${currency})`} inputMode="decimal" value={item.unit_price} disabled={disabled} error={problems.unit_price}
                    onChange={(text) => setItem(index, { unit_price: text })} placeholder="0.00"
                  />
                </div>
              </div>
              <p style={{ margin: '8px 0 0', fontSize: '0.8rem', fontWeight: 700, color: 'var(--text-primary)', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                {formatProposalMoney(lineTotals[index] ?? '0.00', currency)}
              </p>
            </div>
          )
        })}
      </div>
      {listError && <p className="fos-error" role="alert" style={{ marginTop: 8 }}>{listError}</p>}
      <button
        type="button" onClick={addItem} disabled={disabled || atLimit}
        style={{ width: '100%', marginTop: 10, background: 'none', border: '1.5px dashed var(--border-default)', borderRadius: 'var(--radius-md)', padding: 10, cursor: disabled || atLimit ? 'not-allowed' : 'pointer', opacity: disabled || atLimit ? 0.5 : 1, color: 'var(--accent)', fontSize: '0.82rem', fontWeight: 500, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}
      >
        <Plus size={14} /> {atLimit ? `Maximum of ${LIMITS.items} items reached` : 'Add item'}
      </button>
    </div>
  )
}
