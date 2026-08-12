import * as React from 'react'
import { toast } from 'sonner'
import { isKnowledgeBaseSource } from '@craft-agent/shared/sources/knowledge-base'
import type { LoadedSource } from '@craft-agent/shared/sources/types'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'

export interface ProjectBoundaryEditorDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  workspaceRootPath: string
  projectId: string
  parentSessionId?: string
  workspaceId?: string
  onSaved?: () => void
}

type BoundaryFormState = {
  profileId: string
  currency: string
  countryCode: string
  measurementId: string
  measurementTitle: string
  pricingStandard: string
  vatTreatment: string
  rateLocation: string
  organizationOutline: string
  bidderResources: string
  readiness: 'draft' | 'ready' | 'needs_review'
  confirm: boolean
}

type BoundarySourceDraft = {
  id?: string
  kind: 'knowledge_standard' | 'tender_spec_binding' | 'bidder_resource'
  role?: string
  title: string
  path?: string
  knowledgeSlug?: string
  documentId?: string
  markdownPath?: string
  parseStatus?: string
}

type SuggestedSpec = {
  documentId: string
  title: string
  path: string
  kind: string
}

const EMPTY_FORM: BoundaryFormState = {
  profileId: 'generic-international',
  currency: 'USD',
  countryCode: '',
  measurementId: 'to-confirm',
  measurementTitle: '',
  pricingStandard: 'generic_direct_cost_v1',
  vatTreatment: 'to_confirm',
  rateLocation: '',
  organizationOutline: '',
  bidderResources: '',
  readiness: 'draft',
  confirm: false,
}

function readPackData(packs: Record<string, Record<string, unknown>> | undefined): Record<string, unknown> | null {
  const envelope = packs?.project_boundary
  if (!envelope || typeof envelope !== 'object') return null
  const data = (envelope as { data?: unknown }).data
  return data && typeof data === 'object' ? data as Record<string, unknown> : null
}

function formFromPack(data: Record<string, unknown> | null): BoundaryFormState {
  if (!data) return { ...EMPTY_FORM }
  const jurisdiction = (data.jurisdiction ?? {}) as Record<string, unknown>
  const standards = (data.standards ?? {}) as Record<string, unknown>
  const measurement = (standards.measurementStandard ?? {}) as Record<string, unknown>
  const pricing = (data.pricing ?? {}) as Record<string, unknown>
  const tax = (pricing.taxRegime ?? {}) as Record<string, unknown>
  const rate = (pricing.ratePolicy ?? {}) as Record<string, unknown>
  const outline = (data.organizationOutline ?? {}) as Record<string, unknown>
  const resources = (data.bidderResources ?? {}) as Record<string, unknown>
  return {
    profileId: String(data.profileId ?? 'generic-international'),
    currency: String(jurisdiction.currency ?? 'USD'),
    countryCode: String(jurisdiction.countryCode ?? ''),
    measurementId: String(measurement.id ?? 'to-confirm'),
    measurementTitle: String(measurement.title ?? ''),
    pricingStandard: String(pricing.pricingStandard ?? 'generic_direct_cost_v1'),
    vatTreatment: String(tax.vatTreatment ?? 'to_confirm'),
    rateLocation: String(rate.location ?? ''),
    organizationOutline: String(outline.text ?? ''),
    bidderResources: String(resources.outline ?? ''),
    readiness: (data.readiness === 'ready' || data.readiness === 'needs_review' || data.readiness === 'draft')
      ? data.readiness
      : 'draft',
    confirm: Boolean(data.humanConfirmedAt),
  }
}

