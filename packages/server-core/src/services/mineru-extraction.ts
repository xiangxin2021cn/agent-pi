import { spawn } from 'node:child_process'
import {
  buildMineruJsonArgs,
  buildMineruMarkdownArgs,
  type MineruTextExtractionFormat,
} from '@craft-agent/shared/document-extraction/mineru'
import type { WorkspaceMineruExtractionMode } from '@craft-agent/shared/workspaces'

const DEFAULT_TIMEOUT_MS = 120_000
const MAX_TEXT_OUTPUT_BYTES = 20 * 1024 * 1024
const STDERR_PREVIEW_CHARS = 4_000

export interface MineruTextExtractionOptions {
  commandPath: string
  inputPath: string
  token: string
  mode?: WorkspaceMineruExtractionMode
  timeoutMs?: number
}

export type MineruMarkdownExtractionOptions = MineruTextExtractionOptions
export type MineruJsonExtractionOptions = MineruTextExtractionOptions

export async function extractMarkdownWithMineru(options: MineruMarkdownExtractionOptions): Promise<string> {
  return extractTextWithMineru(options, 'md')
}

export async function extractJsonWithMineru(options: MineruJsonExtractionOptions): Promise<string> {
  const content = await extractTextWithMineru(options, 'json')
  try {
    JSON.parse(content)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    throw new Error(`MinerU extraction returned invalid JSON: ${message}`)
  }
  return content
}

async function extractTextWithMineru(
  options: MineruTextExtractionOptions,
  format: MineruTextExtractionFormat,
): Promise<string> {
  const args = format === 'json'
    ? buildMineruJsonArgs(options.inputPath, options.mode)
    : buildMineruMarkdownArgs(options.inputPath, options.mode)
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS

  return new Promise((resolve, reject) => {
    const child = spawn(options.commandPath, args, {
      env: {
        ...process.env,
        MINERU_TOKEN: options.token,
      },
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    })

    const stdoutChunks: Buffer[] = []
    const stderrChunks: Buffer[] = []
    let stdoutBytes = 0
    let settled = false

    const finish = (error?: Error, content?: string) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      if (error) {
        reject(error)
      } else {
        resolve(content ?? '')
      }
    }

    const timer = setTimeout(() => {
      child.kill()
      finish(new Error(`MinerU extraction timed out after ${timeoutMs}ms`))
    }, timeoutMs)

    child.stdout?.on('data', (chunk: Buffer) => {
      stdoutBytes += chunk.length
      if (stdoutBytes > MAX_TEXT_OUTPUT_BYTES) {
        child.kill()
        finish(new Error(`MinerU ${format} output exceeded ${MAX_TEXT_OUTPUT_BYTES} bytes`))
        return
      }
      stdoutChunks.push(chunk)
    })

    child.stderr?.on('data', (chunk: Buffer) => {
      stderrChunks.push(chunk)
    })

    child.on('error', (error) => {
      finish(error)
    })

    child.on('close', (code) => {
      if (settled) return
      const stderr = Buffer.concat(stderrChunks).toString('utf-8').trim()
      if (code !== 0) {
        const detail = stderr ? `: ${stderr.slice(0, STDERR_PREVIEW_CHARS)}` : ''
        finish(new Error(`MinerU extraction failed with exit code ${code}${detail}`))
        return
      }

      const content = Buffer.concat(stdoutChunks).toString('utf-8')
      if (!content.trim()) {
        const detail = stderr ? `: ${stderr.slice(0, STDERR_PREVIEW_CHARS)}` : ''
        finish(new Error(`MinerU extraction returned empty ${format}${detail}`))
        return
      }
      finish(undefined, content)
    })
  })
}
