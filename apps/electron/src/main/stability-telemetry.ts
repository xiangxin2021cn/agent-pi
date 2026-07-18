type MemoryUsageLike = NodeJS.MemoryUsage

interface ProcessMetricLike {
  pid?: number
  type?: string
  name?: string
  memory?: {
    workingSetSize?: number
    peakWorkingSetSize?: number
    privateBytes?: number
    sharedBytes?: number
  }
}

interface AppMetricsProvider {
  getAppMetrics?: () => ProcessMetricLike[]
}

export interface StabilityAppMetricsSummary {
  processCount: number
  totalWorkingSetKb: number
  totalPrivateBytes: number
  byType: Array<{
    type: string
    count: number
    workingSetKb: number
    privateBytes: number
  }>
  topProcesses: Array<{
    pid?: number
    type: string
    name?: string
    workingSetKb: number
    privateBytes: number
  }>
}

export function shouldLogMemoryPeak(previousPeakKb: number, currentTotalWorkingSetKb: number, thresholdKb = 128 * 1024): boolean {
  if (!Number.isFinite(currentTotalWorkingSetKb) || currentTotalWorkingSetKb <= 0) return false
  if (!Number.isFinite(previousPeakKb) || previousPeakKb <= 0) return true
  return currentTotalWorkingSetKb >= previousPeakKb + thresholdKb
}

export function summarizeAppMetrics(metrics: ProcessMetricLike[]): StabilityAppMetricsSummary {
  const byType = new Map<string, { type: string; count: number; workingSetKb: number; privateBytes: number }>()
  let totalWorkingSetKb = 0
  let totalPrivateBytes = 0

  for (const metric of metrics) {
    const type = metric.type || 'unknown'
    const workingSetKb = Number(metric.memory?.workingSetSize ?? 0)
    const privateBytes = Number(metric.memory?.privateBytes ?? 0)
    totalWorkingSetKb += workingSetKb
    totalPrivateBytes += privateBytes

    const current = byType.get(type) ?? { type, count: 0, workingSetKb: 0, privateBytes: 0 }
    current.count += 1
    current.workingSetKb += workingSetKb
    current.privateBytes += privateBytes
    byType.set(type, current)
  }

  return {
    processCount: metrics.length,
    totalWorkingSetKb,
    totalPrivateBytes,
    byType: Array.from(byType.values()).sort((a, b) => b.workingSetKb - a.workingSetKb),
    topProcesses: metrics
      .map((metric) => ({
        pid: metric.pid,
        type: metric.type || 'unknown',
        name: metric.name,
        workingSetKb: Number(metric.memory?.workingSetSize ?? 0),
        privateBytes: Number(metric.memory?.privateBytes ?? 0),
      }))
      .sort((a, b) => b.workingSetKb - a.workingSetKb)
      .slice(0, 12),
  }
}

export async function createStabilitySnapshot(app: AppMetricsProvider, label: string, extra?: unknown) {
  const processMemory = process.memoryUsage() as MemoryUsageLike
  const processWithElectronMemory = process as typeof process & {
    getProcessMemoryInfo?: () => Promise<unknown>
  }
  let processMemoryInfo: unknown = null
  try {
    processMemoryInfo = typeof processWithElectronMemory.getProcessMemoryInfo === 'function'
      ? await processWithElectronMemory.getProcessMemoryInfo()
      : null
  } catch (error) {
    processMemoryInfo = { error: error instanceof Error ? error.message : String(error) }
  }

  let metrics: ProcessMetricLike[] = []
  try {
    metrics = typeof app.getAppMetrics === 'function' ? app.getAppMetrics() : []
  } catch {
    metrics = []
  }

  return {
    timestamp: new Date().toISOString(),
    label,
    process: {
      pid: process.pid,
      platform: process.platform,
      arch: process.arch,
      node: process.versions.node,
      electron: process.versions.electron,
      chrome: process.versions.chrome,
    },
    mainProcessMemory: {
      rssBytes: processMemory.rss,
      heapTotalBytes: processMemory.heapTotal,
      heapUsedBytes: processMemory.heapUsed,
      externalBytes: processMemory.external,
      arrayBuffersBytes: processMemory.arrayBuffers,
    },
    processMemoryInfo,
    appMetrics: summarizeAppMetrics(metrics),
    ...(extra !== undefined ? { extra } : {}),
  }
}
