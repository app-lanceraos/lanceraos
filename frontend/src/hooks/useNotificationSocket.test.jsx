// src/hooks/useNotificationSocket.test.jsx
//
// useWebSocket is mocked here (not the real WebSocket connection) —
// same convention as CommentThread.test.jsx's own "live delivery via
// WebSocket" describe block: this file is about useNotificationSocket's
// own message-routing/poll-fallback logic given whatever the underlying
// hook reports, not useWebSocket's own connect/reconnect behavior.
import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import useNotificationSocket from './useNotificationSocket'

let onMessageCallback = null
let mockConnected = true

vi.mock('./useWebSocket', () => ({
  default: (path, { onMessage } = {}) => {
    onMessageCallback = path ? onMessage : null
    return { connected: mockConnected }
  },
}))

beforeEach(() => {
  onMessageCallback = null
  mockConnected = true
})

afterEach(() => {
  vi.useRealTimers()
})

describe('useNotificationSocket — message routing', () => {
  it('routes a "notification" frame to onNotification with the new item and unread_count', () => {
    const onNotification = vi.fn()
    renderHook(() => useNotificationSocket({ enabled: true, onNotification, onRefresh: vi.fn(), onPoll: vi.fn() }))

    expect(onMessageCallback).toBeTruthy()
    act(() => {
      onMessageCallback({
        kind: 'notification',
        notification: { id: 'n1', type: 'comment_posted', title: 'New message', message: 'Acme Co sent a new message.' },
        unread_count: 3,
      })
    })

    expect(onNotification).toHaveBeenCalledWith(
      { id: 'n1', type: 'comment_posted', title: 'New message', message: 'Acme Co sent a new message.' },
      3,
    )
  })

  it('routes a "refresh" frame to onRefresh with just the unread_count', () => {
    const onRefresh = vi.fn()
    renderHook(() => useNotificationSocket({ enabled: true, onNotification: vi.fn(), onRefresh, onPoll: vi.fn() }))

    act(() => { onMessageCallback({ kind: 'refresh', unread_count: 0 }) })

    expect(onRefresh).toHaveBeenCalledWith(0)
  })

  it('does not connect at all when disabled', () => {
    renderHook(() => useNotificationSocket({ enabled: false, onNotification: vi.fn(), onRefresh: vi.fn(), onPoll: vi.fn() }))
    expect(onMessageCallback).toBeNull()
  })
})

describe('useNotificationSocket — polling fallback when the socket is unavailable', () => {
  it('polls on an interval while disconnected, and stops once connected', () => {
    vi.useFakeTimers()
    mockConnected = false
    const onPoll = vi.fn()

    const { rerender } = renderHook(
      ({ connected }) => {
        mockConnected = connected
        return useNotificationSocket({ enabled: true, onNotification: vi.fn(), onRefresh: vi.fn(), onPoll })
      },
      { initialProps: { connected: false } },
    )

    act(() => { vi.advanceTimersByTime(20000) })
    expect(onPoll).toHaveBeenCalledTimes(1)

    act(() => { vi.advanceTimersByTime(20000) })
    expect(onPoll).toHaveBeenCalledTimes(2)

    // Recovers — the underlying socket reports connected now (useWebSocket's
    // own exponential-backoff reconnect having succeeded in real usage).
    rerender({ connected: true })
    const countAtRecovery = onPoll.mock.calls.length
    act(() => { vi.advanceTimersByTime(60000) })
    expect(onPoll).toHaveBeenCalledTimes(countAtRecovery) // no further polls once connected
  })

  it('never polls while connected from the start', () => {
    vi.useFakeTimers()
    mockConnected = true
    const onPoll = vi.fn()
    renderHook(() => useNotificationSocket({ enabled: true, onNotification: vi.fn(), onRefresh: vi.fn(), onPoll }))

    act(() => { vi.advanceTimersByTime(60000) })
    expect(onPoll).not.toHaveBeenCalled()
  })
})
