import * as React from 'react'
import { FilePlus2, FolderOpen, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import type { BusinessModuleId, BusinessProjectRecord } from '@craft-agent/shared/business-projects'
import type { FileAttachment } from '@craft-agent/shared/protocol'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { ServerDirectoryBrowser } from '@/components/ServerDirectoryBrowser'
import { useDirectoryPicker } from '@/hooks/useDirectoryPicker'
import { useAppShellContext } from '@/context/AppShellContext'
import { slugify } from '@/lib/slugify'
import { cn } from '@/lib/utils'
import { buildBusinessTaskDraft } from '@/pages/business-module-launcher'
import { getBusinessWorkflow } from '@/pages/business-workflows'

const MODULE_TITLE: Record<BusinessModuleId, string> = {
  tender: '投标工作台',
  delivery: '项目实施控制',
  investment: '资源投资研究',
}

type FolderMode = 'create' | 'existing'

interface BusinessProjectDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  moduleId: BusinessModuleId
  workspaceRootPath: string
  onCreated?: (project: BusinessProjectRecord) => void
}

function joinSelectedPath(basePath: string, child: string): string {
  const separator = basePath.includes('\\') ? '\\' : '/'
  return `${basePath.replace(/[\\/]+$/, '')}${separator}${child}`
}

