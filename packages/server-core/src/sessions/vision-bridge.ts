/**
 * Vision bridge for text-only chat models (DeepSeek V4 Flash/Pro).
 *
 * DeepSeek cannot accept image_url parts. When a connection enables the
 * vision bridge, attached images are sent to an OpenAI-compatible VLM
 * (Zhipu / DashScope / Ollama / …) and the answer is injected into the
 * same user turn as text. No MCP source and no extra agent tool.
 *
 * Request shape matches dsh-vision: POST {baseURL}/chat/completions with
 * an image_url content part.
 */
import { readFile, stat } from 'node:fs/promises'
import { extname } from 'node:path'
import {
  isLocalVisionEndpoint,
  type ResolvedVisionBridgeConfig,
} from '@craft-agent/shared/config'
import type { FileAttachment } from '@craft-agent/shared/protocol'

export interface VisionChatRequest {
  baseUrl: string
  apiKey: string
  model: string
  maxTokens: number
  timeoutMs: number
  maxImageBytes: number
  source: string
  question: string
  signal?: AbortSignal
  fetch?: typeof fetch
}

export interface VisionCaption {
  name: string
  text: string
}

const MIME_BY_EXT: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.bmp': 'image/bmp',
  '.tif': 'image/tiff',
  '.tiff': 'image/tiff',
  '.heic': 'image/heic',
}

const RETRIABLE = /returned (?:429|404|5\d\d)/

function redact(text: string, apiKey: string): string {
  return apiKey === '' ? text : text.replaceAll(apiKey, '***')
}

function sanitizeName(name: string): string {
  return name.replace(/[<>"]/g, '').slice(0, 200) || 'image'
}

/** Resolve a local path / URL / data URL to something the VLM endpoint accepts. */
export async function toImageUrl(source: string, maxImageBytes: number): Promise<string> {
  if (/^(https?|data):/i.test(source)) return source
  const mime = MIME_BY_EXT[extname(source).toLowerCase()]
  if (mime === undefined) {
    const supported = Object.keys(MIME_BY_EXT).join(' ')
    throw new Error(`vision-bridge: unsupported image extension in ${JSON.stringify(source)} (supported: ${supported})`)
  }
  const info = await stat(source).catch(() => {
    throw new Error(`vision-bridge: file not found: ${source}`)
  })
  if (info.size > maxImageBytes) {
    throw new Error(`vision-bridge: image is ${info.size} bytes, over the ${maxImageBytes}-byte limit`)
  }
  const bytes = await readFile(source)
  return `data:${mime};base64,${bytes.toString('base64')}`
}

export async function attachmentToImageUrl(
  attachment: Pick<FileAttachment, 'name' | 'mimeType' | 'base64' | 'path' | 'storedPath' | 'size'>,
  maxImageBytes: number,
): Promise<string> {
  if (attachment.base64) {
    const bytes = Buffer.from(attachment.base64, 'base64')
    if (bytes.length > maxImageBytes) {
      throw new Error(`vision-bridge: image ${JSON.stringify(attachment.name)} is ${bytes.length} bytes, over the ${maxImageBytes}-byte limit`)
    }
    const mime = attachment.mimeType?.startsWith('image/') ? attachment.mimeType : 'image/png'
    return `data:${mime};base64,${attachment.base64}`
  }
  const filePath = attachment.storedPath || attachment.path
  if (!filePath) {
    throw new Error(`vision-bridge: image ${JSON.stringify(attachment.name)} has no data or path`)
  }
  return toImageUrl(filePath, maxImageBytes)
}

function extractText(payload: unknown): string | undefined {
  if (typeof payload !== 'object' || payload === null) return undefined
  const choices = (payload as { choices?: unknown }).choices
  if (!Array.isArray(choices) || choices.length === 0) return undefined
  const message = (choices[0] as { message?: { content?: unknown } }).message
  const content = message?.content
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    const parts = content
      .map(part => (typeof part === 'object' && part !== null && typeof (part as { text?: unknown }).text === 'string')
        ? (part as { text: string }).text
        : '')
      .filter(text => text !== '')
    if (parts.length > 0) return parts.join('\n')
  }
  return undefined
}

function stripThink(text: string): string {
  const closed = text.replace(/<think>[\s\S]*?<\/think>/g, '')
  if (closed !== text) return closed.trim()
  if (/^\s*<think>/.test(text)) return ''
  return text.trim()
}

export function buildVisionQuestion(
  userMessage: string,
  name: string,
  index: number,
  total: number,
): string {
  const focus = userMessage.trim()
    ? `The user asked:\n${userMessage.trim()}\n\nAnswer what is needed to help with that request.`
    : 'Describe this image thoroughly.'
  const which = total > 1
    ? ` This is image ${index + 1} of ${total} (filename: ${name}).`
    : ` Filename: ${name}.`
  return `${focus}${which} Include any visible text verbatim, the overall layout, and notable details.`
}

export function injectVisionCaptions(userMessage: string, captions: VisionCaption[]): string {
  if (captions.length === 0) return userMessage
  const header = captions.length === 1
    ? 'The user attached an image. The following is a faithful visual reading of it — treat it as if you saw the image yourself.'
    : `The user attached ${captions.length} images. The following are faithful visual readings — treat them as if you saw the images yourself.`
  const blocks = captions.map(caption => (
    `<attached-image name="${sanitizeName(caption.name)}">\n${caption.text}\n</attached-image>`
  )).join('\n\n')
  return `${userMessage}\n\n${header}\n\n${blocks}`
}

export async function visionChat(request: VisionChatRequest): Promise<string> {
  const doFetch = request.fetch ?? fetch
  const url = `${request.baseUrl.replace(/\/$/, '')}/chat/completions`
  const imageUrl = await toImageUrl(request.source, request.maxImageBytes)
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), request.timeoutMs)
  const onAbort = () => controller.abort()
  if (request.signal) {
    if (request.signal.aborted) controller.abort()
    else request.signal.addEventListener('abort', onAbort, { once: true })
  }

  let response: Response
  try {
    response = await doFetch(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...request.apiKey === '' ? {} : { authorization: `Bearer ${request.apiKey}` },
      },
      body: JSON.stringify({
        model: request.model,
        max_tokens: request.maxTokens,
        messages: [{
          role: 'user',
          content: [
            { type: 'image_url', image_url: { url: imageUrl } },
            { type: 'text', text: request.question },
          ],
        }],
      }),
      signal: controller.signal,
    })
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error)
    throw new Error(redact(`vision-bridge: request to ${url} failed: ${reason}`, request.apiKey))
  } finally {
    clearTimeout(timer)
    request.signal?.removeEventListener('abort', onAbort)
  }

  const body = await response.text()
  if (!response.ok) {
    throw new Error(redact(`vision-bridge: ${url} returned ${response.status}: ${body.slice(0, 500)}`, request.apiKey))
  }
  let payload: unknown
  try {
    payload = JSON.parse(body)
  } catch {
    throw new Error(redact(`vision-bridge: ${url} returned non-JSON body: ${body.slice(0, 200)}`, request.apiKey))
  }
  const text = extractText(payload)
  if (text === undefined) {
    throw new Error(redact(`vision-bridge: no assistant text in response: ${body.slice(0, 300)}`, request.apiKey))
  }
  const cleaned = stripThink(text)
  if (cleaned === '') {
    throw new Error('vision-bridge: model returned only reasoning and no answer (try a larger vision model or raise maxTokens)')
  }
  return cleaned
}

