/**
 * DocumentFormattedMarkdownOverlay - Fullscreen view for reading AI responses and plans
 *
 * Renders markdown content in a document-like format with:
 * - Centered content card with max-width
 * - Copy button via FullscreenOverlayBase's built-in copyContent prop
 * - Optional "Plan" header variant
 * - Optional filePath badge with dual-trigger menu (Open / Reveal in {file manager})
 *
 * Background and scenic blur are provided by FullscreenOverlayBase.
 * Uses FullscreenOverlayBase for portal, traffic lights, ESC handling, and header.
 */

import { useEffect, useState, type ReactNode } from 'react'
import { Download, Eye, Pencil, Save, ListTodo } from 'lucide-react'
import type { MarkdownExportFormat } from '@craft-agent/shared/protocol'
import { Markdown, TiptapMarkdownEditor } from '../markdown'
import type { AnnotationV1 } from '@craft-agent/core'
import type { ExternalOpenAnnotationRequest } from '../annotations/use-annotation-interaction-controller'
import { FullscreenOverlayBase } from './FullscreenOverlayBase'
import type { OverlayTypeBadge } from './FullscreenOverlayBaseHeader'
import { AnnotatableMarkdownDocument } from './AnnotatableMarkdownDocument'

export interface DocumentFormattedMarkdownOverlayProps {
  /** The content to display (markdown) */
  content: string
  /** Whether the overlay is open */
  isOpen: boolean
  /** Called when overlay should close */
  onClose: () => void
  /** Variant: 'response' (default) or 'plan' (shows header) */
  variant?: 'response' | 'plan'
  /** Callback for URL clicks */
  onOpenUrl?: (url: string) => void
  /** Callback for file path clicks */
  onOpenFile?: (path: string) => void
  /** Optional file path — shows badge with "Open" / "Reveal in {file manager}" menu */
  filePath?: string
  /** Optional type badge — tool/format indicator (e.g. "Write") shown in header */
  typeBadge?: OverlayTypeBadge
  /** Optional error message — renders a tinted error banner above the content card */
  error?: string
  /** Optional session id used for annotation payload source metadata */
  sessionId?: string
  /** Optional message id; when present with callbacks, overlay becomes annotatable */
  messageId?: string
  /** Persisted annotations for the message */
  annotations?: AnnotationV1[]
  /** Callback to add annotation */
  onAddAnnotation?: (messageId: string, annotation: AnnotationV1) => void
  /** Callback to remove annotation */
  onRemoveAnnotation?: (messageId: string, annotationId: string) => void
  /** Callback to update annotation */
  onUpdateAnnotation?: (messageId: string, annotationId: string, patch: Partial<AnnotationV1>) => void
  /** Input send key behavior used by follow-up editor */
  sendMessageKey?: 'enter' | 'cmd-enter'
  /** Whether source content is currently streaming (affects annotation eligibility parity) */
  isStreaming?: boolean
  /** Optional external request to open a specific annotation */
  openAnnotationRequest?: ExternalOpenAnnotationRequest | null
  /** Enable file-backed Markdown editing. Only used for real .md/.markdown files. */
  editable?: boolean
  /** Source file mtime captured when preview was opened. */
  sourceMtimeMs?: number
  /** Save edited Markdown content back to the source file. */
  onSave?: (content: string, expectedMtimeMs?: number) => Promise<{ mtimeMs?: number }>
  /** Download the current Markdown content to a user-selected local path. */
  onDownload?: (content: string) => Promise<{ path: string } | null>
  /** Export Markdown content to a document format. */
  onExport?: (format: Extract<MarkdownExportFormat, 'pdf' | 'docx'>, content: string) => Promise<{ path: string } | null>
}

function isEditableMarkdownPath(filePath?: string): boolean {
  return !!filePath && /\.(md|markdown)$/i.test(filePath)
}

function HeaderIconButton({
  title,
  disabled,
  onClick,
  children,
}: {
  title: string
  disabled?: boolean
  onClick: () => void
  children: ReactNode
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
      {children}
    </button>
  )
}

