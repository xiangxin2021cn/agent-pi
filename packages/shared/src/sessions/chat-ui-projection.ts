/**
 * Project a session for the chat renderer.
 *
 * SessionManager keeps the full transcript in memory for the agent. GET_MESSAGES
 * must not ship that payload over IPC: tender parent sessions routinely store
 * multi-megabyte Read/Write/Bash tool results (capped at 4 MiB each). Serializing
 * those into the renderer blocks the UI on session switch — the spinner looks dead.
 *
 * This projection is display-only. It must never be written back to JSONL.
 */

import type { Message, StoredAttachment } from '@craft-agent/core/types'
import type { Session } from '../protocol/dto.ts'

export const CHAT_UI_MAX_TEXT_CHARS = 16_384
export const CHAT_UI_TRUNCATION_SUFFIX = '\n\n[truncated for display]'

export function projectSessionForChatUi(session: Session): Session {
  if (!session.messages?.length) return session
  let changed = false
  const messages = session.messages.map((message) => {
    const projected = projectMessageForChatUi(message)
    if (projected !== message) changed = true
    return projected
  })
  return changed ? { ...session, messages } : session
}

export function projectMessageForChatUi(message: Message): Message {
  let next: Message | undefined

  const content = truncateText(message.content)
  if (content !== message.content) {
    next = { ...message, content }
  }

  if (message.toolResult !== undefined) {
    const toolResult = truncateText(message.toolResult)
    if (toolResult !== message.toolResult) {
      next = { ...(next ?? message), toolResult }
    }
  }

  if (message.toolInput) {
    const toolInput = truncateUnknown(message.toolInput) as Record<string, unknown>
    if (toolInput !== message.toolInput) {
      next = { ...(next ?? message), toolInput }
    }
  }

  if (message.errorOriginal) {
    const errorOriginal = truncateText(message.errorOriginal)
    if (errorOriginal !== message.errorOriginal) {
      next = { ...(next ?? message), errorOriginal }
    }
  }

  if (message.errorDetails?.length) {
    let detailsChanged = false
    const errorDetails = message.errorDetails.map((detail) => {
      const truncated = truncateText(detail)
      if (truncated !== detail) detailsChanged = true
      return truncated
    })
    if (detailsChanged) {
      next = { ...(next ?? message), errorDetails }
    }
  }

  if (message.attachments?.length) {
    let attachmentsChanged = false
    const attachments = message.attachments.map((attachment) => {
      const projected = projectAttachmentForChatUi(attachment)
      if (projected !== attachment) attachmentsChanged = true
      return projected
    })
    if (attachmentsChanged) {
      next = { ...(next ?? message), attachments }
    }
  }

  return next ?? message
}

function projectAttachmentForChatUi(attachment: StoredAttachment): StoredAttachment {
  if (!attachment.resizedBase64 && !isOversizedThumbnail(attachment.thumbnailBase64)) {
    return attachment
  }
  const rest = { ...attachment }
  delete rest.resizedBase64
  if (isOversizedThumbnail(rest.thumbnailBase64)) {
    delete rest.thumbnailBase64
  }
  return rest
}

function isOversizedThumbnail(value: string | undefined): boolean {
  return typeof value === 'string' && value.length > 200_000
}

export function truncateText(value: string): string {
  if (value.length <= CHAT_UI_MAX_TEXT_CHARS) return value
  return value.slice(0, CHAT_UI_MAX_TEXT_CHARS) + CHAT_UI_TRUNCATION_SUFFIX
}

function truncateUnknown(value: unknown, depth = 0): unknown {
  if (depth > 8) return value
  if (typeof value === 'string') return truncateText(value)
  if (Array.isArray(value)) {
    let changed = false
    const next = value.map((item) => {
      const projected = truncateUnknown(item, depth + 1)
      if (projected !== item) changed = true
      return projected
    })
    return changed ? next : value
  }
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>
    let changed = false
    const next: Record<string, unknown> = {}
    for (const [key, item] of Object.entries(record)) {
      const projected = truncateUnknown(item, depth + 1)
      if (projected !== item) changed = true
      next[key] = projected
    }
    return changed ? next : value
  }
  return value
}
