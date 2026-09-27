import { devices, links, type DeviceChange, type DeviceId, type Scenario, type SimulationStep } from './simulation.ts'
import { analyzeLab, ipv4Number, type LabAnalysis, type LabConfig } from './labModel.ts'

export type RouteEntry = {
  prefix: string
  nextHop: string
  interface: string
  protocol: 'connected' | 'static' | 'ospf' | 'default'
  metric: number
  administrativeDistance: number
}

export type InterfaceState = {
  name: string
  status: 'up' | 'down'
  speedMbps: number
  duplex: 'full' | 'half'
  mtu: number
  latencyMs: number
  jitterMs: number
  lossPercent: number
  packetsIn: number
  packetsOut: number
  errors: number
  drops: number
}

export type DeviceRuntimeState = {
  id: DeviceId
  name: string
  kind: string
  interfaces: InterfaceState[]
  ipv4: { address: string; prefix: number; gateway: string; dns: string; vlan: string }
  ipv6: { addresses: string[]; gateway: string; prefix: string; dns: string }
  arpCache: Record<string, string>
  neighborCache: Record<string, string>
  macTable: Record<string, string>
  routes: RouteEntry[]
  tables: Record<string, Record<string, string>>
  changedAtEvent: number | null
}

export type LinkCondition = {
  id: string
  from: DeviceId
  to: DeviceId
  status: 'up' | 'down'
  speedMbps: number
  duplex: 'full' | 'half'
  mtu: number
  latencyMs: number
  jitterMs: number
  lossPercent: number
}

export type NetworkRuntimeState = {
  scenarioId: Scenario['id']
  eventIndex: number
  devices: Record<DeviceId, DeviceRuntimeState>
  events: SimulationStep[]
  recentChanges: DeviceChange[]
  totalEventsApplied: number
}

export type RouteLookup = {
  destination: string
  candidates: RouteEntry[]
  winner: RouteEntry | null
}

export type ProbeResult = {
  ok: boolean
  status: string
  explanation: string
  route: DeviceId[]
  latencyMs?: number
  droppedAt?: string
}

export type TroubleshootingFaultId =
  | 'wrong-gateway' | 'wrong-mask' | 'wrong-vlan' | 'missing-trunk-vlan'
  | 'interface-down' | 'duplicate-ip' | 'incorrect-static-route' | 'missing-route'
  | 'firewall-block' | 'dns-failure' | 'dhcp-exhausted' | 'stp-block'
  | 'mtu-mismatch' | 'duplex-mismatch'

export type TroubleshootingConfig = {
  address: string
  mask: string
  gateway: string
  vlan: number
  trunkVlans: number[]
  interfaceStatus: 'up' | 'down'
  duplicateAddress: boolean
  routes: RouteEntry[]
  firewallAllows: boolean
  dnsAvailable: boolean
  dhcpAvailable: boolean
  stpPathAvailable: boolean
  mtu: number
  duplexLocal: 'full' | 'half'
  duplexRemote: 'full' | 'half'
}

export type TroubleshootingCase = {
  id: TroubleshootingFaultId
  symptom: string
  diagnosis: string
  repair: string
  initial: TroubleshootingConfig
}

const deviceIds = Object.keys(devices) as DeviceId[]
const ipv4RouteTable: RouteEntry[] = [
  { prefix: '10.0.0.0/8', nextHop: '10.10.0.1', interface: 'Gi0/0', protocol: 'static', metric: 10, administrativeDistance: 1 },
  { prefix: '10.20.0.0/16', nextHop: '10.20.0.1', interface: 'Gi0/1', protocol: 'ospf', metric: 20, administrativeDistance: 110 },
  { prefix: '10.20.30.0/24', nextHop: '10.20.30.1', interface: 'Gi0/2', protocol: 'static', metric: 5, administrativeDistance: 1 },
  { prefix: '10.20.30.128/25', nextHop: '10.20.30.129', interface: 'Gi0/3', protocol: 'static', metric: 5, administrativeDistance: 1 },
  { prefix: '0.0.0.0/0', nextHop: '198.51.100.1', interface: 'Gi0/0', protocol: 'default', metric: 1, administrativeDistance: 1 },
]

const ipv6RouteTable: RouteEntry[] = [
  { prefix: '2001:db8:10::/48', nextHop: '—', interface: 'Gi0/0', protocol: 'connected', metric: 0, administrativeDistance: 0 },
  { prefix: '2001:db8:20::/48', nextHop: 'fe80::1', interface: 'Gi0/1', protocol: 'ospf', metric: 20, administrativeDistance: 110 },
  { prefix: '2001:db8:20:30::/64', nextHop: 'fe80::2', interface: 'Gi0/2', protocol: 'static', metric: 5, administrativeDistance: 1 },
  { prefix: '::/0', nextHop: 'fe80::1', interface: 'Gi0/0', protocol: 'default', metric: 1, administrativeDistance: 1 },
]

function prefixLength(prefix: string): number | undefined {
  const match = prefix.match(/\/(\d{1,3})$/)
  if (!match) return undefined
  const value = Number(match[1])
  return prefix.includes(':') ? value <= 128 ? value : undefined : value <= 32 ? value : undefined
}

export function validRoutePrefix(prefix: string): boolean {
  const value = prefix.trim()
  const [address] = value.split('/')
  const length = prefixLength(value)
  if (length === undefined || value.split('/').length !== 2) return false
  return address.includes(':') ? ipv6Number(address) !== undefined : ipv4Integer(address) !== undefined
}

export function validIpAddress(address: string): boolean {
  const value = address.trim()
  return value.includes(':') ? ipv6Number(value) !== undefined : ipv4Integer(value) !== undefined
}

export function ipv6Number(address: string): bigint | undefined {
  const source = address.trim().toLowerCase().split('%')[0]
  if (!source || source.includes(':::') || (source.match(/::/g)?.length ?? 0) > 1) return undefined
  const halves = source.split('::')
  const left = halves[0] ? halves[0].split(':') : []
  const right = halves.length > 1 && halves[1] ? halves[1].split(':') : []
  if (halves.length > 1 && left.length + right.length >= 8) return undefined
  const groups = halves.length === 1 ? left : [...left, ...Array(Math.max(0, 8 - left.length - right.length)).fill('0'), ...right]
  if (groups.length !== 8 || groups.some((part) => !/^[\da-f]{1,4}$/.test(part))) return undefined
  return groups.reduce((value, part) => (value << 16n) | BigInt(`0x${part}`), 0n)
}

function addressMatches(address: string, prefix: string): boolean {
  const [networkText] = prefix.split('/')
  const length = prefixLength(prefix)
  if (length === undefined || !networkText) return false
  if (address.includes(':') !== networkText.includes(':')) return false
  if (address.includes(':')) {
    const value = ipv6Number(address)
    const network = ipv6Number(networkText)
    if (value === undefined || network === undefined) return false
    const shift = BigInt(128 - length)
    return (value >> shift) === (network >> shift)
  }
  const value = ipv4Integer(address)
  const network = ipv4Integer(networkText)
  if (value === undefined || network === undefined) return false
  const block = 2 ** (32 - length)
  return Math.floor(value / block) === Math.floor(network / block)
}

function ipv4Integer(address: string): number | undefined {
  const parts = address.split('.')
  if (parts.length !== 4 || parts.some((part) => !/^\d{1,3}$/.test(part))) return undefined
  const octets = parts.map(Number)
  if (octets.some((part) => part < 0 || part > 255)) return undefined
  return octets.reduce((value, octet) => value * 256 + octet, 0)
}

export function lookupLongestPrefix(destination: string, routes: RouteEntry[]): RouteLookup {
  const candidates = routes.filter((route) => addressMatches(destination, route.prefix))
    .sort((a, b) => (prefixLength(b.prefix) ?? -1) - (prefixLength(a.prefix) ?? -1) || a.administrativeDistance - b.administrativeDistance || a.metric - b.metric)
  return { destination, candidates, winner: candidates[0] ?? null }
}

function interfaceNames(id: DeviceId, kind: string): string[] {
  if (kind === 'switch') return ['Gi0/1 · access', 'Gi0/2 · trunk', 'Gi0/3 · trunk']
  if (kind === 'router') return ['Gi0/0 · VLAN 10', 'Gi0/1 · VLAN 20', 'Gi0/2 · WAN']
  if (kind === 'ap') return ['Ethernet0 · uplink', 'Radio0 · 5 GHz']
  return [id === 'windows' ? 'Ethernet0' : id === 'linux' ? 'eth0' : 'Ethernet0']
}

