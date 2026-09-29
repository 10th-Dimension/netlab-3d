import test from 'node:test'
import assert from 'node:assert/strict'
import { devices, scenarios } from '../src/simulation.ts'
import { packetPositionAt, packetProgressAt } from '../src/packetAnimation.ts'
import {
  captureRows,
  createNetworkState,
  correctTroubleshootingSetting,
  deterministicPercent,
  editTroubleshootingSetting,
  electStpRoot,
  estimateWirelessSignal,
  filterCaptureRows,
  ipv4EmbeddedInNat64,
  ipv6Number,
  linkKey,
  lookupLongestPrefix,
  packetTransition,
  routeTableForLab,
  resetTroubleshootingConfig,
  runCliCommand,
  scenarioLinks,
  shortestOspfPath,
  simulatePathProbe,
  troubleshootingCase,
  troubleshootingCases,
  probeTroubleshooting,
  troubleshootingCliCommand,
  validIpAddress,
  validRoutePrefix,
} from '../src/networkEngine.ts'

test('route editor accepts real IP syntax and rejects malformed entries', () => {
  for (const prefix of ['10.20.30.0/24', '0.0.0.0/0', '2001:db8:10::/64']) assert.equal(validRoutePrefix(prefix), true)
  for (const prefix of ['10.20.30.999/24', '10.20.30.0/33', '10.20.30.0', '2001:db8::/129']) assert.equal(validRoutePrefix(prefix), false)
  assert.equal(validIpAddress('10.20.30.1'), true)
  assert.equal(validIpAddress('10.20.30.999'), false)
})

test('initial device addresses and default routes agree with scenario topology', () => {
  for (const id of ['routing', 'traceroute', 'trunk-fault']) {
    const state = createNetworkState(scenarios.find((scenario) => scenario.id === id), -1)
    assert.equal(state.devices.windows.ipv4.address, '10.20.0.10', id)
    assert.equal(state.devices.windows.ipv4.gateway, '10.20.0.1', id)
    assert.equal(state.devices.windows.ipv4.vlan, '20', id)
    assert.equal(state.devices.router.ipv4.address, '10.20.0.1', id)
    assert.equal(state.devices.windows.routes.find((route) => route.prefix === '0.0.0.0/0')?.nextHop, '10.20.0.1', id)
  }
  const vlan = createNetworkState(scenarios.find((scenario) => scenario.id === 'vlan-routing'), -1)
  assert.equal(vlan.devices.linux.ipv4.vlan, '20')
  assert.equal(vlan.devices.linux.routes.find((route) => route.prefix === '0.0.0.0/0')?.nextHop, '10.20.20.1')
  for (const id of ['dhcp', 'dhcp-relay', 'wifi-join']) {
    const state = createNetworkState(scenarios.find((scenario) => scenario.id === id), -1)
    assert.equal(state.devices.windows.ipv4.address, 'Unconfigured · DHCP pending')
    assert.equal(state.devices.windows.routes.some((route) => route.prefix === '0.0.0.0/0'), false)
  }
  const relay = createNetworkState(scenarios.find((scenario) => scenario.id === 'dhcp-relay'), -1)
  assert.equal(relay.devices.router.ipv4.address, '10.20.0.1')
  const stp = createNetworkState(scenarios.find((scenario) => scenario.id === 'stp-loop'), -1)
  assert.equal(stp.devices.windows.ipv4.address, '10.30.0.10')
  assert.equal(stp.devices.linux.ipv4.address, '10.30.0.20')
  assert.equal(stp.devices.windows.ipv4.vlan, '30')
  assert.equal(stp.devices.windows.routes.some((route) => route.prefix === '0.0.0.0/0'), false)
})

