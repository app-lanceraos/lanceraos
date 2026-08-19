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
import { act, render, renderHook } from '@testing-library/react'
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

  it('renders cleanly under React.StrictMode via renderHook, with zero console errors (renderHook itself does NOT reproduce a real double-invoke here — see the dedicated real-double-mount test below for that)', () => {
    // CORRECTION (LANCERAOS timing/WebSocket audit, 19 August 2026):
    // this test's own docstring used to claim "this test env does not
    // actually double-invoke effects under StrictMode, unlike a real
    // browser dev build" — that was WRONG, and gave false confidence
    // this hook's real double-mount behavior was covered when it
    // silently wasn't. Confirmed directly (a throwaway probe test): a
    // real component rendered via @testing-library/react's `render()`
    // under React.StrictMode DOES double-invoke effects in this exact
    // Vitest/jsdom environment (2 calls, not 1) — it's specifically
    // `renderHook`'s own wrapper mechanism that does NOT reproduce it
    // (1 call). This test still has real value as a basic sanity check
    // of the hook via renderHook, just not as StrictMode coverage —
    // renamed and re-scoped honestly rather than deleted, since a
    // passing hook-level smoke test is still worth keeping.
    const { result } = renderHook(() => useWebSocket('/ws/notifications/'), {
      wrapper: ({ children }) => <React.StrictMode>{children}</React.StrictMode>,
    })

    act(() => MockWebSocket.instances[MockWebSocket.instances.length - 1].triggerOpen())
    expect(result.current.connected).toBe(true)
    expect(errorSpy).not.toHaveBeenCalled()
  })

  it('a REAL React.StrictMode double-invoke (render(), not renderHook) produces exactly one doomed connect-then-immediate-close, then one real connection that stays open — the exact "CONNECT ... DISCONNECT within 4ms" server-log pattern this round investigated, reproduced deterministically and proven benign', () => {
    // Real production evidence: apps/invoices/consumers.py's
    // ClientThreadConsumer logged CONNECT then DISCONNECT within 4ms on
    // the comment-thread socket specifically. Root-caused here as the
    // SAME cause the original fix already targeted — React StrictMode's
    // dev-only double-invoke of mount effects — not a new, distinct bug:
    // StrictMode mounts, tears down, and re-mounts synchronously. The
    // first effect run's socket keeps CONNECTING in the background after
    // its own (deferred, per this hook's existing fix) cleanup runs; by
    // the time its handshake actually completes, `stopped` is already
    // true for that closure, so onopen closes it immediately — a real
    // connect that the SERVER sees (Channels logs CONNECT), followed
    // within milliseconds by a real close (DISCONNECT). The second
    // effect run's socket is the one that actually serves the component.
    // This is why it shows up "on the comment-thread socket
    // specifically" in practice — CommentThread mounts on every Messages-
    // modal open (a frequent, user-driven remount), while the
    // notification socket mounts once per full page load (AppShell) —
    // same underlying cause, just far more visible on the more-often-
    // mounted consumer. This entire pattern is DEV-ONLY: StrictMode's
    // double-invoke never happens in a production `vite build`, so real
    // users never see it.
    function Thing() {
      useWebSocket('/ws/invoices/thread/tok-strictmode-probe/')
      return null
    }

    render(<React.StrictMode><Thing /></React.StrictMode>)

    // A real double-invoke: StrictMode's synchronous mount->cleanup->
    // remount means TWO sockets exist immediately, not one.
    expect(MockWebSocket.instances).toHaveLength(2)
    const [doomed, real] = MockWebSocket.instances
    expect(doomed.readyState).toBe(MockWebSocket.CONNECTING)
    expect(real.readyState).toBe(MockWebSocket.CONNECTING)

    // The doomed socket's handshake completes on the server (a real
    // CONNECT) — simulated here via triggerOpen() — and is immediately
    // closed by the deferred-teardown guard, never a raw ws.close()
    // while still CONNECTING (which is what produces the console error
    // this hook's original fix exists to prevent).
    act(() => doomed.triggerOpen())
    expect(doomed.readyState).toBe(MockWebSocket.CLOSED)
    expect(errorSpy).not.toHaveBeenCalled()
    // No THIRD socket spawned — the deferred close is a clean teardown,
    // not treated as a drop needing the reconnect-with-backoff path.
    expect(MockWebSocket.instances).toHaveLength(2)

    // The real, final socket connects normally and is what the
    // component actually ends up using.
    act(() => real.triggerOpen())
    expect(real.readyState).toBe(MockWebSocket.OPEN)
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