function baseIPv4(id: DeviceId, scenarioId: string): DeviceRuntimeState['ipv4'] {
  if (id === 'windows' && ['dhcp', 'dhcp-relay', 'wifi-join'].includes(scenarioId)) return { address: 'Unconfigured · DHCP pending', prefix: 0, gateway: '—', dns: '—', vlan: scenarioId === 'dhcp-relay' ? '20' : '10' }
  if (id === 'windows') return { address: scenarioId === 'stateful-firewall' ? '192.168.10.42' : scenarioId === 'dhcp-relay' ? '10.20.0.42' : '192.168.10.42', prefix: 24, gateway: scenarioId === 'dhcp-relay' ? '10.20.0.1' : '192.168.10.1', dns: '192.168.10.53', vlan: scenarioId === 'dhcp-relay' ? '20' : '10' }
  if (id === 'linux') return { address: '192.168.10.22', prefix: 24, gateway: '192.168.10.1', dns: '192.168.10.53', vlan: '10' }
  if (id === 'router') return { address: '192.168.10.1', prefix: 24, gateway: '198.51.100.1', dns: '—', vlan: '10,20,WAN' }
  if (id === 'dhcp') return { address: '192.168.10.20', prefix: 24, gateway: '192.168.10.1', dns: '192.168.10.53', vlan: '10,20' }
  if (id === 'dns') return { address: '192.168.10.53', prefix: 24, gateway: '192.168.10.1', dns: '127.0.0.1', vlan: '10' }
  if (id === 'web') return { address: '203.0.113.25', prefix: 24, gateway: '203.0.113.1', dns: '—', vlan: '20,WAN' }
  return { address: '—', prefix: 0, gateway: '—', dns: '—', vlan: '10' }
}

function createDeviceState(id: DeviceId, scenarioId: string): DeviceRuntimeState {
  const device = devices[id]
  const interfaces = interfaceNames(id, device.kind).map((name) => ({
    name, status: 'up' as const, speedMbps: 1000, duplex: 'full' as const, mtu: 1500,
    latencyMs: 2, jitterMs: 0, lossPercent: 0, packetsIn: 0, packetsOut: 0, errors: 0, drops: 0,
  }))
  const routes = id === 'router' ? [
    { prefix: '192.168.10.0/24', nextHop: '—', interface: 'Gi0/0', protocol: 'connected' as const, metric: 0, administrativeDistance: 0 },
    { prefix: '192.168.20.0/24', nextHop: '—', interface: 'Gi0/1', protocol: 'connected' as const, metric: 0, administrativeDistance: 0 },
    { prefix: '0.0.0.0/0', nextHop: '198.51.100.1', interface: 'Gi0/2', protocol: 'default' as const, metric: 1, administrativeDistance: 1 },
    ...(scenarioId === 'route-lpm' ? [...ipv4RouteTable, ...ipv6RouteTable] : scenarioId.startsWith('ipv6-') ? [...ipv6RouteTable] : []),
  ] : id === 'windows' || id === 'linux' ? [
    ...(validIpAddress(baseIPv4(id, scenarioId).gateway) ? [{ prefix: '0.0.0.0/0', nextHop: baseIPv4(id, scenarioId).gateway, interface: interfaces[0].name, protocol: 'default' as const, metric: 0, administrativeDistance: 0 }] : []),
    ...(id === 'windows' && scenarioId.startsWith('ipv6-') ? [{ prefix: 'fe80::/64', nextHop: '—', interface: interfaces[0].name, protocol: 'connected' as const, metric: 0, administrativeDistance: 0 }] : []),
  ] : []
  const ipv6Addresses = id === 'windows'
    ? ['fe80::a/64']
    : id === 'router' && scenarioId.startsWith('ipv6-') ? ['fe80::1/64', '2001:db8:10::1/64'] : []
  return {
    id, name: device.name, kind: device.kind, interfaces,
    ipv4: baseIPv4(id, scenarioId),
    ipv6: { addresses: ipv6Addresses, gateway: '—', prefix: '—', dns: '2001:db8:10::53' },
    arpCache: {}, neighborCache: {}, macTable: {}, routes, tables: {}, changedAtEvent: null,
  }
}

export function linkKey(from: DeviceId, to: DeviceId): string {
  return [from, to].sort().join('--')
}

export function scenarioLinks(scenario: Scenario): LinkCondition[] {
  const selected = scenario.topology?.links ?? links
  return selected.map(([from, to]) => ({
    id: linkKey(from, to), from, to, status: 'up', speedMbps: 1000, duplex: 'full', mtu: 1500,
    latencyMs: 2, jitterMs: 0, lossPercent: 0,
  }))
}

function applyDeviceChange(device: DeviceRuntimeState, entry: DeviceChange, eventOrder: number | null): DeviceRuntimeState {
  const table = { ...(device.tables[entry.table] ?? {}) }
  if (entry.action === 'expired') delete table[entry.key]
  else table[entry.key] = entry.value
  const tables = { ...device.tables, [entry.table]: table }
  const next: DeviceRuntimeState = { ...device, tables, changedAtEvent: eventOrder }
  if (entry.table === 'ARP cache') {
    const arpCache = { ...device.arpCache }
    if (entry.action === 'expired') delete arpCache[entry.key]
    else arpCache[entry.key] = entry.value
    next.arpCache = arpCache
  }
  if (entry.table === 'IPv6 neighbor cache') {
    const neighborCache = { ...device.neighborCache }
    if (entry.action === 'expired') delete neighborCache[entry.key]
    else neighborCache[entry.key] = entry.value
    next.neighborCache = neighborCache
  }
  if (entry.table === 'MAC address table') {
    const macTable = { ...device.macTable }
    if (entry.action === 'expired') delete macTable[entry.key]
    else macTable[entry.key] = entry.value
    next.macTable = macTable
  }
  if (entry.table === 'IPv4 configuration' || entry.table === 'DHCP state') {
    const key = entry.key.toLowerCase()
    const value = entry.value
    let ipv4 = device.ipv4
    const addresses = value.match(/(?:\d{1,3}\.){3}\d{1,3}/g) ?? []
    const addressMatch = addresses[0]
    const prefixMatch = value.match(/\/(\d{1,2})/)?.[1]
    if (key.includes('address') && addressMatch && addressMatch !== '0.0.0.0') ipv4 = { ...ipv4, address: addressMatch, prefix: prefixMatch ? Number(prefixMatch) : ipv4.prefix || 24 }
    if (key.includes('address') && /no ipv4|no address|unconfigured/i.test(value)) ipv4 = { ...ipv4, address: 'Unconfigured · DHCP pending', prefix: 0 }
    if (key.includes('subnet mask') || key === 'mask') {
      const mask = value.match(/(?:\d{1,3}\.){3}\d{1,3}/)?.[0]
      if (mask) ipv4 = { ...ipv4, prefix: maskToPrefix(mask) ?? ipv4.prefix }
    }
    if (key.includes('gateway') || key.includes('default route')) {
      if (addresses.length) ipv4 = { ...ipv4, gateway: addresses[addresses.length - 1] }
      else if (/no gateway|no default/i.test(value)) ipv4 = { ...ipv4, gateway: '—' }
    }
    if (key.includes('dns')) {
      if (addressMatch) ipv4 = { ...ipv4, dns: addressMatch }
      else if (/no dns/i.test(value)) ipv4 = { ...ipv4, dns: '—' }
    }
    if (key.includes('vlan') && /^\d+$/.test(value.trim())) ipv4 = { ...ipv4, vlan: value.trim() }
    next.ipv4 = ipv4
    if ((key.includes('gateway') || key.includes('default route')) && ipv4.gateway !== device.ipv4.gateway) {
      const routes = next.routes.filter((route) => route.prefix !== '0.0.0.0/0')
      if (validIpAddress(ipv4.gateway)) routes.push({ prefix: '0.0.0.0/0', nextHop: ipv4.gateway, interface: next.interfaces[0]?.name ?? 'Ethernet0', protocol: 'default', metric: 0, administrativeDistance: 1 })
      next.routes = routes
    }
  }
  if (entry.table.toLowerCase().includes('ipv6') && entry.key.toLowerCase().includes('address')) {
    const address = entry.value.match(/[0-9a-f]*:[0-9a-f:]+(?:\/\d{1,3})?/i)?.[0]
    const addresses = address ? entry.action === 'expired' ? device.ipv6.addresses.filter((item) => item !== address) : [...new Set([...device.ipv6.addresses, address])] : device.ipv6.addresses
    next.ipv6 = { ...device.ipv6, addresses }
  }
  if (entry.table.toLowerCase().includes('ipv6 configuration')) {
    const key = entry.key.toLowerCase()
    const address = entry.value.match(/[0-9a-f]*:[0-9a-f:]+(?:\/\d{1,3})?/i)?.[0]
    if (key.includes('prefix') && address) {
      next.ipv6 = { ...next.ipv6, prefix: address }
      const routes = next.routes.filter((route) => route.prefix !== address)
      if (entry.action !== 'expired') routes.push({ prefix: address, nextHop: '—', interface: next.interfaces[0]?.name ?? 'Ethernet0', protocol: 'connected', metric: 0, administrativeDistance: 0 })
      next.routes = routes
    }
    if ((key.includes('router') || key.includes('gateway')) && address) {
      next.ipv6 = { ...next.ipv6, gateway: address }
      const routes = next.routes.filter((route) => route.prefix !== '::/0')
      if (entry.action !== 'expired') routes.push({ prefix: '::/0', nextHop: address, interface: next.interfaces[0]?.name ?? 'Ethernet0', protocol: 'default', metric: 0, administrativeDistance: 1 })
      next.routes = routes
    }
  }
  if (/^ipv[46] routing table$/i.test(entry.table)) {
    const prefix = entry.key.trim()
    const nextHop = entry.value.match(/\bvia\s+([^ ·]+)/i)?.[1] ?? '—'
    const iface = entry.value.match(/\b((?:gi|eth|ethernet)[\w./-]+)/i)?.[1] ?? (device.interfaces[0]?.name ?? 'Ethernet0')
    const metric = Number(entry.value.match(/\bmetric\s+(\d+)/i)?.[1] ?? 0)
    const routes = next.routes.filter((route) => route.prefix !== prefix)
    if (entry.action !== 'expired') routes.push({ prefix, nextHop, interface: iface, protocol: prefix === '::/0' || prefix === '0.0.0.0/0' ? 'default' : 'static', metric, administrativeDistance: 1 })
    next.routes = routes
    if (prefix === '::/0') next.ipv6 = { ...next.ipv6, gateway: entry.action === 'expired' ? '—' : nextHop }
  }
  return next
}