export function BusinessProjectDialog({
  open,
  onOpenChange,
  moduleId,
  workspaceRootPath,
  onCreated,
}: BusinessProjectDialogProps) {
  const { openNewChat } = useAppShellContext()
  const workflow = getBusinessWorkflow(moduleId)
  const [step, setStep] = React.useState(0)
  const [name, setName] = React.useState('')
  const [projectId, setProjectId] = React.useState('')
  const [projectIdEdited, setProjectIdEdited] = React.useState(false)
  const [folderMode, setFolderMode] = React.useState<FolderMode>('create')
  const [selectedPath, setSelectedPath] = React.useState('')
  const [attachments, setAttachments] = React.useState<FileAttachment[]>([])
  const [isSaving, setIsSaving] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  const reset = React.useCallback(() => {
    setStep(0)
    setName('')
    setProjectId('')
    setProjectIdEdited(false)
    setFolderMode('create')
    setSelectedPath('')
    setAttachments([])
    setIsSaving(false)
    setError(null)
  }, [])

  React.useEffect(() => {
    if (!open) reset()
  }, [open, reset])

  const handleNameChange = (value: string) => {
    setName(value)
    if (!projectIdEdited) setProjectId(slugify(value))
  }

  const {
    pickDirectory,
    showServerBrowser,
    serverBrowserMode,
    cancelServerBrowser,
    confirmServerBrowser,
  } = useDirectoryPicker(setSelectedPath)

  const handleAttachFiles = async () => {
    const result = await window.electronAPI.openAttachmentDialog('files')
    setAttachments((current) => {
      const byPath = new Map(current.map((item) => [item.path, item]))
      result.attachments.forEach((item) => byPath.set(item.path, item))
      return [...byPath.values()]
    })
    if (result.truncated) toast.warning(`仅载入前 ${result.maxFiles} 个文件`)
  }

  const normalizedProjectId = projectId.trim() || `${moduleId}-${Date.now().toString(36)}`
  const rootPath = selectedPath
    ? folderMode === 'create'
      ? joinSelectedPath(selectedPath, normalizedProjectId)
      : selectedPath
    : ''
  const canContinue = step === 0
    ? Boolean(name.trim() && normalizedProjectId)
    : step === 1
      ? Boolean(selectedPath)
      : true

  const handleCreate = async () => {
    if (!rootPath || isSaving) return
    setIsSaving(true)
    setError(null)
    try {
      const project = await window.electronAPI.createBusinessProject({
        workspaceRootPath,
        module: moduleId,
        projectId: normalizedProjectId,
        name: name.trim(),
        rootPath,
        workflowId: workflow.id,
        createDirectory: folderMode === 'create',
        inputPaths: attachments.map((attachment) => attachment.path),
      })
      window.dispatchEvent(new CustomEvent('craft:business-projects-changed', { detail: { moduleId } }))
      onCreated?.(project)
      onOpenChange(false)

      const firstStage = workflow.stages[0]!
      await openNewChat?.({
        name: `${project.name} · ${firstStage.label}`,
        workingDirectory: project.rootPath,
        businessContext: {
          module: moduleId,
          projectId: project.projectId,
          workflowId: project.workflowId,
          stageId: firstStage.id,
        },
        attachments,
        input: buildBusinessTaskDraft(moduleId, project, firstStage),
      })
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
      setIsSaving(false)
    }
  }

  return (
    <>
      <Dialog open={open} onOpenChange={(next) => !isSaving && onOpenChange(next)}>
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>新建{MODULE_TITLE[moduleId]}项目</DialogTitle>
            <DialogDescription>使用现有对话执行内核，建立独立项目目录、明确资料边界并按专业流程推进。</DialogDescription>
          </DialogHeader>

          <div className="flex gap-2 border-b pb-3 text-xs text-muted-foreground">
            {['项目信息', '项目文件夹', '依据资料', '流程确认'].map((label, index) => (
              <span key={label} className={cn('flex-1 border-b-2 pb-2 text-center', index === step ? 'border-primary text-foreground' : 'border-transparent')}>
                {index + 1}. {label}
              </span>
            ))}
          </div>

          {step === 0 && (
            <div className="space-y-4 py-2">
              <div className="space-y-2">
                <Label htmlFor="business-project-name">项目名称</Label>
                <Input id="business-project-name" value={name} onChange={(event) => handleNameChange(event.target.value)} placeholder="例如：N3 公路升级投标" autoFocus />
              </div>
              <div className="space-y-2">
                <Label htmlFor="business-project-id">项目标识</Label>
                <Input
                  id="business-project-id"
                  value={projectId}
                  onChange={(event) => {
                    setProjectIdEdited(true)
                    setProjectId(slugify(event.target.value))
                  }}
                  placeholder="n3-upgrade"
                />
                <p className="text-xs text-muted-foreground">用于项目状态目录和会话归类，不改变实际文件名。</p>
              </div>
            </div>
          )}

          {step === 1 && (
            <div className="space-y-4 py-2">
              <div className="grid grid-cols-2 gap-2">
                <Button type="button" variant={folderMode === 'create' ? 'default' : 'outline'} onClick={() => setFolderMode('create')}>新建项目文件夹</Button>
                <Button type="button" variant={folderMode === 'existing' ? 'default' : 'outline'} onClick={() => setFolderMode('existing')}>关联现有项目文件夹</Button>
              </div>
              <Button type="button" variant="outline" onClick={pickDirectory} className="w-full justify-start">
                <FolderOpen className="size-4" />
                {selectedPath || (folderMode === 'create' ? '选择上级目录' : '选择现有项目目录')}
              </Button>
              {rootPath && <p className="break-all text-xs text-muted-foreground">项目工作目录：{rootPath}</p>}
            </div>
          )}

          {step === 2 && (
            <div className="space-y-4 py-2">
              <p className="text-sm text-muted-foreground">只登记本次明确选择的文件。系统不会把项目工作目录自动当作资料库扫描。</p>
              <Button type="button" variant="outline" onClick={handleAttachFiles}>
                <FilePlus2 className="size-4" />添加依据和待分析文件
              </Button>
              <div className="max-h-52 space-y-1 overflow-auto">
                {attachments.length === 0 && <p className="py-6 text-center text-sm text-muted-foreground">可暂不添加，进入项目后继续上传。</p>}
                {attachments.map((attachment) => (
                  <div key={attachment.path} className="flex items-center justify-between gap-3 border-b py-2 text-sm">
                    <span className="min-w-0 flex-1 truncate" title={attachment.path}>{attachment.name}</span>
                    <Button type="button" variant="ghost" size="sm" onClick={() => setAttachments((items) => items.filter((item) => item.path !== attachment.path))}>移除</Button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {step === 3 && (
            <div className="space-y-4 py-2">
              <div>
                <p className="font-medium">{workflow.label}</p>
                <p className="mt-1 text-sm text-muted-foreground">新项目从“{workflow.stages[0]?.label}”开始；后续阶段在对话顶部切换。</p>
              </div>
              <ol className="space-y-2 text-sm">
                {workflow.stages.map((stage, index) => (
                  <li key={stage.id} className="flex gap-3 border-b pb-2">
                    <span className="text-muted-foreground">{index + 1}</span>
                    <span>{stage.label}</span>
                  </li>
                ))}
              </ol>
              <div className="text-sm">
                <p><span className="text-muted-foreground">项目：</span>{name}</p>
                <p className="break-all"><span className="text-muted-foreground">目录：</span>{rootPath}</p>
                <p><span className="text-muted-foreground">登记资料：</span>{attachments.length} 个</p>
              </div>
            </div>
          )}

          {error && <p className="text-sm text-destructive">{error}</p>}
          <DialogFooter>
            {step > 0 && <Button type="button" variant="outline" disabled={isSaving} onClick={() => setStep((current) => current - 1)}>上一步</Button>}
            {step < 3 ? (
              <Button type="button" disabled={!canContinue} onClick={() => setStep((current) => current + 1)}>下一步</Button>
            ) : (
              <Button type="button" disabled={isSaving || !rootPath} onClick={handleCreate}>
                {isSaving && <Loader2 className="size-4 animate-spin" />}创建项目并进入任务
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <ServerDirectoryBrowser open={showServerBrowser} mode={serverBrowserMode} onSelect={confirmServerBrowser} onCancel={cancelServerBrowser} />
    </>
  )
}
