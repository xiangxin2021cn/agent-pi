import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { Check, DatabaseZap, FolderOpen } from 'lucide-react'

import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { SourceAvatar } from '@/components/ui/source-avatar'
import { cn } from '@/lib/utils'
import type { LoadedSource } from '../../../shared/types'
import {
  buildKnowledgeBaseSelectorSections,
  setKnowledgeBaseSelection,
  toggleKnowledgeBaseSlug,
} from './knowledge-base-selector-view-model'

export interface KnowledgeBaseLoadDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  sources: LoadedSource[]
  selectedSlugs: string[]
  onChangeSlugs: (slugs: string[]) => void
}

export function KnowledgeBaseLoadDialog({
  open,
  onOpenChange,
  sources,
  selectedSlugs,
  onChangeSlugs,
}: KnowledgeBaseLoadDialogProps) {
  const { t } = useTranslation()
  const sections = React.useMemo(() => buildKnowledgeBaseSelectorSections(sources), [sources])
  const knowledgeBaseSlugs = React.useMemo(
    () => sections.flatMap(section => section.sources.map(source => source.config.slug)),
    [sections]
  )
  const selectedKnowledgeBaseCount = knowledgeBaseSlugs.filter(slug => selectedSlugs.includes(slug)).length
  const allSelected = knowledgeBaseSlugs.length > 0 && selectedKnowledgeBaseCount === knowledgeBaseSlugs.length

  const handleSelectAll = () => {
    onChangeSlugs(setKnowledgeBaseSelection(selectedSlugs, knowledgeBaseSlugs, true))
  }

  const handleClearAll = () => {
    onChangeSlugs(setKnowledgeBaseSelection(selectedSlugs, knowledgeBaseSlugs, false))
  }

  const handleToggle = (slug: string) => {
    onChangeSlugs(toggleKnowledgeBaseSlug(selectedSlugs, slug))
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[560px]">
        <DialogHeader>
          <DialogTitle>{t('chat.loadKnowledgeBase')}</DialogTitle>
          <DialogDescription>
            {t('chat.loadKnowledgeBaseDescription')}
          </DialogDescription>
        </DialogHeader>

        <div className="flex items-center justify-between gap-3 rounded-[8px] border border-border/70 px-3 py-2">
          <div className="min-w-0 text-sm text-muted-foreground">
            {t('chat.knowledgeBaseSelectedCount', {
              selected: selectedKnowledgeBaseCount,
              total: knowledgeBaseSlugs.length,
            })}
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <Button type="button" variant="outline" size="sm" onClick={handleSelectAll} disabled={allSelected || knowledgeBaseSlugs.length === 0}>
              {t('chat.selectAllKnowledgeBase')}
            </Button>
            <Button type="button" variant="ghost" size="sm" onClick={handleClearAll} disabled={selectedKnowledgeBaseCount === 0}>
              {t('common.clearAll')}
            </Button>
          </div>
        </div>

        <div className="max-h-[48vh] overflow-y-auto rounded-[8px] border border-border/70 p-1">
          {sections.length === 0 ? (
            <div className="flex flex-col items-center gap-2 px-4 py-10 text-center text-sm text-muted-foreground">
              <DatabaseZap className="h-5 w-5" />
              {t('chat.noKnowledgeBaseEntries')}
            </div>
          ) : (
            sections.map(section => (
              <div key={section.folder} className="py-1">
                <div className="flex items-center gap-2 px-2 py-1.5 text-xs font-medium text-muted-foreground">
                  <FolderOpen className="h-3.5 w-3.5" />
                  <span className="truncate">{section.folder}</span>
                </div>
                <div className="grid gap-0.5">
                  {section.sources.map(source => {
                    const selected = selectedSlugs.includes(source.config.slug)
                    return (
                      <button
                        key={source.config.slug}
                        type="button"
                        onClick={() => handleToggle(source.config.slug)}
                        className={cn(
                          'flex items-center gap-3 rounded-[6px] px-2 py-2 text-left text-sm transition-colors',
                          selected ? 'bg-primary/10 text-primary' : 'hover:bg-foreground/5'
                        )}
                      >
                        <SourceAvatar source={source} size="sm" />
                        <span className="min-w-0 flex-1 truncate">{source.config.name}</span>
                        <span className="shrink-0 text-[11px] text-muted-foreground">{source.config.slug}</span>
                        <span
                          className={cn(
                            'flex h-4 w-4 shrink-0 items-center justify-center rounded-full border',
                            selected ? 'border-primary bg-primary text-primary-foreground' : 'border-foreground/20'
                          )}
                        >
                          {selected && <Check className="h-2.5 w-2.5" strokeWidth={3} />}
                        </span>
                      </button>
                    )
                  })}
                </div>
              </div>
            ))
          )}
        </div>

        <DialogFooter>
          <Button type="button" onClick={() => onOpenChange(false)}>
            {t('common.done')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