export function applyNetworkEvent(state: NetworkRuntimeState, step: SimulationStep): NetworkRuntimeState {
  let nextDevices = state.devices
  const ensureCopy = () => { if (nextDevices === state.devices) nextDevices = { ...state.devices } }
  const last = step.route.length - 1
  step.route.forEach((id, index) => {
    ensureCopy()
    const current = nextDevices[id]
    const interfaces = current.interfaces.map((iface, portIndex) => portIndex === 0 ? {
      ...iface,
      packetsOut: iface.packetsOut + (index === 0 ? 1 : 0),
      packetsIn: iface.packetsIn + (index === last ? 1 : 0),
    } : iface)
    nextDevices[id] = { ...current, interfaces }
  })
  for (const entry of step.deviceChanges) {
    ensureCopy()
    nextDevices[entry.deviceId] = applyDeviceChange(nextDevices[entry.deviceId], entry, step.order)
  }
  return {
    ...state,
    eventIndex: step.order - 1,
    devices: nextDevices,
    events: [...state.events, step].slice(-256),
    recentChanges: step.deviceChanges,
    totalEventsApplied: state.totalEventsApplied + 1,
  }
}

export function createNetworkState(scenario: Scenario, throughIndex: number): NetworkRuntimeState {
  let state: NetworkRuntimeState = {
    scenarioId: scenario.id, eventIndex: -1,
    devices: Object.fromEntries(deviceIds.map((id) => [id, createDeviceState(id, scenario.id)])) as Record<DeviceId, DeviceRuntimeState>,
    events: [], recentChanges: [], totalEventsApplied: 0,
  }
  for (const entry of scenario.initialState) {
    state.devices[entry.deviceId] = applyDeviceChange(state.devices[entry.deviceId], entry, null)
  }
  const limit = Math.max(-1, Math.min(throughIndex, scenario.steps.length - 1))
  for (let index = 0; index <= limit; index += 1) state = applyNetworkEvent(state, scenario.steps[index])
  return state
}

function maskToPrefix(mask: string): number | undefined {
  const number = ipv4Integer(mask)
  if (number === undefined) return undefined
  const binary = number.toString(2).padStart(32, '0')
  return /^1*0*$/.test(binary) ? (binary.match(/1/g) ?? []).length : undefined
}

function protocolOf(step: SimulationStep): string {
  return [step.protocol, step.network?.protocol, step.transport?.protocol].filter(Boolean).join(' ').toLowerCase()
}

export type CaptureRow = {
  number: number
  eventIndex: number
  time: string
  source: string
  destination: string
  protocol: string
  info: string
  step: SimulationStep
}

export function captureRows(scenario: Scenario, throughIndex: number): CaptureRow[] {
  const end = Math.min(throughIndex, scenario.steps.length - 1)
  const start = Math.max(0, end - 255)
  return scenario.steps.slice(start, end + 1).map((step, offset) => ({
    number: start + offset + 1,
    eventIndex: start + offset,
    time: `${((start + offset) * 0.003).toFixed(3)}`,
    source: step.network?.source ?? step.ethernet?.source ?? devices[step.sourceDevice].shortName,
    destination: step.network?.destination ?? step.ethernet?.destination ?? devices[step.destinationDevice].shortName,
    protocol: step.transport?.protocol ?? step.network?.protocol ?? step.protocol.split(' · ')[0],
    info: step.payload,
    step,
  }))
}

export function filterCaptureRows(rows: CaptureRow[], rawFilter: string): CaptureRow[] {
  const filter = rawFilter.trim().toLowerCase()
  if (!filter) return rows
  const port = filter.match(/^(tcp|udp)\.port\s*==\s*(\d+)$/)
  const ipAddress = filter.match(/^ip\.addr\s*==\s*([\da-f:.]+)$/)
  return rows.filter((row) => {
    const step = row.step
    const text = `${protocolOf(step)} ${row.info} ${row.source} ${row.destination}`.toLowerCase()
    if (port) return step.transport?.protocol.toLowerCase() === port[1] && [step.transport.sourcePort, step.transport.destinationPort].includes(port[2])
    if (ipAddress) return step.network?.source.toLowerCase() === ipAddress[1] || step.network?.destination.toLowerCase() === ipAddress[1]
    return text.includes(filter)
  })
}

export type PacketTransition = {
  before: { ethernet: SimulationStep['ethernet']; network: SimulationStep['network']; transport: SimulationStep['transport'] }
  decision: { device: string; lookup: string; result: string; explanation: string }
  after: { ethernet: SimulationStep['ethernet']; network: SimulationStep['network']; transport: SimulationStep['transport'] }
}

export function packetTransition(scenario: Scenario, index: number): PacketTransition {
  const step = scenario.steps[Math.max(0, Math.min(index, scenario.steps.length - 1))]
  const previous = scenario.steps[index - 1]
  const next = scenario.steps[index + 1]
  const hop = step.hopFrames?.[0]
  const networkProtocol = step.network?.protocol
  const routablePacket = (networkProtocol === 'IPv4' || networkProtocol === 'IPv6') && step.network?.destination !== '255.255.255.255'
  const routerDecision = step.route.includes('router') && routablePacket
  const decisionDevice = step.kind === 'decision' ? step.sourceDevice : routerDecision ? 'router' : step.route[1] ?? step.sourceDevice
  const alreadyForwarded = step.sourceDevice === 'router' && /NAT|TRANSLAT|FORWARD|HOP LIMIT/i.test(step.protocol)
  const routerForward = step.route.includes('router') && !alreadyForwarded
  const routerEgress = step.sourceDevice === 'router' && routablePacket
  const afterNetwork = step.network ? { ...step.network, ttl: step.network.ttl && routerForward ? step.network.ttl - 1 : step.network.ttl } : null
  const afterEthernet = hop
    ? { source: hop.sourceMac, destination: hop.destinationMac, note: hop.note, vlan: step.ethernet?.vlan }
    : step.ethernet ?? (step.kind === 'decision' && decisionDevice === 'router' && step.route.length > 1
      ? { source: devices[step.route[0]].mac, destination: devices[step.route[1]].mac, note: 'New link-layer header for the selected egress path' }
      : null)
  const isTranslation = /NAT|TRANSLAT/i.test(step.protocol)
  const translatedNext = next && /NAT|TRANSLAT/i.test(next.protocol) && next.network?.protocol !== step.network?.protocol ? next : undefined
  const transitionBefore = (isTranslation || routerEgress) && previous ? previous : step
  const transitionAfter = isTranslation || routerEgress ? step : translatedNext ?? undefined
  const routeLookup = lookupLongestPrefix(step.network?.destination ?? '', routerDecision || (step.kind === 'decision' && decisionDevice === 'router' && routablePacket) ? (scenario.id === 'route-lpm' ? [...ipv4RouteTable, ...ipv6RouteTable] : createDeviceState('router', scenario.id).routes) : [])
  const matched = routeLookup.winner ? `Longest matching route ${routeLookup.winner.prefix} via ${routeLookup.winner.nextHop} · ${routeLookup.winner.interface}` : step.egressInterface
  return {
    before: { ethernet: transitionBefore.ethernet, network: transitionBefore.network, transport: transitionBefore.transport },
    decision: {
      device: devices[decisionDevice].name,
      lookup: step.kind === 'decision' ? step.protocol : step.ethernet?.destination === 'FF:FF:FF:FF:FF:FF' ? 'Broadcast / flooding decision' : routeLookup.candidates.length ? 'Destination route lookup' : 'Forwarding / next-hop decision',
      result: routeLookup.winner ? matched : step.egressInterface,
      explanation: step.explanation,
    },
    after: {
      ethernet: transitionAfter?.ethernet ?? afterEthernet,
      network: transitionAfter?.network ?? afterNetwork,
      transport: transitionAfter?.transport ?? step.transport,
    },
  }
}

