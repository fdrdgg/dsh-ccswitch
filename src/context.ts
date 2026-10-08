/**
 * Harness request-history conversion into pi-ai's Context vocabulary.
 *
 * @module dsh-llm-pi-ai/context
 */

import { ToolCallId, contentHasImage, LlmError } from '@deepseek-ai/dsh-llm'
import type { ContentBlock, GenerateOptions, RequestMessage } from '@deepseek-ai/dsh-llm'
import type { AttachmentStore } from '@deepseek-ai/dsh-attachment'
import type { Context as PiContext, ImageContent, Message as PiMessage, TextContent, Tool as PiTool } from '@earendil-works/pi-ai'
import { toPiAssistant } from './replay.ts'

/** One harness tool-role message: a first-class result rather than a content block. */
type HarnessToolResult = Extract<RequestMessage, { role: 'tool' }>

/** Anything carrying harness content blocks (durable messages and one-shot user input). */
interface HasContent {
  readonly content: readonly ContentBlock[]
}

/** Join the text blocks of a harness message. */
function flattenText(message: HasContent): string {
  return message.content
    .filter(block => block.type === 'text')
    .map(block => block.text)
    .join('')
}

/**
 * Reject history pi-ai cannot represent before any conversion work happens.
 *
 * `developer` carries tool add/remove deltas that pi-ai's transcript vocabulary
 * has no room for, and only user/tool roles may hold images.
 */
function assertSupportedHistory(messages: readonly RequestMessage[]): void {
  for (const message of messages) {
    if (message.role === 'developer') {
      throw new LlmError('Developer messages are not supported yet', 'UNSUPPORTED_CONTENT')
    }
    if (message.content.some(block => block.type === 'tool-addition' || block.type === 'tool-removal')) {
      throw new LlmError('Tool-change blocks require developer role', 'UNSUPPORTED_CONTENT')
    }
    if (message.role !== 'user' && message.role !== 'tool' && contentHasImage(message.content)) {
      throw new LlmError(`pi-ai cannot represent an image in an in-history ${message.role} message`, 'UNSUPPORTED_CONTENT')
    }
  }
}

/**
 * Select the pi-ai `systemPrompt` source shared by both conversion paths.
 *
 * An explicit `options.system` (one-shot callers) wins and every history message
 * still converts. Otherwise a leading `system` history message supplies the
 * prompt and leaves the converted history; empty leading text sends no prompt.
 */
function splitSystemPrompt(options: GenerateOptions): {
  systemPrompt: string | undefined
  messages: readonly RequestMessage[]
} {
  if (options.system !== undefined) return { systemPrompt: options.system, messages: options.messages }
  const [first, ...rest] = options.messages
  if (first?.role !== 'system') return { systemPrompt: undefined, messages: options.messages }
  const text = flattenText(first)
  return { systemPrompt: text.length > 0 ? text : undefined, messages: rest }
}

async function userContent(
  blocks: readonly ContentBlock[],
  attachments: AttachmentStore,
): Promise<string | (TextContent | ImageContent)[]> {
  const content: (TextContent | ImageContent)[] = []
  for (const block of blocks) {
    switch (block.type) {
      case 'text':
        if (block.text.length > 0) content.push({ type: 'text', text: block.text })
        break
      case 'image': {
        const stored = await attachments.readImage(block.attachment)
        content.push({
          type: 'image',
          data: Buffer.from(stored.data).toString('base64'),
          mimeType: stored.ref.mediaType,
        })
        break
      }
      default:
        // Other merge-extensible blocks are not user-input vocabulary for pi-ai.
        break
    }
  }
  if (content.every(block => block.type === 'text')) return content.map(block => block.text).join('')
  return content
}

function toolsOf(options: GenerateOptions): PiTool[] | undefined {
  if (options.tools?.some(tool => tool.deferLoading === true)) {
    throw new LlmError('Deferred tool loading is not supported yet', 'UNSUPPORTED_CONTENT')
  }
  return options.tools?.map(tool => ({
    name: tool.name,
    description: tool.description,
    // ToolSchema.parameters is a JSON Schema object; pi-ai's TSchema
    // (TypeBox) is structurally JSON Schema, so it assigns directly.
    parameters: tool.parameters,
  }))
}

/** Assemble the request-level pi-ai context envelope shared by both conversion paths. */
function piContext(systemPrompt: string | undefined, options: GenerateOptions, messages: PiMessage[]): PiContext {
  const tools = toolsOf(options)
  return {
    ...systemPrompt !== undefined ? { systemPrompt } : {},
    messages,
    ...tools !== undefined && tools.length > 0 ? { tools } : {},
  }
}