export function DocumentFormattedMarkdownOverlay({
  content,
  isOpen,
  onClose,
  variant = 'response',
  onOpenUrl,
  onOpenFile,
  filePath,
  typeBadge,
  error,
  sessionId,
  messageId,
  annotations,
  onAddAnnotation,
  onRemoveAnnotation,
  onUpdateAnnotation,
  sendMessageKey = 'enter',
  isStreaming = false,
  openAnnotationRequest,
  editable = false,
  sourceMtimeMs,
  onSave,
  onDownload,
  onExport,
}: DocumentFormattedMarkdownOverlayProps) {
  const canEdit = editable && isEditableMarkdownPath(filePath) && !!onSave
  const [mode, setMode] = useState<'preview' | 'edit'>('preview')
  const [draftContent, setDraftContent] = useState(content)
  const [savedContent, setSavedContent] = useState(content)
  const [lastMtimeMs, setLastMtimeMs] = useState(sourceMtimeMs)
  const [isSaving, setIsSaving] = useState(false)
  const [isDownloading, setIsDownloading] = useState(false)
  const [exportingFormat, setExportingFormat] = useState<MarkdownExportFormat | null>(null)
  const [localError, setLocalError] = useState<string | undefined>()
  const [statusMessage, setStatusMessage] = useState<string | undefined>()
  const visibleContent = canEdit ? draftContent : content
  const hasContent = visibleContent.trim().length > 0
  const isDirty = canEdit && draftContent !== savedContent

  useEffect(() => {
    setDraftContent(content)
    setSavedContent(content)
    setLastMtimeMs(sourceMtimeMs)
    setMode('preview')
    setLocalError(undefined)
    setStatusMessage(undefined)
  }, [content, filePath, sourceMtimeMs])

  const handleSave = async () => {
    if (!canEdit || !onSave || isSaving || !isDirty) return
    setIsSaving(true)
    setLocalError(undefined)
    setStatusMessage(undefined)
    try {
      const result = await onSave(draftContent, lastMtimeMs)
      setSavedContent(draftContent)
      if (typeof result.mtimeMs === 'number') {
        setLastMtimeMs(result.mtimeMs)
      }
      setStatusMessage('Saved')
    } catch (err) {
      setLocalError(err instanceof Error ? err.message : 'Failed to save Markdown file')
    } finally {
      setIsSaving(false)
    }
  }

  const handleExport = async (format: Extract<MarkdownExportFormat, 'pdf' | 'docx'>) => {
    if (!onExport || exportingFormat) return
    setExportingFormat(format)
    setLocalError(undefined)
    setStatusMessage(undefined)
    try {
      const result = await onExport(format, draftContent)
      if (result?.path) {
        setStatusMessage(`Exported: ${result.path}`)
      }
    } catch (err) {
      setLocalError(err instanceof Error ? err.message : `Failed to export ${format.toUpperCase()}`)
    } finally {
      setExportingFormat(null)
    }
  }

  const handleDownload = async () => {
    if (!onDownload || isDownloading) return
    setIsDownloading(true)
    setLocalError(undefined)
    setStatusMessage(undefined)
    try {
      const result = await onDownload(draftContent)
      if (result?.path) {
        setStatusMessage(`Saved: ${result.path}`)
      }
    } catch (err) {
      setLocalError(err instanceof Error ? err.message : 'Failed to download Markdown file')
    } finally {
      setIsDownloading(false)
    }
  }

  const headerActions = canEdit ? (
    <div className="flex items-center gap-1">
      <HeaderIconButton
        title={mode === 'edit' ? 'Preview Markdown' : 'Edit Markdown'}
        onClick={() => setMode(mode === 'edit' ? 'preview' : 'edit')}
      >
        {mode === 'edit' ? <Eye className="h-4 w-4" /> : <Pencil className="h-4 w-4" />}
      </HeaderIconButton>
      <HeaderIconButton title="Save Markdown" disabled={!isDirty || isSaving} onClick={handleSave}>
        <Save className="h-4 w-4" />
      </HeaderIconButton>
      {onDownload && (
        <HeaderIconButton title="Download Markdown" disabled={isDownloading} onClick={handleDownload}>
          <Download className="h-4 w-4" />
          MD
        </HeaderIconButton>
      )}
      {onExport && (
        <>
          <HeaderIconButton title="Export PDF" disabled={!!exportingFormat} onClick={() => handleExport('pdf')}>
            <Download className="h-4 w-4" />
            PDF
          </HeaderIconButton>
          <HeaderIconButton title="Export DOCX" disabled={!!exportingFormat} onClick={() => handleExport('docx')}>
            <Download className="h-4 w-4" />
            DOCX
          </HeaderIconButton>
        </>
      )}
    </div>
  ) : undefined

  return (
    <FullscreenOverlayBase
      isOpen={isOpen}
      onClose={onClose}
      filePath={filePath}
      typeBadge={typeBadge}
      headerActions={headerActions}
      copyContent={visibleContent}
      error={(error || localError) ? { label: localError ? 'File Action Failed' : 'Preview Issue', message: localError ?? error! } : undefined}
    >
      {/* Content wrapper — min-h-full for vertical centering within FullscreenOverlayBase's scroll container.
          Scrolling and gradient fade mask are handled by FullscreenOverlayBase. */}
      <div className="min-h-full flex flex-col justify-center px-6 py-16">
        {/* Content card - my-auto centers vertically when content is small, flows naturally when large */}
        <div className="bg-background rounded-[16px] shadow-strong w-full max-w-[960px] h-fit mx-auto my-auto">
          {/* Plan header (variant="plan" only) */}
          {variant === 'plan' && (
            <div className="px-4 py-2 border-b border-border/30 flex items-center gap-2 bg-success/5 rounded-t-[16px]">
              <ListTodo className="w-3 h-3 text-success" />
              <span className="text-[13px] font-medium text-success">Plan</span>
            </div>
          )}

          {/* Content area */}
          <div className="px-10 pt-8 pb-8">
            {statusMessage && (
              <div className="mb-4 rounded-[8px] border border-border/60 bg-muted/25 px-3 py-2 text-xs text-muted-foreground">
                {statusMessage}
              </div>
            )}
            <div className="text-sm">
              {!hasContent ? (
                <div className="rounded-[8px] border border-border/60 bg-muted/35 px-4 py-3 text-sm text-muted-foreground">
                  No preview content was returned for this file.
                </div>
              ) : canEdit && mode === 'edit' ? (
                <TiptapMarkdownEditor
                  content={draftContent}
                  onUpdate={setDraftContent}
                  editable
                  markdownEngine="official"
                  className="min-h-[56vh] rounded-[8px] border border-border/50 bg-background px-4 py-3 text-foreground focus-within:border-ring focus-within:ring-1 focus-within:ring-ring"
                />
              ) : messageId && onAddAnnotation ? (
                <AnnotatableMarkdownDocument
                  content={visibleContent}
                  sessionId={sessionId}
                  messageId={messageId}
                  annotations={annotations}
                  onAddAnnotation={onAddAnnotation}
                  onRemoveAnnotation={onRemoveAnnotation}
                  onUpdateAnnotation={onUpdateAnnotation}
                  onOpenUrl={onOpenUrl}
                  onOpenFile={onOpenFile}
                  sendMessageKey={sendMessageKey}
                  islandZIndex={420}
                  openAnnotationRequest={openAnnotationRequest}
                  isStreaming={isStreaming}
                />
              ) : (
                <Markdown
                  mode="minimal"
                  onUrlClick={onOpenUrl}
                  onFileClick={onOpenFile}
                  hideFirstMermaidExpand={false}
                >
                  {visibleContent}
                </Markdown>
              )}
            </div>
          </div>
        </div>
      </div>
    </FullscreenOverlayBase>
  )
}
