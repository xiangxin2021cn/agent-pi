/**
 * PDFPreviewOverlay - In-app PDF preview using Chromium's native PDF viewer.
 *
 * Renders PDFs through a blob URL in an iframe. This avoids pdf.js worker URL
 * issues in packaged Electron builds while still keeping the preview in-app.
 * Supports multiple items with arrow navigation in the header.
 */

import { useState, useCallback, useMemo, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { FileText } from 'lucide-react'
import { PreviewOverlay } from './PreviewOverlay'
import { CopyButton } from './CopyButton'
import { ItemNavigator } from './ItemNavigator'

interface PreviewItem {
  src: string
  label?: string
}

export interface PDFPreviewOverlayProps {
  isOpen: boolean
  onClose: () => void
  /** Absolute file path for the PDF (single item / backward compat) */
  filePath: string
  /** Multiple items for arrow navigation */
  items?: PreviewItem[]
  /** Initial active item index (defaults to 0) */
  initialIndex?: number
  /** Async loader that returns PDF data as Uint8Array */
  loadPdfData: (path: string) => Promise<Uint8Array>
  theme?: 'light' | 'dark'
}

export function PDFPreviewOverlay({
  isOpen,
  onClose,
  filePath,
  items,
  initialIndex = 0,
  loadPdfData,
  theme = 'light',
}: PDFPreviewOverlayProps) {
  const { t } = useTranslation()

  // Normalize: items array or single filePath
  const resolvedItems = useMemo<PreviewItem[]>(() => {
    if (items && items.length > 0) return items
    return [{ src: filePath }]
  }, [items, filePath])

  const [activeIdx, setActiveIdx] = useState(initialIndex)
  const [pdfUrl, setPdfUrl] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(false)

  const activeItem = resolvedItems[activeIdx]

  // Reset index when overlay opens
  useEffect(() => {
    if (isOpen) {
      setActiveIdx(initialIndex)
    }
  }, [isOpen, initialIndex])

  // Load PDF data when overlay opens or active item changes
  useEffect(() => {
    if (!isOpen || !activeItem?.src) return

    let cancelled = false
    let objectUrl: string | null = null
    setIsLoading(true)
    setError(null)
    setPdfUrl(null)

    loadPdfData(activeItem.src)
      .then((data) => {
        if (!cancelled) {
          const bytes = data instanceof Uint8Array ? data : new Uint8Array(data)
          const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
          objectUrl = URL.createObjectURL(new Blob([buffer], { type: 'application/pdf' }))
          setPdfUrl(objectUrl)
          setIsLoading(false)
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Failed to load PDF')
          setIsLoading(false)
        }
      })

    return () => {
      cancelled = true
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [isOpen, activeItem?.src, loadPdfData])

  const handleFrameLoad = useCallback(() => {
    setIsLoading(false)
  }, [])

  // Header actions: item navigation + copy button
  const headerActions = (
    <div className="flex items-center gap-2">
      <ItemNavigator items={resolvedItems} activeIndex={activeIdx} onSelect={setActiveIdx} size="md" />
      <CopyButton content={activeItem?.src || filePath} title={t('common.copyPath')} className="bg-background shadow-minimal" />
    </div>
  )

  return (
    <PreviewOverlay
      isOpen={isOpen}
      onClose={onClose}
      theme={theme}
      typeBadge={{
        icon: FileText,
        label: 'PDF',
        variant: 'orange',
      }}
      filePath={activeItem?.src || filePath}
      error={error ? { label: 'Load Failed', message: error } : undefined}
      headerActions={headerActions}
    >
      <div className="h-full min-h-[70vh] flex flex-col items-center overflow-hidden">
        {isLoading && (
          <div className="absolute z-10 mt-6 rounded-[6px] bg-background px-3 py-2 text-sm text-muted-foreground shadow-minimal">
            {t('preview.loadingPdf')}
          </div>
        )}
        {pdfUrl && (
          <iframe
            src={pdfUrl}
            title={activeItem?.label || activeItem?.src || filePath}
            className="h-full min-h-[70vh] w-full border-0 bg-background"
            onLoad={handleFrameLoad}
          />
        )}
      </div>
    </PreviewOverlay>
  )
}
