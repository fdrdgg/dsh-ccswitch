import assert from 'node:assert/strict'
import test from 'node:test'
import { createModels } from '@earendil-works/pi-ai'
import { buildProvider } from '../src/provider.ts'

/**
 * OpenCode Go 网关（opencode.ai/zen/go）自 2025-09-05 起要求每个请求携带
 * `x-opencode-session` 头，否则返回 400 MissingSessionID。DSH 会在每个模型请求
 * 的 GenerateOptions.sessionId 里带上会话持久 id；插件需要把它透传为请求头。
 *
 * pi-ai 内置的 opencode-go provider 通过 withOpenCodeSessionHeader 包装 API 流，
 * 把 SimpleStreamOptions.sessionId 变成 x-opencode-session 头；插件对指向
 * opencode.ai 的路由也应套用同一包装。
 */

function route(baseURL, protocol = 'anthropic-messages') {
  const models = [{
    id: 'deepseek-flash',
    name: 'DeepSeek V4 Flash',
    contextWindow: 1000000,
    maxTokens: undefined,
    input: ['text', 'image'],
  }]
  return {
    provider: 'ccswitch/claude/probe',
    name: 'probe',
    baseURL,
    protocol,
    appType: 'claude',
    authKind: 'api-key',
    models,
    headers: undefined,
    settings: '{}',
    meta: '{}',
  }
}

function context() {
  return {
    systemPrompt: 'you are a probe',
    messages: [{ role: 'user', content: 'ping' }],
  }
}

async function capture(route, options) {
  let captured = null
  const original = globalThis.fetch
  globalThis.fetch = async (input, init) => {
    captured = {
      url: typeof input === 'string' ? input : input.url,
      headers: new Headers(init?.headers ?? input?.headers),
    }
    throw new Error('probe stop after capture')
  }
  try {
    const provider = buildProvider(route)
    const models = createModels()
    models.setProvider(provider)
    const model = models.getModel(route.provider, route.models[0].id)
    assert.ok(model, '模型应已注册')
    const events = models.streamSimple(model, context(), options)
    for await (const _ of events) { /* consume; fetch throws inside */ }
  } catch {
    // expected: the stubbed fetch aborts the stream
  } finally {
    globalThis.fetch = original
  }
  return captured
}

test('opencode 路由：sessionId 会变成 x-opencode-session 请求头', async () => {
  const captured = await capture(route('https://opencode.ai/zen/go'), { apiKey: 'oc_sk_test', sessionId: 'sess-123' })
  assert.ok(captured, 'fetch 应已被调用')
  assert.ok(captured.url.includes('opencode.ai'), `请求应发往 opencode：${captured.url}`)
  assert.equal(captured.headers.get('x-opencode-session'), 'sess-123')
})

test('opencode 路由：未提供 sessionId 时不应附加该头', async () => {
  const captured = await capture(route('https://opencode.ai/zen/go'), { apiKey: 'oc_sk_test' })
  assert.ok(captured, 'fetch 应已被调用')
  assert.equal(captured.headers.get('x-opencode-session'), null)
})

test('非 opencode 路由：即使有 sessionId 也不应附加 opencode 专属头', async () => {
  const captured = await capture(route('https://api.anthropic.com'), { apiKey: 'sk-ant-test', sessionId: 'sess-123' })
  assert.ok(captured, 'fetch 应已被调用')
  assert.equal(captured.headers.get('x-opencode-session'), null)
  assert.ok(captured.headers.get('x-api-key') !== null, 'anthropic 请求仍应携带 x-api-key')
})
