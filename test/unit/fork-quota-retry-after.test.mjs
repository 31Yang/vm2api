// Fork patch (quota-retry-after): drive the real evaluateAccount / AccountQuota path, not a
// mocked quota gate, so the wake time a 503 advertises matches why the account is out.
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { PoolScheduler } from '../../src/lib/pool/pool-scheduler.mjs'
import { AccountQuota } from '../../src/lib/pool/account-quota.mjs'
import { FailoverRunner } from '../../src/lib/pool/failover-runner.mjs'
import { rewritePoolErrorForClient } from '../../src/lib/core/errors.mjs'

const HOUR = 3600_000

function project() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kin-quota-retry-after-'))
  const vms = path.join(root, 'vms')
  fs.mkdirSync(vms, { recursive: true })
  for (const [id, accountId, port] of [
    ['vm-01', 'account-1', 10001],
    ['vm-02', 'account-2', 10002],
  ]) {
    const vm = {
      id,
      name: id,
      status: 'running',
      schedulable: true,
      proxy_cli_enabled: true,
      proxy: { id: `proxy-${id}`, url: `socks5h://127.0.0.1:${port}` },
      runtime: { worker_socket: path.join(vms, id, 'run', 'worker.sock') },
      policy: { maxConcurrency: 4, concurrencyOverride: true, weight: 1, priority: 0 },
      claude: {
        account_uuid: accountId,
        account_tier: 'max',
        access_token: `access-${accountId}`,
        refresh_token: `refresh-${accountId}`,
        expires_at: Math.floor(Date.now() / 1000) + 3600,
      },
    }
    fs.writeFileSync(path.join(vms, `${id}.json`), JSON.stringify(vm))
  }
  fs.writeFileSync(path.join(vms, 'active.json'), JSON.stringify({ active_vm: 'vm-01' }))
  return root
}

/** Operator switch off: out of the pool for good, no wake time of its own. */
function switchOff(root, id) {
  const file = path.join(root, 'vms', `${id}.json`)
  const vm = JSON.parse(fs.readFileSync(file, 'utf8'))
  vm.schedulable = false
  fs.writeFileSync(file, JSON.stringify(vm))
}

class RuntimeRepo {
  states = new Map()

  get(id) {
    return this.states.get(id) || null
  }
  clearExpired() {}
  upsert(state) {
    const next = { ...(this.states.get(state.account_id) || {}), ...state }
    this.states.set(state.account_id, next)
    return next
  }
  markCooldown(id, update) {
    const state = this.states.get(id) || { account_id: id, vm_id: update.vmId, model_states: {} }
    state.cooldown_until = update.until
    state.cooldown_reason = update.reason
    state.status = update.status
    this.states.set(id, state)
    return state
  }
}

function setup(t) {
  const root = project()
  const quota = new AccountQuota({ dataDir: path.join(root, 'data'), config: {} })
  quota.ensure({ account_id: 'account-1', vm_id: 'vm-01' })
  quota.ensure({ account_id: 'account-2', vm_id: 'vm-02' })
  const runtimeRepo = new RuntimeRepo()
  const pool = new PoolScheduler({
    projectRoot: root,
    accountQuota: quota,
    runtimeRepo,
    workerHealth: async () => ({ ok: true, credential: { generation: 1, has_access: true } }),
    config: { fallback_wait_timeout_ms: 5, sticky_wait_timeout_ms: 5 },
  })
  t.after(() => {
    for (const timer of pool.cooldownTimers?.values?.() || []) clearTimeout(timer)
    pool.cooldownTimers?.clear?.()
    try {
      fs.rmSync(root, { recursive: true, force: true })
    } catch {}
  })
  return { root, quota, runtimeRepo, pool }
}

/** Real upstream header shape: utilization 0–1, reset in epoch seconds. */
function headers(quota, accountId, { u5 = 0.2, reset5 = Date.now() + 3 * HOUR, u7 = 0.4, reset7 = Date.now() + 30 * HOUR } = {}) {
  quota.ingestHeaders(accountId, {
    'anthropic-ratelimit-unified-5h-utilization': String(u5),
    'anthropic-ratelimit-unified-5h-status': u5 >= 0.9 ? 'allowed_warning' : 'allowed',
    'anthropic-ratelimit-unified-5h-reset': String(Math.floor(reset5 / 1000)),
    'anthropic-ratelimit-unified-7d-utilization': String(u7),
    'anthropic-ratelimit-unified-7d-status': u7 >= 0.9 ? 'allowed_warning' : 'allowed',
    'anthropic-ratelimit-unified-7d-reset': String(Math.floor(reset7 / 1000)),
  })
}

function assertWakeNear(selected, wakeAt) {
  assert.equal(selected.ok, false)
  assert.equal(selected.reason, 'no_eligible_accounts')
  const expected = wakeAt - Date.now()
  assert.ok(
    Math.abs(selected.soonest_available_ms - expected) < 5_000,
    `soonest ${selected.soonest_available_ms} should be near ${expected}`,
  )
}

test('real 5h circuit break (Max at 95%) surfaces the window reset', async (t) => {
  const { root, quota, pool } = setup(t)
  switchOff(root, 'vm-02')
  const reset5 = Date.now() + 3 * HOUR
  headers(quota, 'account-1', { u5: 0.95, reset5 })
  const selected = await pool.selectAndReserve({ model: 'claude-test', allowWait: false })
  assertWakeNear(selected, Math.floor(reset5 / 1000) * 1000)
})

