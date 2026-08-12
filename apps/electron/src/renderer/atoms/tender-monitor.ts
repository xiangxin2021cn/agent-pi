import { atom } from 'jotai'

/**
 * Project-scoped live tender monitor. Survives Overview↔Chat navigation so
 * resume polling / dispatch fill-up continues while the user reads the main session.
 */
export interface TenderLiveMonitorState {
  moduleId: 'tender'
  workspaceRootPath: string
  projectId: string
  active: boolean
  /**
   * When true, background ticks only inspect status — no resume fill-up /
   * continue / spawn. Stage boards should also have dispatchEnabled=false.
   */
  dispatchPaused?: boolean
  /** ISO timestamp of last successful resume/status tick. */
  lastTickAt?: number
}

export const tenderLiveMonitorAtom = atom<TenderLiveMonitorState | null>(null)

export function isTenderMonitorActiveFor(
  state: TenderLiveMonitorState | null,
  projectId: string,
  workspaceRootPath?: string,
): boolean {
  if (!state?.active) return false
  if (state.projectId !== projectId) return false
  if (workspaceRootPath && state.workspaceRootPath !== workspaceRootPath) return false
  return true
}