function sourcesFromPack(data: Record<string, unknown> | null): BoundarySourceDraft[] {
  const raw = data?.boundarySources
  if (!Array.isArray(raw)) return []
  return raw.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object')
    .map((item) => ({
      id: typeof item.id === 'string' ? item.id : undefined,
      kind: item.kind === 'tender_spec_binding' || item.kind === 'bidder_resource'
        ? item.kind
        : 'knowledge_standard',
      role: typeof item.role === 'string' ? item.role : undefined,
      title: String(item.title ?? ''),
      ...(typeof item.path === 'string' ? { path: item.path } : {}),
      ...(typeof item.knowledgeSlug === 'string' ? { knowledgeSlug: item.knowledgeSlug } : {}),
      ...(typeof item.documentId === 'string' ? { documentId: item.documentId } : {}),
      ...(typeof item.markdownPath === 'string' ? { markdownPath: item.markdownPath } : {}),
      ...(typeof item.parseStatus === 'string' ? { parseStatus: item.parseStatus } : {}),
    }))
}

function packFromForm(
  projectId: string,
  form: BoundaryFormState,
  sources: BoundarySourceDraft[],
  existing: Record<string, unknown> | null,
): Record<string, unknown> {
  const existingStandards = (existing?.standards ?? {}) as Record<string, unknown>
  const existingSpecs = Array.isArray(existingStandards.technicalSpecs) ? existingStandards.technicalSpecs : []
  return {
    schemaVersion: 1,
    projectId,
    profileId: form.profileId.trim() || 'generic-international',
    jurisdiction: {
      ...(form.countryCode.trim() ? { countryCode: form.countryCode.trim().slice(0, 2).toUpperCase() } : {}),
      currency: form.currency.trim().toUpperCase() || 'USD',
    },
    standards: {
      technicalSpecs: existingSpecs,
      measurementStandard: {
        id: form.measurementId.trim() || 'to-confirm',
        title: form.measurementTitle.trim() || form.measurementId.trim() || 'Confirm measurement standard',
      },
    },
    pricing: {
      pricingStandard: form.pricingStandard.trim() || 'generic_direct_cost_v1',
      indirectCostPolicy: 'exclude_from_item_direct_cost',
      taxRegime: { vatTreatment: form.vatTreatment.trim() || 'to_confirm' },
      ratePolicy: {
        location: form.rateLocation.trim() || 'Project location TBD',
        mustVerifyOnline: [],
        allowUnverifiedLabel: true,
      },
    },
    productivity: {
      basis: 'user_provided',
      sources: [],
    },
    bidderResources: {
      outline: form.bidderResources.trim() || 'Describe owned plant, labour, material sources and subcontract boundaries.',
      ...((existing?.bidderResources && typeof existing.bidderResources === 'object')
        ? Object.fromEntries(
          Object.entries(existing.bidderResources as Record<string, unknown>)
            .filter(([key]) => key !== 'outline'),
        )
        : {}),
    },
    organizationOutline: {
      text: form.organizationOutline,
    },
    boundarySources: sources,
    ...(existing?.extractedInventory ? { extractedInventory: existing.extractedInventory } : {}),
    ...(form.confirm ? { humanConfirmedAt: new Date().toISOString() } : {}),
    readiness: form.confirm ? 'ready' : form.readiness,
  }
}

function knowledgePath(source: LoadedSource): string | undefined {
  const metadata = source.config.metadata
  const path = typeof metadata?.sourceFilePath === 'string' ? metadata.sourceFilePath : undefined
  return path?.trim() || undefined
}

function parsePending(sources: BoundarySourceDraft[]): boolean {
  return sources.some((source) => Boolean(source.path) && source.parseStatus === 'registered')
}

function sourceKey(source: BoundarySourceDraft): string {
  return source.id
    || [source.kind, source.path ?? '', source.knowledgeSlug ?? '', source.documentId ?? '', source.title].join('|')
}

