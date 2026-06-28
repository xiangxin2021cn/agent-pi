import * as React from 'react'
import { useTranslation } from "react-i18next"
import { cn } from '@/lib/utils'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { SlashCommandMenu, DEFAULT_SLASH_COMMAND_GROUPS, type SlashCommandId } from '@/components/ui/slash-command-menu'
import { Check, CheckCircle2, ChevronDown, Info, Pencil, Plus, RotateCcw, Target, Trash2 } from 'lucide-react'
import { PERMISSION_MODE_CONFIG, type PermissionMode } from '@craft-agent/shared/agent/modes'
import type { SessionGoalMode, SessionGoalState } from '@craft-agent/shared/sessions'
import type { SessionGoalUpdate } from '@craft-agent/shared/protocol'
import type { BackgroundTask } from './ActiveTasksBar'
import { LabelIcon, LabelValueTypeIcon } from '@/components/ui/label-icon'
import { LabelValuePopover } from '@/components/ui/label-value-popover'
import type { LabelConfig } from '@craft-agent/shared/labels'
import { flattenLabels, parseLabelEntry, formatLabelEntry, formatDisplayValue } from '@craft-agent/shared/labels'
import { resolveEntityColor } from '@craft-agent/shared/colors'
import { useTheme } from '@/context/ThemeContext'
import { useDynamicStack } from '@/hooks/useDynamicStack'
import type { SessionStatus } from '@/config/session-status-config'
import { getState } from '@/config/session-status-config'
import { SessionStatusMenu } from '@/components/ui/session-status-menu'
import { MetadataBadge } from '@/components/ui/metadata-badge'
import { openLabelLink } from '@/lib/open-label-link'
import { SessionInfoPopover } from './SessionInfoPopover'
import {
  buildGoalUpdateFromDraft,
  createBlankGoalCriterionDraft,
  createGoalEditDraft,
  getGoalBadgeValue,
  getGoalLatestAuditPreview,
  getGoalManualActions,
  getGoalModeDescription,
  getGoalModeLabel,
  type GoalCriterionEditDraft,
  type GoalEditDraft,
} from './goal-status-view-model'

// ============================================================================
// Permission Mode Icon Component
// ============================================================================

function PermissionModeIcon({ mode, className }: { mode: PermissionMode; className?: string }) {
  const config = PERMISSION_MODE_CONFIG[mode]
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      <path d={config.svgPath} />
    </svg>
  )
}

export interface ActiveOptionBadgesProps {
  /** Current permission mode */
  permissionMode?: PermissionMode
  /** Callback when permission mode changes */
  onPermissionModeChange?: (mode: PermissionMode) => void
  /** Application-level goal audit state for this session */
  goalState?: SessionGoalState
  /** Callback when goal loop mode changes */
  onGoalModeChange?: (mode: SessionGoalMode) => void
  /** Callback when user accepts the current goal result */
  onGoalAccept?: () => void
  /** Callback when user requests one more goal improvement pass */
  onGoalImprove?: () => void
  /** Callback when user updates goal objective or criteria */
  onGoalUpdate?: (update: SessionGoalUpdate) => void | Promise<void>
  /** Background tasks to display */
  tasks?: BackgroundTask[]
  /** Session ID for opening preview windows */
  sessionId?: string
  /** Absolute path to the session folder (for Files header actions) */
  sessionFolderPath?: string
  /** Callback when kill button is clicked on a task */
  onKillTask?: (taskId: string) => void
  /** Callback to insert message into input field */
  onInsertMessage?: (text: string) => void
  /** Label entries applied to this session (e.g., ["bug", "priority::3"]) */
  sessionLabels?: string[]
  /** Available label configs (tree structure) for resolving label display */
  labels?: LabelConfig[]
  /** Callback when a label is removed (legacy — prefer onLabelsChange) */
  onRemoveLabel?: (labelId: string) => void
  /** Callback when session labels array changes (value edits or removals) */
  onLabelsChange?: (updatedLabels: string[]) => void
  /** Label ID whose value popover should auto-open (set when a valued label is added via # menu) */
  autoOpenLabelId?: string | null
  /** Called after the auto-open has been consumed, so the parent can clear the signal */
  onAutoOpenConsumed?: () => void
  // ── State/status badge (in dynamic stack) ──
  /** Available workflow states */
  sessionStatuses?: SessionStatus[]
  /** Current session state ID */
  currentSessionStatus?: string
  /** Callback when state changes */
  onSessionStatusChange?: (stateId: string) => void
  /** Additional CSS classes */
  className?: string
}

