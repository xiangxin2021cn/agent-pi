import { useState } from 'react'
import { Download } from 'lucide-react'
import type { MarkdownExportFormat } from '@craft-agent/shared/protocol'

type MarkdownDocumentExportFormat = Extract<MarkdownExportFormat, 'pdf' | 'docx'>
type BusyAction = 'md' | MarkdownDocumentExportFormat

export interface MarkdownSidecarActionsProps {
  markdownPath?: string
  readMarkdown: (path: string) => Promise<string>
  onDownload?: (markdownPath: string, content: string) => Promise<{ path: string } | null>
  onExport?: (markdownPath: string, format: MarkdownDocumentExportFormat, content: string) => Promise<{ path: string } | null>
  onStatus?: (message?: string) => void
  onError?: (message?: string) => void
}

function HeaderActionButton({
  title,
  disabled,
  onClick,
  label,
}: {
  title: string
  disabled?: boolean
  onClick: () => void
  label: string
}) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      disabled={disabled}
      onClick={onClick}
      className="inline-flex h-7 items-center justify-center gap-1 rounded-[6px] bg-background px-2 text-xs font-medium shadow-minimal opacity-75 transition-opacity hover:opacity-100 disabled:cursor-not-allowed disabled:opacity-35 focus:outline-none focus-visible:ring-1 focus-visible:ring-ring"
    >
      <Download className="h-4 w-4" />
      {label}
    </button>
  )
}

export function MarkdownSidecarActions({
  markdownPath,
  readMarkdown,
  onDownload,
  onExport,
  onStatus,
  onError,
}: MarkdownSidecarActionsProps) {
  const [busyAction, setBusyAction] = useState<BusyAction | null>(null)

  if (!markdownPath || (!onDownload && !onExport)) {
    return null
  }

  const runWithMarkdown = async (
    action: BusyAction,
    callback: (content: string) => Promise<{ path: string } | null | undefined>
  ) => {
    if (busyAction) return
    setBusyAction(action)
    onError?.(undefined)
    onStatus?.(undefined)
    try {
      const content = await readMarkdown(markdownPath)
      if (!content.trim()) {
        throw new Error('Markdown sidecar is empty')
      }
      const result = await callback(content)
      if (result?.path) {
        onStatus?.(`${action.toUpperCase()} saved: ${result.path}`)
      }
    } catch (err) {
      onError?.(err instanceof Error ? err.message : 'Markdown sidecar action failed')
    } finally {
      setBusyAction(null)
    }
  }

  return (
    <div className="flex items-center gap-1">
      {onDownload && (
        <HeaderActionButton
          title="Download Markdown sidecar"
          disabled={!!busyAction}
          onClick={() => runWithMarkdown('md', content => onDownload(markdownPath, content))}
          label="MD"
        />
      )}
      {onExport && (
        <>
          <HeaderActionButton
            title="Export Markdown sidecar to PDF"
            disabled={!!busyAction}
            onClick={() => runWithMarkdown('pdf', content => onExport(markdownPath, 'pdf', content))}
            label="PDF"
          />
          <HeaderActionButton
            title="Export Markdown sidecar to DOCX"
            disabled={!!busyAction}
            onClick={() => runWithMarkdown('docx', content => onExport(markdownPath, 'docx', content))}
            label="DOCX"
          />
        </>
      )}
    </div>
  )
}
