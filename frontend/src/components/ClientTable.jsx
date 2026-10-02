// src/components/ClientTable.jsx
//
// Desktop client list — a real table (Clients list alignment, Part B,
// 02 October 2026), replacing the card grid at desktop widths so the page
// matches Invoices' structure and puts the money columns front and centre.
// Columns: Client | Tags | Invoices | Invoiced | Outstanding | Reliability |
// Actions. Mobile keeps the card layout (Clients.jsx renders ClientCard
// directly at ≤768px) — this component is desktop-only.
//
// Mirrors InvoiceTable.jsx on purpose: the whole row opens the detail panel
// (cursor + hover via a row class), the actions cell stops click
// propagation so opening the row menu never also opens the panel, and every
// th/td/wrapper/hover style comes from listTableStyles.js so the two list
// tables cannot drift. No checkbox column and no column-header sorting —
// Invoices has neither for sorting, and bulk selection on Clients is
// deferred (DECISIONS.md).
//
// Money: every figure is payment_stats' own, already converted into
// payment_stats.currency by the backend, and labelled with that field —
// never client.default_currency. Drafts, cancelled and refunded invoices are
// excluded from the count and every figure (a drafts-only client therefore
// legitimately shows 0 / 0), and an invoice that could not be converted is
// reported through the Info icon rather than guessed or silently dropped.
//
// Like InvoiceTable, rows are NOT keyboard-operable (a clickable <tr>, no
// tabIndex/key handler) — deliberately not diverged from here; fixing it
// belongs to both tables together (DECISIONS.md audit backlog).
import { Archive, Flag, Info, MoreVertical, RotateCcw } from 'lucide-react'

import DropdownMenu from './DropdownMenu'
import { clickableRowCss, tableStyle, tableWrapperStyle, td, th, theadRowStyle } from './listTableStyles'
import {
  STATUS_BADGE_STYLE, badgeBaseStyle, formatClientMoney, overdueLabel, reliabilityBand, tagPillStyle, unconvertedNote,
} from '@/pages/clientHelpers'

const MAX_VISIBLE_TAGS = 2

export default function ClientTable({ clients, busyId, onOpen, onFlag, onArchive, onRestore }) {
  return (
    <div style={tableWrapperStyle}>
      <style>{clickableRowCss('client-row')}</style>
      {/* minWidth is MEASURED, not guessed (real Chromium, 02 October 2026): the table's
          min-content width is ~810px for ordinary rows and ~970px for the worst realistic row
          (2 tags + the "+N" pill + an overdue line). Below that the wrapper scrolls instead of
          crushing columns; at 1280px neither case scrolls. The Client cell is capped at 240px
          (it was 280 and pushed the worst row to ~1003px, forcing a scrollbar at 1280). */}
      <table style={tableStyle(820)}>
        <thead>
          <tr style={theadRowStyle}>
            <th style={th}>Client</th>
            <th style={th}>Tags</th>
            <th style={th}>Invoices</th>
            <th style={th}>Invoiced</th>
            <th style={th}>Outstanding</th>
            <th style={th}>Reliability</th>
            <th style={{ ...th, width: 44 }} aria-label="Actions" />
          </tr>
        </thead>
        <tbody>
          {clients.map((client) => (
            <ClientRow
              key={client.id}
              client={client}
              busy={busyId === client.id}
              onOpen={onOpen}
              onFlag={onFlag}
              onArchive={onArchive}
              onRestore={onRestore}
            />
          ))}
        </tbody>
      </table>
    </div>
  )
}

