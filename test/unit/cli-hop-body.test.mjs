import test from 'node:test'
import assert from 'node:assert/strict'
import {
  prepareCliHopBody,
  stripCliOwnedSystem,
  raiseCliHopMaxTokensForThinking,
} from '../../src/lib/protocol/outbound-attempt.mjs'
import { modelSupportsMidConversationSystem } from '../../src/lib/protocol/anthropic-policy.mjs'
import { applyMinMaxTokens } from '../../src/lib/protocol/min-max-tokens.mjs'
import { CRS_OFFICIAL_SYSTEM, CRS_OFFICIAL_CLI_SYSTEM } from '../../src/lib/identity/crs-persona.mjs'
import { CRS_OFFICIAL_AGENT_PROMPT } from '../../src/lib/identity/official-cc-system-2.1.241.mjs'

test('prepareCliHopBody drops metadata and CLI-owned system but keeps official agent leftover', () => {
  const body = prepareCliHopBody({
    model: 'claude-sonnet-5',
    max_tokens: 256,
    metadata: { user_id: '{"device_id":"abc"}' },
    system: [
      {
        type: 'text',
        text: "x-anthropic-billing-header: cc_version=2.8.4; prompt_version=You are a Claude agent, built on Anthropic's Claude Agent SDK.;",
      },
      { type: 'text', text: CRS_OFFICIAL_SYSTEM },
      { type: 'text', text: CRS_OFFICIAL_AGENT_PROMPT },
      { type: 'text', text: '# Environment\nTime zone: America/New_York' },
    ],
    messages: [{ role: 'user', content: 'hi' }],
  })
  assert.equal(body.metadata, undefined)
  assert.equal(body.system.length, 1)
  assert.equal(body.system[0].text, CRS_OFFICIAL_AGENT_PROMPT)
  assert.equal(body.model, 'claude-sonnet-5')
  assert.deepEqual(body.messages[0].content, [
    { type: 'text', text: 'hi', cache_control: { type: 'ephemeral', ttl: '1h' } },
  ])
  assert.equal(body.stream, true)
})

test('prepareCliHopBody keeps caller leftover system and tools', () => {
  const body = prepareCliHopBody({
    model: 'claude-opus-5',
    max_tokens: 1024,
    system: [
      { type: 'text', text: CRS_OFFICIAL_CLI_SYSTEM },
      { type: 'text', text: '你是一个高速收费员。' },
    ],
    tools: [{ name: 'get_weather', input_schema: { type: 'object', properties: {} } }],
    thinking: { type: 'disabled' },
    messages: [{ role: 'user', content: '你好呀。' }],
  })
  assert.equal(body.metadata, undefined)
  assert.equal(body.system.length, 1)
  assert.equal(body.system[0].text, '你是一个高速收费员。')
  assert.equal(body.tools[0].name, 'get_weather')
  assert.equal(body.thinking.type, 'disabled')
})

test('stripCliOwnedSystem leaves empty inbound system absent', () => {
  assert.equal(stripCliOwnedSystem(undefined), undefined)
  assert.equal(stripCliOwnedSystem(''), undefined)
  assert.equal(stripCliOwnedSystem([{ type: 'text', text: '' }]), undefined)
})

test('prepareCliHopBody fills 2.1.263 thinking effort and context_management', () => {
  const body = prepareCliHopBody({
    model: 'claude-sonnet-5',
    messages: [{ role: 'user', content: 'hello' }],
  })
  assert.deepEqual(body.thinking, { type: 'adaptive', display: 'omitted' })
  assert.equal(body.output_config.effort, 'high')
  assert.equal(body.context_management.edits[0].type, 'clear_thinking_20251015')
  assert.equal(body.metadata, undefined)
  assert.equal(body.system, undefined)
})

test('prepareCliHopBody does not overwrite caller thinking disabled', () => {
  const body = prepareCliHopBody({
    model: 'claude-sonnet-5',
    max_tokens: 256,
    thinking: { type: 'disabled' },
    messages: [{ role: 'user', content: 'hi' }],
  })
  assert.equal(body.thinking.type, 'disabled')
  assert.equal(body.context_management, undefined)
})

