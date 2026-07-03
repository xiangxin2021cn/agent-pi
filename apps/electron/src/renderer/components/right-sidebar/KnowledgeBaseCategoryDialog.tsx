import * as React from 'react'
import { Check, FolderOpen } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { cn } from '@/lib/utils'
import {
  buildKnowledgeBaseCategoryOptions,
  resolveKnowledgeBaseDialogValue,
} from './knowledge-base-category-dialog-view-model'

export interface KnowledgeBaseCategoryDialogProps {
  open: boolean
  fileName?: string
  suggestedCategory: string
  existingCategories: string[]
  onOpenChange: (open: boolean) => void
  onConfirm: (category: string) => void
}

export function KnowledgeBaseCategoryDialog({
  open,
  fileName,
  suggestedCategory,
  existingCategories,
  onOpenChange,
  onConfirm,
}: KnowledgeBaseCategoryDialogProps) {
  const { t } = useTranslation()
  const options = React.useMemo(
    () => buildKnowledgeBaseCategoryOptions({ suggestedCategory, existingCategories }),
    [existingCategories, suggestedCategory]
  )
  const [value, setValue] = React.useState(suggestedCategory)

  React.useEffect(() => {
    if (open) setValue(suggestedCategory)
  }, [open, suggestedCategory])

  const resolvedValue = resolveKnowledgeBaseDialogValue(value)

  const handleConfirm = () => {
    if (!resolvedValue) return
    onConfirm(resolvedValue)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[460px]">
        <DialogHeader>
          <DialogTitle>{t('chat.knowledgeBaseDialogTitle')}</DialogTitle>
          <DialogDescription>
            {fileName
              ? t('chat.knowledgeBaseDialogDescriptionWithFile', { fileName })
              : t('chat.knowledgeBaseDialogDescription')}
          </DialogDescription>
        </DialogHeader>

        {options.length > 0 && (
          <div className="space-y-2">
            <Label>{t('chat.knowledgeBaseExistingCategories')}</Label>
            <div className="max-h-36 overflow-y-auto rounded-[8px] border border-border/70 p-1">
              {options.map(option => {
                const selected = resolvedValue === option.value
                return (
                  <button
                    key={option.value}
                    type="button"
                    className={cn(
                      'flex w-full items-center gap-2 rounded-[6px] px-2 py-1.5 text-left text-sm hover:bg-foreground/5',
                      selected && 'bg-primary/10 text-primary'
                    )}
                    onClick={() => setValue(option.value)}
                  >
                    <FolderOpen className="h-3.5 w-3.5 shrink-0" />
                    <span className="min-w-0 flex-1 truncate">{option.value}</span>
                    {option.isSuggested && (
                      <span className="shrink-0 rounded bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium text-primary">
                        {t('chat.knowledgeBaseSuggested')}
                      </span>
                    )}
                    {selected && <Check className="h-3.5 w-3.5 shrink-0" />}
                  </button>
                )
              })}
            </div>
          </div>
        )}

        <div className="space-y-2">
          <Label htmlFor="knowledge-base-category-input">{t('chat.knowledgeBaseCategoryPrompt')}</Label>
          <Input
            id="knowledge-base-category-input"
            value={value}
            onChange={(event) => setValue(event.target.value)}
            placeholder={t('chat.knowledgeBaseCategoryPlaceholder')}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && resolvedValue) {
                event.preventDefault()
                handleConfirm()
              }
            }}
          />
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t('common.cancel')}
          </Button>
          <Button onClick={handleConfirm} disabled={!resolvedValue}>
            {t('chat.addToKnowledgeBase')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
