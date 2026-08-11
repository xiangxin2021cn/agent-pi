import { beforeEach, describe, expect, it } from 'bun:test'
import {
  SESSION_ATTACHMENTS_CHANGED_EVENT,
  SESSION_ATTACHMENTS_LOADING_EVENT,
  dispatchSessionAttachmentsChanged,
  dispatchSessionAttachmentsLoading,
} from '../attachment-events'

class FakeWindow extends EventTarget {
  dispatchEvent(event: Event): boolean {
    return super.dispatchEvent(event)
  }
}

describe('attachment-events', () => {
  beforeEach(() => {
    ;(globalThis as { window: EventTarget }).window = new FakeWindow()
  })

  it('dispatches attachments-changed with session scope', () => {
    let seen: unknown
    const handler = (event: Event) => {
      seen = (event as CustomEvent).detail
    }
    window.addEventListener(SESSION_ATTACHMENTS_CHANGED_EVENT, handler)
    dispatchSessionAttachmentsChanged({
      sessionId: 's1',
      attachments: [{
        type: 'text',
        path: 'C:/tmp/a.md',
        name: 'a.md',
        mimeType: 'text/markdown',
        size: 12,
      }],
    })
    window.removeEventListener(SESSION_ATTACHMENTS_CHANGED_EVENT, handler)
    expect(seen).toMatchObject({ sessionId: 's1' })
    expect((seen as { attachments: unknown[] }).attachments).toHaveLength(1)
  })

  it('dispatches loading deltas and ignores zero', () => {
    const deltas: number[] = []
    const handler = (event: Event) => {
      deltas.push((event as CustomEvent).detail.delta)
    }
    window.addEventListener(SESSION_ATTACHMENTS_LOADING_EVENT, handler)
    dispatchSessionAttachmentsLoading({ sessionId: 's1', delta: 1 })
    dispatchSessionAttachmentsLoading({ sessionId: 's1', delta: 0 })
    dispatchSessionAttachmentsLoading({ sessionId: 's1', delta: -1 })
    window.removeEventListener(SESSION_ATTACHMENTS_LOADING_EVENT, handler)
    expect(deltas).toEqual([1, -1])
  })
})