test('prepareCliHopBody strips unsigned empty dummy and short thinking history', () => {
  const body = prepareCliHopBody({
    model: 'claude-sonnet-5',
    max_tokens: 256,
    messages: [
      { role: 'user', content: 'hi' },
      {
        role: 'assistant',
        content: [
          { type: 'thinking', thinking: 'keep-me', signature: 'sig_real_1234567890abcdef' },
          { type: 'thinking', thinking: 'no-sig' },
          { type: 'thinking', thinking: '', signature: 'sig_empty_text_still_long_enough' },
          { type: 'thinking', thinking: 'dummy', signature: 'skip_thought_signature_validator' },
          { type: 'thinking', thinking: 'short', signature: 'abc' },
          { type: 'text', text: 'hello' },
        ],
      },
      { role: 'user', content: 'again' },
    ],
  })
  assert.deepEqual(body.thinking, { type: 'adaptive', display: 'omitted' })
  assert.equal(body.temperature, 1)
  assert.deepEqual(body.messages[1].content, [
    { type: 'thinking', thinking: 'keep-me', signature: 'sig_real_1234567890abcdef' },
    { type: 'text', text: 'hello' },
  ])
})

test('prepareCliHopBody drops an assistant turn that is only unsigned thinking', () => {
  const body = prepareCliHopBody({
    model: 'claude-opus-5.5',
    max_tokens: 64000,
    thinking: { type: 'adaptive' },
    messages: [
      { role: 'user', content: 'first' },
      {
        role: 'assistant',
        content: [{ type: 'thinking', thinking: 'draft only', signature: 'abc' }],
      },
      { role: 'user', content: 'continue' },
    ],
  })
  assert.equal(body.model, 'claude-opus-5-5')
  assert.deepEqual(
    body.messages.map((message) => message.role),
    ['user'],
  )
  assert.deepEqual(body.messages.at(-1).content, [
    { type: 'text', text: 'first' },
    { type: 'text', text: 'continue', cache_control: { type: 'ephemeral', ttl: '1h' } },
  ])
})

test('prepareCliHopBody repaired does not refill thinking after signature downgrade', () => {
  const body = prepareCliHopBody(
    {
      model: 'claude-sonnet-5',
      max_tokens: 256,
      messages: [
        { role: 'user', content: 'hi' },
        {
          role: 'assistant',
          content: [
            { type: 'text', text: 'plan' },
            { type: 'text', text: 'hello' },
          ],
        },
        { role: 'user', content: 'again' },
      ],
    },
    { repaired: true },
  )
  assert.equal(body.thinking, undefined)
  assert.equal(body.context_management, undefined)
  assert.deepEqual(body.messages[1].content, [
    { type: 'text', text: 'plan' },
    { type: 'text', text: 'hello' },
  ])
})

test('prepareCliHopBody disables thinking on Haiku so wrap CLI cannot inherit adaptive', () => {
  const body = prepareCliHopBody({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 256,
    messages: [{ role: 'user', content: 'hello' }],
  })
  assert.equal(body.thinking?.type, 'disabled')
  assert.equal(body.output_config, undefined)
  assert.equal(body.context_management, undefined)
})

test('prepareCliHopBody drops caller context_management on Haiku (thinking pinned off)', () => {
  // Claude Code 的 Haiku 旁路请求会带 clear_thinking。cli-hop 把 Haiku thinking 固定为 disabled
  // 且跳过 beta 清洗，所以必须在这里删掉该字段，否则上游会杀掉 CLI。
  const body = prepareCliHopBody({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 512,
    context_management: { edits: [{ type: 'clear_thinking_20251015' }] },
    messages: [{ role: 'user', content: 'hi' }],
  })
  assert.equal(body.thinking?.type, 'disabled')
  assert.equal(body.context_management, undefined)
})

test('prepareCliHopBody disables Haiku adaptive thinking', () => {
  const body = prepareCliHopBody({
    model: 'claude-haiku-4-5',
    max_tokens: 256,
    thinking: { type: 'adaptive', display: 'omitted' },
    messages: [{ role: 'user', content: 'hello' }],
  })
  assert.equal(body.thinking.type, 'disabled')
})

function withoutMessageCache(body) {
  return {
    ...body,
    messages: (body.messages || []).map((message) => {
      if (!Array.isArray(message?.content)) return message
      return {
        ...message,
        content: message.content.map((block) => {
          if (!block || typeof block !== 'object' || !block.cache_control) return block
          const { cache_control: _drop, ...rest } = block
          return rest
        }),
      }
    }),
  }
}

function messageMarkers(body) {
  const hits = []
  for (const [index, message] of (body.messages || []).entries()) {
    if (!Array.isArray(message?.content)) continue
    for (const [blockIndex, block] of message.content.entries()) {
      if (!block?.cache_control) continue
      hits.push({ index, blockIndex, type: block.type, ttl: block.cache_control.ttl })
    }
  }
  return hits
}

