// src/components/CommentThread.test.jsx
//
// useWebSocket is mocked here (not the real WebSocket connection) — its
// own real connect/reconnect/message-dispatch behavior belongs to a
// dedicated useWebSocket test, this file is about CommentThread's own
// rendering/send/poll-fallback logic given whatever the hook reports.
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import MockAdapter from 'axios-mock-adapter'

import api from '@/lib/api'
import CommentThread from './CommentThread'

let mock
let onMessageCallback = null
let mockConnected = true

vi.mock('@/hooks/useWebSocket', () => ({
  default: (path, { onMessage } = {}) => {
    onMessageCallback = onMessage
    return { connected: mockConnected }
  },
}))

beforeEach(() => {
  mock = new MockAdapter(api)
  onMessageCallback = null
  mockConnected = true
})

afterEach(() => {
  mock.restore()
  vi.useRealTimers()
})

const SAMPLE_COMMENTS = [
  { id: 'c1', author_type: 'freelancer', author_name: 'Ali', client_email: '', source: 'app', body_text: 'Hi there', body_html: '', attachment_url: '', created_at: '2026-01-01T10:00:00Z', read_by_freelancer_at: null, read_by_client_at: null },
  { id: 'c2', author_type: 'client', author_name: 'Acme Co', client_email: 'acme@example.com', source: 'portal', body_text: 'When is this due?', body_html: '', attachment_url: '', created_at: '2026-01-01T11:00:00Z', read_by_freelancer_at: null, read_by_client_at: null },
]

describe('CommentThread — rendering', () => {
  it('loads and renders every comment', async () => {
    mock.onGet('/invoices/inv-1/comments/').reply(200, SAMPLE_COMMENTS)
    render(<CommentThread commentsUrl="/invoices/inv-1/comments/" viewToken="tok-1" viewerType="freelancer" />)

    await waitFor(() => expect(screen.getByText('Hi there')).toBeTruthy())
    expect(screen.getByText('When is this due?')).toBeTruthy()
  })

  it('shows an empty state with zero comments', async () => {
    mock.onGet('/invoices/inv-1/comments/').reply(200, [])
    render(<CommentThread commentsUrl="/invoices/inv-1/comments/" viewToken="tok-1" viewerType="freelancer" />)
    await waitFor(() => expect(screen.getByText(/no messages yet/i)).toBeTruthy())
  })
})

describe('CommentThread — sending', () => {
  it('posts a new message and appends it to the thread', async () => {
    mock.onGet('/invoices/inv-1/comments/').reply(200, [])
    mock.onPost('/invoices/inv-1/comments/').reply(201, {
      id: 'c3', author_type: 'freelancer', author_name: 'Ali', source: 'app',
      body_text: 'new message', body_html: '', attachment_url: '', created_at: '2026-01-01T12:00:00Z',
    })
    render(<CommentThread commentsUrl="/invoices/inv-1/comments/" viewToken="tok-1" viewerType="freelancer" />)
    await waitFor(() => expect(screen.getByText(/no messages yet/i)).toBeTruthy())

    fireEvent.change(screen.getByPlaceholderText(/write a message/i), { target: { value: 'new message' } })
    fireEvent.click(screen.getByRole('button', { name: /send message/i }))

    await waitFor(() => expect(screen.getByText('new message')).toBeTruthy())
    await waitFor(() => expect(mock.history.post.length).toBeGreaterThan(0))
    const sentBody = mock.history.post[mock.history.post.length - 1].data
    expect(sentBody).toBeInstanceOf(FormData)
  })

  it('shows the real backend error on a failed send', async () => {
    mock.onGet('/invoices/inv-1/comments/').reply(200, [])
    mock.onPost('/invoices/inv-1/comments/').reply(429, { error: 'Too many messages. Please try again later.' })
    render(<CommentThread commentsUrl="/invoices/inv-1/comments/" viewToken="tok-1" viewerType="freelancer" />)
    await waitFor(() => expect(screen.getByText(/no messages yet/i)).toBeTruthy())

    fireEvent.change(screen.getByPlaceholderText(/write a message/i), { target: { value: 'hi' } })
    fireEvent.click(screen.getByRole('button', { name: /send message/i }))

    await waitFor(() => expect(screen.getByText(/too many messages/i)).toBeTruthy())
  })

  it('send button is disabled with no text and no attachment', async () => {
    mock.onGet('/invoices/inv-1/comments/').reply(200, [])
    render(<CommentThread commentsUrl="/invoices/inv-1/comments/" viewToken="tok-1" viewerType="freelancer" />)
    await waitFor(() => expect(screen.getByText(/no messages yet/i)).toBeTruthy())
    expect(screen.getByRole('button', { name: /send message/i }).disabled).toBe(true)
  })
})