export function buildScenarioRoutes(scenarioId: string): RouteEntry[] {
  return scenarioId === 'route-lpm' ? [...ipv4RouteTable, ...ipv6RouteTable] : []
}

export function routeTableForLab(): RouteEntry[] {
  return [...ipv4RouteTable, ...ipv6RouteTable]
}

export function deterministicPercent(seed: string, attempt: number, linkId: string): number {
  let hash = 2166136261
  const input = `${seed}:${attempt}:${linkId}`
  for (let index = 0; index < input.length; index += 1) hash = Math.imul(hash ^ input.charCodeAt(index), 16777619)
  return (hash >>> 0) % 1000 / 10
}

export function simulatePathProbe(route: DeviceId[], conditions: LinkCondition[], seed = 'netlab', attempt = 1, payloadBytes = 32): ProbeResult {
  if (route.length < 2) return { ok: true, status: 'LOCAL', explanation: 'The destination is on the same simulated link.', route }
  const path: LinkCondition[] = []
  for (let index = 0; index < route.length - 1; index += 1) {
    const edge = conditions.find((link) => link.id === linkKey(route[index], route[index + 1]))
    if (!edge) return { ok: false, status: 'NO PATH', explanation: `No simulated link connects ${devices[route[index]].shortName} to ${devices[route[index + 1]].shortName}.`, route: route.slice(0, index + 1), droppedAt: devices[route[index]].shortName }
    if (edge.status === 'down') return { ok: false, status: 'LINK DOWN', explanation: `The link ${devices[edge.from].shortName} ↔ ${devices[edge.to].shortName} is down.`, route: route.slice(0, index + 1), droppedAt: `${devices[edge.from].shortName} · ${devices[edge.to].shortName}` }
    path.push(edge)
  }
  const mtu = Math.min(...path.map((link) => link.mtu))
  const overhead = route.some((id) => id === 'router') ? 28 : 48
  if (payloadBytes + overhead > mtu) return { ok: false, status: 'MTU EXCEEDED', explanation: `${payloadBytes + overhead}-byte probe exceeds the path MTU of ${mtu} bytes.`, route: route.slice(0, -1), droppedAt: 'Path MTU' }
  const lossIndex = path.findIndex((link) => {
    const sampledLoss = deterministicPercent(seed, attempt, link.id) < link.lossPercent
    const collisionBurst = link.duplex === 'half' && deterministicPercent(`${seed}:collision`, attempt, link.id) < 15
    return sampledLoss || collisionBurst
  })
  if (lossIndex >= 0) {
    const loss = path[lossIndex]
    const collisionBurst = loss.duplex === 'half' && deterministicPercent(`${seed}:collision`, attempt, loss.id) < 15
    return {
      ok: false,
      status: 'REQUEST TIMED OUT',
      explanation: collisionBurst ? `A deterministic half-duplex collision/retry burst timed out a probe on ${devices[loss.from].shortName} ↔ ${devices[loss.to].shortName}.` : `A deterministic ${loss.lossPercent}% loss profile dropped this probe on ${devices[loss.from].shortName} ↔ ${devices[loss.to].shortName}.`,
      route: route.slice(0, lossIndex + 1),
      droppedAt: loss.id,
    }
  }
  const latencyMs = path.reduce((sum, link, index) => sum + link.latencyMs + (link.jitterMs ? deterministicPercent(seed, attempt + index, link.id) / 100 * link.jitterMs : 0), 0)
  return { ok: true, status: 'REPLY RECEIVED', explanation: `Reply returned through ${route.map((id) => devices[id].shortName).join(' → ')}.`, route, latencyMs: Math.round(latencyMs * 10) / 10 }
}

export function scenarioProbeRoute(scenario: Scenario, stepIndex: number): DeviceId[] {
  const current = scenario.steps[Math.max(0, Math.min(stepIndex, scenario.steps.length - 1))]
  if (['routing', 'https', 'nat-pat', 'traceroute', 'stateful-firewall', 'route-lpm'].includes(scenario.id)) {
    const endToEnd: DeviceId[] = ['windows', 'switch', 'router', 'internet', 'web']
    const edges = new Set(scenarioLinks(scenario).map((link) => link.id))
    if (endToEnd.slice(0, -1).every((device, index) => edges.has(linkKey(device, endToEnd[index + 1])))) return endToEnd
  }
  const useful = scenario.steps.find((step) => step.kind === 'packet' && step.route.length > 1)
  return current?.route.length > 1 ? current.route : useful?.route ?? ['windows', 'switch']
}

function formatRoutes(routes: RouteEntry[], family: 'ipv4' | 'ipv6'): string {
  const selected = routes.filter((route) => route.prefix.includes(':') === (family === 'ipv6'))
  return selected.length ? selected.map((route) => `${route.prefix.padEnd(25)} ${route.protocol.padEnd(10)} via ${route.nextHop} · ${route.interface} · metric ${route.metric}`).join('\n') : 'No routes installed.'
}

export type CliResult = { command: string; output: string; eventIndex?: number; route?: DeviceId[] }
export type CliOptions = { routeOverrides?: RouteEntry[] }