test('cli-hop drops caller system/tools markers and restamps last plus penultimate user', () => {
  const body = prepareCliHopBody(
    {
      model: 'claude-sonnet-5',
      max_tokens: 256,
      tools: [{ name: 'Read', cache_control: { type: 'ephemeral', ttl: '5m' } }],
      system: [{ type: 'text', text: 'caller', cache_control: { type: 'ephemeral', ttl: '1h' } }],
      cache_control: { type: 'ephemeral', ttl: '5m' },
      messages: [
        { role: 'user', content: [{ type: 'text', text: 'u1', cache_control: { type: 'ephemeral', ttl: '1h' } }] },
        { role: 'assistant', content: [{ type: 'text', text: 'a1', cache_control: { type: 'ephemeral' } }] },
        { role: 'user', content: [{ type: 'text', text: 'u2' }] },
        { role: 'assistant', content: [{ type: 'text', text: 'a2' }] },
      ],
    },
    { cacheTtl: '5m' },
  )
  assert.equal(body.cache_control, undefined)
  assert.equal(body.tools[0].cache_control, undefined)
  assert.equal(body.system[0].cache_control, undefined)
  assert.deepEqual(messageMarkers(body), [
    { index: 0, blockIndex: 0, type: 'text', ttl: '5m' },
    { index: 3, blockIndex: 0, type: 'text', ttl: '5m' },
  ])
})

test('cli-hop short history only marks the last message', () => {
  const body = prepareCliHopBody({
    model: 'claude-sonnet-5',
    max_tokens: 256,
    messages: [
      { role: 'user', content: 'u1' },
      { role: 'assistant', content: 'a1' },
      { role: 'user', content: 'u2' },
    ],
  })
  assert.deepEqual(
    body.messages.map((message) => message.role),
    ['user', 'assistant', 'user'],
  )
  assert.deepEqual(messageMarkers(body), [{ index: 2, blockIndex: 0, type: 'text', ttl: '1h' }])
})

test('cli-hop does not mark thinking blocks', () => {
  const body = prepareCliHopBody(
    {
      model: 'claude-sonnet-5',
      max_tokens: 256,
      messages: [
        {
          role: 'assistant',
          content: [
            { type: 'text', text: 'answer' },
            { type: 'thinking', thinking: 'hidden', signature: 'sig'.repeat(8) },
          ],
        },
      ],
    },
    { cacheTtl: '1h' },
  )
  assert.deepEqual(body.messages.at(-1).content[0].cache_control, { type: 'ephemeral', ttl: '1h' })
  assert.equal(body.messages.at(-1).content[1].cache_control, undefined)
})

test('cli-hop uses the inbound session TTL on both message anchors', () => {
  const body = prepareCliHopBody(
    {
      model: 'claude-sonnet-5',
      max_tokens: 256,
      messages: [
        { role: 'user', content: 'u1' },
        { role: 'assistant', content: 'a1' },
        { role: 'user', content: 'u2' },
        { role: 'assistant', content: 'a2' },
      ],
    },
    { cacheTtl: '1h' },
  )
  assert.deepEqual(
    messageMarkers(body).map((hit) => hit.ttl),
    ['1h', '1h'],
  )
})

test('Claude Code turns stay a content prefix of the next one, from turn 1 on', () => {
  const reminder = (text) => ({ role: 'system', content: text })
  const budget = (left) => reminder(`<total_tokens>${left} tokens left</total_tokens>`)
  const turn = (messages) =>
    prepareCliHopBody({
      model: 'claude-opus-5-5',
      max_tokens: 64000,
      system: [{ type: 'text', text: 'main prompt' }],
      messages,
    })
  const turns = [
    [{ role: 'user', content: 'u1' }, reminder('SessionStart hook context')],
    [{ role: 'assistant', content: 'a1' }, { role: 'user', content: 'u2' }, budget(14930105)],
    [{ role: 'assistant', content: 'a2' }, { role: 'user', content: 'u3' }, budget(14928642)],
  ]
  let history = []
  let previous = null
  for (const added of turns) {
    history = [...history, ...added]
    const body = turn(history)
    assert.equal(body.messages.at(-1).role, 'system')
    if (previous) {
      assert.deepEqual(body.system, previous.system)
      assert.deepEqual(
        withoutMessageCache(body).messages.slice(0, previous.messages.length),
        withoutMessageCache(previous).messages,
      )
    }
    previous = body
  }
})

