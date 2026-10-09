import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  copyOfficialAnthropicFields,
  openaiResponseFormatToOutputConfig,
  applyStructuredOutput,
  stripIllegalContentFields,
  stripIllegalBodyContentFields,
  promoteContentToBlocks,
  promoteSystemToBlocks,
  canonicalizeClaudeMessagesShape,
  liftMidConversationSystemMessages,
  STABILIZED_CONTEXT_BUDGET,
} from '../../src/lib/protocol/sanitize.mjs'

test('copyOfficialAnthropicFields keeps official keys and drops client junk', () => {
  const out = copyOfficialAnthropicFields({
    model: 'claude-sonnet-5',
    messages: [],
    max_tokens: 1024,
    temperature: 1,
    system: 'hi',
    tools: [],
    // dropped keys
    settings: { foo: 1 },
    env: { BAR: 'baz' },
    user: 'u1',
    extra_body: {},
    response_format: {},
    seed: 42,
    parallel_tool_calls: true,
    reasoning_effort: 'high',
    stream_options: {},
    previous_response_id: 'r_1',
    machine_id: 'm',
    account_uuid: 'a',
  })
  assert.deepEqual(Object.keys(out).sort(), ['max_tokens', 'messages', 'model', 'system', 'temperature', 'tools'])
})

test('copyOfficialAnthropicFields drops undefined values', () => {
  const out = copyOfficialAnthropicFields({ model: 'x', temperature: undefined })
  assert.deepEqual(out, { model: 'x' })
})

test('copyOfficialAnthropicFields handles null/undefined body', () => {
  assert.deepEqual(copyOfficialAnthropicFields(null), {})
  assert.deepEqual(copyOfficialAnthropicFields(undefined), {})
})

test('openaiResponseFormatToOutputConfig converts json_schema', () => {
  const result = openaiResponseFormatToOutputConfig({
    type: 'json_schema',
    json_schema: { name: 'task', schema: { type: 'object' } },
  })
  assert.deepEqual(result, {
    format: {
      type: 'json_schema',
      schema: { type: 'object' },
      name: 'task',
    },
  })
})

test('openaiResponseFormatToOutputConfig converts json_object', () => {
  const result = openaiResponseFormatToOutputConfig({ type: 'json_object' })
  assert.deepEqual(result, {
    format: { type: 'json_schema', schema: { type: 'object' } },
  })
})

test('openaiResponseFormatToOutputConfig returns null for unknown type', () => {
  assert.equal(openaiResponseFormatToOutputConfig({ type: 'text' }), null)
  assert.equal(openaiResponseFormatToOutputConfig(null), null)
  assert.equal(openaiResponseFormatToOutputConfig(undefined), null)
})

test('stripIllegalContentFields removes annotations from text blocks', () => {
  const content = [
    { type: 'text', text: 'hello', annotations: [{ type: 'cite' }] },
    { type: 'text', text: 'world' },
  ]
  const result = stripIllegalContentFields(content)
  assert.equal(result[0].annotations, undefined)
  assert.equal(result[1].annotations, undefined)
  assert.equal(result[0].text, 'hello')
})

test('stripIllegalContentFields recurses into tool_result blocks', () => {
  const content = [
    {
      type: 'tool_result',
      tool_use_id: 't1',
      content: [{ type: 'text', text: 'ok', annotations: [{ type: 'cite' }] }],
    },
  ]
  const result = stripIllegalContentFields(content)
  assert.equal(result[0].content[0].annotations, undefined)
})

test('stripIllegalContentFields returns non-array as-is', () => {
  assert.equal(stripIllegalContentFields('hello'), 'hello')
  assert.equal(stripIllegalContentFields(null), null)
})

test('stripIllegalBodyContentFields cleans messages and system', () => {
  const body = {
    system: [{ type: 'text', text: 'sys', annotations: [] }],
    messages: [{ role: 'user', content: [{ type: 'text', text: 'hi', annotations: [] }] }],
  }
  const result = stripIllegalBodyContentFields(body)
  assert.equal(result.system[0].annotations, undefined)
  assert.equal(result.messages[0].content[0].annotations, undefined)
})

test('promoteContentToBlocks converts string to text block array', () => {
  assert.deepEqual(promoteContentToBlocks('hello'), [{ type: 'text', text: 'hello' }])
  assert.deepEqual(promoteContentToBlocks(''), [])
  assert.equal(promoteContentToBlocks(null), null)
  assert.deepEqual(promoteContentToBlocks([{ type: 'text', text: 'a' }]), [{ type: 'text', text: 'a' }])
  assert.deepEqual(promoteContentToBlocks(['str', { type: 'text', text: 'b' }]), [
    { type: 'text', text: 'str' },
    { type: 'text', text: 'b' },
  ])
})

