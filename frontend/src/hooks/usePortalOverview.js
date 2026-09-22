// src/hooks/usePortalOverview.js
//
// Reads the Client Portal shell's own Overview fetch (freelancer
// identity, balances, needs-attention, recent invoices) from
// PortalShell.jsx's PortalOverviewContext — same shape as
// usePageHeaderActions.js reading AppShell's own PageHeaderActionsContext
// (this codebase's existing context-hook convention, mirrored here
// rather than invented fresh). `reload` lets a nested page ask the shell
// to re-fetch after an action that could change the overview (e.g.
// acknowledging an invoice) without duplicating the fetch logic itself.
import { useContext } from 'react'

import { PortalOverviewContext } from '@/pages/portal/PortalShell'

export default function usePortalOverview() {
  return useContext(PortalOverviewContext)
}