test('preserves all original journeys and loads every Phase 2 journey', () => {
  const ids = new Set(scenarios.map((scenario) => scenario.id))
  for (const id of ['dhcp', 'arp-ping', 'routing', 'https', 'vlan-routing', 'dhcp-relay', 'nat-pat', 'traceroute', 'trunk-fault', 'stp-loop', 'wifi-join', 'stateful-firewall', 'ip-sandbox']) assert.ok(ids.has(id))
  for (const id of ['ipv6-addressing', 'ipv6-ndp', 'ipv6-slaac', 'ipv6-gateway', 'ipv6-dual-stack', 'ipv6-routing', 'ipv6-nat64', 'route-lpm', 'troubleshooting', 'wireless-rf']) assert.ok(ids.has(id))
  assert.equal(scenarios.length, 23)
  assert.ok(scenarios.every((scenario) => scenario.steps.length > 0))
  for (const scenario of scenarios) {
    const availableLinks = new Set(scenarioLinks(scenario).map((link) => link.id))
    const visibleNodes = new Set(scenario.topology?.visibleNodes ?? Object.keys(devices).filter((id) => id !== 'switch2' && id !== 'switch3'))
    for (const step of scenario.steps) {
      for (const device of step.route) {
        assert.ok(visibleNodes.has(device), `${scenario.id} event ${step.order} moves through hidden device ${device}`)
      }
      for (let index = 0; index < step.route.length - 1; index++) {
        assert.ok(availableLinks.has(linkKey(step.route[index], step.route[index + 1])), `${scenario.id} event ${step.order} has no rendered link for ${step.route[index]} → ${step.route[index + 1]}`)
      }
      if (step.blockedHop) {
        assert.equal(step.route.at(-1), step.blockedHop[0], `${scenario.id} event ${step.order} must stop at the blocked-hop source`)
        assert.ok(availableLinks.has(linkKey(...step.blockedHop)), `${scenario.id} event ${step.order} drop point has no visible link`)
      }
    }
  }
})

test('the VLAN trunk fault shows the packet reaching the switch and dropping before the router', () => {
  const scenario = scenarios.find((item) => item.id === 'trunk-fault')
  const dropped = scenario.steps.find((step) => step.protocol === 'TRUNK FILTER · VLAN 20 DROPPED')
  assert.deepEqual(dropped.route, ['windows', 'switch'])
  assert.deepEqual(dropped.blockedHop, ['switch', 'router'])
  assert.match(dropped.explanation, /discards it at trunk Gi0\/1/i)
})

test('every packet journey has a complete, finite visual path or is an explicitly local decision', () => {
  let animatedEvents = 0
  let localDecisions = 0
  for (const scenario of scenarios) {
    for (const step of scenario.steps) {
      if (step.route.length < 2) {
        assert.equal(step.kind, 'decision', `${scenario.id} event ${step.order} is missing a packet route`)
        assert.equal(step.route.length, 1, `${scenario.id} event ${step.order} has no animation route`)
        localDecisions += 1
        continue
      }
      animatedEvents += 1
      const start = packetPositionAt(step.route, 0, devices)
      const middle = packetPositionAt(step.route, 0.5, devices)
      const finish = packetPositionAt(step.route, 1, devices)
      assert.ok(start && middle && finish, `${scenario.id} event ${step.order} must resolve its device positions`)
      const startExpected = [devices[step.route[0]].position[0], 0.53, devices[step.route[0]].position[2]]
      const finishExpected = [devices[step.route.at(-1)].position[0], 0.53, devices[step.route.at(-1)].position[2]]
      assert.ok(start.every((value, index) => Math.abs(value - startExpected[index]) < 1e-12), `${scenario.id} event ${step.order} does not begin at its source`)
      assert.ok(finish.every((value, index) => Math.abs(value - finishExpected[index]) < 1e-12), `${scenario.id} event ${step.order} does not reach its destination`)
      assert.ok(middle.every(Number.isFinite), `${scenario.id} event ${step.order} has a non-finite midpoint`)
      assert.equal(packetProgressAt(20, 20, 1.65), 0)
      assert.ok(Math.abs(packetProgressAt(20.825, 20, 1.65) - 0.5) < 1e-12)
      assert.ok(Math.abs(packetProgressAt(21.65, 20, 1.65) - 1) < 1e-12)
      assert.ok(Math.abs(packetProgressAt(20.4125, 20, 1.65, 1, 0.25) - 0.5) < 1e-12, 'resuming playback continues from its paused position')
      assert.equal(packetProgressAt(21.65, 20, 1.65, 0.75, 0.9), 0.75, 'blocked routes stop at their boundary')
    }
  }
  assert.ok(animatedEvents > 100, `expected broad packet coverage, saw ${animatedEvents} animated events`)
  assert.ok(localDecisions > 0)
})

