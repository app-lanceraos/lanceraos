// src/hooks/useWebSocket.test.jsx
//
// Dedicated test for useWebSocket's own connect/reconnect/teardown
// behavior — CommentThread.test.jsx and useNotificationSocket.test.jsx
// both mock this hook away entirely (their own header comments say so),
// so this file is the first real coverage of useWebSocket itself.
//
// Covers a real, reported bug: "WebSocket connection ... failed:
// WebSocket is closed before the connection is established" showing up
// in the browser console on every fast mount/unmount (a panel opening/
// closing before the handshake completes, or React StrictMode's dev-only
// double-invoke of effects). Root cause was cleanup calling ws.close()
// on a socket still in CONNECTING state. jsdom has no real WebSocket, so
// this file installs a local mock (not global test-setup.js
// infrastructure — this is specific to this one hook, matching how
// useFilterOverflow.test.js mocks offsetWidth/clientWidth directly
// rather than adding them there) that reproduces the exact same
// observable symptom real browsers produce — a console.error fired at
// the moment .close() is called on a CONNECTING socket — so the fix can
// be verified against that directly instead of guessing at internals.
import React from 'react'
import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import useWebSocket from './useWebSocket'

class MockWebSocket {
  static instances = []
  static CONNECTING = 0
  static OPEN = 1
  static CLOSING = 2
  static CLOSED = 3

  constructor(url) {
    this.url = url
    this.readyState = MockWebSocket.CONNECTING
    this.onopen = null
    this.onclose = null
    this.onerror = null
    this.onmessage = null
    MockWebSocket.instances.push(this)
  }

  // Test helper — simulates the server actually completing the handshake.
  triggerOpen() {
    if (this.readyState !== MockWebSocket.CONNECTING) return
    this.readyState = MockWebSocket.OPEN
    this.onopen?.()
  }

  // Test helper — simulates the server dropping an already-open connection.
  triggerServerClose() {
    this.readyState = MockWebSocket.CLOSED
    this.onclose?.({ wasClean: false })
  }

  close() {
    if (this.readyState === MockWebSocket.CLOSED) return
    const wasConnecting = this.readyState === MockWebSocket.CONNECTING
    if (wasConnecting) {
      // The exact real-browser symptom this file exists to catch a
      // regression of — this mock reproduces it faithfully so tests can
      // assert on it directly rather than inspecting private state.
      console.error(`WebSocket connection to '${this.url}' failed: WebSocket is closed before the connection is established.`)
    }
    this.readyState = MockWebSocket.CLOSED
    this.onclose?.({ wasClean: !wasConnecting })
  }
}

let errorSpy

beforeEach(() => {
  MockWebSocket.instances = []
  global.WebSocket = MockWebSocket
  errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
  vi.useRealTimers()
  errorSpy.mockRestore()
})

describe('useWebSocket — teardown while still connecting', () => {
  it('does not close a still-CONNECTING socket on fast unmount (a panel closing before the handshake completes)', () => {
    const { unmount } = renderHook(() => useWebSocket('/ws/invoices/thread/tok/'))
    expect(MockWebSocket.instances).toHaveLength(1)
    const socket = MockWebSocket.instances[0]

    unmount()

    // The real bug: cleanup used to call ws.close() immediately here,
    // while the socket was still CONNECTING — that's what produced the
    // console error. Fixed cleanup defers instead.
    expect(socket.readyState).toBe(MockWebSocket.CONNECTING)
    expect(errorSpy).not.toHaveBeenCalled()

    // Once the handshake actually finishes, the deferred teardown (the
    // onopen guard) closes it cleanly — no console error, no reconnect
    // (no second instance spawned for an already-stopped connection).
    act(() => socket.triggerOpen())
    expect(socket.readyState).toBe(MockWebSocket.CLOSED)
    expect(errorSpy).not.toHaveBeenCalled()
    expect(MockWebSocket.instances).toHaveLength(1)
  })

  it('renders cleanly under React.StrictMode with zero console errors and still reaches connected (this test env does not actually double-invoke effects under StrictMode, unlike a real browser dev build — kept anyway as a direct regression guard on the wrapper itself)', () => {
    const { result } = renderHook(() => useWebSocket('/ws/notifications/'), {
      wrapper: ({ children }) => <React.StrictMode>{children}</React.StrictMode>,
    })

    act(() => MockWebSocket.instances[MockWebSocket.instances.length - 1].triggerOpen())
    expect(result.current.connected).toBe(true)
    expect(errorSpy).not.toHaveBeenCalled()
  })

  it('a fresh mount after a fast unmount still connects normally (panel closed then reopened)', () => {
    const first = renderHook(() => useWebSocket('/ws/invoices/thread/tok/'))
    first.unmount()
    act(() => MockWebSocket.instances[0].triggerOpen()) // deferred teardown settles

    const second = renderHook(() => useWebSocket('/ws/invoices/thread/tok/'))
    expect(MockWebSocket.instances).toHaveLength(2)
    act(() => MockWebSocket.instances[1].triggerOpen())

    expect(second.result.current.connected).toBe(true)
    expect(errorSpy).not.toHaveBeenCalled()
  })
})

describe('useWebSocket — reconnect after a real drop', () => {
  it('reconnects with backoff after the server closes an already-open connection, and reaches connected again', () => {
    vi.useFakeTimers()
    const { result } = renderHook(() => useWebSocket('/ws/notifications/'))
    act(() => MockWebSocket.instances[0].triggerOpen())
    expect(result.current.connected).toBe(true)

    act(() => MockWebSocket.instances[0].triggerServerClose())
    expect(result.current.connected).toBe(false)

    act(() => { vi.advanceTimersByTime(1000) }) // first backoff delay
    expect(MockWebSocket.instances).toHaveLength(2)

    act(() => MockWebSocket.instances[1].triggerOpen())
    expect(result.current.connected).toBe(true)
    expect(errorSpy).not.toHaveBeenCalled()
  })
})
