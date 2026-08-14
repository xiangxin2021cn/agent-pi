import * as React from 'react'
import { ClipboardCheck, ClipboardList, Landmark, Plus } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import type { BusinessModuleId } from '@craft-agent/shared/business-projects'
import { cn } from '@/lib/utils'
import { BusinessProjectDialog } from './BusinessProjectDialog'

const MODULES = {
  tender: { labelKey: 'businessProjects.moduleTender', icon: ClipboardCheck },
  delivery: { labelKey: 'businessProjects.moduleDelivery', icon: ClipboardList },
  investment: { labelKey: 'businessProjects.moduleInvestment', icon: Landmark },
} as const

export function BusinessModuleLaunchButton({
  moduleId,
  workspaceRootPath,
  className,
}: {
  moduleId: BusinessModuleId
  workspaceRootPath?: string
  className?: string
}) {
  const { t } = useTranslation()
  const module = MODULES[moduleId]
  const [dialogOpen, setDialogOpen] = React.useState(false)

  return (
    <>
      <Button type="button" disabled={!workspaceRootPath} onClick={() => setDialogOpen(true)} className={cn('justify-start', className)}>
        <Plus className="size-4" />
        {t('businessProjects.createModuleProject', { module: t(module.labelKey) })}
      </Button>
      {workspaceRootPath && <BusinessProjectDialog open={dialogOpen} onOpenChange={setDialogOpen} moduleId={moduleId} workspaceRootPath={workspaceRootPath} />}
    </>
  )
}

export function BusinessModuleLanding({ moduleId, workspaceRootPath }: { moduleId: BusinessModuleId; workspaceRootPath?: string }) {
  const { t } = useTranslation()
  const module = MODULES[moduleId]
  const Icon = module.icon

  return (
    <div className="flex h-full items-center justify-center px-6">
      <div className="flex w-full max-w-md flex-col items-center gap-5 text-center">
        <Icon className="size-8 text-muted-foreground" />
        <h1 className="text-lg font-semibold">{t(module.labelKey)}</h1>
        <p className="text-sm text-muted-foreground">{t('businessProjects.landingHint')}</p>
        <BusinessModuleLaunchButton moduleId={moduleId} workspaceRootPath={workspaceRootPath} />
      </div>
    </div>
  )
}