test('real 7d circuit break surfaces the weekly reset', async (t) => {
  const { root, quota, pool } = setup(t)
  switchOff(root, 'vm-02')
  const reset7 = Date.now() + 30 * HOUR
  headers(quota, 'account-1', { u5: 0.3, u7: 0.96, reset7 })
  const selected = await pool.selectAndReserve({ model: 'claude-test', allowWait: false })
  assertWakeNear(selected, Math.floor(reset7 / 1000) * 1000)
})

test('live upstream 429 block surfaces its reset', async (t) => {
  const { root, quota, runtimeRepo, pool } = setup(t)
  switchOff(root, 'vm-02')
  headers(quota, 'account-1', { u5: 0.5 })
  const until = Date.now() + HOUR
  runtimeRepo.upsert({ account_id: 'account-1', vm_id: 'vm-01', rate_limit_reset_at: until })
  const selected = await pool.selectAndReserve({ model: 'claude-test', allowWait: false })
  assertWakeNear(selected, until)
})

test('in-flight guard (90% with a call in flight) advertises no wake time', async (t) => {
  const { root, quota, pool } = setup(t)
  switchOff(root, 'vm-02')
  headers(quota, 'account-1', { u5: 0.9 })
  assert.equal(quota.tryAcquire('account-1', { skipGate: true }).ok, true)
  const selected = await pool.selectAndReserve({ model: 'claude-test', allowWait: false })
  assert.equal(selected.ok, false)
  assert.equal(selected.reason, 'no_eligible_accounts')
  assert.equal(selected.soonest_available_ms, null)
})

test('in-flight guard on one account hides another account window reset', async (t) => {
  const { quota, pool } = setup(t)
  headers(quota, 'account-1', { u5: 0.9 })
  assert.equal(quota.tryAcquire('account-1', { skipGate: true }).ok, true)
  headers(quota, 'account-2', { u5: 0.95, reset5: Date.now() + 3 * HOUR })
  const selected = await pool.selectAndReserve({ model: 'claude-test', allowWait: false })
  assert.equal(selected.ok, false)
  assert.equal(selected.soonest_available_ms, null)
})

test('admission is unchanged: 92% with nothing in flight still gets the call', async (t) => {
  const { root, quota, pool } = setup(t)
  switchOff(root, 'vm-02')
  headers(quota, 'account-1', { u5: 0.92 })
  const selected = await pool.selectAndReserve({ model: 'claude-test', allowWait: false })
  assert.equal(selected.ok, true)
  assert.equal(selected.accountId, 'account-1')
  selected.release()
})

test('failover 503 carries Retry-After and a Beijing-time client message on a real break', async (t) => {
  const { root, quota, pool } = setup(t)
  switchOff(root, 'vm-02')
  const reset5 = Date.now() + 3 * HOUR
  headers(quota, 'account-1', { u5: 0.95, reset5 })
  const runner = new FailoverRunner({ scheduler: pool })
  const result = await runner.run({
    requestId: 'req-quota-break',
    canonicalBody: { model: 'claude-test' },
    model: 'claude-test',
    callAttempt: () => {
      throw new Error('must not reach an account')
    },
  })
  assert.equal(result.status, 503)
  const expectedSec = Math.ceil((Math.floor(reset5 / 1000) * 1000 - Date.now()) / 1000)
  assert.ok(Math.abs(result.retryAfterSec - expectedSec) <= 5, `retryAfterSec ${result.retryAfterSec} vs ${expectedSec}`)

  const client = rewritePoolErrorForClient({ status: 503, body: result.body }, result.body)
  assert.equal(client.status, 503)
  assert.equal(client.body.error.code, 'pool_unavailable')
  assert.match(client.body.error.message, /^号池当前没有可用账号（预计北京时间 \d{2}-\d{2} \d{2}:\d{2} 恢复）$/)
  assert.ok(Math.abs(Date.parse(client.body.error.details.reset_at) - (Math.floor(reset5 / 1000) * 1000)) < 5_000)
  assert.ok(Math.abs(client.body.error.details.retry_after_sec - expectedSec) <= 5)
})

test('client message shows the wake time in Beijing time, rounded up to the minute', () => {
  // e.g. a 5h reset at 09:39:59.688Z reads 「预计北京时间 09-30 17:40 恢复」
  const boundary = Math.ceil((Date.now() + 2 * HOUR) / 60_000) * 60_000
  const wake = boundary - 30_000
  const body = { error: { code: 'account_pool_exhausted', message: 'x', details: { soonest_available_ms: wake - Date.now() } } }
  const client = rewritePoolErrorForClient({ status: 503, body }, body)
  const bj = new Date(boundary + 8 * HOUR).toISOString()
  assert.equal(client.body.error.message, `号池当前没有可用账号（预计北京时间 ${bj.slice(5, 10)} ${bj.slice(11, 16)} 恢复）`)
  assert.equal(client.body.error.details.reset_at, new Date(Date.parse(client.body.error.details.reset_at)).toISOString())
})

test('no wake time keeps the plain client message and no details', () => {
  const body = { error: { code: 'account_pool_exhausted', message: 'x', details: { soonest_available_ms: null } } }
  const client = rewritePoolErrorForClient({ status: 503, body }, body)
  assert.equal(client.body.error.message, '号池当前没有可用账号')
  assert.equal(client.body.error.details, undefined)
})