test('event replay mutates one visible DHCP lease and ARP state', () => {
  const dhcp = scenarios.find((scenario) => scenario.id === 'dhcp')
  const beforeAck = createNetworkState(dhcp, 2)
  const afterAck = createNetworkState(dhcp, 3)
  assert.equal(beforeAck.devices.windows.ipv4.address, 'Unconfigured · DHCP pending')
  assert.equal(afterAck.devices.windows.ipv4.address, '192.168.10.42')
  assert.equal(afterAck.devices.windows.ipv4.gateway, '192.168.10.1')
  assert.equal(afterAck.devices.dhcp.tables['Lease pool']['192.168.10.42'], 'Active · expires in 24 hours')

  const arp = scenarios.find((scenario) => scenario.id === 'arp-ping')
  const arpStep = arp.steps.findIndex((step) => step.deviceChanges.some((change) => change.table === 'ARP cache'))
  const learned = createNetworkState(arp, arpStep)
  assert.ok(Object.keys(learned.devices.windows.arpCache).length > 0)
  assert.ok(learned.devices.windows.interfaces[0].packetsOut > 0)
})

test('packet transitions show routing, TTL, MAC, and PAT changes at the device', () => {
  const routing = scenarios.find((scenario) => scenario.id === 'routing')
  const routed = packetTransition(routing, 3)
  assert.equal(routed.decision.device, 'Router / default gateway')
  assert.equal(routed.decision.result.includes('0.0.0.0/0'), true)
  assert.equal(routed.after.network.ttl, 63)
  const forwarded = packetTransition(routing, 4)
  assert.equal(forwarded.before.network.ttl, 64)
  assert.equal(forwarded.after.network.ttl, 63)
  assert.equal(forwarded.before.ethernet.destination, '02:42:AC:11:10:01')
  assert.equal(forwarded.after.ethernet.source, '02:42:AC:11:10:01')

  const nat = scenarios.find((scenario) => scenario.id === 'nat-pat')
  const translated = packetTransition(nat, 1)
  assert.equal(translated.before.network.source, '192.168.10.42')
  assert.equal(translated.before.transport.sourcePort, '51522')
  assert.equal(translated.after.network.source, '198.51.100.2')
  assert.equal(translated.after.transport.sourcePort, '62001')
  assert.equal(translated.after.network.ttl, 63)

  const firewall = scenarios.find((scenario) => scenario.id === 'stateful-firewall')
  const allowedIndex = firewall.steps.findIndex((step) => step.protocol.includes('FIREWALL ALLOWS'))
  const inspected = packetTransition(firewall, allowedIndex)
  assert.equal(inspected.before.network.source, '192.168.10.42')
  assert.equal(inspected.after.ethernet.source, '02:42:AC:11:10:01')
  const sessionState = createNetworkState(firewall, allowedIndex)
  assert.match(Object.values(sessionState.devices.router.tables['Firewall session table']).join(' '), /return traffic permitted/)
  const denyIndex = firewall.steps.findIndex((step) => step.deviceChanges.some((change) => change.table === 'Firewall log' && change.value.startsWith('DENY')))
  const deniedState = createNetworkState(firewall, denyIndex)
  assert.match(deniedState.devices.router.tables['Firewall log']['WAN → LAN TCP/22'], /DENY/)

  const ipv6 = scenarios.find((scenario) => scenario.id === 'ipv6-routing')
  assert.equal(packetTransition(ipv6, 2).after.network.ttl, 63)
})

