export function isPreviewContentPending(content: string | null | undefined): boolean {
  return content == null
}

export function hasPreviewContent(content: string | null | undefined): boolean {
  return (content ?? '').trim().length > 0
}

export function shouldShowMissingPreviewMessage(
  content: string | null | undefined,
  error?: string,
): boolean {
  return !isPreviewContentPending(content) && !hasPreviewContent(content) && !error
}