export async function applyVisionBridgeToMessage(options: {
  message: string
  images: FileAttachment[]
  config: ResolvedVisionBridgeConfig
  apiKey: string
  signal?: AbortSignal
  fetch?: typeof fetch
}): Promise<string> {
  const { message, images, config, apiKey, signal, fetch: doFetch } = options
  if (images.length === 0) return message
  if (!apiKey && !isLocalVisionEndpoint(config.baseUrl)) {
    throw new Error(
      'vision-bridge: no vision API key. Edit this DeepSeek connection in Settings → AI, enable vision, and paste a VLM key (Zhipu glm-4.6v-flash is free at https://open.bigmodel.cn). Local Ollama needs no key.',
    )
  }

  const captions: VisionCaption[] = []
  for (let i = 0; i < images.length; i++) {
    const image = images[i]!
    const source = await attachmentToImageUrl(image, config.maxImageBytes)
    const question = buildVisionQuestion(message, image.name, i, images.length)
    let lastError: unknown
    let text: string | undefined
    for (const model of [config.model, ...config.fallbackModels]) {
      try {
        text = await visionChat({
          baseUrl: config.baseUrl,
          apiKey,
          model,
          maxTokens: config.maxTokens,
          timeoutMs: config.timeoutMs,
          maxImageBytes: config.maxImageBytes,
          source,
          question,
          signal,
          fetch: doFetch,
        })
        break
      } catch (error) {
        lastError = error
        if (!(error instanceof Error) || !RETRIABLE.test(error.message)) throw error
      }
    }
    if (text === undefined) throw lastError
    captions.push({ name: image.name, text })
  }
  return injectVisionCaptions(message, captions)
}