export function runCliCommand(command: string, scenario: Scenario, state: NetworkRuntimeState, conditions: LinkCondition[], probeAttempt = 1, options: CliOptions = {}): CliResult {
  const raw = command.trim()
  const lower = raw.toLowerCase().replace(/\s+/g, ' ')
  const client = state.devices.windows
  const router = state.devices.router
  const routes = options.routeOverrides ?? router.routes
  const captureEvent = (target: string) => scenario.steps.findIndex((step) => step.network?.source === target || step.network?.destination === target)
  if (/^ipconfig(?: \/all)?$/.test(lower)) {
    const dns = client.ipv4.dns === '—' ? 'No DNS server configured' : client.ipv4.dns
    return { command: raw, output: `Windows IP Configuration\n\nEthernet adapter Ethernet0:\n   IPv4 Address . . . . . . . . . . : ${client.ipv4.address}${client.ipv4.prefix ? `/${client.ipv4.prefix}` : ''}\n   Default Gateway . . . . . . . . : ${client.ipv4.gateway}\n   DNS Servers . . . . . . . . . . : ${dns}\n   VLAN . . . . . . . . . . . . . : ${client.ipv4.vlan}\n${lower.endsWith('/all') ? `\n   MAC Address . . . . . . . . . . : ${devices.windows.mac}\n   DHCP State . . . . . . . . . . : ${client.tables['DHCP state']?.State ?? 'Static / not represented'}` : ''}` }
  }
  if (/^ip addr$/.test(lower)) return { command: raw, output: `2: eth0: <BROADCAST,MULTICAST,UP> mtu ${client.interfaces[0].mtu}\n    link/ether ${devices.windows.mac.toLowerCase()}\n    inet ${client.ipv4.address}/${client.ipv4.prefix || 0}\n${client.ipv6.addresses.map((address) => `    inet6 ${address}`).join('\n') || '    inet6 fe80::a/64 scope link (baseline sample)'}` }
  if (/^(?:route print|ip route)$/.test(lower)) return { command: raw, output: `PC-A route summary at this event\nInterface: ${client.ipv4.address}${client.ipv4.prefix ? `/${client.ipv4.prefix}` : ''}\nDefault route: ${client.ipv4.gateway === '—' ? 'not configured' : `0.0.0.0/0 via ${client.ipv4.gateway}`}\nRouter routes are separate; use show ip route to inspect R-01.` }
  if (/^(?:arp(?: -a)?|show arp)$/.test(lower)) {
    const entries = Object.entries(client.arpCache)
    return { command: raw, output: entries.length ? entries.map(([address, mac]) => `${address.padEnd(18)} ${mac}  dynamic`).join('\n') : 'No IPv4 ARP entries are learned on PC-A yet.' }
  }
  if (/^show mac-address-table$/.test(lower)) {
    const rows = Object.entries(state.devices.switch.macTable)
    return { command: raw, output: rows.length ? `VLAN   MAC address        Type      Port\n${rows.map(([mac, port]) => `${(port.match(/VLAN\s+(\d+)/i)?.[1] ?? '?').padEnd(6)} ${mac.padEnd(18)} dynamic   ${port.split(' · ')[0]}`).join('\n')}` : 'The switch CAM table is empty before it receives a source frame.' }
  }
  if (/^show vlan$/.test(lower)) {
    const allowed = state.devices.switch.tables['Trunk Gi0/1']?.['Allowed VLANs']
    return { command: raw, output: allowed ? `SW-01 trunk Gi0/1 · allowed VLANs: ${allowed}\nInspect the event log to see which VLAN 20 frame is dropped or restored.` : `Client access VLAN: ${client.ipv4.vlan}\nOnly the VLANs shown in this journey are modeled. Inspect State for current switch tables.` }
  }
  if (/^show ip route$/.test(lower)) return { command: raw, output: formatRoutes(routes, 'ipv4') }
  if (/^show ipv6 route$/.test(lower)) return { command: raw, output: formatRoutes(routes, 'ipv6') }
  if (/^show interfaces?(?: (.+))?$/.test(lower)) {
    const name = lower.match(/^show interfaces? (.+)$/)?.[1]
    const selected = conditions.filter((link) => !name || link.id.toLowerCase().includes(name) || `${devices[link.from].shortName} ${devices[link.to].shortName}`.toLowerCase().includes(name))
    return { command: raw, output: selected.length ? selected.map((link) => `${devices[link.from].shortName} ↔ ${devices[link.to].shortName} is ${link.status}, line protocol is ${link.status}\n  ${link.speedMbps} Mbps, ${link.duplex}-duplex, MTU ${link.mtu}\n  latency ${link.latencyMs} ms, jitter ${link.jitterMs} ms, loss ${link.lossPercent}%`).join('\n\n') : `No interface or simulated link named ${name}.` }
  }
  if (/^show spanning-tree$/.test(lower)) return { command: raw, output: scenario.id === 'stp-loop' ? `VLAN 30 spanning tree\nRoot ID    Priority 4096 · SW-01\nSW-03 root port    toward SW-01 · forwarding\nSW-03 alternate    toward SW-02 · discarding\nAfter the SW-01 ↔ SW-03 link fails, SW-03 forwards through SW-02.` : 'Spanning Tree port roles are not represented in this journey. Open the STP loop prevention lab to inspect them.' }
  if (/^show (?:running-config|configuration)$/.test(lower)) return { command: raw, output: `R-01 modeled configuration excerpt\nIPv4 interface: ${router.ipv4.address}${router.ipv4.prefix ? `/${router.ipv4.prefix}` : ''}\nUpstream gateway: ${router.ipv4.gateway}\nThis journey does not model a full router operating system or every interface.` }
  if (/^netstat(?: -an)?$/.test(lower)) {
    const sessions = Object.entries(state.devices.router.tables['Firewall session table'] ?? {})
    return { command: raw, output: sessions.length ? `Proto  Local address         Foreign address      State\n${sessions.map(([key, value]) => `TCP    ${key.padEnd(22)} ${value}`).join('\n')}` : 'No simulated TCP sessions are active at this event.' }
  }
  if (/^(?:nslookup|dig)(?:\s+(.+))?$/.test(lower)) {
    const name = lower.match(/^(?:nslookup|dig)\s+(.+)$/)?.[1]
    if (!name) return { command: raw, output: 'Enter a hostname, for example: nslookup example.test' }
    const modeledRecord = name === 'example.test' && ['https', 'nat-pat'].includes(scenario.id)
      ? { address: '203.0.113.25', type: 'A' }
      : name === 'ipv4-service.example' && scenario.id === 'ipv6-nat64'
        ? { address: '64:ff9b::c633:6419', type: 'synthesized AAAA' }
        : null
    if (!modeledRecord) return { command: raw, output: `No DNS record for ${name} is modeled in this lab. Choose a hostname shown in this scenario; no address has been invented.` }
    return { command: raw, output: `Server:  ${client.ipv4.dns === '—' ? 'Simulated resolver' : client.ipv4.dns}\nName:    ${name}\n${modeledRecord.type}: ${modeledRecord.address}\nAnswer from this lab’s modeled DNS record.`, eventIndex: captureEvent(modeledRecord.address) }
  }
  const ping = lower.match(/^ping(?: -l (\d+))?\s+(.+)$/)
  if (ping) {
    const payload = Number(ping[1] ?? 32)
    const target = ping[2]
    if (ipv4Number(target) === undefined) return { command: raw, output: `Invalid IPv4 destination ${target}; no matching route or modeled host.` }
    if (scenario.id === 'route-lpm') {
      const choice = lookupLongestPrefix(target, routes)
      return { command: raw, output: choice.winner ? `Route lookup for ${target}: ${choice.winner.prefix} via ${choice.winner.nextHop} · ${choice.winner.interface}.\nThis lab checks route selection; it does not model an ICMP reply from that destination.` : `Destination ${target}: no matching route.`, route: ['windows', 'switch', 'router'] }
    }
    if (scenario.id !== 'arp-ping' && scenario.id !== 'routing') return { command: raw, output: 'This journey does not model an ICMP echo destination. Use the IP addressing sandbox for editable ping tests, or Lab Tools to check the modeled link path.' }
    const expected = scenario.id === 'arp-ping' ? '10.10.10.22' : '203.0.113.25'
    if (target !== expected) return { command: raw, output: `No host at ${target} is modeled in this lab. The modeled ping destination is ${expected}; no reply was generated.` }
    const route: DeviceId[] = scenario.id === 'arp-ping' ? ['windows', 'switch', 'linux'] : ['windows', 'switch', 'router', 'internet', 'web']
    const result = simulatePathProbe(route, conditions, scenario.id, probeAttempt, payload)
    return { command: raw, output: result.ok ? `Reply from ${target}: bytes=${payload} time=${result.latencyMs}ms\n${result.explanation}` : `Request timed out.\n${result.status}: ${result.explanation}`, eventIndex: captureEvent(target), route: result.route }
  }
  if (/^(?:tracert|traceroute)(?:\s+(.+))?$/.test(lower)) {
    const target = lower.match(/^(?:tracert|traceroute)\s+(.+)$/)?.[1]
    if (!target) return { command: raw, output: 'Enter a destination, for example: tracert 203.0.113.25' }
    if (ipv4Number(target) === undefined) return { command: raw, output: `Invalid IPv4 destination ${target}.` }
    if (!['routing', 'traceroute'].includes(scenario.id) || target !== '203.0.113.25') return { command: raw, output: `No traceroute to ${target} is modeled in this lab. Select the Traceroute journey for 203.0.113.25.` }
    const route = scenarioProbeRoute(scenario, state.eventIndex)
    const failed = simulatePathProbe(route, conditions, scenario.id, probeAttempt, 32)
    const hops = failed.ok ? route : failed.route
    return { command: raw, output: hops.map((id, index) => `${index + 1}  ${devices[id].address ?? devices[id].shortName}  ${devices[id].shortName}`).join('\n') + (failed.ok ? '\nTrace complete.' : `\n* * * ${failed.status} at ${failed.droppedAt}`) }
  }
  if (/^help$/.test(lower)) return { command: raw, output: 'Windows: ipconfig [/all], ping <target>, tracert <target>, nslookup <name>, arp -a, route print, netstat\nLinux: ip addr, ip route, ping <target>, traceroute <target>, dig <name>, arp\nSwitch/router: show interfaces, show mac-address-table, show arp, show ip route, show ipv6 route, show vlan, show spanning-tree, show running-config' }
  return { command: raw, output: `Unrecognized command: ${raw}. Type help for supported networking commands.` }
}

export type TroubleSetting = keyof TroubleshootingConfig | 'staticRouteNextHop'

