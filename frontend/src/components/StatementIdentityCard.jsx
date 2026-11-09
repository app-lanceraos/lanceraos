// src/components/StatementIdentityCard.jsx
//
// "Details printed on the statement": the name, business, address, email and phone the PDF will carry, so the person sees
// what goes on a paper that is handed to a bank. The list mirrors the server's allowlist (statementIdentity); the CNIC and
// NTN rows say "Printed from your saved details" and never show the digits. Everything is plain text (a hostile business
// name is shown as text), and long values wrap.
import { AlertCircle, RefreshCw } from 'lucide-react'
import { Link } from 'react-router-dom'

import { statementIdentity } from '@/pages/reportsHelpers'
import DashboardCard from './DashboardCard'

export default function StatementIdentityCard({ profile, loading, failed, onReload, includeCnic, includeNtn }) {
  const rows = profile ? statementIdentity(profile, { includeCnic, includeNtn }) : []
  return (
    <DashboardCard id="stm-identity" title="Details printed on the statement" className="stm-identity">
      {failed ? (
        <p role="status" style={{ margin: 0, fontSize: '0.84rem', color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <AlertCircle size={15} aria-hidden="true" style={{ color: 'var(--status-amber-text)' }} />
          Couldn&apos;t load your details.
          <button type="button" className="fos-btn fos-btn-ghost" style={{ fontSize: '0.78rem', padding: '5px 10px' }} onClick={onReload}>
            <RefreshCw size={13} aria-hidden="true" /> Reload
          </button>
        </p>
      ) : loading || !profile ? (
        <div aria-busy="true" style={{ height: 120, background: 'var(--bg-surface-3)', borderRadius: 'var(--radius-md)', animation: 'skeleton-pulse 1.4s ease-in-out infinite' }} />
      ) : (
        <>
          <dl style={{ margin: 0, display: 'grid', gridTemplateColumns: 'minmax(90px, max-content) minmax(0, 1fr)', gap: '8px 16px' }}>
            {rows.map((row) => (
              <div key={row.label} style={{ display: 'contents' }}>
                <dt style={{ fontSize: '0.78rem', color: 'var(--text-tertiary)' }}>{row.label}</dt>
                <dd style={{ margin: 0, fontSize: '0.86rem', color: 'var(--text-primary)', overflowWrap: 'anywhere' }}>
                  {row.lines.map((line) => <span key={line} style={{ display: 'block' }}>{line}</span>)}
                </dd>
              </div>
            ))}
          </dl>
          <p style={{ margin: '14px 0 0', fontSize: '0.78rem', color: 'var(--text-tertiary)' }}>
            To change these, update your <Link to="/profile" style={{ color: 'var(--accent)', fontWeight: 600 }}>Profile</Link> and
            your <Link to="/settings" style={{ color: 'var(--accent)', fontWeight: 600 }}>Settings</Link> (Account and Business). Your logo is added if you uploaded one.
          </p>
        </>
      )}
    </DashboardCard>
  )
}