describe('CommentThread — live delivery via WebSocket', () => {
  it('appends an incoming WS message to the thread without a re-fetch', async () => {
    mock.onGet('/invoices/inv-1/comments/').reply(200, [])
    render(<CommentThread commentsUrl="/invoices/inv-1/comments/" viewToken="tok-1" viewerType="freelancer" />)
    await waitFor(() => expect(screen.getByText(/no messages yet/i)).toBeTruthy())

    expect(onMessageCallback).toBeTruthy()
    onMessageCallback({
      id: 'c-live', author_type: 'client', author_name: 'Acme Co', source: 'portal',
      body_text: 'live incoming message', body_html: '', attachment_url: '', created_at: '2026-01-01T13:00:00Z',
    })

    await waitFor(() => expect(screen.getByText('live incoming message')).toBeTruthy())
    expect(mock.history.get.length).toBe(1) // no extra GET triggered by the WS message
  })

  it('does not append a duplicate if the same comment id arrives twice', async () => {
    mock.onGet('/invoices/inv-1/comments/').reply(200, SAMPLE_COMMENTS)
    render(<CommentThread commentsUrl="/invoices/inv-1/comments/" viewToken="tok-1" viewerType="freelancer" />)
    await waitFor(() => expect(screen.getByText('Hi there')).toBeTruthy())

    onMessageCallback(SAMPLE_COMMENTS[0]) // the exact same id, already in the list
    await new Promise((r) => setTimeout(r, 0))
    expect(screen.getAllByText('Hi there').length).toBe(1)
  })

  it('a live read_state WS message flips the seen/sent indicator with no refetch (item 3 of the 16 August 2026 second verification pass)', async () => {
    mock.onGet('/invoices/inv-1/comments/').reply(200, [
      { id: 'c1', author_type: 'freelancer', author_name: 'Ali', source: 'app', body_text: 'Hi there', body_html: '', attachment_url: '', created_at: '2026-01-01T10:00:00Z', read_by_freelancer_at: null, read_by_client_at: null },
    ])
    render(<CommentThread commentsUrl="/invoices/inv-1/comments/" viewToken="tok-1" viewerType="freelancer" />)
    await waitFor(() => expect(screen.getByText('Sent')).toBeTruthy())

    onMessageCallback({ event: 'read_state', field: 'read_by_client_at', ids: ['c1'], at: '2026-01-01T10:05:00Z' })

    await waitFor(() => expect(screen.getByText('Seen')).toBeTruthy())
    expect(mock.history.get.length).toBe(1) // no extra GET triggered by the read_state message
  })

  it('a read_state WS message for a different comment id leaves other messages untouched', async () => {
    mock.onGet('/invoices/inv-1/comments/').reply(200, [
      { id: 'c1', author_type: 'freelancer', author_name: 'Ali', source: 'app', body_text: 'First', body_html: '', attachment_url: '', created_at: '2026-01-01T10:00:00Z', read_by_freelancer_at: null, read_by_client_at: null },
      { id: 'c2', author_type: 'freelancer', author_name: 'Ali', source: 'app', body_text: 'Second', body_html: '', attachment_url: '', created_at: '2026-01-01T10:01:00Z', read_by_freelancer_at: null, read_by_client_at: null },
    ])
    render(<CommentThread commentsUrl="/invoices/inv-1/comments/" viewToken="tok-1" viewerType="freelancer" />)
    await waitFor(() => expect(screen.getAllByText('Sent').length).toBe(2))

    onMessageCallback({ event: 'read_state', field: 'read_by_client_at', ids: ['c2'], at: '2026-01-01T10:05:00Z' })

    await waitFor(() => {
      const sentCount = screen.getAllByText('Sent').length
      const seenCount = screen.queryAllByText('Seen').length
      expect(sentCount).toBe(1)
      expect(seenCount).toBe(1)
    })
  })
})

describe('CommentThread — seen/sent indicators (item 9 of the verification pass)', () => {
  it('shows "Sent" on my own message the other side has not read yet', async () => {
    mock.onGet('/invoices/inv-1/comments/').reply(200, [
      { id: 'c1', author_type: 'freelancer', author_name: 'Ali', source: 'app', body_text: 'Hi there', body_html: '', attachment_url: '', created_at: '2026-01-01T10:00:00Z', read_by_freelancer_at: null, read_by_client_at: null },
    ])
    render(<CommentThread commentsUrl="/invoices/inv-1/comments/" viewToken="tok-1" viewerType="freelancer" />)
    await waitFor(() => expect(screen.getByText('Hi there')).toBeTruthy())
    expect(screen.getByText('Sent')).toBeTruthy()
    expect(screen.queryByText('Seen')).toBeNull()
  })

  it('shows "Seen" on my own message once the other side has read it', async () => {
    mock.onGet('/invoices/inv-1/comments/').reply(200, [
      { id: 'c1', author_type: 'freelancer', author_name: 'Ali', source: 'app', body_text: 'Hi there', body_html: '', attachment_url: '', created_at: '2026-01-01T10:00:00Z', read_by_freelancer_at: null, read_by_client_at: '2026-01-01T10:05:00Z' },
    ])
    render(<CommentThread commentsUrl="/invoices/inv-1/comments/" viewToken="tok-1" viewerType="freelancer" />)
    await waitFor(() => expect(screen.getByText('Hi there')).toBeTruthy())
    expect(screen.getByText('Seen')).toBeTruthy()
  })

  it('never shows a seen/sent indicator on the OTHER side\'s message', async () => {
    mock.onGet('/invoices/inv-1/comments/').reply(200, [
      { id: 'c2', author_type: 'client', author_name: 'Acme Co', source: 'portal', body_text: 'When is this due?', body_html: '', attachment_url: '', created_at: '2026-01-01T11:00:00Z', read_by_freelancer_at: '2026-01-01T11:05:00Z', read_by_client_at: null },
    ])
    render(<CommentThread commentsUrl="/invoices/inv-1/comments/" viewToken="tok-1" viewerType="freelancer" />)
    await waitFor(() => expect(screen.getByText('When is this due?')).toBeTruthy())
    expect(screen.queryByText('Seen')).toBeNull()
    expect(screen.queryByText('Sent')).toBeNull()
  })
})