test('CLI output derives from the selected simulated event state', () => {
  const scenario = scenarios.find((item) => item.id === 'dhcp')
  const waiting = createNetworkState(scenario, 0)
  const bound = createNetworkState(scenario, 3)
  assert.match(runCliCommand('ipconfig /all', scenario, waiting, scenarioLinks(scenario)).output, /Unconfigured · DHCP pending/)
  assert.match(runCliCommand('ipconfig /all', scenario, bound, scenarioLinks(scenario)).output, /192\.168\.10\.42\/24/)
  assert.match(runCliCommand('arp -a', scenario, waiting, scenarioLinks(scenario)).output, /No IPv4 ARP entries/)
  assert.match(runCliCommand('show mac-address-table', scenario, bound, scenarioLinks(scenario)).output, /02:42:AC:11:00:0A/)
  assert.match(runCliCommand('show ip route', scenario, bound, scenarioLinks(scenario)).output, /0\.0\.0\.0\/0/)

  const lpm = scenarios.find((item) => item.id === 'route-lpm')
  const lpmState = createNetworkState(lpm, 0)
  const routeOptions = { routeOverrides: routeTableForLab() }
  assert.match(runCliCommand('ping 10.20.30.140', lpm, lpmState, scenarioLinks(lpm), 1, routeOptions).output, /10\.20\.30\.128\/25/)
  assert.match(runCliCommand('ping 999.1.1.1', lpm, lpmState, scenarioLinks(lpm), 1, routeOptions).output, /no matching route/)

  const routing = scenarios.find((item) => item.id === 'routing')
  const routingState = createNetworkState(routing, 0)
  const endToEnd = runCliCommand('ping 203.0.113.25', routing, routingState, scenarioLinks(routing))
  assert.deepEqual(endToEnd.route, ['windows', 'switch', 'router', 'internet', 'web'])
  const brokenPath = scenarioLinks(routing).map((link) => link.id === linkKey('router', 'internet') ? { ...link, status: 'down' } : link)
  assert.match(runCliCommand('ping 203.0.113.25', routing, routingState, brokenPath).output, /LINK DOWN/)
  assert.deepEqual(runCliCommand('ping 203.0.113.25', routing, routingState, brokenPath).route, ['windows', 'switch', 'router'])
})

test('packet capture rows follow the event timeline and bounded filters work', () => {
  const https = scenarios.find((scenario) => scenario.id === 'https')
  const rows = captureRows(https, https.steps.length - 1)
  assert.equal(rows.length, https.steps.length)
  assert.ok(filterCaptureRows(rows, 'tcp.port == 443').length > 0)
  assert.ok(filterCaptureRows(rows, 'udp.port == 53').length > 0)
  assert.ok(filterCaptureRows(rows, 'tcp').length > 0)
  assert.equal(captureRows(https, 999).length, https.steps.length)
})

test('longest-prefix match selects IPv4 and IPv6 most-specific routes', () => {
  const routes = routeTableForLab()
  assert.equal(lookupLongestPrefix('10.20.30.140', routes).winner?.prefix, '10.20.30.128/25')
  assert.equal(lookupLongestPrefix('10.20.30.12', routes).winner?.prefix, '10.20.30.0/24')
  assert.equal(lookupLongestPrefix('10.20.44.12', routes).winner?.prefix, '10.20.0.0/16')
  assert.equal(lookupLongestPrefix('11.1.1.1', routes).winner?.prefix, '0.0.0.0/0')
  assert.equal(lookupLongestPrefix('2001:db8:20:30::20', routes).winner?.prefix, '2001:db8:20:30::/64')
  assert.equal(ipv6Number('2001:db8::1'), ipv6Number('2001:0db8:0:0:0:0:0:1'))
  assert.equal(ipv6Number('2001:::1'), undefined)
  assert.equal(ipv6Number('2001:db8:1:2:3:4:5:6::1'), undefined)
})

test('reset replay starts from an isolated, repeatable scenario baseline', () => {
  const scenario = scenarios.find((item) => item.id === 'dhcp')
  const baseline = createNetworkState(scenario, -1)
  assert.equal(baseline.devices.windows.ipv4.address, 'Unconfigured · DHCP pending')
  assert.deepEqual(createNetworkState(scenario, -1), baseline)
  assert.notEqual(createNetworkState(scenario, scenario.steps.length - 1).devices.windows, baseline.devices.windows)
})

