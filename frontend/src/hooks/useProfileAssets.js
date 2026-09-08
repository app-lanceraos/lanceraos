// src/hooks/useProfileAssets.js
import { useEffect, useState } from 'react'
import api from '@/lib/api'

// A tiny module-level cache + in-flight de-dupe so every CanvasItem
// instance that needs the current user's real logo/signature (the
// design editor renders one ContentBody per canvas element, so a
// template with both a logo and a signatureImage element would
// otherwise fire two independent GETs, and any future consumer would
// add its own) shares exactly one real network call per page load,
// not one per mount. GET /auth/profile/ is the same endpoint
// Profile.jsx already reads logo/signature_url from — no new backend
// surface, just a second, cached consumer of it.
let cache = null
let inflight = null

function loadProfileAssets() {
  if (cache) return Promise.resolve(cache)
  if (!inflight) {
    inflight = api.get('/auth/profile/')
      .then((res) => {
        cache = {
          logo: res.data?.logo || '',
          signatureUrl: res.data?.signature_url || '',
        }
        return cache
      })
      .catch(() => {
        // A real user with no logo/signature yet is indistinguishable
        // from a failed fetch here — both correctly fall back to the
        // placeholder asset in CanvasItem, never a broken <img>.
        cache = { logo: '', signatureUrl: '' }
        return cache
      })
      .finally(() => { inflight = null })
  }
  return inflight
}

// Invalidates the cache so the next mount re-fetches — call this after
// a real signature/logo commit so a freshly-uploaded asset shows up in
// the canvas without a full page reload.
export function invalidateProfileAssetsCache() {
  cache = null
}

export default function useProfileAssets() {
  const [assets, setAssets] = useState(cache || { logo: '', signatureUrl: '' })

  useEffect(() => {
    if (cache) {
      setAssets(cache)
      return undefined
    }
    let alive = true
    loadProfileAssets().then((data) => {
      if (alive) setAssets(data)
    })
    return () => { alive = false }
  }, [])

  return assets
}