describe('CommentThread — inline attachments (item 9 of the verification pass)', () => {
  it('renders an image attachment as a clickable thumbnail, not a raw link', async () => {
    mock.onGet('/invoices/inv-1/comments/').reply(200, [
      { id: 'c1', author_type: 'freelancer', author_name: 'Ali', source: 'app', body_text: 'see attached', body_html: '', attachment_url: 'https://res.cloudinary.com/demo/image/upload/receipt.png', created_at: '2026-01-01T10:00:00Z', read_by_freelancer_at: null, read_by_client_at: null },
    ])
    render(<CommentThread commentsUrl="/invoices/inv-1/comments/" viewToken="tok-1" viewerType="freelancer" />)
    await waitFor(() => expect(screen.getByRole('button', { name: /view image attachment/i })).toBeTruthy())
    expect(screen.queryByRole('link')).toBeNull() // no plain <a> navigating to the raw URL
  })

  it('renders a PDF attachment with a document icon and filename', async () => {
    mock.onGet('/invoices/inv-1/comments/').reply(200, [
      { id: 'c1', author_type: 'freelancer', author_name: 'Ali', source: 'app', body_text: 'see attached', body_html: '', attachment_url: 'https://res.cloudinary.com/demo/raw/upload/bank_statement.pdf', created_at: '2026-01-01T10:00:00Z', read_by_freelancer_at: null, read_by_client_at: null },
    ])
    render(<CommentThread commentsUrl="/invoices/inv-1/comments/" viewToken="tok-1" viewerType="freelancer" />)
    await waitFor(() => expect(screen.getByText('bank_statement.pdf')).toBeTruthy())
  })

  it('clicking an attachment opens the preview modal, and closing it removes the modal', async () => {
    mock.onGet('/invoices/inv-1/comments/').reply(200, [
      { id: 'c1', author_type: 'freelancer', author_name: 'Ali', source: 'app', body_text: 'see attached', body_html: '', attachment_url: 'https://res.cloudinary.com/demo/image/upload/receipt.png', created_at: '2026-01-01T10:00:00Z', read_by_freelancer_at: null, read_by_client_at: null },
    ])
    render(<CommentThread commentsUrl="/invoices/inv-1/comments/" viewToken="tok-1" viewerType="freelancer" />)
    await waitFor(() => expect(screen.getByRole('button', { name: /view image attachment/i })).toBeTruthy())

    fireEvent.click(screen.getByRole('button', { name: /view image attachment/i }))
    expect(screen.getByRole('button', { name: /^close$/i })).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: /^close$/i }))
    expect(screen.queryByRole('button', { name: /^close$/i })).toBeNull()
  })

  it('the file input accepts images and PDFs, not images only', async () => {
    mock.onGet('/invoices/inv-1/comments/').reply(200, [])
    const { container } = render(<CommentThread commentsUrl="/invoices/inv-1/comments/" viewToken="tok-1" viewerType="freelancer" />)
    await waitFor(() => expect(screen.getByText(/no messages yet/i)).toBeTruthy())
    const fileInput = container.querySelector('input[type="file"]')
    expect(fileInput.accept).toContain('application/pdf')
  })
})

describe('CommentThread — polling fallback when WS is unavailable', () => {
  it('polls the comments endpoint when the socket never connects', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    mockConnected = false
    mock.onGet('/invoices/inv-1/comments/').reply(200, [])
    render(<CommentThread commentsUrl="/invoices/inv-1/comments/" viewToken="tok-1" viewerType="freelancer" />)

    await vi.waitFor(() => expect(mock.history.get.length).toBeGreaterThanOrEqual(1))
    const initialCount = mock.history.get.length

    await vi.advanceTimersByTimeAsync(16000)
    await vi.waitFor(() => expect(mock.history.get.length).toBeGreaterThan(initialCount))
  })
})
