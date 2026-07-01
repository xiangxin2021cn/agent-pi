import type { ProjectMemorySessionStatusResult } from '../../../shared/types'

export interface ProjectMemoryTelemetryResetAction {
  enabled: boolean
  labelKey: string
  defaultLabel: string
}

export function getProjectMemoryTelemetryResetAction(options: {
  status: ProjectMemorySessionStatusResult | null
  isResetting: boolean
}): ProjectMemoryTelemetryResetAction {
  if (options.isResetting) {
    return {
      enabled: false,
      labelKey: 'sessionInfo.projectMemoryResettingTelemetry',
      defaultLabel: 'Resetting learned quality telemetry...',
    }
  }

  return {
    enabled: options.status?.status === 'lite_ready',
    labelKey: 'sessionInfo.projectMemoryResetTelemetry',
    defaultLabel: 'Reset learned quality telemetry',
  }
}