export function editTroubleshootingSetting(config: TroubleshootingConfig, setting: TroubleSetting, value: string): TroubleshootingConfig {
  switch (setting) {
    case 'address': return { ...config, address: value.trim() }
    case 'mask': return { ...config, mask: value.trim() }
    case 'gateway': return { ...config, gateway: value.trim() }
    case 'vlan': return { ...config, vlan: Math.max(1, Math.min(4094, Math.trunc(Number(value) || 1))) }
    case 'trunkVlans': return { ...config, trunkVlans: [...new Set(value.split(/[ ,]+/).map(Number).filter((vlan) => Number.isInteger(vlan) && vlan >= 1 && vlan <= 4094))] }
    case 'interfaceStatus': return { ...config, interfaceStatus: value === 'down' ? 'down' : 'up' }
    case 'duplicateAddress': return { ...config, duplicateAddress: value === 'true' }
    case 'routes': return { ...config, routes: value === 'restore' ? routeTableForLab() : config.routes }
    case 'staticRouteNextHop': {
      const existing = config.routes.filter((route) => route.prefix !== '10.20.30.128/25')
      if (!value.trim()) return { ...config, routes: existing }
      const route: RouteEntry = { prefix: '10.20.30.128/25', nextHop: value.trim(), interface: 'Gi0/3', protocol: 'static', metric: 5, administrativeDistance: 1 }
      return { ...config, routes: [...existing, route] }
    }
    case 'firewallAllows': return { ...config, firewallAllows: value === 'true' }
    case 'dnsAvailable': return { ...config, dnsAvailable: value === 'true' }
    case 'dhcpAvailable': return { ...config, dhcpAvailable: value === 'true' }
    case 'stpPathAvailable': return { ...config, stpPathAvailable: value === 'true' }
    case 'mtu': return { ...config, mtu: Math.max(576, Math.min(9216, Math.trunc(Number(value) || 1500))) }
    case 'duplexLocal':
    case 'duplexRemote': return { ...config, [setting]: value === 'half' ? 'half' : 'full' }
  }
}

export function correctTroubleshootingSetting(config: TroubleshootingConfig, setting: TroubleSetting): TroubleshootingConfig {
  const baseline = initialTroubleshootConfig()
  switch (setting) {
    case 'address': return { ...config, address: baseline.address, duplicateAddress: false }
    case 'mask': return { ...config, mask: baseline.mask }
    case 'gateway': return { ...config, gateway: baseline.gateway }
    case 'vlan': return { ...config, vlan: baseline.vlan }
    case 'trunkVlans': return { ...config, trunkVlans: [...baseline.trunkVlans] }
    case 'interfaceStatus': return { ...config, interfaceStatus: baseline.interfaceStatus }
    case 'duplicateAddress': return { ...config, duplicateAddress: false }
    case 'routes': return { ...config, routes: baseline.routes }
    case 'staticRouteNextHop': return editTroubleshootingSetting(config, setting, baseline.routes.find((route) => route.prefix === '10.20.30.128/25')?.nextHop ?? '')
    case 'firewallAllows': return { ...config, firewallAllows: baseline.firewallAllows }
    case 'dnsAvailable': return { ...config, dnsAvailable: baseline.dnsAvailable }
    case 'dhcpAvailable': return { ...config, dhcpAvailable: baseline.dhcpAvailable }
    case 'stpPathAvailable': return { ...config, stpPathAvailable: baseline.stpPathAvailable }
    case 'mtu': return { ...config, mtu: baseline.mtu }
    case 'duplexLocal': return { ...config, duplexLocal: baseline.duplexLocal, duplexRemote: baseline.duplexRemote }
    case 'duplexRemote': return { ...config, duplexLocal: baseline.duplexLocal, duplexRemote: baseline.duplexRemote }
  }
}

export function runSandboxCommand(command: string, config: LabConfig): CliResult {
  const raw = command.trim()
  const lower = raw.toLowerCase().replace(/\s+/g, ' ')
  const analysis = analyzeLab(config)
  if (/^ipconfig(?: \/all)?$/.test(lower)) return { command: raw, output: `IPv4 Address . . . . . : ${config.client.address}\nSubnet Mask . . . . . : ${config.client.mask}\nDefault Gateway . . . : ${config.client.gateway}\nDNS Server . . . . . . : 192.168.10.53\nAccess VLAN . . . . . : ${config.client.vlan}` }
  if (/^arp -a$/.test(lower)) return { command: raw, output: analysis.arpTarget === 'No ARP request sent' ? 'No ARP request can be sent because IP settings failed validation.' : `Predicted ARP target: ${analysis.arpTarget}\nThis sandbox calculates neighbor resolution during a ping; it does not keep a persistent ARP cache for this command.` }
  if (/^route print$/.test(lower)) return { command: raw, output: `IPv4 routes for PC-A\n${config.client.address}/${analysis.clientSubnet?.prefix ?? '?'} on-link\n0.0.0.0/0 via ${config.client.gateway} · Ethernet0\nDecision: ${analysis.decision}` }
  const sandboxPing = lower.match(/^ping\s+(.+)$/)
  if (sandboxPing) {
    const target = sandboxPing[1]
    if (ipv4Number(target) === undefined) return { command: raw, output: `Invalid IPv4 destination ${target}.` }
    if (target !== config.server.address) return { command: raw, output: `No host at ${target} is modeled in this sandbox. Server-B is currently ${config.server.address}; no reply was generated.` }
    return { command: raw, output: analysis.verdict === 'success' ? `Reply from ${config.server.address}: bytes=32 time=4ms\n${analysis.summary}` : `${analysis.title}: ${analysis.summary}\nFirst failed check: ${analysis.events.find((event) => event.state === 'blocked')?.title ?? analysis.events.at(-1)?.title}\n${analysis.repair}` }
  }
  if (/^(?:tracert|traceroute)(?:\s+.*)?$/.test(lower)) {
    const target = lower.match(/^(?:tracert|traceroute)\s+(.+)$/)?.[1]
    if (!target || target !== config.server.address) return { command: raw, output: `This sandbox traces only Server-B at its current address ${config.server.address}.` }
    const failed = analysis.events.findIndex((event) => event.state === 'blocked')
    const visible = failed >= 0 ? analysis.events.slice(0, failed + 1) : analysis.events
    return { command: raw, output: visible.map((event, index) => `${index + 1}  ${event.title} · ${event.detail}`).join('\n') }
  }
  if (/^(?:nslookup|dig)(?:\s+.*)?$/.test(lower)) return { command: raw, output: `DNS server: 192.168.10.53\nThis IPv4 sandbox models addressing and ICMP policy; DNS records are outside this scenario.` }
  if (/^help$/.test(lower)) return { command: raw, output: 'ipconfig /all · ping <target> · tracert <target> · nslookup <name> · arp -a · route print' }
  return { command: raw, output: `Unrecognized command: ${raw}. Type help for supported commands.` }
}

export function troubleshootingCliCommand(command: string, config: TroubleshootingConfig): CliResult {
  const raw = command.trim()
  const lower = raw.toLowerCase().replace(/\s+/g, ' ')
  if (/^ipconfig(?: \/all)?$/.test(lower)) return { command: raw, output: `IPv4 Address . . . . . : ${config.address}/${maskToPrefix(config.mask) ?? '?'}\nSubnet Mask . . . . . : ${config.mask}\nDefault Gateway . . . : ${config.gateway}\nAccess VLAN . . . . . : ${config.vlan}\nDHCP scope . . . . . . : ${config.dhcpAvailable ? 'available' : 'exhausted'}` }
  if (/^route print$/.test(lower)) return { command: raw, output: `0.0.0.0/0 via ${config.gateway}\n${config.routes.map((route) => `${route.prefix} via ${route.nextHop} · ${route.interface} · ${route.protocol}`).join('\n') || 'No route entries installed.'}` }
  if (/^show ip route$/.test(lower)) return { command: raw, output: formatRoutes(config.routes, 'ipv4') }
  if (/^show vlan$/.test(lower)) return { command: raw, output: `PC-A access port: VLAN ${config.vlan}\nSW-01 ↔ SW-02 allowed VLANs: ${config.trunkVlans.join(', ') || 'none'}\nVLAN 20: ${config.trunkVlans.includes(20) ? 'allowed on trunk' : 'not allowed on trunk'}` }
  if (/^show interfaces?(?: .*)?$/.test(lower)) return { command: raw, output: `Gi0/8 is ${config.interfaceStatus}, line protocol is ${config.interfaceStatus}\n  ${config.duplexLocal}-duplex / remote ${config.duplexRemote}-duplex, MTU ${config.mtu}\n  ${config.duplexLocal === config.duplexRemote ? '0' : '147'} input errors, simulated counters` }
  if (/^arp -a$/.test(lower)) return { command: raw, output: config.duplicateAddress ? `192.168.10.1  02:42:AC:11:10:01  dynamic\n192.168.10.1  02:42:AC:11:10:99  conflicting response observed` : '192.168.10.1  02:42:AC:11:10:01  dynamic' }
  if (/^show mac-address-table$/.test(lower)) return { command: raw, output: `VLAN ${config.vlan} 02:42:AC:11:00:0A dynamic Gi0/8\nVLAN 20 ${config.trunkVlans.includes(20) ? 'forwarding' : 'not carried'} on SW-01 ↔ SW-02` }
  if (/^show spanning-tree$/.test(lower)) return { command: raw, output: `Root bridge: SW-02 · priority 8192\nAlternate uplink: ${config.stpPathAvailable ? 'forwarding after failover' : 'blocked / unavailable'}\nSTP maintains one loop-free logical forwarding path.` }
  if (/^netstat(?: -an)?$/.test(lower)) return { command: raw, output: config.firewallAllows ? 'TCP 192.168.10.42:52144 192.168.20.20:445 SYN-SENT' : 'No established file-service session; new TCP/445 is blocked by policy.' }
  if (/^(?:nslookup|dig)(?:\s+(.+))?$/.test(lower)) {
    const name = lower.match(/^(?:nslookup|dig)\s+(.+)$/)?.[1]
    if (name !== 'fileserver.example') return { command: raw, output: `Only fileserver.example is represented in this troubleshooting case; no DNS answer exists here for ${name ?? '(missing hostname)'}.` }
    return { command: raw, output: config.dnsAvailable ? `Name: fileserver.example\nAddress: 192.168.20.20` : `** server can't find fileserver.example: SERVFAIL`, eventIndex: 0 }
  }
  const ping = lower.match(/^ping(?: -l (\d+))?\s+(.+)$/)
  if (ping) {
    const target = ping[2]
    if (target !== '192.168.20.20' && target !== 'fileserver.example') return { command: raw, output: `No host at ${target} is represented in this case. Test 192.168.20.20 or fileserver.example.` }
    const hostname = target === 'fileserver.example'
    const result = probeTroubleshooting(config, { test: 'ping', hostname, payloadBytes: ping[1] ? Number(ping[1]) : undefined })
    return { command: raw, output: result.ok ? `Reply from ${target}: bytes=${ping[1] ?? 32} time=${result.latencyMs}ms\n${result.explanation}` : `${result.status}: ${result.explanation}`, route: result.route }
  }
  if (/^help$/.test(lower)) return { command: raw, output: 'ipconfig /all · ping <target> · ping -l <bytes> <target> · tracert <target> · nslookup <name> · arp -a · route print · netstat · show interfaces · show mac-address-table · show ip route · show vlan · show spanning-tree' }
  return { command: raw, output: `Unrecognized command: ${raw}. Type help for supported commands.` }
}