test('a link failure and MTU/loss profiles change deterministic probe outcomes', () => {
  const scenario = scenarios.find((item) => item.id === 'routing')
  const route = ['windows', 'switch', 'router']
  const defaults = scenarioLinks(scenario)
  assert.equal(simulatePathProbe(route, defaults).ok, true)
  const down = defaults.map((link) => link.id === linkKey('windows', 'switch') ? { ...link, status: 'down' } : link)
  assert.equal(simulatePathProbe(route, down).status, 'LINK DOWN')
  const smallMtu = defaults.map((link) => link.id === linkKey('switch', 'router') ? { ...link, mtu: 1300 } : link)
  assert.equal(simulatePathProbe(route, smallMtu, 'routing', 1, 1400).status, 'MTU EXCEEDED')
  const loss = defaults.map((link) => link.id === linkKey('windows', 'switch') ? { ...link, lossPercent: 52 } : link)
  const first = simulatePathProbe(route, loss, 'fixed-seed', 4)
  const repeated = simulatePathProbe(route, loss, 'fixed-seed', 4)
  assert.deepEqual(repeated, first)
  assert.equal(deterministicPercent('fixed-seed', 4, linkKey('windows', 'switch')), deterministicPercent('fixed-seed', 4, linkKey('windows', 'switch')))
})

test('troubleshooting cases conceal the cause and become verifiable after a repair', () => {
  assert.ok(troubleshootingCases.length >= 14)
  const gateway = troubleshootingCase(0)
  assert.equal(probeTroubleshooting(gateway.initial, { test: 'ping' }).status, 'BAD GATEWAY')
  const repaired = editTroubleshootingSetting(gateway.initial, 'gateway', '192.168.10.1')
  assert.equal(probeTroubleshooting(repaired, { test: 'ping' }).ok, true)

  const dns = troubleshootingCase(9)
  assert.equal(probeTroubleshooting(dns.initial, { test: 'ping', hostname: true }).status, 'DNS FAILURE')
  assert.equal(probeTroubleshooting(dns.initial, { test: 'ping', hostname: false }).ok, true)
  const mtu = troubleshootingCase(12)
  assert.equal(probeTroubleshooting(mtu.initial, { test: 'ping', payloadBytes: 1472 }).status, 'MTU EXCEEDED')
})

test('each blind troubleshooting fault is detectable and repairable through its setting', () => {
  const repairs = {
    'wrong-gateway': ['gateway', { test: 'ping' }],
    'wrong-mask': ['mask', { test: 'ping' }],
    'wrong-vlan': ['vlan', { test: 'ping' }],
    'missing-trunk-vlan': ['trunkVlans', { test: 'ping' }],
    'interface-down': ['interfaceStatus', { test: 'ping' }],
    'duplicate-ip': ['duplicateAddress', { test: 'ping' }],
    'incorrect-static-route': ['staticRouteNextHop', { test: 'ping' }],
    'missing-route': ['routes', { test: 'ping' }],
    'firewall-block': ['firewallAllows', { test: 'service' }],
    'dns-failure': ['dnsAvailable', { test: 'ping', hostname: true }],
    'dhcp-exhausted': ['dhcpAvailable', { test: 'dhcp' }],
    'stp-block': ['stpPathAvailable', { test: 'ping' }],
    'mtu-mismatch': ['mtu', { test: 'ping', payloadBytes: 1472 }],
    'duplex-mismatch': ['duplexRemote', { test: 'ping' }],
  }
  const troubleScenario = scenarios.find((item) => item.id === 'troubleshooting')
  const troubleEdges = new Set(scenarioLinks(troubleScenario).map((link) => link.id))
  for (const [index, scenario] of troubleshootingCases.entries()) {
    const [setting, options] = repairs[scenario.id]
    const broken = resetTroubleshootingConfig(index)
    assert.equal(probeTroubleshooting(broken, options).ok, false, `${scenario.id} should fail before repair`)
    const repaired = correctTroubleshootingSetting(broken, setting)
    const verification = probeTroubleshooting(repaired, options)
    assert.equal(verification.ok, true, `${scenario.id} should verify after repair`)
    for (let edge = 0; edge < verification.route.length - 1; edge++) assert.ok(troubleEdges.has(linkKey(verification.route[edge], verification.route[edge + 1])), `${scenario.id} repair returned a route with a missing topology link`)
  }
  const wrongGateway = resetTroubleshootingConfig(0)
  assert.match(troubleshootingCliCommand('ipconfig /all', wrongGateway).output, /192\.168\.10\.254/)
})