/** Resolved label entry: config + parsed value + original index in sessionLabels */
interface ResolvedLabelEntry {
  config: LabelConfig
  rawValue?: string
  index: number
}

export function ActiveOptionBadges({
  permissionMode = 'ask',
  onPermissionModeChange,
  goalState,
  onGoalModeChange,
  onGoalAccept,
  onGoalImprove,
  onGoalUpdate,
  tasks = [],
  sessionId,
  sessionFolderPath,
  onKillTask,
  onInsertMessage,
  sessionLabels = [],
  labels = [],
  onRemoveLabel,
  onLabelsChange,
  autoOpenLabelId,
  onAutoOpenConsumed,
  sessionStatuses = [],
  currentSessionStatus,
  onSessionStatusChange,
  className,
}: ActiveOptionBadgesProps) {
  // Resolve session label entries to their config objects + parsed values.
  // Entries may be bare IDs ("bug") or valued ("priority::3").
  // Preserves the raw value and original index for editing/removal.
  const resolvedLabels = React.useMemo((): ResolvedLabelEntry[] => {
    if (sessionLabels.length === 0 || labels.length === 0) return []
    const flat = flattenLabels(labels)
    const result: ResolvedLabelEntry[] = []
    for (let i = 0; i < sessionLabels.length; i++) {
      const parsed = parseLabelEntry(sessionLabels[i])
      const config = flat.find(l => l.id === parsed.id)
      if (config) {
        result.push({ config, rawValue: parsed.rawValue, index: i })
      }
    }
    return result
  }, [sessionLabels, labels])

  const hasLabels = resolvedLabels.length > 0

  // Resolve the current state from sessionStatuses for the badge display.
  // Every session always has a state — fall back to the default state (or 'todo')
  // when currentSessionStatus isn't explicitly set, matching SessionList's behavior.
  const effectiveStateId = currentSessionStatus || 'todo'
  const resolvedState = sessionStatuses.length > 0 ? getState(effectiveStateId, sessionStatuses) : undefined
  const hasState = !!resolvedState

  // Show the stacking container when there are labels (state badge is now rendered standalone on the left)
  const hasStackContent = hasLabels

  // Dynamic stacking with equal visible strips: ResizeObserver computes per-badge
  // margins directly on children. Wider badges get more negative margins so each
  // shows the same visible strip when stacked. No React re-renders needed.
  const stackRef = useDynamicStack({ gap: 8, minVisible: 20, reservedStart: 0 })

  // Only render if badges or tasks are active
  if (!permissionMode && tasks.length === 0 && !hasState && !hasStackContent) {
    return null
  }

  return (
    <div className={cn("flex items-start gap-2 mb-2 px-px pt-px pb-0.5", className)}>
      {/* Left side: mode → state → labels stack */}
      <div className="flex items-start gap-2 min-w-0 flex-1">
        {/* Permission Mode Badge */}
        {permissionMode && (
          <div className="shrink-0">
            <PermissionModeDropdown
              permissionMode={permissionMode}
              onPermissionModeChange={onPermissionModeChange}
              sessionId={sessionId}
            />
          </div>
        )}

        {goalState && (
          <div className="shrink-0">
            <GoalModeBadge
              goalState={goalState}
              onGoalModeChange={onGoalModeChange}
              onGoalAccept={onGoalAccept}
              onGoalImprove={onGoalImprove}
              onGoalUpdate={onGoalUpdate}
              sessionId={sessionId}
            />
          </div>
        )}

        {/* State Badge — standalone on the left, after Mode */}
        {hasState && resolvedState && (
          <div className="shrink-0">
            <StateBadge
              state={resolvedState}
              sessionStatuses={sessionStatuses}
              onSessionStatusChange={onSessionStatusChange}
              sessionId={sessionId}
            />
          </div>
        )}

        {/* Stacking container for label badges (left side).
         * useDynamicStack sets per-child marginLeft directly via ResizeObserver.
         * overflow: clip prevents scroll container while py/-my gives shadow room. */}
        {hasStackContent && (
          <div
            className="flex-1 min-w-0 max-w-full py-0.5 -my-0.5"
            style={{
              // shadow-minimal replicated as drop-shadow (traces masked alpha, no clipping).
              // Ring uses higher blur+opacity for visible border feel (hard 1px ring can't be replicated exactly).
              // Blur shadows use reduced blur+opacity to stay tight (accounting for no negative spread in drop-shadow).
              filter: 'drop-shadow(0px 0px 0.5px rgba(var(--foreground-rgb), 0.3)) drop-shadow(0px 1px 0.1px rgba(0,0,0,0.04)) drop-shadow(0px 3px 0.2px rgba(0,0,0,0.03))',
            }}
          >
            <div
              ref={stackRef}
              className="flex items-center min-w-0 py-1 -my-1"
              style={{ overflow: 'clip' }}
            >
              {/* Label badges */}
              {resolvedLabels.map(({ config, rawValue, index }) => (
                <LabelBadge
                  key={`${config.id}-${index}`}
                  label={config}
                  value={rawValue}
                  autoOpen={config.id === autoOpenLabelId}
                  onAutoOpenConsumed={onAutoOpenConsumed}
                  sessionId={sessionId}
                  onValueChange={(newValue) => {
                    // Rebuild the sessionLabels array with the updated entry
                    const updated = [...sessionLabels]
                    updated[index] = formatLabelEntry(config.id, newValue)
                    onLabelsChange?.(updated)
                  }}
                  onRemove={() => {
                    if (onLabelsChange) {
                      onLabelsChange(sessionLabels.filter((_, i) => i !== index))
                    } else {
                      onRemoveLabel?.(config.id)
                    }
                  }}
                />
              ))}
            </div>
          </div>
        )}

      </div>

      {/* Right side: Files popover button */}
      <div className="shrink-0">
        <FilesPopoverButton sessionId={sessionId} sessionFolderPath={sessionFolderPath} />
      </div>
    </div>
  )
}