test('promoteSystemToBlocks converts string to text block array', () => {
  assert.deepEqual(promoteSystemToBlocks('sys'), [{ type: 'text', text: 'sys' }])
  assert.equal(promoteSystemToBlocks(null), null)
  assert.equal(promoteSystemToBlocks(''), '')
  assert.deepEqual(promoteSystemToBlocks(['str', { type: 'text', text: 'b' }]), [
    { type: 'text', text: 'str' },
    { type: 'text', text: 'b' },
  ])
})

test('canonicalizeClaudeMessagesShape promotes strings to blocks', () => {
  const body = {
    model: 'x',
    system: 'You are a bot',
    messages: [
      { role: 'user', content: 'hello' },
      { role: 'assistant', content: [{ type: 'text', text: 'hi' }] },
    ],
  }
  const result = canonicalizeClaudeMessagesShape(body)
  assert.deepEqual(result.system, [{ type: 'text', text: 'You are a bot' }])
  assert.deepEqual(result.messages[0].content, [{ type: 'text', text: 'hello' }])
  assert.deepEqual(result.messages[1].content, [{ type: 'text', text: 'hi' }])
})

test('canonicalizeClaudeMessagesShape handles null/undefined body', () => {
  assert.equal(canonicalizeClaudeMessagesShape(null), null)
  assert.equal(canonicalizeClaudeMessagesShape(undefined), undefined)
})

test('applyStructuredOutput promotes response_format before drop', () => {
  const out = { model: 'x' }
  const source = { response_format: { type: 'json_object' } }
  const result = applyStructuredOutput({ ...out }, source)
  assert.ok(result.output_config)
  assert.equal(result.output_config.format.type, 'json_schema')
})

// Fork patch (lift-budget-stabilize): lifted <total_tokens> reminders must not
// make top-level system[] grow / change per turn or the cache prefix breaks.
test('liftMidConversationSystemMessages pins budget counter and keeps one block', () => {
  const body = {
    model: 'claude-opus-4-8',
    system: [{ type: 'text', text: 'persona' }],
    messages: [
      { role: 'user', content: 'hi' },
      { role: 'system', content: '<total_tokens>182000 tokens left</total_tokens>' },
      { role: 'assistant', content: 'hello' },
      { role: 'system', content: '<total_tokens>171500 tokens left</total_tokens>' },
      { role: 'user', content: 'next' },
    ],
  }
  const out = liftMidConversationSystemMessages(body)
  assert.equal(out.messages.some((m) => m.role === 'system'), false)
  assert.deepEqual(out.system, [{ type: 'text', text: 'persona' }, { type: 'text', text: STABILIZED_CONTEXT_BUDGET }])
})

test('liftMidConversationSystemMessages is turn-invariant as history grows', () => {
  const turn = (history) => ({
    model: 'claude-opus-4-8',
    system: [{ type: 'text', text: 'persona' }],
    messages: history,
  })
  const base = [
    { role: 'user', content: 'a' },
    { role: 'system', content: '<total_tokens>190000 tokens left</total_tokens>' },
    { role: 'assistant', content: 'b' },
  ]
  const later = [
    ...base,
    { role: 'system', content: '<total_tokens>12345 tokens left</total_tokens>' },
    { role: 'user', content: 'c' },
    { role: 'system', content: '<total_tokens>1 tokens left</total_tokens>' },
  ]
  const out1 = liftMidConversationSystemMessages(turn(base))
  const out2 = liftMidConversationSystemMessages(turn(later))
  assert.deepEqual(out2.system, out1.system)
})

test('liftMidConversationSystemMessages pins but keeps non-pure budget wrappers', () => {
  const body = {
    model: 'claude-opus-4-8',
    messages: [
      { role: 'user', content: 'hi' },
      { role: 'system', content: 'note: <total_tokens>999 tokens left</total_tokens> today' },
      { role: 'system', content: '<total_tokens>998 tokens left</total_tokens>' },
      { role: 'system', content: '<total_tokens>997 tokens left</total_tokens>' },
    ],
  }
  const out = liftMidConversationSystemMessages(body)
  const texts = out.system.map((b) => b.text)
  assert.deepEqual(texts, [`note: ${STABILIZED_CONTEXT_BUDGET} today`, STABILIZED_CONTEXT_BUDGET])
})

test('liftMidConversationSystemMessages pins a string system budget', () => {
  const body = {
    model: 'claude-opus-4-8',
    system: 'budget: <total_tokens>42 tokens left</total_tokens>',
    messages: [{ role: 'user', content: 'hi' }],
  }
  const out = liftMidConversationSystemMessages(body)
  assert.equal(out.system, `budget: ${STABILIZED_CONTEXT_BUDGET}`)
})

test('liftMidConversationSystemMessages leaves reminder-free bodies untouched', () => {
  const body = {
    model: 'claude-opus-4-8',
    system: [{ type: 'text', text: 'persona' }],
    messages: [
      { role: 'user', content: 'hi' },
      { role: 'system', content: 'session started' },
    ],
  }
  const out = liftMidConversationSystemMessages(body)
  assert.deepEqual(out.system, [
    { type: 'text', text: 'persona' },
    { type: 'text', text: 'session started' },
  ])
})
