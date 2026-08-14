import { describe, expect, it } from 'bun:test'
import type { Message } from '@craft-agent/core/types'
import type { Session } from '../../protocol/dto.ts'
import {
  CHAT_UI_MAX_TEXT_CHARS,
  CHAT_UI_TRUNCATION_SUFFIX,
  projectMessageForChatUi,
  projectSessionForChatUi,
} from '../chat-ui-projection.ts'

function message(overrides: Partial<Message> = {}): Message {
  return {
    id: 'msg-1',
    role: 'assistant',
    content: 'ok',
    timestamp: 1,
    ...overrides,
  }
}

function session(messages: Message[]): Session {
  return {
    id: 'session-1',
    workspaceId: 'ws',
    workspaceName: 'ws',
    lastMessageAt: 1,
    messages,
    isProcessing: false,
  }
}

describe('projectSessionForChatUi', () => {
  it('returns the same session when nothing needs truncation', () => {
    const original = session([message({ content: 'short' })])
    expect(projectSessionForChatUi(original)).toBe(original)
  })

  it('does not mutate the in-memory transcript', () => {
    const huge = 'x'.repeat(CHAT_UI_MAX_TEXT_CHARS + 50)
    const original = message({ toolResult: huge, toolName: 'Read' })
    const projected = projectMessageForChatUi(original)

    expect(original.toolResult).toBe(huge)
    expect(projected).not.toBe(original)
    expect(projected.toolResult?.endsWith(CHAT_UI_TRUNCATION_SUFFIX)).toBe(true)
    expect(projected.toolResult?.length).toBe(CHAT_UI_MAX_TEXT_CHARS + CHAT_UI_TRUNCATION_SUFFIX.length)
  })

  it('truncates Write toolInput.content but keeps the path', () => {
    const projected = projectMessageForChatUi(message({
      role: 'tool',
      toolName: 'Write',
      toolInput: {
        file_path: '/tmp/boq.md',
        content: 'y'.repeat(CHAT_UI_MAX_TEXT_CHARS + 10),
      },
    }))

    expect(projected.toolInput?.file_path).toBe('/tmp/boq.md')
    expect(String(projected.toolInput?.content).endsWith(CHAT_UI_TRUNCATION_SUFFIX)).toBe(true)
  })

  it('strips resizedBase64 so image payloads do not cross IPC', () => {
    const projected = projectMessageForChatUi(message({
      role: 'user',
      attachments: [{
        id: 'att-1',
        type: 'image',
        name: 'scan.png',
        mimeType: 'image/png',
        size: 12,
        storedPath: '/tmp/scan.png',
        thumbnailBase64: 'tiny',
        resizedBase64: 'a'.repeat(5000),
      }],
    }))

    expect(projected.attachments?.[0]?.thumbnailBase64).toBe('tiny')
    expect(projected.attachments?.[0]?.resizedBase64).toBeUndefined()
  })

  it('projects a mixed tender-sized session without dropping message count', () => {
    const messages = [
      message({ id: 'u', role: 'user', content: 'parse the tender' }),
      message({
        id: 't',
        role: 'tool',
        toolName: 'Read',
        toolResult: 'z'.repeat(CHAT_UI_MAX_TEXT_CHARS * 2),
      }),
    ]
    const projected = projectSessionForChatUi(session(messages))
    expect(projected.messages).toHaveLength(2)
    expect(projected.messages[0]).toBe(messages[0])
    expect(projected.messages[1]?.toolResult?.length).toBeLessThan(messages[1]!.toolResult!.length)
  })

  it('keeps full assistant markdown so in-chat preview blocks still parse', () => {
    const fence = [
      '```datatable',
      JSON.stringify({
        title: '按类别统计（合并后）',
        src: 'C:\\\\tender\\\\stats.json',
        rows: Array.from({ length: 200 }, (_, index) => ({ id: index, name: 'n'.repeat(80) })),
      }),
      '```',
    ].join('\n')
    const original = message({ content: fence })
    expect(fence.length).toBeGreaterThan(CHAT_UI_MAX_TEXT_CHARS)
    expect(projectMessageForChatUi(original)).toBe(original)
    expect(projectMessageForChatUi(original).content).toBe(fence)
  })
})
