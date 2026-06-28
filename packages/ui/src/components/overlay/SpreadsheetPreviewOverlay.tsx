import { useEffect, useMemo, useState } from 'react'
import { Table2 } from 'lucide-react'
import type { SpreadsheetPreviewResult } from '@craft-agent/shared/protocol'
import { PreviewOverlay } from './PreviewOverlay'
import { cn } from '../../lib/utils'

export interface SpreadsheetPreviewOverlayProps {
  isOpen: boolean
  onClose: () => void
  filePath: string
  preview: SpreadsheetPreviewResult | null
  error?: string
  theme?: 'light' | 'dark'
}

export function SpreadsheetPreviewOverlay({
  isOpen,
  onClose,
  filePath,
  preview,
  error,
  theme = 'light',
}: SpreadsheetPreviewOverlayProps) {
  const [activeSheetName, setActiveSheetName] = useState<string | null>(preview?.activeSheet ?? null)

  useEffect(() => {
    setActiveSheetName(preview?.activeSheet ?? null)
  }, [preview?.activeSheet])

  const activeSheet = useMemo(() => {
    if (!preview?.sheets.length) return null
    return preview.sheets.find(sheet => sheet.name === activeSheetName) ?? preview.sheets[0]
  }, [preview, activeSheetName])

  const issue = error
    ? { label: 'Load Failed', message: error }
    : preview?.truncated
      ? { label: 'Preview truncated', message: 'Only a bounded sample is shown. Open the workbook externally for the full file.' }
      : undefined

  return (
    <PreviewOverlay
      isOpen={isOpen}
      onClose={onClose}
      theme={theme}
      typeBadge={{ icon: Table2, label: 'Spreadsheet', variant: 'green' }}
      filePath={filePath}
      subtitle={activeSheet ? `${activeSheet.totalRows} rows x ${activeSheet.totalCols} cols` : undefined}
      error={issue}
    >
      <div className="min-h-full flex flex-col justify-center px-6 py-12">
        <div className="w-full max-w-[1180px] mx-auto bg-background rounded-[10px] border border-border/50 shadow-strong overflow-hidden">
          {preview && preview.sheets.length > 1 && (
            <div className="flex items-center gap-1 overflow-x-auto border-b border-border/50 px-3 py-2 bg-muted/20">
              {preview.sheets.map(sheet => (
                <button
                  key={sheet.name}
                  type="button"
                  onClick={() => setActiveSheetName(sheet.name)}
                  className={cn(
                    'h-7 px-2.5 rounded-[6px] text-xs font-medium whitespace-nowrap transition-colors',
                    sheet.name === activeSheet?.name
                      ? 'bg-background shadow-minimal text-foreground'
                      : 'text-muted-foreground hover:text-foreground hover:bg-background/60'
                  )}
                >
                  {sheet.name}
                </button>
              ))}
            </div>
          )}

          {!activeSheet ? (
            <div className="px-5 py-8 text-sm text-muted-foreground">
              No spreadsheet preview rows were returned for this workbook.
            </div>
          ) : (
            <div className="max-h-[72vh] overflow-auto">
              <table className="w-full border-collapse text-sm">
                <thead className="sticky top-0 z-10 bg-background">
                  <tr>
                    <th className="w-12 border-b border-r border-border/60 px-2 py-2 text-right text-xs font-medium text-muted-foreground bg-muted/30">
                      #
                    </th>
                    {activeSheet.columns.map(column => (
                      <th
                        key={column.key}
                        className="min-w-[120px] border-b border-r border-border/60 px-2 py-2 text-left text-xs font-medium text-muted-foreground bg-muted/30"
                      >
                        {column.label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {activeSheet.rows.map((row, rowIndex) => (
                    <tr key={rowIndex} className="odd:bg-muted/[0.14]">
                      <td className="border-r border-border/40 px-2 py-1.5 text-right text-xs text-muted-foreground">
                        {rowIndex + 1}
                      </td>
                      {activeSheet.columns.map(column => (
                        <td
                          key={column.key}
                          className="max-w-[320px] border-r border-border/30 px-2 py-1.5 align-top text-foreground/90"
                        >
                          <span className="line-clamp-3 break-words">
                            {row[column.key] == null ? '' : String(row[column.key])}
                          </span>
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </PreviewOverlay>
  )
}