export function ProjectBoundaryEditorDialog({
  open,
  onOpenChange,
  workspaceRootPath,
  projectId,
  parentSessionId,
  workspaceId,
  onSaved,
}: ProjectBoundaryEditorDialogProps) {
  const [form, setForm] = React.useState<BoundaryFormState>(EMPTY_FORM)
  const [sources, setSources] = React.useState<BoundarySourceDraft[]>([])
  const [suggestedSpecs, setSuggestedSpecs] = React.useState<SuggestedSpec[]>([])
  const [knowledgeSources, setKnowledgeSources] = React.useState<LoadedSource[]>([])
  const [packData, setPackData] = React.useState<Record<string, unknown> | null>(null)
  const [loading, setLoading] = React.useState(false)
  const [saving, setSaving] = React.useState(false)

  const pendingParse = parsePending(sources)

  const reload = React.useCallback(async () => {
    const [bundle, stage] = await Promise.all([
      window.electronAPI.getTenderWorkspace({
        workingDirectory: workspaceRootPath,
        projectId,
      }),
      window.electronAPI.runTenderStage({
        action: 'status',
        workspaceRootPath,
        projectId,
        stageId: 'project-boundary-conditions',
        ...(parentSessionId ? { parentSessionId } : {}),
      }),
    ])
    const data = readPackData(bundle.packs)
    setPackData(data)
    setForm(formFromPack(data))
    const deskSources = stage.boundaryDesk?.sources ?? []
    setSources(deskSources.length > 0 ? deskSources.map((source) => ({
      id: source.id,
      kind: source.kind === 'tender_spec_binding' || source.kind === 'bidder_resource'
        ? source.kind
        : 'knowledge_standard',
      role: source.role,
      title: source.title,
      ...(source.path ? { path: source.path } : {}),
      ...(source.knowledgeSlug ? { knowledgeSlug: source.knowledgeSlug } : {}),
      ...(source.documentId ? { documentId: source.documentId } : {}),
      ...(source.markdownPath ? { markdownPath: source.markdownPath } : {}),
      parseStatus: source.parseStatus,
    })) : sourcesFromPack(data))
    setSuggestedSpecs(stage.boundaryDesk?.suggestedSpecs ?? [])
  }, [workspaceRootPath, projectId, parentSessionId])

  React.useEffect(() => {
    if (!open) return
    let cancelled = false
    setLoading(true)
    void (async () => {
      try {
        await reload()
        if (workspaceId) {
          const loaded = await window.electronAPI.getSources(workspaceId)
          if (!cancelled) setKnowledgeSources(loaded.filter(isKnowledgeBaseSource))
        } else if (!cancelled) {
          setKnowledgeSources([])
        }
      } catch (error) {
        if (!cancelled) {
          toast.error(error instanceof Error ? error.message : String(error))
          setForm({ ...EMPTY_FORM })
          setSources([])
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [open, reload, workspaceId])

  const update = <K extends keyof BoundaryFormState>(key: K, value: BoundaryFormState[K]) => {
    setForm((current) => ({ ...current, [key]: value }))
  }

  const upsertSources = (incoming: BoundarySourceDraft[]) => {
    setSources((current) => {
      const next = [...current]
      for (const source of incoming) {
        const key = sourceKey(source)
        const index = next.findIndex((item) => sourceKey(item) === key
          || (source.knowledgeSlug && item.knowledgeSlug === source.knowledgeSlug)
          || (source.path && item.path === source.path)
          || (source.documentId && item.documentId === source.documentId && item.kind === source.kind))
        if (index >= 0) next[index] = { ...next[index], ...source }
        else next.push(source)
      }
      return next
    })
  }

  const removeSource = (source: BoundarySourceDraft) => {
    const key = sourceKey(source)
    setSources((current) => current.filter((item) => sourceKey(item) !== key))
  }

  const handleRegisterSources = async (nextSources = sources) => {
    const result = await window.electronAPI.runTenderStage({
      action: 'register_boundary_sources',
      workspaceRootPath,
      projectId,
      stageId: 'project-boundary-conditions',
      ...(parentSessionId ? { parentSessionId } : {}),
      boundarySources: nextSources.map((source) => ({
        ...(source.id ? { id: source.id } : {}),
        kind: source.kind,
        ...(source.role ? { role: source.role } : {}),
        title: source.title,
        ...(source.path ? { path: source.path } : {}),
        ...(source.knowledgeSlug ? { knowledgeSlug: source.knowledgeSlug } : {}),
        ...(source.documentId ? { documentId: source.documentId } : {}),
      })),
    })
    const deskSources = result.boundaryDesk?.sources ?? []
    if (deskSources.length > 0) {
      setSources(deskSources.map((source) => ({
        id: source.id,
        kind: source.kind === 'tender_spec_binding' || source.kind === 'bidder_resource'
          ? source.kind
          : 'knowledge_standard',
        role: source.role,
        title: source.title,
        ...(source.path ? { path: source.path } : {}),
        ...(source.knowledgeSlug ? { knowledgeSlug: source.knowledgeSlug } : {}),
        ...(source.documentId ? { documentId: source.documentId } : {}),
        ...(source.markdownPath ? { markdownPath: source.markdownPath } : {}),
        parseStatus: source.parseStatus,
      })))
    }
    onSaved?.()
    return result
  }

  const handleToggleKnowledge = (source: LoadedSource, checked: boolean) => {
    const path = knowledgePath(source)
    if (!checked) {
      setSources((current) => current.filter((item) => item.knowledgeSlug !== source.config.slug))
      return
    }
    upsertSources([{
      kind: 'knowledge_standard',
      title: source.config.name,
      knowledgeSlug: source.config.slug,
      ...(path ? { path } : {}),
      parseStatus: path ? 'registered' : 'not_required',
    }])
  }

  const handleAddBidderFiles = async () => {
    const result = await window.electronAPI.openAttachmentDialog('files')
    if (result.attachments.length === 0) return
    upsertSources(result.attachments.map((item) => ({
      kind: 'bidder_resource' as const,
      title: item.path.split(/[\\/]/).pop() || item.path,
      path: item.path,
      parseStatus: 'registered',
    })))
  }

  const handleToggleSpec = (spec: SuggestedSpec, checked: boolean) => {
    if (!checked) {
      setSources((current) => current.filter((item) => !(item.kind === 'tender_spec_binding' && item.documentId === spec.documentId)))
      return
    }
    upsertSources([{
      kind: 'tender_spec_binding',
      title: spec.title,
      path: spec.path,
      documentId: spec.documentId,
      parseStatus: 'not_required',
    }])
  }

  const handleSuggest = async () => {
    setSaving(true)
    try {
      await window.electronAPI.runTenderStage({
        action: 'suggest_project_boundary',
        workspaceRootPath,
        projectId,
        stageId: 'project-boundary-conditions',
        ...(parentSessionId ? { parentSessionId } : {}),
      })
      await reload()
      toast.success('已写入边界草稿（仍须登记来源并人工确认）')
      onSaved?.()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error))
    } finally {
      setSaving(false)
    }
  }

  const handleSave = async () => {
    if (form.confirm && pendingParse) {
      toast.error('仍有界限文件待解析，确认前请先派发解析批次')
      return
    }
    setSaving(true)
    try {
      await handleRegisterSources()
      await window.electronAPI.runTenderStage({
        action: 'save_project_boundary',
        workspaceRootPath,
        projectId,
        stageId: 'project-boundary-conditions',
        ...(parentSessionId ? { parentSessionId } : {}),
        projectBoundaryData: packFromForm(projectId, form, sources, packData),
      })
      toast.success(form.confirm ? '边界条件已确认，可作为组价围栏' : '边界条件草稿已保存')
      onOpenChange(false)
      onSaved?.()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error))
    } finally {
      setSaving(false)
    }
  }

  const selectedKb = new Set(sources.filter((source) => source.kind === 'knowledge_standard').map((source) => source.knowledgeSlug).filter(Boolean))
  const selectedSpecs = new Set(sources.filter((source) => source.kind === 'tender_spec_binding').map((source) => source.documentId).filter(Boolean))

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>项目边界条件 · 登记与确认</DialogTitle>
        </DialogHeader>
        {loading ? (
          <p className="text-sm text-muted-foreground">加载中…</p>
        ) : (
          <div className="grid gap-4 py-2">
            <p className="text-xs text-muted-foreground">
              面板只登记和确认围栏。招标资料已在解析阶段登记，这里只选企业知识库、勾选本标规范、上传投标人自有文件；主会话再派子会话解析进 `project_boundary`，作为组价 brief 的硬围栏。
            </p>

            <section className="grid gap-2 rounded-md border p-3">
              <h3 className="text-sm font-medium">企业规范库</h3>
              {knowledgeSources.length === 0 ? (
                <p className="text-xs text-muted-foreground">当前工作区没有知识库条目。请先在知识库中选用已有规范，不必在此入库。</p>
              ) : (
                <div className="grid max-h-40 gap-1 overflow-y-auto text-sm">
                  {knowledgeSources.map((source) => (
                    <label key={source.config.slug} className="flex items-start gap-2">
                      <input
                        type="checkbox"
                        className="mt-1"
                        checked={selectedKb.has(source.config.slug)}
                        onChange={(event) => handleToggleKnowledge(source, event.target.checked)}
                      />
                      <span>
                        {source.config.name}
                        <span className="ml-1 text-xs text-muted-foreground">
                          {source.config.slug}
                          {knowledgePath(source) ? ' · 将解析文件' : ' · 仅引用条目'}
                        </span>
                      </span>
                    </label>
                  ))}
                </div>
              )}
            </section>

            <section className="grid gap-2 rounded-md border p-3">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-medium">投标人自有文件</h3>
                <Button type="button" variant="outline" size="sm" disabled={saving} onClick={() => void handleAddBidderFiles()}>
                  添加 Excel / Word / PDF
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">设备、队伍、营地、历史价、组织机构等。不要写入项目招标资料清单。</p>
              {sources.filter((source) => source.kind === 'bidder_resource').length === 0 ? (
                <p className="text-xs text-muted-foreground">尚未登记自有文件。</p>
              ) : (
                <ul className="grid gap-1 text-sm">
                  {sources.filter((source) => source.kind === 'bidder_resource').map((source) => (
                    <li key={sourceKey(source)} className="flex items-center justify-between gap-2">
                      <span className="truncate" title={source.path}>{source.title}</span>
                      <Button type="button" variant="ghost" size="sm" onClick={() => removeSource(source)}>移除</Button>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <section className="grid gap-2 rounded-md border p-3">
              <h3 className="text-sm font-medium">本标规范（解析阶段已登记，不再扫招标包）</h3>
              {suggestedSpecs.length === 0 ? (
                <p className="text-xs text-muted-foreground">暂无规范/合同类招标文件可勾选。可先完成招标文件解析。</p>
              ) : (
                <div className="grid max-h-32 gap-1 overflow-y-auto text-sm">
                  {suggestedSpecs.map((spec) => (
                    <label key={spec.documentId} className="flex items-start gap-2">
                      <input
                        type="checkbox"
                        className="mt-1"
                        checked={selectedSpecs.has(spec.documentId)}
                        onChange={(event) => handleToggleSpec(spec, event.target.checked)}
                      />
                      <span>{spec.title}<span className="ml-1 text-xs text-muted-foreground">{spec.kind}</span></span>
                    </label>
                  ))}
                </div>
              )}
            </section>

            <section className="grid gap-2 rounded-md border p-3">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-medium">解析状态</h3>
                <Button type="button" variant="outline" size="sm" disabled={saving} onClick={() => void handleRegisterSources().then(() => toast.success('已登记界限来源'))}>
                  登记来源
                </Button>
              </div>
              {sources.length === 0 ? (
                <p className="text-xs text-muted-foreground">尚未登记围栏来源。可只填大纲后确认（组价围栏将偏弱），建议至少选知识库或自有文件。</p>
              ) : (
                <ul className="grid gap-1 text-xs">
                  {sources.map((source) => (
                    <li key={sourceKey(source)}>
                      [{source.kind}/{source.role ?? '—'}] {source.title} · {source.parseStatus ?? 'registered'}
                    </li>
                  ))}
                </ul>
              )}
              {pendingParse && (
                <p className="text-xs text-amber-700">有文件仍待解析。请在工作台对本阶段点「进入阶段 / 下一步」派发子会话，完成后再确认。</p>
              )}
            </section>

            <label className="grid gap-1 text-xs">
              管辖区预设
              <select
                className="h-9 rounded-md border bg-background px-2 text-sm"
                value={form.profileId}
                onChange={(event) => {
                  const profileId = event.target.value
                  update('profileId', profileId)
                  if (profileId === 'sa-sanral-highway') {
                    setForm((current) => ({
                      ...current,
                      profileId,
                      currency: current.currency === 'USD' ? 'ZAR' : current.currency,
                      countryCode: current.countryCode || 'ZA',
                      pricingStandard: 'c51_pure_direct_cost_v1',
                      measurementId: 'coto-measurement-payment',
                      measurementTitle: current.measurementTitle || 'COTO measurement & payment',
                      vatTreatment: 'exclusive',
                    }))
                  }
                }}
              >
                <option value="generic-international">generic-international</option>
                <option value="sa-sanral-highway">sa-sanral-highway</option>
              </select>
            </label>
            <div className="grid grid-cols-2 gap-3">
              <label className="grid gap-1 text-xs">
                币种
                <Input value={form.currency} onChange={(e) => update('currency', e.target.value)} />
              </label>
              <label className="grid gap-1 text-xs">
                国家码
                <Input value={form.countryCode} onChange={(e) => update('countryCode', e.target.value)} placeholder="ISO alpha-2" />
              </label>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <label className="grid gap-1 text-xs">
                计量标准 ID
                <Input value={form.measurementId} onChange={(e) => update('measurementId', e.target.value)} />
              </label>
              <label className="grid gap-1 text-xs">
                计量标准名称
                <Input value={form.measurementTitle} onChange={(e) => update('measurementTitle', e.target.value)} />
              </label>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <label className="grid gap-1 text-xs">
                pricingStandard
                <Input value={form.pricingStandard} onChange={(e) => update('pricingStandard', e.target.value)} />
              </label>
              <label className="grid gap-1 text-xs">
                税 / VAT 口径
                <Input value={form.vatTreatment} onChange={(e) => update('vatTreatment', e.target.value)} />
              </label>
            </div>
            <label className="grid gap-1 text-xs">
              费率询价地点
              <Input value={form.rateLocation} onChange={(e) => update('rateLocation', e.target.value)} />
            </label>
            <label className="grid gap-1 text-xs">
              组织策划大纲（必填，建议 ≥80 字）
              <Textarea
                rows={6}
                value={form.organizationOutline}
                onChange={(e) => update('organizationOutline', e.target.value)}
              />
            </label>
            <label className="grid gap-1 text-xs">
              投标人自有资源（可与解析抽出的设备/人员合并）
              <Textarea
                rows={4}
                value={form.bidderResources}
                onChange={(e) => update('bidderResources', e.target.value)}
              />
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={form.confirm}
                disabled={pendingParse}
                onChange={(e) => update('confirm', e.target.checked)}
              />
              人工确认本边界可作为组价硬围栏
            </label>
          </div>
        )}
        <DialogFooter className="gap-2 sm:gap-2">
          <Button type="button" variant="outline" disabled={saving || loading} onClick={() => void handleSuggest()}>
            生成建议草稿
          </Button>
          <Button type="button" variant="ghost" disabled={saving} onClick={() => onOpenChange(false)}>
            取消
          </Button>
          <Button type="button" disabled={saving || loading} onClick={() => void handleSave()}>
            {saving ? '保存中…' : form.confirm ? '确认保存' : '保存草稿'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