export function electStpRoot(bridges: Array<{ id: string; priority: number; mac: string }>): string | undefined {
  return [...bridges].sort((a, b) => a.priority - b.priority || a.mac.localeCompare(b.mac))[0]?.id
}

export type OspfLink = { from: string; to: string; cost: number; up: boolean }
export type OspfPath = { nodes: string[]; cost: number } | undefined

export function shortestOspfPath(links: OspfLink[], source: string, destination: string): OspfPath {
  const distance = new Map<string, number>([[source, 0]])
  const previous = new Map<string, string>()
  const unvisited = new Set(links.flatMap((link) => [link.from, link.to]))
  while (unvisited.size) {
    let current: string | undefined
    let best = Number.POSITIVE_INFINITY
    for (const node of unvisited) {
      const candidate = distance.get(node) ?? Number.POSITIVE_INFINITY
      if (candidate < best) { best = candidate; current = node }
    }
    if (!current || !Number.isFinite(best)) break
    if (current === destination) {
      const nodes = [destination]
      while (nodes[0] !== source) {
        const parent = previous.get(nodes[0])
        if (!parent) return undefined
        nodes.unshift(parent)
      }
      return { nodes, cost: best }
    }
    unvisited.delete(current)
    for (const link of links.filter((entry) => entry.up && (entry.from === current || entry.to === current))) {
      const neighbor = link.from === current ? link.to : link.from
      const alternative = best + Math.max(1, link.cost)
      if (alternative < (distance.get(neighbor) ?? Number.POSITIVE_INFINITY)) {
        distance.set(neighbor, alternative)
        previous.set(neighbor, current)
      }
    }
  }
  return undefined
}

export type WirelessRadio = { band: '2.4 GHz' | '5 GHz' | '6 GHz'; channel: number; widthMHz: 20 | 40 | 80 | 160; distanceMeters: number; walls: number; interference: number }
export type WirelessEstimate = { rssiDbm: number; quality: 'Excellent' | 'Good' | 'Fair' | 'Weak' | 'Out of range'; coveragePercent: number; note: string }

export function estimateWirelessSignal(radio: WirelessRadio): WirelessEstimate {
  const distance = Math.max(1, radio.distanceMeters)
  const bandPenalty = radio.band === '2.4 GHz' ? 0 : radio.band === '5 GHz' ? 3 : 6
  const widthPenalty = radio.widthMHz >= 160 ? 3 : radio.widthMHz >= 80 ? 2 : radio.widthMHz >= 40 ? 1 : 0
  const channelPenalty = radio.band === '2.4 GHz' && ![1, 6, 11].includes(radio.channel) ? 4 : 0
  const rssiDbm = Math.round(-30 - 20 * Math.log10(distance) - bandPenalty - radio.walls * 5 - radio.interference * 0.22 - widthPenalty - channelPenalty)
  const quality = rssiDbm >= -55 ? 'Excellent' : rssiDbm >= -67 ? 'Good' : rssiDbm >= -75 ? 'Fair' : rssiDbm >= -85 ? 'Weak' : 'Out of range'
  const coveragePercent = Math.max(0, Math.min(100, Math.round((rssiDbm + 100) * 2)))
  const note = radio.band === '2.4 GHz'
    ? '2.4 GHz usually travels farther and penetrates obstacles better; channels 1, 6, and 11 avoid overlap in common 20 MHz plans.'
    : `${radio.band} has more spectrum choices; higher frequency and wider channels can reduce practical range or increase contention.`
  return { rssiDbm, quality, coveragePercent, note }
}

export const troubleshootingCases: TroubleshootingCase[] = [
  { id: 'wrong-gateway', symptom: 'Finance PCs can reach local printers. They cannot reach the file server or the Internet.', diagnosis: 'The workstation has an incorrect default gateway.', repair: 'Set the gateway to the router address on the Finance subnet (192.168.10.1).', initial: { ...initialTroubleshootConfig(), gateway: '192.168.10.254' } },
  { id: 'wrong-mask', symptom: 'A PC can reach nearby hosts but sends remote traffic directly to ARP and never reaches the router.', diagnosis: 'The host subnet mask is too wide, so it treats remote addresses as on-link.', repair: 'Correct the host mask to /24 (255.255.255.0).', initial: { ...initialTroubleshootConfig(), mask: '255.255.0.0' } },
  { id: 'wrong-vlan', symptom: 'One desk cannot reach its gateway. Other desks on the same subnet still work.', diagnosis: 'The access port is assigned to the wrong VLAN.', repair: 'Move the client access port to VLAN 10.', initial: { ...initialTroubleshootConfig(), vlan: 30 } },
  { id: 'missing-trunk-vlan', symptom: 'VLAN 20 hosts work near the distribution switch. VLAN 20 fails across one uplink.', diagnosis: 'VLAN 20 is missing from the trunk allowed-VLAN list.', repair: 'Allow VLAN 20 on the affected trunk.', initial: { ...initialTroubleshootConfig(), trunkVlans: [10, 30] } },
  { id: 'interface-down', symptom: 'A whole group of users lost connectivity after a cable move. Their settings are unchanged.', diagnosis: 'The switch access interface is administratively or physically down.', repair: 'Restore the interface to an up state and verify link.', initial: { ...initialTroubleshootConfig(), interfaceStatus: 'down' } },
  { id: 'duplicate-ip', symptom: 'A workstation intermittently reaches the printer. ARP replies for its address appear to change.', diagnosis: 'Another device is using the workstation IPv4 address.', repair: 'Assign a unique address and clear stale neighbor entries.', initial: { ...initialTroubleshootConfig(), duplicateAddress: true } },
  { id: 'incorrect-static-route', symptom: 'A remote subnet is reachable through a backup router. New traffic now takes a longer, failing path.', diagnosis: 'A more-specific static route points to the wrong next hop.', repair: 'Correct the next hop or remove the incorrect more-specific route.', initial: { ...initialTroubleshootConfig(), routes: [...routeTableForLab(), { prefix: '10.20.30.128/25', nextHop: '192.0.2.254', interface: 'Gi0/3', protocol: 'static', metric: 1, administrativeDistance: 1 }] } },
  { id: 'missing-route', symptom: 'The local gateway responds, but one remote subnet reports destination network unreachable.', diagnosis: 'The router is missing a route to the destination prefix.', repair: 'Install a route for 10.20.0.0/16 through the reachable next hop.', initial: { ...initialTroubleshootConfig(), routes: routeTableForLab().filter((route) => !lookupLongestPrefix('10.20.30.140', [route]).winner) } },
  { id: 'firewall-block', symptom: 'Name resolution works and the server answers pings, but new TCP connections to the file service time out.', diagnosis: 'An ACL or firewall rule blocks the required application flow.', repair: 'Allow the required client-to-server TCP service with a narrow rule.', initial: { ...initialTroubleshootConfig(), firewallAllows: false } },
  { id: 'dns-failure', symptom: 'Users can ping a server by IP address, but applications fail when they use its hostname.', diagnosis: 'The configured DNS service or record is failing.', repair: 'Restore the resolver or correct the missing host record.', initial: { ...initialTroubleshootConfig(), dnsAvailable: false } },
  { id: 'dhcp-exhausted', symptom: 'New clients receive self-assigned addresses. Existing clients with leases still work.', diagnosis: 'The DHCP scope has no free lease addresses.', repair: 'Release stale leases or expand the approved scope.', initial: { ...initialTroubleshootConfig(), dhcpAvailable: false } },
  { id: 'stp-block', symptom: 'A redundant switch path is blocking. After the forwarding uplink fails, a VLAN has no usable path.', diagnosis: 'The spanning-tree alternate path has not transitioned to forwarding.', repair: 'Restore the failed root path or allow STP to reconverge on the alternate.', initial: { ...initialTroubleshootConfig(), stpPathAvailable: false } },
  { id: 'mtu-mismatch', symptom: 'Small pings succeed. Large packets and some application transfers stall across a tunnel.', diagnosis: 'The path MTU is smaller than the packet size and path MTU discovery is not completing.', repair: 'Correct the MTU or permit the required fragmentation feedback.', initial: { ...initialTroubleshootConfig(), mtu: 1300 } },
  { id: 'duplex-mismatch', symptom: 'The link stays up, but users report slow transfers and interface error counters keep increasing.', diagnosis: 'The two link partners have a duplex mismatch.', repair: 'Configure both ends to the same duplex and speed.', initial: { ...initialTroubleshootConfig(), duplexLocal: 'full', duplexRemote: 'half' } },
]