test('cli-hop lifts role=system turns for models that reject them', () => {
  const body = prepareCliHopBody({
    model: 'claude-haiku-4-5',
    max_tokens: 256,
    messages: [
      { role: 'user', content: 'u1' },
      { role: 'system', content: 'reminder' },
      { role: 'assistant', content: 'a1' },
      { role: 'user', content: 'u2' },
    ],
  })
  assert.ok(body.messages.every((message) => message.role !== 'system'))
  assert.equal(body.system.at(-1).text, 'reminder')
})

test('prepareCliHopBody clamps small max_tokens to 1024 for automated probe tests', () => {
  const probe1 = prepareCliHopBody({
    model: 'claude-haiku-4-5',
    max_tokens: 1,
    messages: [{ role: 'user', content: '.' }],
  })
  assert.equal(probe1.max_tokens, 1024)

  const probe32 = prepareCliHopBody({
    model: 'claude-haiku-4-5',
    max_tokens: 32,
    messages: [{ role: 'user', content: 'ping' }],
  })
  assert.equal(probe32.max_tokens, 1024)

  // Sonnet 5 gets adaptive thinking filled in, so the thinking floor applies (fork patch cli-hop-min-tokens).
  const classifier64 = prepareCliHopBody({
    model: 'claude-sonnet-5',
    max_tokens: 64,
    messages: [{ role: 'user', content: '<severity>0</severity>' }],
  })
  assert.equal(classifier64.max_tokens, 4096)

  const normal = prepareCliHopBody({
    model: 'claude-haiku-4-5',
    max_tokens: 4096,
    messages: [{ role: 'user', content: 'hello' }],
  })
  assert.equal(normal.max_tokens, 4096)
})

test('fork patch cli-hop-min-tokens: entry min_max_tokens floor no longer defeats the cli-hop clamp', () => {
  // Claude Code auto-mode permission classifier as relayed through NewAPI (OpenAI chat -> Messages).
  const inbound = applyMinMaxTokens(
    {
      model: 'claude-sonnet-5',
      max_tokens: 64,
      stop_sequences: ['</severity>'],
      system: 'You are a security classifier.',
      messages: [{ role: 'user', content: '<transcript>...</transcript>' }],
    },
    { enabled: true, value: 128 },
  )
  assert.equal(inbound.max_tokens, 128)
  const body = prepareCliHopBody(inbound)
  assert.equal(body.thinking.type, 'adaptive')
  assert.equal(body.max_tokens, 4096)

  // Haiku keeps thinking pinned off, so only the plain floor applies.
  const haiku = prepareCliHopBody(
    applyMinMaxTokens({ model: 'claude-haiku-4-5', max_tokens: 64, messages: [{ role: 'user', content: 'hi' }] }),
  )
  assert.equal(haiku.thinking.type, 'disabled')
  assert.equal(haiku.max_tokens, 1024)

  const haiku500 = prepareCliHopBody({
    model: 'claude-haiku-4-5',
    max_tokens: 500,
    messages: [{ role: 'user', content: 'hi' }],
  })
  assert.equal(haiku500.max_tokens, 1024)
})

test('fork patch cli-hop-min-tokens: caller-disabled thinking and large budgets are left alone', () => {
  const disabled = prepareCliHopBody({
    model: 'claude-sonnet-5',
    max_tokens: 256,
    thinking: { type: 'disabled' },
    messages: [{ role: 'user', content: 'hi' }],
  })
  assert.equal(disabled.thinking.type, 'disabled')
  assert.equal(disabled.max_tokens, 1024)

  const large = prepareCliHopBody({
    model: 'claude-opus-5-5',
    max_tokens: 64000,
    messages: [{ role: 'user', content: 'hi' }],
  })
  assert.equal(large.max_tokens, 64000)

  // Upstream officialMessagesBody fills a missing budget with 128000; the floor must not touch it.
  const missing = prepareCliHopBody({ model: 'claude-sonnet-5', messages: [{ role: 'user', content: 'hi' }] })
  assert.equal(missing.max_tokens, 128000)

  assert.equal(
    raiseCliHopMaxTokensForThinking({ max_tokens: 100, thinking: { type: 'enabled', budget_tokens: 50 } }).max_tokens,
    4096,
  )
  assert.equal(raiseCliHopMaxTokensForThinking({ max_tokens: 100 }).max_tokens, 100)
})

