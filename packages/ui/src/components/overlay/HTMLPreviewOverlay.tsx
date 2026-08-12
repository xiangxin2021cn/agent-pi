/**
 * HTMLPreviewOverlay - Fullscreen overlay for viewing rendered HTML content.
 *
 * Uses PreviewOverlay as the base for consistent modal/fullscreen behavior.
 * File-backed previews load via a live origin URL (full webpage: scripts,
 * relative assets, dynamic components). Chat embeds keep srcDoc + sandbox
 * with scripts disabled. Links in srcDoc previews open in the system browser
 * via Electron's will-navigate handler.
 *
 * Supports Preview/Code modes, Save As, multi-item navigation, and copy.
 */

import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { Code2, Download, Eye, Globe, AppWindow } from 'lucide-react'
import { PreviewOverlay } from './PreviewOverlay'
import { CopyButton } from './CopyButton'
import { ItemNavigator } from './ItemNavigator'
import { ShikiCodeViewer } from '../code-viewer/ShikiCodeViewer'
import { ContentFrame } from './ContentFrame'
import { cn } from '../../lib/utils'

/**
 * Inject `<base target="_top">` so link clicks navigate the top frame,
 * which Electron's will-navigate handler intercepts → system browser.
 */
function injectBaseTarget(html: string): string {
  if (/<base\s/i.test(html)) return html
  if (/<head[^>]*>/i.test(html)) {
    return html.replace(/(<head[^>]*>)/i, '$1<base target="_top">')
  }
  if (/<html[^>]*>/i.test(html)) {
    return html.replace(/(<html[^>]*>)/i, '$1<head><base target="_top"></head>')
  }
  return `<head><base target="_top"></head>${html}`
}

interface PreviewItem {
  src: string
  label?: string
}

export interface HTMLPreviewOverlayProps {
  /** Whether the overlay is visible */
  isOpen: boolean
  /** Callback when the overlay should close */
  onClose: () => void
  /** Single HTML content (backward compat for link interceptor usage) */
  html?: string
  /** Multiple items for tabbed navigation */
  items?: PreviewItem[]
  /** Pre-loaded content cache (src → html string) */
  contentCache?: Record<string, string>
  /** Callback to load content for uncached items */
  onLoadContent?: (src: string) => Promise<string>
  /** Initial active item index (defaults to 0) */
  initialIndex?: number
  /** Optional title for the overlay header */
  title?: string
  /** Real filesystem path — enables path badge Open/Reveal actions */
  filePath?: string
  /** Save current HTML via host Save As dialog */
  onSaveAs?: (content: string) => void | Promise<unknown>
  /**
   * Allow script execution inside the sandboxed iframe.
   * Enable for trusted local artifact files (simulations/reports); keep false for chat embeds.
   */
  allowScripts?: boolean
  /**
   * Live origin URL for file-backed HTML (custom protocol). When set, preview
   * loads as a full webpage instead of srcDoc so relative assets and dynamic
   * components can run.
   */
  previewUrl?: string
  /** Open the live page in the in-app browser window */
  onOpenInBrowser?: () => void | Promise<unknown>
  /** Theme mode for dark/light styling */
  theme?: 'light' | 'dark'
  /** Error message if the file could not be read */
  error?: string
}