function initialTroubleshootConfig(): TroubleshootingConfig {
  return {
    address: '192.168.10.42', mask: '255.255.255.0', gateway: '192.168.10.1', vlan: 10,
    trunkVlans: [10, 20], interfaceStatus: 'up', duplicateAddress: false,
    routes: routeTableForLab(), firewallAllows: true, dnsAvailable: true, dhcpAvailable: true,
    stpPathAvailable: true, mtu: 1500, duplexLocal: 'full', duplexRemote: 'full',
  }
}

export function troubleshootingCase(index: number): TroubleshootingCase {
  const stable = Math.abs(Math.trunc(index)) % troubleshootingCases.length
  return troubleshootingCases[stable]
}

export function resetTroubleshootingConfig(index: number): TroubleshootingConfig {
  const source = troubleshootingCase(index).initial
  return { ...source, trunkVlans: [...source.trunkVlans], routes: source.routes.map((route) => ({ ...route })) }
}

export function probeTroubleshooting(config: TroubleshootingConfig, options: { hostname?: boolean; payloadBytes?: number; test: 'ping' | 'service' | 'dhcp' }): ProbeResult {
  if (config.interfaceStatus === 'down') return { ok: false, status: 'LINK DOWN', explanation: 'The client access interface is down.', route: ['windows'], droppedAt: 'SW-01 Gi0/8' }
  if (config.duplicateAddress) return { ok: false, status: 'ADDRESS CONFLICT', explanation: `More than one host answers ARP for ${config.address}.`, route: ['windows', 'switch'], droppedAt: 'ARP resolution' }
  if (config.vlan !== 10) return { ok: false, status: 'VLAN MISMATCH', explanation: `The client is in VLAN ${config.vlan}; its gateway is in VLAN 10.`, route: ['windows', 'switch'], droppedAt: 'SW-01 access port' }
  if (!config.trunkVlans.includes(20)) return { ok: false, status: 'VLAN NOT ALLOWED', explanation: 'The inter-switch trunk does not carry VLAN 20.', route: ['windows', 'switch', 'switch2'], droppedAt: 'SW-01 ↔ SW-02 trunk' }
  if (config.gateway !== '192.168.10.1') return { ok: false, status: 'BAD GATEWAY', explanation: `The configured gateway ${config.gateway} does not answer on VLAN 10.`, route: ['windows', 'switch'], droppedAt: config.gateway }
  const prefix = maskToPrefix(config.mask)
  if (prefix === undefined || prefix > 30 || prefix < 1) return { ok: false, status: 'INVALID MASK', explanation: 'The subnet mask is not a contiguous host mask for this LAN.', route: ['windows'], droppedAt: 'IP configuration' }
  if (prefix < 24) return { ok: false, status: 'WRONG MASK', explanation: 'The host treats the remote 192.168.20.20 destination as on-link and ARPs instead of using its router.', route: ['windows', 'switch'], droppedAt: 'ARP for remote host' }
  const selected = lookupLongestPrefix('10.20.30.140', config.routes)
  if (selected.winner?.nextHop === '192.0.2.254') return { ok: false, status: 'BAD ROUTE', explanation: 'A more-specific static route wins, but its next hop is unreachable.', route: ['windows', 'switch', 'router'], droppedAt: selected.winner.interface }
  if (!selected.winner) return { ok: false, status: 'NO ROUTE', explanation: 'The router has no matching route for the destination prefix.', route: ['windows', 'switch', 'router'], droppedAt: 'Route lookup' }
  if (!config.stpPathAvailable) return { ok: false, status: 'NO FORWARDING PATH', explanation: 'The primary STP path failed and the alternate path is not forwarding.', route: ['windows', 'switch', 'switch2'], droppedAt: 'STP alternate port' }
  if (options.hostname && !config.dnsAvailable) return { ok: false, status: 'DNS FAILURE', explanation: 'The name query fails; use an IP test to separate DNS from connectivity.', route: ['windows', 'switch', 'router'], droppedAt: 'DNS resolver' }
  if (options.test === 'service' && !config.firewallAllows) return { ok: false, status: 'FILTERED', explanation: 'The firewall blocks the new application flow while ICMP remains available.', route: ['windows', 'switch', 'router'], droppedAt: 'Firewall policy' }
  if (options.test === 'dhcp' && !config.dhcpAvailable) return { ok: false, status: 'NO DHCP LEASE', explanation: 'The scope is exhausted; existing leased clients continue to work.', route: ['windows', 'switch'], droppedAt: 'DHCP scope' }
  if (options.payloadBytes !== undefined && options.payloadBytes + 28 > config.mtu) return { ok: false, status: 'MTU EXCEEDED', explanation: `${options.payloadBytes + 28}-byte IPv4 packet is larger than the ${config.mtu}-byte path MTU.`, route: ['windows', 'switch', 'router'], droppedAt: 'Path MTU' }
  if (config.duplexLocal !== config.duplexRemote) return { ok: false, status: 'INTERMITTENT LOSS', explanation: 'The duplex mismatch causes collisions and retries on the Ethernet segment.', route: ['windows', 'switch'], droppedAt: 'Gi0/8 counters' }
  return { ok: true, status: 'VERIFIED', explanation: 'Host addressing, VLAN forwarding, routing, and the tested policy permit the path.', route: ['windows', 'switch', 'router', 'internet', 'web'], latencyMs: 4 }
}

export function generateIPv6Address(prefix = '2001:db8:10::/64', hostId = 'a'): string {
  return `${prefix.replace(/\/\d+$/, '').replace(/::$/, '')}::${hostId}`.replace('::::', '::')
}

export function ipv4EmbeddedInNat64(address: string): string | undefined {
  const value = ipv4Integer(address)
  if (value === undefined) return undefined
  const octets = address.split('.').map((part) => Number(part).toString(16).padStart(2, '0'))
  return `64:ff9b::${octets.slice(0, 2).join('')}:${octets.slice(2).join('')}`
}

export function captureSandbox(config: LabConfig): CaptureRow[] {
  const analysis: LabAnalysis = analyzeLab(config)
  return analysis.events.slice(0, 256).map((event, index) => ({
    number: index + 1, eventIndex: index, time: (index * 0.003).toFixed(3),
    source: config.client.address, destination: config.server.address, protocol: event.title.toUpperCase(),
    info: event.detail, step: {
      order: index + 1, kind: 'packet', sourceDevice: index === 0 ? 'windows' : 'router', destinationDevice: index === analysis.events.length - 1 ? 'web' : 'router',
      route: ['windows', 'switch', 'router', 'web'], ingressInterface: 'Gi0/0', egressInterface: 'Gi0/1', protocol: event.title.toUpperCase(), osiLayer: 'Layer 3 · Network',
      ethernet: null, network: { protocol: 'IPv4', source: config.client.address, destination: config.server.address, ttl: 64 }, transport: { protocol: 'ICMP', flags: event.state },
      payload: event.detail, explanation: event.detail, deviceChanges: [],
    },
  }))
}

export function baselineRoutes(): RouteEntry[] {
  return [...ipv4RouteTable]
}