test('fork patch mid-system-models: Sonnet 4.6 lifts role=system turns like Haiku', () => {
  // Claude Code session-title request: caller leftover system becomes a trailing role=system turn.
  const body = prepareCliHopBody({
    model: 'claude-sonnet-4-6',
    max_tokens: 32000,
    messages: [
      { role: 'user', content: '<session>fix the ui</session> Write the title.' },
      { role: 'system', content: '<system-reminder>\nMANDATORY constraints for this turn.\n</system-reminder>' },
    ],
  })
  assert.ok(body.messages.every((message) => message.role !== 'system'))
  assert.match(body.system.at(-1).text, /MANDATORY constraints/)
})

test('fork patch mid-system-models: supported models keep role=system turns in place', () => {
  for (const model of ['claude-opus-5', 'claude-opus-5-5', 'claude-opus-4-8', 'claude-sonnet-5-5', 'claude-haiku-5-5']) {
    const body = prepareCliHopBody({
      model,
      max_tokens: 64000,
      messages: [
        { role: 'user', content: 'u1' },
        { role: 'system', content: 'reminder' },
      ],
    })
    assert.equal(body.messages.at(-1).role, 'system', model)
  }
})

test('fork patch mid-system-models: modelSupportsMidConversationSystem model table', () => {
  // Expectations track the upstream implementation (v1.3.135, #324): the docs-listed models accept
  // a mid-conversation role=system turn — Fable 5/5.1, Mythos 5/5.1, Opus 5/5.5/4.8, Sonnet 5.5,
  // Haiku 5.5. Sonnet 5, Haiku 5 and Claude 4.x others lift it into top-level system instead.
  const unsupported = [
    'claude-haiku-4-5',
    'claude-haiku-4-5-20251001',
    'claude-haiku-5',
    'claude-sonnet-4-6',
    'claude-sonnet-4-5-20250929',
    'claude-sonnet-4-20250514',
    'claude-sonnet-5',
    'claude-sonnet-5-fast',
    'claude-sonnet-5[1m]',
    'claude-opus-4-6',
    'claude-opus-4-7',
    'claude-opus-4-1-20250805',
    'claude-3-7-sonnet-20250219',
    'claude-mythos-preview',
    'CLAUDE-SONNET-4-6',
  ]
  const supported = [
    'claude-fable-5',
    'claude-fable-5-1',
    'claude-fable-5.1[1m]',
    'claude-mythos-5',
    'claude-mythos-5-1',
    'claude-opus-5',
    'claude-opus-5-5',
    'claude-opus-5.5',
    'claude-opus-5-5-20251001',
    'claude-opus-4-8',
    'claude-sonnet-5-5',
    'claude-sonnet-5.5',
    'claude-haiku-5-5',
  ]
  for (const model of unsupported) assert.equal(modelSupportsMidConversationSystem(model), false, model)
  for (const model of supported) assert.equal(modelSupportsMidConversationSystem(model), true, model)
})

test('cli-hop makes Opus 5.5 acceptable to Claude Code 2.1.280', () => {
  const body = prepareCliHopBody({
    model: 'claude-opus-5.5',
    thinking: { type: 'enabled', budget_tokens: 8000, display: 'summarized' },
    output_config: { effort: 'high' },
    tool_choice: { type: 'tool', name: 'get_weather' },
    tools: [
      { name: 'get_weather', input_schema: { type: 'object' } },
      { type: 'computer_20251124', name: 'computer' },
    ],
    messages: [{ role: 'user', content: 'hi' }],
  })
  assert.equal(body.model, 'claude-opus-5-5')
  assert.deepEqual(body.thinking, { type: 'adaptive', display: 'summarized' })
  assert.equal(body.thinking.budget_tokens, undefined)
  assert.equal(body.output_config.effort, 'high')
  assert.deepEqual(body.tool_choice, { type: 'auto' })
  assert.equal(body.tools.find((tool) => tool.name === 'get_weather').strict, true)
  assert.equal(body.tools.find((tool) => tool.name === 'computer').type, 'computer_toolset_20260801')

  const filled = prepareCliHopBody({
    model: 'claude-opus-5-5',
    thinking: { type: 'disabled' },
    messages: [{ role: 'user', content: 'hi' }],
  })
  assert.equal(filled.thinking.type, 'adaptive')
  assert.equal(filled.thinking.budget_tokens, undefined)
  assert.equal(filled.output_config.effort, 'medium')

  const opus5 = prepareCliHopBody({
    model: 'claude-opus-5',
    thinking: { type: 'disabled' },
    messages: [{ role: 'user', content: 'hi' }],
  })
  assert.equal(opus5.thinking.type, 'disabled')
  assert.equal(opus5.output_config.effort, 'high')
})
