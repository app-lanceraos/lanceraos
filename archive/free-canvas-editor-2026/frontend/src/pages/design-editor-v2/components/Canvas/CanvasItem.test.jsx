// src/pages/design-editor-v2/components/Canvas/CanvasItem.test.jsx
//
// Confirmed real bug (see the invoice-editor signature-tool task): the
// `logo`/`signatureImage` canvas element types always rendered a hardcoded
// placeholder (/favicon.svg, /signature.png) regardless of whether the
// current user actually has a real logo/signature uploaded — only the
// separate Preview feature (which calls the real backend renderer with
// real freelancer data) ever showed real assets. Fixed via useProfileAssets
// (a cached GET /auth/profile/ consumer). This proves both branches: a
// real asset renders when the profile has one, the placeholder renders
// only when it genuinely doesn't.
import { render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import MockAdapter from 'axios-mock-adapter'

import api from '@/lib/api'
import { invalidateProfileAssetsCache } from '@/hooks/useProfileAssets'
import { EditorProvider } from '../../state/EditorContext'
import { createContentItem } from '../../data/elementCatalog'
import CanvasItem from './CanvasItem'

let mock

beforeEach(() => {
  mock = new MockAdapter(api, { delayResponse: 0 })
  invalidateProfileAssetsCache()
})

afterEach(() => {
  mock.restore()
})

function renderItem(item) {
  return render(
    <EditorProvider>
      <CanvasItem item={item} readOnly />
    </EditorProvider>,
  )
}

describe('CanvasItem — logo/signatureImage real-asset rendering', () => {
  it('renders the real logo when the profile has one set', async () => {
    mock.onGet('/auth/profile/').reply(200, { logo: 'https://cdn.example.com/logo.png', signature_url: '' })
    const item = createContentItem('logo')
    renderItem(item)
    const img = await screen.findByAltText('Logo')
    expect(img.getAttribute('src')).toBe('https://cdn.example.com/logo.png')
  })

  it('falls back to the placeholder logo when the profile has none set', async () => {
    mock.onGet('/auth/profile/').reply(200, { logo: '', signature_url: '' })
    const item = createContentItem('logo')
    renderItem(item)
    const img = await screen.findByAltText('Logo')
    expect(img.getAttribute('src')).toBe('/favicon.svg')
  })

  it('renders the real signature when the profile has one set', async () => {
    mock.onGet('/auth/profile/').reply(200, { logo: '', signature_url: 'https://cdn.example.com/sig.png' })
    const item = createContentItem('signatureImage')
    renderItem(item)
    const img = await screen.findByAltText('Signature')
    expect(img.getAttribute('src')).toBe('https://cdn.example.com/sig.png')
  })

  it('falls back to the placeholder signature when the profile has none set', async () => {
    mock.onGet('/auth/profile/').reply(200, { logo: '', signature_url: '' })
    const item = createContentItem('signatureImage')
    renderItem(item)
    const img = await screen.findByAltText('Signature')
    expect(img.getAttribute('src')).toBe('/signature.png')
  })
})