/** Recover the pi-ai toolResult message for one harness tool-role message. */
function toolResultOf(
  message: HarnessToolResult,
  toolNames: Map<ToolCallId, string>,
  content: string | (TextContent | ImageContent)[],
): PiMessage {
  return {
    role: 'toolResult',
    toolCallId: message.toolCallId,
    toolName: toolNames.get(message.toolCallId) ?? 'unknown',
    content: typeof content === 'string' ? [{ type: 'text', text: content || '(no output)' }] : content,
    isError: message.isError ?? false,
    timestamp: 0,
  }
}

/**
 * Append the system and assistant roles both context builders treat identically.
 * pi-ai has a single systemPrompt slot, so an in-history system message is folded
 * into a user message to preserve order.
 * @returns true when the message was consumed.
 */
function appendSystemOrAssistant(
  message: RequestMessage,
  messages: PiMessage[],
  toolNames: Map<ToolCallId, string>,
  onReplayDegrade?: (reason: string) => void,
): boolean {
  if (message.role === 'system') {
    messages.push({ role: 'user', content: flattenText(message), timestamp: 0 })
    return true
  }
  if (message.role === 'assistant') {
    const assistant = toPiAssistant(message, onReplayDegrade)
    for (const block of assistant.content) {
      if (block.type === 'toolCall') toolNames.set(ToolCallId(block.id), block.name)
    }
    messages.push(assistant)
    return true
  }
  return false
}

function textOnlyContext(options: GenerateOptions, onReplayDegrade?: (reason: string) => void): PiContext {
  assertSupportedHistory(options.messages)
  const split = splitSystemPrompt(options)
  const toolNames = new Map<ToolCallId, string>()
  const messages: PiMessage[] = []
  for (const message of split.messages) {
    if (contentHasImage(message.content)) {
      throw new LlmError('pi-ai image conversion requires the durable attachment service', 'UNSUPPORTED_CONTENT')
    }
    if (appendSystemOrAssistant(message, messages, toolNames, onReplayDegrade)) continue
    if (message.role === 'tool') {
      messages.push(toolResultOf(message, toolNames, flattenText(message)))
      continue
    }
    messages.push({ role: 'user', content: flattenText(message), timestamp: 0 })
  }
  return piContext(split.systemPrompt, options, messages)
}

/**
 * Convert text-only harness history to a synchronous pi-ai Context. Tool
 * result names are recovered from preceding assistant tool calls.
 * @param options - the harness request; a leading `system` message or `options.system` supplies the prompt.
 * @param attachments - absent; selects the synchronous conversion.
 * @param onReplayDegrade - forwarded to {@link toPiAssistant} for each assistant message.
 * @returns the pi-ai context; `tools` is omitted when the request declares none.
 */
export function toPiContext(
  options: GenerateOptions,
  attachments?: undefined,
  onReplayDegrade?: (reason: string) => void,
): PiContext
/**
 * Convert harness history to a pi-ai Context while resolving durable images.
 * Tool result names are recovered from preceding assistant tool calls.
 * @param options - the harness request; a leading `system` message or `options.system` supplies the prompt.
 * @param attachments - durable byte resolver for image references.
 * @param onReplayDegrade - forwarded to {@link toPiAssistant} for each assistant message.
 * @returns the asynchronously resolved pi-ai context.
 */
export function toPiContext(
  options: GenerateOptions,
  attachments: AttachmentStore,
  onReplayDegrade?: (reason: string) => void,
): Promise<PiContext>
export function toPiContext(
  options: GenerateOptions,
  attachments?: AttachmentStore,
  onReplayDegrade?: (reason: string) => void,
): PiContext | Promise<PiContext> {
  return attachments === undefined
    ? textOnlyContext(options, onReplayDegrade)
    : toPiContextWithImages(options, attachments, onReplayDegrade)
}

async function toPiContextWithImages(
  options: GenerateOptions,
  attachments: AttachmentStore,
  onReplayDegrade?: (reason: string) => void,
): Promise<PiContext> {
  assertSupportedHistory(options.messages)
  const split = splitSystemPrompt(options)
  const toolNames = new Map<ToolCallId, string>()
  const messages: PiMessage[] = []

  for (const message of split.messages) {
    if (appendSystemOrAssistant(message, messages, toolNames, onReplayDegrade)) continue
    const content = await userContent(message.content, attachments)
    if (message.role === 'tool') {
      messages.push(toolResultOf(message, toolNames, content))
      continue
    }
    messages.push({ role: 'user', content, timestamp: 0 })
  }

  return piContext(split.systemPrompt, options, messages)
}
