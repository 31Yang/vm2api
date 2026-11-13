const PREFIX_RE = /^[a-zA-Z0-9][a-zA-Z0-9_.-]*-$/

export function slotContainerPrefix() {
  const prefix = String(process.env.KIN_SLOT_CONTAINER_PREFIX || '').trim()
  if (!prefix) return ''
  if (!PREFIX_RE.test(prefix)) {
    throw new Error('KIN_SLOT_CONTAINER_PREFIX must end with "-" and use Docker-name-safe characters')
  }
  return prefix
}

export function withSlotContainerPrefix(name) {
  const value = String(name || '')
    .trim()
    .replace(/^\//, '')
  const prefix = slotContainerPrefix()
  if (!prefix || !value || value.startsWith(prefix)) return value
  return `${prefix}${value}`
}

export function namespacedContainerName(vmId) {
  const suffix = String(vmId || '').replace(/^vm-/, '')
  return withSlotContainerPrefix(`kin-${suffix}`)
}
