import assert from 'node:assert/strict'
import test from 'node:test'

import { containerName } from '../../src/lib/vm/vm-runtime.mjs'
import { slotContainerName } from '../../src/lib/transport/rust-kernel-supervisor.mjs'
import { slotExecContainer } from '../../src/lib/vm/slot-exec.mjs'

test('slot container names keep upstream behavior without a prefix', () => {
  delete process.env.KIN_SLOT_CONTAINER_PREFIX
  assert.equal(containerName('vm-02'), 'kin-02')
  assert.equal(slotContainerName({ vm: { id: 'vm-02' } }), 'kin-02')
  assert.equal(slotContainerName({ vm: { runtime: { container: 'kin-02' } } }), 'kin-02')
  assert.equal(slotExecContainer({ id: 'vm-02' }), 'kin-02')
  assert.equal(slotExecContainer({ id: 'vm-02', runtime: { container: 'kin-02' } }), 'kin-02')
})

test('slot container prefix applies to generated and persisted names', () => {
  process.env.KIN_SLOT_CONTAINER_PREFIX = 'test-'
  try {
    assert.equal(containerName('vm-02'), 'test-kin-02')
    assert.equal(slotContainerName({ vm: { id: 'vm-02' } }), 'test-kin-02')
    assert.equal(slotContainerName({ vm: { runtime: { container: 'kin-02' } } }), 'test-kin-02')
    assert.equal(slotContainerName({ vm: { runtime: { container: 'test-kin-02' } } }), 'test-kin-02')
    assert.equal(slotExecContainer({ id: 'vm-02' }), 'test-kin-02')
    assert.equal(slotExecContainer({ id: 'vm-02', runtime: { container: 'kin-02' } }), 'test-kin-02')
  } finally {
    delete process.env.KIN_SLOT_CONTAINER_PREFIX
  }
})

test('slot container prefix must be Docker-name-safe', () => {
  process.env.KIN_SLOT_CONTAINER_PREFIX = 'test'
  try {
    assert.throws(() => containerName('vm-02'), /KIN_SLOT_CONTAINER_PREFIX/)
  } finally {
    delete process.env.KIN_SLOT_CONTAINER_PREFIX
  }
})
