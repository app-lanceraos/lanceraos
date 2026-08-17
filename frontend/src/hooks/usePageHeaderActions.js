// src/hooks/usePageHeaderActions.js
//
// Registers a mounted page's header action buttons into AppShell's
// header (List/Table restructure pass) — desktop gets the real `desktop`
// React node rendered between the title and the bell; mobile gets the
// flat `mobileItems` list folded into AppShell's single 3-dot menu.
// Unregisters (clears back to nothing) on unmount so navigating away
// never leaves a stale page's buttons in the header.
import { useContext, useEffect } from 'react'

import { PageHeaderActionsContext } from '@/components/AppShell'

export default function usePageHeaderActions({ desktop = null, mobileItems = [] }) {
  const setPageHeaderActions = useContext(PageHeaderActionsContext)

  useEffect(() => {
    setPageHeaderActions({ desktop, mobileItems })
    return () => setPageHeaderActions({ desktop: null, mobileItems: [] })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [desktop, mobileItems, setPageHeaderActions])
}