export function HTMLPreviewOverlay({
  isOpen,
  onClose,
  html,
  items,
  contentCache: externalCache,
  onLoadContent,
  initialIndex = 0,
  title,
  filePath,
  onSaveAs,
  allowScripts = false,
  previewUrl,
  onOpenInBrowser,
  theme,
  error,
}: HTMLPreviewOverlayProps) {
  // Normalize: single html prop → single item, or use items array
  const { t } = useTranslation()
  const resolvedItems = React.useMemo<PreviewItem[]>(() => {
    if (items && items.length > 0) return items
    if (html || filePath) return [{ src: filePath || '__single__', label: title }]
    return []
  }, [items, html, filePath, title])

  const [activeIdx, setActiveIdx] = React.useState(initialIndex)
  const [viewMode, setViewMode] = React.useState<'preview' | 'code'>('preview')
  const iframeRef = React.useRef<HTMLIFrameElement>(null)
  const [contentSize, setContentSize] = React.useState<{ width: number; height: number } | null>(null)

  // Internal content cache (merges external + locally loaded)
  const [internalCache, setInternalCache] = React.useState<Record<string, string>>({})
  const [loadingItem, setLoadingItem] = React.useState(false)
  const [loadError, setLoadError] = React.useState<string | null>(null)
  const [saving, setSaving] = React.useState(false)

  // Merge caches — external takes precedence, plus single html prop
  const mergedCache = React.useMemo(() => {
    const merged: Record<string, string> = { ...internalCache }
    if (externalCache) Object.assign(merged, externalCache)
    if (html) {
      merged['__single__'] = html
      if (filePath) merged[filePath] = html
    }
    return merged
  }, [internalCache, externalCache, html, filePath])

  const activeItem = resolvedItems[activeIdx]
  const activeContent = activeItem ? mergedCache[activeItem.src] : undefined

  // Reset index when overlay opens
  React.useEffect(() => {
    if (isOpen) {
      setActiveIdx(initialIndex)
      setContentSize(null)
      setViewMode('preview')
    }
  }, [isOpen, initialIndex])

  // Reset size when active item changes
  React.useEffect(() => {
    setContentSize(null)
    setLoadError(null)
  }, [activeIdx])

  // Load content for active item if not cached
  React.useEffect(() => {
    if (!isOpen || !activeItem?.src) return
    if (mergedCache[activeItem.src]) return
    if (!onLoadContent) return

    setLoadingItem(true)
    setLoadError(null)
    onLoadContent(activeItem.src)
      .then((content) => {
        setInternalCache((prev) => ({ ...prev, [activeItem.src]: content }))
      })
      .catch((err) => {
        setLoadError(err instanceof Error ? err.message : 'Failed to load content')
      })
      .finally(() => setLoadingItem(false))
  }, [isOpen, activeItem?.src, mergedCache, onLoadContent])

  // Preprocess active HTML
  const processedHtml = React.useMemo(
    () => activeContent ? injectBaseTarget(activeContent) : null,
    [activeContent]
  )

  const livePreview = Boolean(previewUrl) && viewMode === 'preview'
  const sandbox = allowScripts
    ? 'allow-scripts allow-same-origin allow-top-navigation-by-user-activation'
    : 'allow-same-origin allow-top-navigation-by-user-activation'

  // Read iframe content dimensions after it loads (srcDoc previews only)
  const handleLoad = React.useCallback(() => {
    if (previewUrl) return
    const iframe = iframeRef.current
    if (!iframe) return
    try {
      const doc = iframe.contentDocument
      if (!doc?.body) return
      doc.documentElement.style.overflow = 'hidden'
      doc.body.style.overflow = 'hidden'
      const origWidth = doc.body.style.width
      doc.body.style.width = 'fit-content'
      const naturalWidth = doc.body.scrollWidth
      doc.body.style.width = origWidth
      const height = doc.body.scrollHeight
      setContentSize({ width: naturalWidth, height })
    } catch {
      // Cross-origin access denied — fall back to viewport height
      setContentSize({ width: 0, height: Math.round(window.innerHeight * 0.7) })
    }
  }, [previewUrl])

  const handleSaveAs = React.useCallback(async () => {
    if (!onSaveAs || !activeContent || saving) return
    setSaving(true)
    try {
      await onSaveAs(activeContent)
    } finally {
      setSaving(false)
    }
  }, [onSaveAs, activeContent, saving])

  const iframeHeight = contentSize
    ? `${Math.max(contentSize.height, 400)}px`
    : 'calc(100vh - 200px)'

  const measured = contentSize !== null || viewMode === 'code'

  // Header actions: mode toggle + item navigation + save/copy
  const headerActions = (
    <div className="flex items-center gap-2">
      <div className="flex items-center rounded-[6px] border bg-background shadow-minimal overflow-hidden">
        <button
          type="button"
          className={cn(
            'inline-flex h-7 items-center gap-1 px-2 text-xs font-medium transition-colors',
            viewMode === 'preview'
              ? 'bg-foreground/10 text-foreground'
              : 'text-muted-foreground hover:text-foreground hover:bg-foreground/5',
          )}
          onClick={() => setViewMode('preview')}
          title={t('overlay.preview')}
        >
          <Eye className="w-3.5 h-3.5" />
          {t('overlay.preview')}
        </button>
        <button
          type="button"
          className={cn(
            'inline-flex h-7 items-center gap-1 px-2 text-xs font-medium transition-colors',
            viewMode === 'code'
              ? 'bg-foreground/10 text-foreground'
              : 'text-muted-foreground hover:text-foreground hover:bg-foreground/5',
          )}
          onClick={() => setViewMode('code')}
          title={t('overlay.code')}
        >
          <Code2 className="w-3.5 h-3.5" />
          {t('overlay.code')}
        </button>
      </div>
      <ItemNavigator items={resolvedItems} activeIndex={activeIdx} onSelect={setActiveIdx} size="md" />
      {onOpenInBrowser && previewUrl && (
        <button
          type="button"
          className="inline-flex h-7 items-center justify-center gap-1 rounded-[6px] bg-background px-2 text-xs font-medium shadow-minimal text-muted-foreground hover:text-foreground"
          onClick={() => { void onOpenInBrowser() }}
          title={t('overlay.openInBrowser')}
        >
          <AppWindow className="w-3.5 h-3.5" />
          {t('overlay.openInBrowser')}
        </button>
      )}
      {onSaveAs && (
        <button
          type="button"
          className="inline-flex h-7 items-center justify-center gap-1 rounded-[6px] bg-background px-2 text-xs font-medium shadow-minimal text-muted-foreground hover:text-foreground disabled:cursor-not-allowed disabled:opacity-35"
          disabled={!activeContent || saving}
          onClick={() => { void handleSaveAs() }}
          title={t('common.saveAs')}
        >
          <Download className="w-3.5 h-3.5" />
          {t('common.saveAs')}
        </button>
      )}
      <CopyButton content={activeContent || ''} label="Copy HTML" className="bg-background shadow-minimal" />
    </div>
  )

  const displayError = error || loadError
  const overlayLayout = livePreview ? 'browser' : 'document'

  return (
    <PreviewOverlay
      isOpen={isOpen}
      onClose={onClose}
      theme={theme}
      typeBadge={{
        icon: Globe,
        label: 'HTML',
        variant: 'blue',
      }}
      filePath={filePath}
      title={filePath ? undefined : (title || activeItem?.label || t('preview.htmlPreview'))}
      headerActions={headerActions}
      layout={overlayLayout}
      error={displayError && !activeContent && !previewUrl ? { label: 'Read Failed', message: displayError } : undefined}
    >
      {livePreview && previewUrl ? (
        <iframe
          ref={iframeRef}
          src={previewUrl}
          title={activeItem?.label || title || t('preview.htmlPreview')}
          className="absolute inset-0 h-full w-full border-0 bg-white"
        />
      ) : (
        <div className="px-6 pb-6">
          {loadingItem && !activeContent && (
            <div className="py-12 text-center text-muted-foreground text-sm">{t('common.loading')}</div>
          )}
          {viewMode === 'code' && activeContent && (
            <ContentFrame title={t('overlay.code')} fitContent minWidth={850}>
              <div>
                <ShikiCodeViewer
                  code={activeContent}
                  filePath={filePath}
                  language="html"
                  theme={theme}
                />
              </div>
            </ContentFrame>
          )}
          {viewMode === 'preview' && processedHtml && (
            <div
              className="bg-white rounded-[12px] overflow-hidden shadow-minimal mx-auto"
              style={{
                maxWidth: contentSize?.width ? `${contentSize.width + 128}px` : undefined,
                padding: '24px 64px 36px',
                opacity: measured ? 1 : 0,
                transition: 'opacity 200ms ease-in',
              }}
            >
              <iframe
                ref={iframeRef}
                sandbox={sandbox}
                srcDoc={processedHtml}
                onLoad={handleLoad}
                title={activeItem?.label || title || t('preview.htmlPreview')}
                className="w-full border-0"
                style={{ height: iframeHeight, minHeight: '400px' }}
              />
            </div>
          )}
        </div>
      )}
    </PreviewOverlay>
  )
}
