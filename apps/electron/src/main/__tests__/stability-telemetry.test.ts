import { describe, expect, it } from 'bun:test'
import { shouldLogMemoryPeak, summarizeAppMetrics } from '../stability-telemetry'

describe('stability telemetry', () => {
  it('logs initial memory and significant peak increases only', () => {
    expect(shouldLogMemoryPeak(0, 1000)).toBe(true)
    expect(shouldLogMemoryPeak(1000, 1020, 128)).toBe(false)
    expect(shouldLogMemoryPeak(1000, 1128, 128)).toBe(true)
    expect(shouldLogMemoryPeak(1000, 0, 128)).toBe(false)
  })

  it('summarizes app metrics by process type and top processes', () => {
    const summary = summarizeAppMetrics([
      { pid: 1, type: 'Browser', memory: { workingSetSize: 100, privateBytes: 1000 } },
      { pid: 2, type: 'Renderer', memory: { workingSetSize: 250, privateBytes: 2000 } },
      { pid: 3, type: 'Renderer', memory: { workingSetSize: 50, privateBytes: 3000 } },
    ])

    expect(summary.processCount).toBe(3)
    expect(summary.totalWorkingSetKb).toBe(400)
    expect(summary.totalPrivateBytes).toBe(6000)
    expect(summary.byType[0]).toEqual({
      type: 'Renderer',
      count: 2,
      workingSetKb: 300,
      privateBytes: 5000,
    })
    expect(summary.topProcesses[0].pid).toBe(2)
  })
})
