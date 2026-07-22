import { describe, expect, test } from 'bun:test'
import {
  classifyToolFailure,
  createToolCallSignature,
  createToolInputShape,
  createToolRecoveryRuntime,
  guardToolRetry,
  registerToolFailure,
  registerToolSuccess,
} from './tool-recovery.ts'

describe('bounded tool recovery', () => {
  test('classifies common failures into actionable categories', () => {
    expect(classifyToolFailure('Validation failed: path must have required property file_path')).toBe('invalid_input')
    expect(classifyToolFailure('Offset 2100 is beyond end of file (2004 lines total)')).toBe('range')
    expect(classifyToolFailure('ENOENT: no such file or directory')).toBe('path')
    expect(classifyToolFailure('operation timed out after 60000ms')).toBe('timeout')
    expect(classifyToolFailure('command line is too long; payload exceeds limit')).toBe('output_limit')
    expect(classifyToolFailure('401 unauthorized: API key is required')).toBe('missing_prerequisite')
  })

  test('allows one retry and blocks the same identical call after its second failure', () => {
    const runtime = createToolRecoveryRuntime()
    const input = { file_path: 'C:/secret/project/report.md', offset: 2100, limit: 100 }

    const first = registerToolFailure(runtime, {
      toolName: 'Read',
      input,
      result: 'Offset 2100 is beyond end of file (2004 lines total)',
      now: 100,
    })
    expect(first.decision).toBe('retry_allowed')
    expect(guardToolRetry(runtime, 'Read', input)).toEqual({ action: 'allow' })

    const second = registerToolFailure(runtime, {
      toolName: 'Read',
      input,
      result: 'Offset 2100 is beyond end of file (2004 lines total)',
      now: 200,
    })
    expect(second.decision).toBe('change_route')
    expect(guardToolRetry(runtime, 'Read', input)).toMatchObject({ action: 'block' })

    expect(guardToolRetry(runtime, 'Read', { ...input, offset: 1900 })).toEqual({ action: 'allow' })
  })

  test('signatures and reusable shapes do not expose paths or secrets', () => {
    const input = {
      file_path: 'C:/confidential/tender/volume-1.pdf',
      apiKey: 'sk-secret-value',
      options: { page: 4, mode: 'layout' },
    }
    const signature = createToolCallSignature('MinerU', input)
    const shape = createToolInputShape(input)

    expect(signature).not.toContain('confidential')
    expect(signature).not.toContain('sk-secret-value')
    expect(JSON.stringify(shape)).not.toContain('confidential')
    expect(JSON.stringify(shape)).not.toContain('sk-secret-value')
    expect(shape.keys).toEqual(['apiKey', 'file_path', 'options'])
  })

  test('records a recovered route only after a changed call succeeds', () => {
    const runtime = createToolRecoveryRuntime()
    registerToolFailure(runtime, {
      toolName: 'Read',
      input: { file_path: 'report.md', offset: 2100, limit: 100 },
      result: 'Offset 2100 is beyond end of file (2004 lines total)',
      now: 100,
    })

    expect(registerToolSuccess(runtime, {
      toolName: 'Read',
      input: { file_path: 'report.md', offset: 1900, limit: 100 },
      now: 200,
    })).toMatchObject({ category: 'range', failedAttempts: 1 })
    expect(registerToolSuccess(runtime, {
      toolName: 'Write',
      input: { file_path: 'report.md', content: 'ok' },
      now: 300,
    })).toBeUndefined()
  })
})