// ============================================================================
// Goal Mode Badge Component
// ============================================================================

const VISIBLE_GOAL_MODES: SessionGoalMode[] = ['auto_improve', 'check_only', 'off']

function GoalModeBadge({
  goalState,
  onGoalModeChange,
  onGoalAccept,
  onGoalImprove,
  onGoalUpdate,
  sessionId,
}: {
  goalState: SessionGoalState
  onGoalModeChange?: (mode: SessionGoalMode) => void
  onGoalAccept?: () => void
  onGoalImprove?: () => void
  onGoalUpdate?: (update: SessionGoalUpdate) => void | Promise<void>
  sessionId?: string
}) {
  const { t } = useTranslation()
  const [open, setOpen] = React.useState(false)
  const [editing, setEditing] = React.useState(false)
  const [draft, setDraft] = React.useState<GoalEditDraft>(() => createGoalEditDraft(goalState))
  const activeMode = VISIBLE_GOAL_MODES.includes(goalState.mode) ? goalState.mode : 'auto_improve'
  const manualActions = React.useMemo(() => getGoalManualActions(t, goalState), [goalState, t])
  const latestAuditPreview = React.useMemo(() => getGoalLatestAuditPreview(goalState), [goalState])
  const canSaveGoal = draft.objective.trim().length > 0 && draft.criteria.some(criterion => criterion.text.trim().length > 0)
  const badgeColor = activeMode === 'off'
    ? 'var(--foreground)'
    : activeMode === 'check_only'
    ? 'var(--info)'
    : 'var(--accent)'

  const handleSelect = React.useCallback((mode: SessionGoalMode) => {
    setEditing(false)
    setOpen(false)
    onGoalModeChange?.(mode)
  }, [onGoalModeChange])

  const handleManualAction = React.useCallback((actionId: 'improve' | 'accept') => {
    setEditing(false)
    setOpen(false)
    if (actionId === 'improve') {
      onGoalImprove?.()
    } else {
      onGoalAccept?.()
    }
  }, [onGoalAccept, onGoalImprove])

  const handleOpenChange = React.useCallback((nextOpen: boolean) => {
    setOpen(nextOpen)
    if (!nextOpen) {
      setEditing(false)
    }
  }, [])

  const handleStartEdit = React.useCallback(() => {
    setDraft(createGoalEditDraft(goalState))
    setEditing(true)
  }, [goalState])

  const handleCancelEdit = React.useCallback(() => {
    setDraft(createGoalEditDraft(goalState))
    setEditing(false)
  }, [goalState])

  const updateCriterion = React.useCallback((index: number, patch: Partial<GoalCriterionEditDraft>) => {
    setDraft(current => ({
      ...current,
      criteria: current.criteria.map((criterion, currentIndex) =>
        currentIndex === index ? { ...criterion, ...patch } : criterion
      ),
    }))
  }, [])

  const removeCriterion = React.useCallback((index: number) => {
    setDraft(current => ({
      ...current,
      criteria: current.criteria.filter((_, currentIndex) => currentIndex !== index),
    }))
  }, [])

  const addCriterion = React.useCallback(() => {
    setDraft(current => ({
      ...current,
      criteria: [...current.criteria, createBlankGoalCriterionDraft()],
    }))
  }, [])

  const handleSaveEdit = React.useCallback(async () => {
    if (!canSaveGoal) return
    try {
      await onGoalUpdate?.(buildGoalUpdateFromDraft(draft))
      setEditing(false)
      setOpen(false)
    } catch {
      // Caller owns user-facing error handling; keep the editor open.
    }
  }, [canSaveGoal, draft, onGoalUpdate])

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild>
        <MetadataBadge
          label={t('sessionInfo.goal')}
          value={getGoalBadgeValue(t, goalState)}
          badgeColor={badgeColor}
          interactive
          isActive={open}
          showChevron
          icon={<Target className="h-3.5 w-3.5" />}
          className="pl-2.5"
        />
      </PopoverTrigger>
      <PopoverContent
        className={cn(
          "p-1 rounded-[8px] bg-background shadow-modal-small border border-border/60",
          editing ? "w-[360px]" : "w-[240px]"
        )}
        side="top"
        align="start"
        sideOffset={4}
        onCloseAutoFocus={(e) => {
          e.preventDefault()
          window.dispatchEvent(new CustomEvent('craft:focus-input', {
            detail: { sessionId }
          }))
        }}
      >
        {editing ? (
          <div className="space-y-2 p-1">
            <label className="block space-y-1">
              <span className="text-[11px] font-medium text-muted-foreground">{t('sessionInfo.goalObjective')}</span>
              <textarea
                value={draft.objective}
                onChange={event => setDraft(current => ({ ...current, objective: event.target.value }))}
                rows={3}
                className="w-full resize-none rounded-[6px] border border-border/70 bg-background px-2 py-1.5 text-[12px] text-foreground outline-none focus:border-accent"
              />
            </label>
            <div className="space-y-1">
              <div className="flex items-center justify-between gap-2">
                <span className="text-[11px] font-medium text-muted-foreground">{t('sessionInfo.goalCriteria')}</span>
                <button
                  type="button"
                  className="inline-flex h-6 items-center gap-1 rounded-[6px] px-1.5 text-[11px] text-muted-foreground hover:bg-foreground/5"
                  onClick={addCriterion}
                >
                  <Plus className="h-3 w-3" />
                  <span>{t('sessionInfo.goalAddCriterion')}</span>
                </button>
              </div>
              <div className="max-h-[220px] space-y-1 overflow-y-auto pr-0.5">
                {draft.criteria.map((criterion, index) => (
                  <div key={criterion.id ?? index} className="flex items-start gap-1.5">
                    <input
                      type="checkbox"
                      checked={criterion.required}
                      aria-label={t('sessionInfo.goalCriterionRequired')}
                      className="mt-2 h-3.5 w-3.5 shrink-0 accent-[var(--accent)]"
                      onChange={event => updateCriterion(index, { required: event.target.checked })}
                    />
                    <input
                      value={criterion.text}
                      onChange={event => updateCriterion(index, { text: event.target.value })}
                      className="min-w-0 flex-1 rounded-[6px] border border-border/70 bg-background px-2 py-1.5 text-[12px] text-foreground outline-none focus:border-accent"
                    />
                    <button
                      type="button"
                      aria-label={t('common.delete')}
                      className="mt-0.5 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-[6px] text-muted-foreground hover:bg-foreground/5"
                      onClick={() => removeCriterion(index)}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            </div>
            <div className="flex justify-end gap-1 border-t border-border/60 pt-2">
              <button
                type="button"
                className="h-7 rounded-[6px] px-2 text-[12px] text-muted-foreground hover:bg-foreground/5"
                onClick={handleCancelEdit}
              >
                {t('common.cancel')}
              </button>
              <button
                type="button"
                disabled={!canSaveGoal}
                className="h-7 rounded-[6px] bg-accent px-2 text-[12px] font-medium text-accent-foreground hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
                onClick={() => { void handleSaveEdit() }}
              >
                {t('common.save')}
              </button>
            </div>
          </div>
        ) : (
          <>
            {latestAuditPreview && (
              <div className="m-1 rounded-[7px] bg-foreground/[0.035] px-2 py-1.5">
                <div className="flex items-center gap-2 text-[11px] font-medium text-foreground/80">
                  <Target className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                  <span className="min-w-0 flex-1 truncate">
                    {t('sessionInfo.goalAuditIteration', { iteration: latestAuditPreview.iteration })}
                  </span>
                  <span className={cn(
                    "shrink-0",
                    latestAuditPreview.status === 'pass'
                      ? "text-success"
                      : latestAuditPreview.status === 'fail'
                      ? "text-destructive"
                      : "text-info"
                  )}>
                    {getCompactGoalAuditStatusText(t, latestAuditPreview.status)}
                  </span>
                </div>
                <div className="mt-1 line-clamp-2 text-[11px] leading-4 text-muted-foreground">
                  {latestAuditPreview.summary}
                </div>
                {latestAuditPreview.missingCriteria.length > 0 && (
                  <div className="mt-1 space-y-0.5">
                    {latestAuditPreview.missingCriteria.map((criterion, index) => (
                      <div key={`${index}-${criterion}`} className="truncate text-[11px] leading-4 text-foreground/70" title={criterion}>
                        {criterion}
                      </div>
                    ))}
                    {latestAuditPreview.hiddenMissingCriteriaCount > 0 && (
                      <div className="text-[11px] text-muted-foreground">
                        {t('sessionInfo.goalAuditMoreItems', { count: latestAuditPreview.hiddenMissingCriteriaCount })}
                      </div>
                    )}
                  </div>
                )}
                <div className="mt-1 text-[10px] text-muted-foreground">
                  {t('sessionInfo.goalAuditEvidenceCount', { count: latestAuditPreview.evidenceCount })}
                </div>
              </div>
            )}
            {VISIBLE_GOAL_MODES.map(mode => {
              const selected = mode === activeMode
              return (
                <button
                  key={mode}
                  type="button"
                  className={cn(
                    "w-full rounded-[6px] px-2 py-1.5 text-left flex items-start gap-2 text-[13px]",
                    "hover:bg-foreground/5 outline-none",
                    selected && "bg-foreground/5"
                  )}
                  onClick={() => handleSelect(mode)}
                >
                  <Target className="h-3.5 w-3.5 mt-0.5 shrink-0 text-muted-foreground" />
                  <span className="min-w-0 flex-1">
                    <span className="block font-medium text-foreground">{getGoalModeLabel(t, mode)}</span>
                    <span className="block text-xs text-muted-foreground leading-snug">{getGoalModeDescription(t, mode)}</span>
                  </span>
                  {selected && <Check className="h-3.5 w-3.5 mt-0.5 shrink-0" />}
                </button>
              )
            })}
          </>
        )}
        {!editing && goalState.mode !== 'off' && (
          <div className="mt-1 border-t border-border/60 pt-1">
            <button
              type="button"
              className={cn(
                "w-full rounded-[6px] px-2 py-1.5 text-left flex items-start gap-2 text-[13px]",
                "hover:bg-foreground/5 outline-none"
              )}
              onClick={handleStartEdit}
            >
              <Pencil className="h-3.5 w-3.5 mt-0.5 shrink-0 text-muted-foreground" />
              <span className="min-w-0 flex-1">
                <span className="block font-medium text-foreground">{t('sessionInfo.goalEditCriteria')}</span>
                <span className="block text-xs text-muted-foreground leading-snug">{t('sessionInfo.goalEditCriteriaDesc')}</span>
              </span>
            </button>
          </div>
        )}
        {!editing && manualActions.length > 0 && (
          <div className="mt-1 border-t border-border/60 pt-1">
            {manualActions.map(action => (
              <button
                key={action.id}
                type="button"
                className={cn(
                  "w-full rounded-[6px] px-2 py-1.5 text-left flex items-start gap-2 text-[13px]",
                  "hover:bg-foreground/5 outline-none"
                )}
                onClick={() => handleManualAction(action.id)}
              >
                {action.id === 'improve'
                  ? <RotateCcw className="h-3.5 w-3.5 mt-0.5 shrink-0 text-muted-foreground" />
                  : <CheckCircle2 className="h-3.5 w-3.5 mt-0.5 shrink-0 text-muted-foreground" />}
                <span className="min-w-0 flex-1">
                  <span className="block font-medium text-foreground">{action.label}</span>
                  <span className="block text-xs text-muted-foreground leading-snug">{action.description}</span>
                </span>
              </button>
            ))}
          </div>
        )}
      </PopoverContent>
    </Popover>
  )
}

function getCompactGoalAuditStatusText(
  t: ReturnType<typeof useTranslation>['t'],
  status: 'pass' | 'fail' | 'uncertain',
): string {
  switch (status) {
    case 'pass':
      return t('sessionInfo.goalAuditPass')
    case 'fail':
      return t('sessionInfo.goalAuditFail')
    case 'uncertain':
      return t('sessionInfo.goalAuditUncertain')
  }
}

// ============================================================================
// Label Badge Component
// ============================================================================

/**
 * Renders a single label badge with LabelValuePopover for editing/removal.
 * No box-shadow on the badge itself — all shadows come from the parent
 * wrapper's drop-shadow filter (traces masked alpha without clipping).
 * Shows: [color circle] [name] [· value in mono] [chevron]
 */
function LabelBadge({
  label,
  value,
  autoOpen,
  onAutoOpenConsumed,
  onValueChange,
  onRemove,
  sessionId,
}: {
  label: LabelConfig
  value?: string
  /** When true, auto-open the value popover on mount (for newly added valued labels) */
  autoOpen?: boolean
  onAutoOpenConsumed?: () => void
  onValueChange?: (newValue: string | undefined) => void
  onRemove: () => void
  sessionId?: string
}) {
  const { isDark } = useTheme()
  const [open, setOpen] = React.useState(false)

  // Auto-open the value popover when this label was just added via # menu
  // and has a valueType. Opens exactly once, then clears the signal.
  React.useEffect(() => {
    if (autoOpen && label.valueType) {
      setOpen(true)
      onAutoOpenConsumed?.()
    }
  }, [autoOpen, label.valueType, onAutoOpenConsumed])

  // Resolve label color for tinting background and text via CSS color-mix
  const resolvedColor = label.color
    ? resolveEntityColor(label.color, isDark)
    : 'var(--foreground)'

  const displayValue = value ? formatDisplayValue(value, label.valueType) : undefined

  return (
    <LabelValuePopover
      label={label}
      value={value}
      open={open}
      onOpenChange={setOpen}
      onValueChange={onValueChange}
      onRemove={onRemove}
      sessionId={sessionId}
    >
      <MetadataBadge
        label={label.name}
        value={displayValue}
        onValueClick={label.valueType === 'link' && value ? () => openLabelLink(value) : undefined}
        icon={<LabelIcon label={label} size="lg" />}
        valueHintIcon={label.valueType ? <LabelValueTypeIcon valueType={label.valueType} /> : undefined}
        badgeColor={resolvedColor}
        interactive
        isActive={open}
        showChevron
        shadow="none"
        className="relative"
      />
    </LabelValuePopover>
  )
}

// ============================================================================
// State Badge Component
// ============================================================================

/**
 * Renders the current workflow state as a badge in the dynamic stacking container.
 * Click opens a SessionStatusMenu popover for changing the state.
 * Styled consistently with label badges (h-[30px], rounded-[8px], color-mix tinting).
 */
function StateBadge({
  state,
  sessionStatuses,
  onSessionStatusChange,
  sessionId,
}: {
  state: SessionStatus
  sessionStatuses: SessionStatus[]
  onSessionStatusChange?: (stateId: string) => void
  sessionId?: string
}) {
  const { t } = useTranslation()
  const [open, setOpen] = React.useState(false)

  const handleSelect = React.useCallback((stateId: string) => {
    setOpen(false)
    onSessionStatusChange?.(stateId)
  }, [onSessionStatusChange])

  // Use the state's resolved color for tinting (same color-mix pattern as labels)
  const badgeColor = state.resolvedColor || 'var(--foreground)'
  const applyColor = state.iconColorable

  const DEFAULT_STATUS_IDS = new Set(['backlog', 'todo', 'needs-review', 'done', 'cancelled'])
  const stateLabel = DEFAULT_STATUS_IDS.has(state.id) ? t(`status.${state.id}`, state.label) : state.label

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <MetadataBadge
          label={stateLabel}
          badgeColor={badgeColor}
          interactive
          isActive={open}
          showChevron
          icon={(
            <span
              className="shrink-0 flex items-center w-3.5 h-3.5 [&>svg]:w-full [&>svg]:h-full [&>img]:w-full [&>img]:h-full [&>span]:text-xs"
              style={applyColor ? { color: state.resolvedColor } : undefined}
            >
              {state.icon}
            </span>
          )}
          className="pl-2.5"
        />
      </PopoverTrigger>
      <PopoverContent
        className="w-auto p-0 border-0 shadow-none bg-transparent"
        side="top"
        align="end"
        sideOffset={4}
        onCloseAutoFocus={(e) => {
          e.preventDefault()
          window.dispatchEvent(new CustomEvent('craft:focus-input', {
            detail: { sessionId }
          }))
        }}
      >
        <SessionStatusMenu
          activeState={state.id}
          onSelect={handleSelect}
          states={sessionStatuses}
        />
      </PopoverContent>
    </Popover>
  )
}

function FilesPopoverButton({ sessionId, sessionFolderPath }: { sessionId?: string; sessionFolderPath?: string }) {
  const { t } = useTranslation()
  const [open, setOpen] = React.useState(false)

  if (!sessionId) return null

  return (
    <SessionInfoPopover
      sessionId={sessionId}
      sessionFolderPath={sessionFolderPath}
      trigger={(
        <button
          type="button"
          className={cn(
            "h-[30px] pl-[12px] pr-[14px] text-xs font-medium rounded-[8px] flex items-center gap-1.5 shrink-0",
            "outline-none select-none transition-colors shadow-minimal",
            "hover:bg-foreground/5 data-[state=open]:bg-foreground/5",
            "bg-[color-mix(in_srgb,var(--background)_97%,var(--foreground)_3%)]",
            "text-foreground/80",
          )}
        >
          <Info className="h-3.5 w-3.5 shrink-0" />
          <span className="whitespace-nowrap">{t("common.info")}</span>
        </button>
      )}
    />
  )
}

interface PermissionModeDropdownProps {
  permissionMode: PermissionMode
  onPermissionModeChange?: (mode: PermissionMode) => void
  sessionId?: string
}

function PermissionModeDropdown({ permissionMode, onPermissionModeChange, sessionId }: PermissionModeDropdownProps) {
  const { t } = useTranslation()
  const [open, setOpen] = React.useState(false)
  // Optimistic local state - updates immediately, syncs with prop
  const [optimisticMode, setOptimisticMode] = React.useState(permissionMode)

  // Sync optimistic state when prop changes (confirmation from backend)
  React.useEffect(() => {
    setOptimisticMode(permissionMode)
  }, [permissionMode])

  const activeCommands = React.useMemo((): SlashCommandId[] => {
    return [optimisticMode as SlashCommandId]
  }, [optimisticMode])

  // Handle command selection from dropdown
  const handleSelect = React.useCallback((commandId: SlashCommandId) => {
    if (commandId === 'safe' || commandId === 'ask' || commandId === 'allow-all') {
      setOptimisticMode(commandId)
      onPermissionModeChange?.(commandId)
    }
    setOpen(false)
  }, [onPermissionModeChange])

  // Get config for current mode (use optimistic state for instant UI update)
  const config = PERMISSION_MODE_CONFIG[optimisticMode]

  // Mode-specific styling using CSS variables (theme-aware)
  // - safe (Explore): foreground at 60% opacity - subtle, read-only feel
  // - ask (Ask to Edit): info color - amber, prompts for edits
  // - allow-all (Auto): accent color - purple, full autonomy
  const modeStyles: Record<PermissionMode, { className: string; shadowVar: string }> = {
    'safe': {
      className: 'bg-foreground/5 text-foreground/60',
      shadowVar: 'var(--foreground-rgb)',
    },
    'ask': {
      className: 'bg-info/10 text-info',
      shadowVar: 'var(--info-rgb)',
    },
    'allow-all': {
      className: 'bg-accent/5 text-accent',
      shadowVar: 'var(--accent-rgb)',
    },
  }
  const currentStyle = modeStyles[optimisticMode]

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          data-tutorial="permission-mode-dropdown"
          className={cn(
            "h-[30px] pl-2.5 pr-2 text-xs font-medium rounded-[8px] flex items-center gap-1.5 shadow-tinted outline-none select-none",
            currentStyle.className
          )}
          style={{ '--shadow-color': currentStyle.shadowVar } as React.CSSProperties}
        >
          <PermissionModeIcon mode={optimisticMode} className="h-3.5 w-3.5" />
          <span>{t(`mode.${optimisticMode}`)}</span>
          <ChevronDown className="h-3.5 w-3.5 opacity-60" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        className="w-auto p-0 rounded-[8px] bg-background text-foreground shadow-modal-small"
        side="top"
        align="start"
        sideOffset={4}
        onCloseAutoFocus={(e) => {
          e.preventDefault()
          // Don't auto-focus the text input on touch devices — it pulls up the virtual keyboard
          const isTouchDevice = 'ontouchstart' in window || navigator.maxTouchPoints > 0
          if (!isTouchDevice) {
            window.dispatchEvent(new CustomEvent('craft:focus-input', {
              detail: { sessionId }
            }))
          }
        }}
      >
        <SlashCommandMenu
          commandGroups={DEFAULT_SLASH_COMMAND_GROUPS}
          activeCommands={activeCommands}
          onSelect={handleSelect}
          showFilter
        />
      </PopoverContent>
    </Popover>
  )
}
