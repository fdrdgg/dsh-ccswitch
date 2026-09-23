import assert from 'node:assert/strict'
import test from 'node:test'
import { mapStopReason } from '../src/stream.ts'

function assistant(stopReason, content = [{ type: 'text', text: 'hello' }], errorMessage) {
  return {
    role: 'assistant',
    content,
    api: 'anthropic-messages',
    provider: 'ccswitch/claude/test',
    model: 'test-model',
    usage: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    stopReason,
    ...errorMessage === undefined ? {} : { errorMessage },
    timestamp: 0,
  }
}

test('maps every terminal pi-ai stop reason onto a harness finish reason', () => {
  assert.deepEqual(mapStopReason(assistant('stop')), { kind: 'stop' })
  assert.deepEqual(mapStopReason(assistant('length')), { kind: 'max-tokens' })
  assert.deepEqual(mapStopReason(assistant('toolUse')), { kind: 'tool-calls' })
  assert.deepEqual(mapStopReason(assistant('aborted')), {
    kind: 'aborted',
    failure: { message: 'pi-ai stream aborted', code: 'ABORTED' },
  })
  assert.deepEqual(mapStopReason(assistant('error', [{ type: 'text', text: 'x' }], 'boom')), {
    kind: 'error',
    failure: { message: 'boom', code: 'PI_AI_ERROR' },
  })
})

test('reports a terminal stop with no content as an empty response, not success', () => {
  const reason = mapStopReason(assistant('stop', []))
  assert.equal(reason.kind, 'error')
  assert.equal(reason.failure.code, 'EMPTY_RESPONSE')
})

// pi-ai 0.83 added the pre-terminal `pending` placeholder and the terminal
// `deferred` state to StopReason. Neither can be represented as a completed
// harness turn, so both must surface as non-retryable failures instead of
// silently reporting success or falling through the switch.
test('maps the pi-ai pending placeholder to a non-retryable failure', () => {
  const reason = mapStopReason(assistant('pending'))
  assert.deepEqual(reason, {
    kind: 'error',
    failure: { message: 'pi-ai stream for model "test-model" ended pending', code: 'PI_AI_ERROR' },
  })
})

test('maps an unsupported pi-ai deferred response to a non-retryable failure', () => {
  const reason = mapStopReason(assistant('deferred'))
  assert.deepEqual(reason, {
    kind: 'error',
    failure: { message: 'pi-ai deferred response for model "test-model" is not supported', code: 'PI_AI_ERROR' },
  })
})
