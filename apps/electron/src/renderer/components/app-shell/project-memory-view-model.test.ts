import { describe, expect, it } from 'bun:test'
import { getProjectMemoryTelemetryResetAction } from './project-memory-view-model'

describe('project memory view model', () => {
  it('enables telemetry reset only when Project Memory Lite is ready', () => {
    expect(getProjectMemoryTelemetryResetAction({
      status: { status: 'lite_ready', message: 'ready' },
      isResetting: false,
    })).toMatchObject({
      enabled: true,
      labelKey: 'sessionInfo.projectMemoryResetTelemetry',
    })

    expect(getProjectMemoryTelemetryResetAction({
      status: { status: 'not_initialized', message: 'not ready' },
      isResetting: false,
    })).toMatchObject({ enabled: false })
  })

  it('disables telemetry reset while reset is running', () => {
    expect(getProjectMemoryTelemetryResetAction({
      status: { status: 'lite_ready', message: 'ready' },
      isResetting: true,
    })).toMatchObject({
      enabled: false,
      labelKey: 'sessionInfo.projectMemoryResettingTelemetry',
    })
  })
})
