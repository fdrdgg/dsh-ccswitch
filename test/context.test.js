import assert from 'node:assert/strict'
import test from 'node:test'
import { toPiContext } from '../src/context.ts'

const SYSTEM = {
  id: 'm-system',
  role: 'system',
  content: [{ type: 'text', text: 'You are a helpful agent.' }],
  source: { kind: 'system-prompt' },
}

const USER = {
  id: 'm-user',
  role: 'user',
  content: [{ type: 'text', text: 'list the files' }],
  source: { kind: 'user' },
}

const ASSISTANT = {
  id: 'm-assistant',
  role: 'assistant',
  content: [{ type: 'tool-call', id: 'call-1', name: 'bash', arguments: '{"command":"ls"}' }],
  source: { kind: 'model', provider: 'ccswitch/claude/test', model: 'test-model' },
}

const TOOL = {
  id: 'm-tool',
  role: 'tool',
  content: [{ type: 'text', text: 'a.txt\nb.txt' }],
  source: { kind: 'tool', callId: 'call-1' },
  toolCallId: 'call-1',
  isError: false,
}

function options(messages, extra = {}) {
  return { provider: 'ccswitch/claude/test', model: 'test-model', messages, ...extra }
}

// DSH 0.2 made tool results first-class `role: 'tool'` messages instead of
// `tool-result` content blocks, and moved the system prompt into a leading
// `system` history message rather than a separate request field.
test('promotes a leading system message to the pi-ai systemPrompt slot', () => {
  const context = toPiContext(options([SYSTEM, USER]))

  assert.equal(context.systemPrompt, 'You are a helpful agent.')
  assert.equal(context.messages.length, 1)
  assert.equal(context.messages[0].role, 'user')
  assert.equal(context.messages[0].content, 'list the files')
})

test('lets an explicit options.system win while still converting the leading system message', () => {
  const context = toPiContext(options([SYSTEM, USER], { system: 'override' }))

  assert.equal(context.systemPrompt, 'override')
  assert.equal(context.messages.length, 2)
  assert.deepEqual(context.messages[0], { role: 'user', content: 'You are a helpful agent.', timestamp: 0 })
})

test('converts a tool-role message to a pi-ai toolResult and recovers the tool name', () => {
  const context = toPiContext(options([USER, ASSISTANT, TOOL]))

  const result = context.messages.at(-1)
  assert.equal(result.role, 'toolResult')
  assert.equal(result.toolCallId, 'call-1')
  assert.equal(result.toolName, 'bash')
  assert.deepEqual(result.content, [{ type: 'text', text: 'a.txt\nb.txt' }])
  assert.equal(result.isError, false)
})

test('substitutes placeholder text for an empty tool result', () => {
  const context = toPiContext(options([
    USER,
    ASSISTANT,
    { ...TOOL, content: [] },
  ]))

  assert.deepEqual(context.messages.at(-1).content, [{ type: 'text', text: '(no output)' }])
})

// pi-ai has no vocabulary for developer tool-delta messages; failing loudly
// beats silently dropping tool state the model may rely on.
test('rejects developer messages and tool-change blocks', () => {
  assert.throws(
    () => toPiContext(options([{ ...USER, id: 'm-dev', role: 'developer', source: { kind: 'user' } }])),
    /Developer messages are not supported yet/,
  )
  assert.throws(
    () => toPiContext(options([{ ...USER, content: [{ type: 'tool-addition', toolName: 'bash' }] }])),
    /Tool-change blocks require developer role/,
  )
})

test('rejects deferred tool loading it cannot honour', () => {
  assert.throws(
    () => toPiContext(options([USER], { tools: [{ name: 'bash', description: 'run', parameters: {}, deferLoading: true }] })),
    /Deferred tool loading is not supported yet/,
  )
})
