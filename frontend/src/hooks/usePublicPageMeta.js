// src/hooks/usePublicPageMeta.js
//
// Keeps a link-only public page (the client's proposal page, /proposal/:token, and the client's contract page,
// /contract/:token) out of search engines and out of Referer headers while it is mounted: the URL's token IS the
// credential, so it must not be indexed, archived or leaked to a third party the page links to. Mirrors the response
// headers vercel.json adds for /proposal/* and /contract/* (X-Robots-Tag, Referrer-Policy) — the tags cover dev and any
// host that does not send them.
//
// Creates the tags, or updates ones that already exist, and puts the previous
// state back on unmount. Safe under StrictMode's mount → unmount → mount.
import { useEffect } from 'react'

const TAGS = [
  { name: 'robots', content: 'noindex,nofollow,noarchive' },
  { name: 'referrer', content: 'no-referrer' },
]

export default function usePublicPageMeta() {
  useEffect(() => {
    const restore = TAGS.map(({ name, content }) => {
      const existing = document.head.querySelector(`meta[name="${name}"]`)
      if (existing) {
        const previous = existing.getAttribute('content')
        existing.setAttribute('content', content)
        return () => existing.setAttribute('content', previous ?? '')
      }
      const tag = document.createElement('meta')
      tag.setAttribute('name', name)
      tag.setAttribute('content', content)
      document.head.appendChild(tag)
      return () => tag.remove()
    })
    return () => restore.forEach((fn) => fn())
  }, [])
}