function ClientRow({ client, busy, onOpen, onFlag, onArchive, onRestore }) {
  const stats = client.payment_stats
  const hasFlag = client.is_flagged || client.auto_flagged
  const band = reliabilityBand(stats?.reliability_score)
  const tags = client.tags || []
  const hiddenTags = tags.slice(MAX_VISIBLE_TAGS)
  const overdueText = overdueLabel(stats)
  const unconverted = stats?.unconverted_count || 0

  const items = []
  if (!hasFlag) items.push({ key: 'flag', label: 'Flag', Icon: Flag, onClick: () => onFlag(client) })
  if (client.is_active) items.push({ key: 'archive', label: 'Archive', Icon: Archive, onClick: () => onArchive(client) })
  else items.push({ key: 'restore', label: 'Restore', Icon: RotateCcw, onClick: () => onRestore(client) })

  return (
    <tr className="client-row" onClick={() => onOpen(client)}>
      <td style={td}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{
            width: 36, height: 36, borderRadius: '50%', flexShrink: 0,
            background: hasFlag ? 'var(--status-red-bg)' : 'var(--accent)',
            color: hasFlag ? 'var(--status-red-text)' : '#000',
            border: hasFlag ? '1px solid var(--status-red)' : 'none',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: '0.95rem', fontWeight: 700,
          }}>
            {(client.name || 'C').charAt(0).toUpperCase()}
          </div>
          <div style={{ minWidth: 0, maxWidth: 240 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span title={client.name} style={{ fontWeight: 600, color: 'var(--text-primary)', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {client.name}
              </span>
              {client.is_flagged && <span style={{ ...badgeBaseStyle, ...STATUS_BADGE_STYLE.red, flexShrink: 0 }}>Flagged</span>}
              {client.auto_flagged && <span style={{ ...badgeBaseStyle, ...STATUS_BADGE_STYLE.amber, flexShrink: 0 }}>Auto-flagged</span>}
              {!client.is_active && <span style={{ ...badgeBaseStyle, ...STATUS_BADGE_STYLE.gray, flexShrink: 0 }}>Archived</span>}
            </div>
            <div title={[client.email, client.company].filter(Boolean).join(' · ')} style={{ marginTop: 2, fontSize: '0.76rem', color: 'var(--text-tertiary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {client.email}{client.company && ` · ${client.company}`}
            </div>
          </div>
        </div>
      </td>

      <td style={td}>
        {tags.length > 0 && (
          <div style={{ display: 'flex', gap: 5, flexWrap: 'nowrap' }}>
            {tags.slice(0, MAX_VISIBLE_TAGS).map((tag) => (
              <span key={tag.id} style={{ ...tagPillStyle(tag.color), fontSize: '0.66rem', padding: '2px 7px' }}>{tag.name}</span>
            ))}
            {hiddenTags.length > 0 && (
              <span
                title={hiddenTags.map((t) => t.name).join(', ')}
                style={{ ...badgeBaseStyle, ...STATUS_BADGE_STYLE.gray, fontSize: '0.66rem', padding: '2px 7px' }}
              >
                +{hiddenTags.length}
              </span>
            )}
          </div>
        )}
      </td>

      <td style={{ ...td, fontVariantNumeric: 'tabular-nums' }}>{stats?.invoice_count ?? 0}</td>

      <td style={{ ...td, fontWeight: 700, fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>
        <span title={exactMoneyTitle(stats, 'total_invoiced')}>{formatClientMoney(stats, 'total_invoiced')}</span>
        {unconverted > 0 && (
          <span
            role="img" aria-label={unconvertedNote(unconverted)} title={unconvertedNote(unconverted)}
            style={{ display: 'inline-flex', verticalAlign: 'middle', marginLeft: 6, color: 'var(--text-tertiary)', cursor: 'help' }}
          >
            <Info size={13} />
          </span>
        )}
      </td>

      <td style={{ ...td, fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>
        {stats?.outstanding > 0
          ? <span title={exactMoneyTitle(stats, 'outstanding')} style={{ fontWeight: 600 }}>{formatClientMoney(stats, 'outstanding')}</span>
          : <span style={{ color: 'var(--text-tertiary)' }}>—</span>}
        {overdueText && (
          <div style={{ marginTop: 2, fontSize: '0.72rem', fontWeight: 600, color: 'var(--status-red-text)' }}>{overdueText}</div>
        )}
      </td>

      <td style={td}>
        <span style={{ ...badgeBaseStyle, ...STATUS_BADGE_STYLE[band.statusKey] }}>{band.label}</span>
      </td>

      <td style={{ ...td, textAlign: 'right' }} onClick={(e) => e.stopPropagation()}>
        <DropdownMenu
          trigger={<MoreVertical size={15} strokeWidth={1.7} />}
          triggerLabel={`Actions for ${client.name}`}
          bareTrigger
          triggerStyle={{ width: 28, height: 28, borderRadius: 'var(--radius-md)', color: 'var(--text-tertiary)' }}
          items={items.map((item) => ({ ...item, disabled: busy }))}
        />
      </td>
    </tr>
  )
}

// formatMoney rounds to whole units (the app-wide convention, same as
// InvoiceTable's Amount column), so the exact 2dp value rides along as a
// hover title instead of being lost.
function exactMoneyTitle(stats, field) {
  if (!stats || !stats.currency) return undefined
  return `${stats.currency} ${Number(stats[field] || 0).toLocaleString('en', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}