test('NDP and SLAAC events populate the IPv6 device view and capture', () => {
  const ndp = scenarios.find((scenario) => scenario.id === 'ipv6-ndp')
  const afterAdvertisement = createNetworkState(ndp, 1)
  assert.equal(afterAdvertisement.devices.windows.neighborCache['fe80::1'], '02:42:AC:11:10:01')
  assert.ok(filterCaptureRows(captureRows(ndp, 1), 'ipv6').length > 0)
  const slaac = scenarios.find((scenario) => scenario.id === 'ipv6-slaac')
  const beforeAdvertisement = createNetworkState(slaac, 0).devices.windows
  assert.equal(beforeAdvertisement.ipv6.gateway, '—')
  assert.equal(beforeAdvertisement.ipv6.prefix, '—')
  assert.deepEqual(beforeAdvertisement.ipv6.addresses, ['fe80::a/64'])
  const slaacAfterAdvertisement = createNetworkState(slaac, 1).devices.windows
  assert.equal(slaacAfterAdvertisement.ipv6.gateway, 'fe80::1')
  assert.equal(slaacAfterAdvertisement.ipv6.prefix, '2001:db8:10::/64')
  const completedSlaac = createNetworkState(slaac, slaac.steps.length - 1).devices.windows
  assert.deepEqual(completedSlaac.ipv6.addresses, ['fe80::a/64', '2001:db8:10::a/64'])
  assert.ok(completedSlaac.routes.some((route) => route.prefix === '::/0' && route.nextHop === 'fe80::1'))
  assert.equal(ipv4EmbeddedInNat64('198.51.100.25'), '64:ff9b::c633:6419')
})

test('STP root election and OSPF link failure converge deterministically', () => {
  const bridges = [{ id: 'SW-01', priority: 32768, mac: '02:42:AC:11:00:01' }, { id: 'SW-02', priority: 8192, mac: '02:42:AC:11:00:02' }, { id: 'SW-03', priority: 12288, mac: '02:42:AC:11:00:03' }]
  assert.equal(electStpRoot(bridges), 'SW-02')
  assert.equal(electStpRoot(bridges.map((bridge) => bridge.id === 'SW-01' ? { ...bridge, priority: 4096 } : bridge)), 'SW-01')
  const links = [{ from: 'R1', to: 'R2', cost: 10, up: true }, { from: 'R1', to: 'R3', cost: 15, up: true }, { from: 'R3', to: 'R2', cost: 10, up: true }]
  assert.deepEqual(shortestOspfPath(links, 'R1', 'R2'), { nodes: ['R1', 'R2'], cost: 10 })
  const failed = shortestOspfPath(links.map((link) => link.from === 'R1' && link.to === 'R2' ? { ...link, up: false } : link), 'R1', 'R2')
  assert.deepEqual(failed, { nodes: ['R1', 'R3', 'R2'], cost: 25 })
})

test('wireless signal estimates are repeatable and respond to distance and interference', () => {
  const base = { band: '5 GHz', channel: 36, widthMHz: 40, distanceMeters: 5, walls: 0, interference: 0 }
  const near = estimateWirelessSignal(base)
  assert.deepEqual(estimateWirelessSignal(base), near)
  const far = estimateWirelessSignal({ ...base, distanceMeters: 25, walls: 2, interference: 35 })
  assert.ok(far.rssiDbm < near.rssiDbm)
  assert.ok(far.coveragePercent < near.coveragePercent)
  assert.match(estimateWirelessSignal({ ...base, band: '2.4 GHz', channel: 6 }).note, /channels 1, 6, and 11/)
})
