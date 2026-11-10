// src/components/TaxViewNav.jsx
//
// The three views of the Tax page as a row of real links (Estimate / Calculator / How this works). It is links, not an ARIA tab
// widget: a link row needs no custom keyboard handling, the Back button works and a view can be linked to. The active one
// carries aria-current="page" and the underline of the Settings tab row. The row scrolls sideways inside itself on a phone.
import { BookOpen, Calculator, Receipt } from 'lucide-react'
import { Link } from 'react-router-dom'

import { VIEWS, VIEW_NAV_LABEL } from '@/pages/taxHelpers'

const ICONS = { estimate: Receipt, calculator: Calculator, sources: BookOpen }

export default function TaxViewNav({ active }) {
  return (
    <nav
      aria-label={VIEW_NAV_LABEL}
      style={{ display: 'flex', gap: 4, borderBottom: '1px solid var(--border-subtle)', marginBottom: 16, overflowX: 'auto', maxWidth: '100%' }}
    >
      {VIEWS.map((view) => {
        const isActive = active === view.key
        const Icon = ICONS[view.key]
        return (
          <Link
            key={view.key} to={view.to} aria-current={isActive ? 'page' : undefined}
            style={{
              display: 'flex', alignItems: 'center', gap: 6, padding: '10px 16px', textDecoration: 'none',
              borderBottom: isActive ? '2px solid var(--accent)' : '2px solid transparent',
              color: isActive ? 'var(--text-primary)' : 'var(--text-tertiary)',
              fontWeight: isActive ? 600 : 500, fontSize: '0.875rem', whiteSpace: 'nowrap', fontFamily: "'DM Sans', sans-serif",
              transition: 'color 0.15s ease, border-color 0.15s ease',
            }}
          >
            <Icon size={15} aria-hidden="true" />
            {view.label}
          </Link>
        )
      })}
    </nav>
  )
}
