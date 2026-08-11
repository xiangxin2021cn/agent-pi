import type { FileAttachment } from '@craft-agent/shared/protocol'

export const SESSION_ATTACHMENTS_CHANGED_EVENT = 'craft:session-attachments-changed'
export const SESSION_ATTACHMENTS_LOADING_EVENT = 'craft:session-attachments-loading'

export interface SessionAttachmentsChangedDetail {
  sessionId: string
  attachments: FileAttachment[]
}

export interface SessionAttachmentsLoadingDetail {
  sessionId: string
  /** Positive while reading starts, negative when finished. */
  delta: number
}

/** Notify the open chat composer that draft attachments changed outside FreeFormInput. */
export function dispatchSessionAttachmentsChanged(detail: SessionAttachmentsChangedDetail): void {
  window.dispatchEvent(
    new CustomEvent<SessionAttachmentsChangedDetail>(SESSION_ATTACHMENTS_CHANGED_EVENT, { detail }),
  )
}

/** Drive AttachmentPreview loading bubbles while an external attach path reads files. */
export function dispatchSessionAttachmentsLoading(detail: SessionAttachmentsLoadingDetail): void {
  if (!detail.delta) return
  window.dispatchEvent(
    new CustomEvent<SessionAttachmentsLoadingDetail>(SESSION_ATTACHMENTS_LOADING_EVENT, { detail }),
  )
}
