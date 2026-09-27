import { useEffect, useMemo, useState } from 'react'
import { Activity, ArrowRight, BadgeCheck, BookOpen, Cable, Check, CircleAlert, CircleCheck, Radio, RotateCcw, Send, ShieldAlert, Table2, TerminalSquare, Wifi } from 'lucide-react'
import type { CSSProperties } from 'react'
import { analyzeLab, initialLabConfig, type LabConfig } from './labModel'
import { studyCheckpoints } from './studyGuide'
import { devices, type DeviceId, type Scenario, type SimulationStep } from './simulation'
import {
  captureRows, captureSandbox, correctTroubleshootingSetting, createNetworkState, editTroubleshootingSetting,
  estimateWirelessSignal, filterCaptureRows, linkKey, lookupLongestPrefix, packetTransition, probeTroubleshooting,
  resetTroubleshootingConfig, routeTableForLab, runCliCommand, runSandboxCommand, scenarioProbeRoute,
  shortestOspfPath, simulatePathProbe, troubleshootingCase, troubleshootingCases, troubleshootingCliCommand, validIpAddress, validRoutePrefix,
  type CaptureRow, type DeviceRuntimeState, type LinkCondition, type OspfLink, type ProbeResult, type RouteEntry,
  type TroubleSetting, type TroubleshootingConfig, type WirelessRadio,
} from './networkEngine'

type View = 'packet' | 'state' | 'cli' | 'capture' | 'troubleshoot' | 'lab'

type Props = {
  scenario: Scenario
  stepIndex: number
  onSelectStep: (index: number) => void
  linkConditions: LinkCondition[]
  onLinkPatch: (linkId: string, patch: Partial<LinkCondition>) => void
  onRouteUpdate: (route: DeviceId[] | null) => void
  sandboxConfig?: LabConfig
  focusedDevice?: DeviceId | null
  checkpointComplete: boolean
  onCompleteCheckpoint: (id: Scenario['id']) => void
}

const tabs: Array<{ id: View; label: string; Icon: typeof Activity }> = [
  { id: 'packet', label: 'LEARN', Icon: BookOpen },
  { id: 'state', label: 'STATE', Icon: Table2 },
  { id: 'cli', label: 'CLI', Icon: TerminalSquare },
  { id: 'capture', label: 'CAPTURE', Icon: Radio },
  { id: 'troubleshoot', label: 'TROUBLESHOOT', Icon: ShieldAlert },
  { id: 'lab', label: 'LAB TOOLS', Icon: Cable },
]

const faultLabels: Record<string, string> = {
  'wrong-gateway': 'Wrong default gateway', 'wrong-mask': 'Wrong subnet mask', 'wrong-vlan': 'Incorrect access VLAN', 'missing-trunk-vlan': 'VLAN missing from trunk', 'interface-down': 'Interface down', 'duplicate-ip': 'Duplicate IP address', 'incorrect-static-route': 'Incorrect static route', 'missing-route': 'Missing route', 'firewall-block': 'Firewall / ACL block', 'dns-failure': 'DNS failure', 'dhcp-exhausted': 'DHCP scope exhausted', 'stp-block': 'STP path unavailable', 'mtu-mismatch': 'MTU issue', 'duplex-mismatch': 'Duplex mismatch',
}

const troubleSettings: Array<{ value: TroubleSetting; label: string; type: 'text' | 'number' | 'select' }> = [
  { value: 'gateway', label: 'Default gateway', type: 'text' }, { value: 'mask', label: 'Subnet mask', type: 'text' },
  { value: 'address', label: 'Host IPv4 address', type: 'text' }, { value: 'vlan', label: 'Access VLAN', type: 'number' },
  { value: 'trunkVlans', label: 'Trunk allowed VLANs', type: 'text' }, { value: 'interfaceStatus', label: 'Interface status', type: 'select' },
  { value: 'duplicateAddress', label: 'Duplicate address flag', type: 'select' }, { value: 'staticRouteNextHop', label: 'Specific route next hop', type: 'text' },
  { value: 'routes', label: 'Missing route set', type: 'select' }, { value: 'firewallAllows', label: 'Firewall allows service', type: 'select' },
  { value: 'dnsAvailable', label: 'DNS service', type: 'select' }, { value: 'dhcpAvailable', label: 'DHCP scope', type: 'select' },
  { value: 'stpPathAvailable', label: 'STP alternate path', type: 'select' }, { value: 'mtu', label: 'Path MTU', type: 'number' },
  { value: 'duplexRemote', label: 'Remote duplex', type: 'select' },
]

function displayAddress(config: DeviceRuntimeState['ipv4']) {
  return config.prefix ? `${config.address}/${config.prefix}` : config.address
}

function InterfaceRow({ label, value, changed = false }: { label: string; value: string; changed?: boolean }) {
  return <div className={`state-row ${changed ? 'state-changed' : ''}`}><span>{label}</span><code>{value || '—'}</code></div>
}

function PacketSummary({ title, packet, emphasis = false }: { title: string; packet: { ethernet: SimulationStep['ethernet']; network: SimulationStep['network']; transport: SimulationStep['transport'] }; emphasis?: boolean }) {
  return <section className={`transition-card ${emphasis ? 'decision-card' : ''}`}>
    <div className="transition-heading">{title}</div>
    {packet.ethernet && <div className="transition-line"><span>L2</span><code>{packet.ethernet.source || '—'} → {packet.ethernet.destination || '—'}</code></div>}
    {packet.network && <div className="transition-line"><span>{packet.network.protocol}</span><code>{packet.network.source} → {packet.network.destination}{packet.network.ttl ? ` · ${packet.network.protocol === 'IPv6' ? 'HL' : 'TTL'} ${packet.network.ttl}` : ''}</code></div>}
    {packet.transport && <div className="transition-line"><span>{packet.transport.protocol}</span><code>{[packet.transport.sourcePort, packet.transport.destinationPort].filter(Boolean).join(' → ') || packet.transport.flags || 'control message'}</code></div>}
    {!packet.network && !packet.ethernet && <div className="transition-empty">Control / device decision · no forwarded frame in this event.</div>}
  </section>
}

export function Phase2Panel({ scenario, stepIndex, onSelectStep, linkConditions, onLinkPatch, onRouteUpdate, sandboxConfig = initialLabConfig, focusedDevice, checkpointComplete, onCompleteCheckpoint }: Props) {
  const [view, setView] = useState<View>('packet')
  const step = scenario.steps[Math.max(0, Math.min(stepIndex, scenario.steps.length - 1))]
  const runtime = useMemo(() => createNetworkState(scenario, stepIndex), [scenario, stepIndex])
  const packet = useMemo(() => packetTransition(scenario, stepIndex), [scenario, stepIndex])
  const devicesInScenario = scenario.topology?.visibleNodes ?? Object.keys(devices).filter((id) => id !== 'switch2' && id !== 'switch3') as DeviceId[]
  const [selectedDevice, setSelectedDevice] = useState<DeviceId>(step.sourceDevice)
  useEffect(() => { if (focusedDevice) setSelectedDevice(focusedDevice) }, [focusedDevice])
  const checkpoint = studyCheckpoints[scenario.id]
  const [checkpointAnswer, setCheckpointAnswer] = useState<number | null>(null)

  const [command, setCommand] = useState('help')
  const [consoleLines, setConsoleLines] = useState<string[]>(['NetLab simulated terminal · output reads the selected lab state.', 'Type help for the supported command list.'])
  const [probeAttempt, setProbeAttempt] = useState(0)
  const [captureFilter, setCaptureFilter] = useState('')
  const [linkId, setLinkId] = useState('')
  const [probeResult, setProbeResult] = useState<ProbeResult | null>(null)
  const [probeBytes, setProbeBytes] = useState(32)

  const [caseIndex, setCaseIndex] = useState(0)
  const [troubleConfig, setTroubleConfig] = useState<TroubleshootingConfig>(() => resetTroubleshootingConfig(0))
  const [diagnosis, setDiagnosis] = useState('')
  const [submittedDiagnosis, setSubmittedDiagnosis] = useState(false)
  const [troubleVerification, setTroubleVerification] = useState<ProbeResult | null>(null)
  const [troubleEvidence, setTroubleEvidence] = useState<string[]>([])
  const [troubleChanges, setTroubleChanges] = useState<string[]>([])
  const [troubleSetting, setTroubleSetting] = useState<TroubleSetting>('gateway')
  const [routeTarget, setRouteTarget] = useState('10.20.30.140')
  const [routeEntries, setRouteEntries] = useState<RouteEntry[]>(() => routeTableForLab())
  const [routeDraft, setRouteDraft] = useState({ prefix: '10.20.30.128/25', nextHop: '10.20.30.129', interface: 'Gi0/3', metric: '5' })
  const [routeError, setRouteError] = useState('')
  const [ospfPrimaryUp, setOspfPrimaryUp] = useState(true)
  const [stpPriority, setStpPriority] = useState(4096)
  const [stpLinkFailed, setStpLinkFailed] = useState(false)
  const [radio, setRadio] = useState<WirelessRadio>({ band: '5 GHz', channel: 36, widthMHz: 40, distanceMeters: 8, walls: 1, interference: 10 })

  const currentLinkId = linkConditions.find((link) => link.id === linkId)?.id ?? linkConditions[0]?.id
  const currentLink = linkConditions.find((link) => link.id === currentLinkId)
  const selectedDeviceState = runtime.devices[selectedDevice]
  const currentChanges = new Set(step.deviceChanges.map((change) => `${change.deviceId}:${change.table}:${change.key}`))
  const visibleTables = Object.entries(selectedDeviceState.tables).filter(([, values]) => Object.keys(values).length > 0)
  const effectiveRoutes = scenario.id === 'route-lpm' && selectedDevice === 'router' ? routeEntries : selectedDeviceState.routes
  const lookup = lookupLongestPrefix(routeTarget, routeEntries)
  const capture = useMemo(() => scenario.id === 'ip-sandbox' ? captureSandbox(sandboxConfig) : captureRows(scenario, stepIndex), [scenario, stepIndex, sandboxConfig])
  const filteredCapture = useMemo(() => filterCaptureRows(capture, captureFilter).slice(-80), [capture, captureFilter])
  const trouble = troubleshootingCase(caseIndex)
  const rfEstimate = estimateWirelessSignal(radio)
  const ospfLinks: OspfLink[] = [
    { from: 'R1', to: 'R2', cost: 10, up: ospfPrimaryUp },
    { from: 'R1', to: 'R3', cost: 15, up: true },
    { from: 'R3', to: 'R2', cost: 10, up: true },
  ]
  const ospfPath = shortestOspfPath(ospfLinks, 'R1', 'R2')
  const rootBridge = stpPriority < 8192 ? 'SW-01' : stpPriority < 12288 ? 'SW-01' : 'SW-02'
  const stpLink = linkConditions.find((link) => link.id === linkKey('switch', 'switch3'))

  useEffect(() => {
    setConsoleLines(['NetLab simulated terminal · output reads the selected lab state.', 'Type help for the supported command list.'])
    setProbeResult(null)
    setProbeAttempt(0)
    setCaptureFilter('')
    setView('packet')
    setRouteEntries(routeTableForLab())
    setOspfPrimaryUp(true)
    setStpPriority(4096)
    setStpLinkFailed(false)
    setRadio({ band: '5 GHz', channel: 36, widthMHz: 40, distanceMeters: 8, walls: 1, interference: 10 })
  }, [scenario.id])

  useEffect(() => {
    setTroubleConfig(resetTroubleshootingConfig(caseIndex))
    setDiagnosis('')
    setSubmittedDiagnosis(false)
    setTroubleVerification(null)
    setTroubleEvidence([])
    setTroubleChanges([])
  }, [caseIndex])

  useEffect(() => {
    if (!stpLink || scenario.id !== 'stp-loop') return
    onLinkPatch(stpLink.id, { status: stpLinkFailed ? 'down' : 'up' })
  }, [stpLink?.id, stpLinkFailed, scenario.id, onLinkPatch])

  const runCommand = () => {
    const attempt = probeAttempt + 1
    let result = scenario.id === 'troubleshooting'
      ? troubleshootingCliCommand(command, troubleConfig)
      : scenario.id === 'ip-sandbox'
        ? runSandboxCommand(command, sandboxConfig)
        : runCliCommand(command, scenario, runtime, linkConditions, attempt, { routeOverrides: routeEntries })
    if (scenario.id === 'wireless-rf' && /^show wireless$/i.test(command.trim())) {
      result = { command, output: `Band ${radio.band} · channel ${radio.channel} · ${radio.widthMHz} MHz\nEstimated ${rfEstimate.rssiDbm} dBm · ${rfEstimate.quality}\n${rfEstimate.note}` }
    }
    if (scenario.id === 'stp-loop' && /^show spanning-tree$/i.test(command.trim())) {
      result = { command, output: `VLAN 30 · root bridge: ${rootBridge} · priority ${rootBridge === 'SW-01' ? stpPriority : 8192}\n${stpLinkFailed ? 'SW-01 ↔ SW-03 is down. SW-03 forwards through SW-02 after reconvergence.' : 'SW-03 forwards directly to SW-01; its alternate toward SW-02 discards.'}` }
    }
    setConsoleLines((lines) => [...lines, `> ${command}`, ...result.output.split('\n')].slice(-42))
    if (/^ping\b/i.test(command.trim())) setProbeAttempt(attempt)
    if (scenario.id === 'troubleshooting' && command.trim() && !/^help$/i.test(command.trim())) setTroubleEvidence((items) => [...items, command.trim()].slice(-12))
    const lowered = command.trim().toLowerCase()
    if (lowered.startsWith('ping')) {
      if (scenario.id !== 'ip-sandbox' && result.route) {
        onRouteUpdate(result.route)
      }
    }
  }

  const runPathTest = () => {
    const attempt = probeAttempt + 1
    let result: ProbeResult
    if (scenario.id === 'troubleshooting') result = probeTroubleshooting(troubleConfig, optionsForFault(trouble.id, probeBytes))
    else if (scenario.id === 'ip-sandbox') {
      const analysis = analyzeLab(sandboxConfig)
      result = { ok: analysis.verdict === 'success', status: analysis.verdict === 'success' ? 'REPLY RECEIVED' : analysis.title.toUpperCase(), explanation: analysis.summary, route: analysis.verdict === 'success' ? ['windows', 'switch', 'router', 'web'] : analysis.events.slice(0, 2).map((_, index) => ['windows', 'switch', 'router'][index]).filter(Boolean) as DeviceId[], ...(analysis.verdict === 'success' ? { latencyMs: 4 } : { droppedAt: analysis.events.find((item) => item.state === 'blocked')?.title }) }
    } else if (scenario.id === 'route-lpm') {
      const selected = lookupLongestPrefix(routeTarget, routeEntries)
      result = selected.winner
        ? { ok: true, status: 'ROUTE SELECTED', explanation: `${routeTarget} matches ${selected.winner.prefix} via ${selected.winner.nextHop}. This is a route-table decision; no remote host reply is modeled here.`, route: ['windows', 'switch', 'router'] }
        : { ok: false, status: 'NO ROUTE', explanation: `No route matches ${routeTarget}.`, route: ['windows', 'switch', 'router'], droppedAt: 'Route lookup' }
    } else {
      const checked = simulatePathProbe(scenarioProbeRoute(scenario, stepIndex), linkConditions, scenario.id, attempt, probeBytes)
      result = checked.ok ? { ...checked, status: 'MODELED PATH AVAILABLE', explanation: `The selected path has no modeled link fault: ${checked.route.map((id) => devices[id].shortName).join(' → ')}. This check does not prove that the application protocol succeeds.` } : checked
    }
    setProbeAttempt(attempt)
    setProbeResult(result)
    onRouteUpdate(result.route)
    if (scenario.id === 'troubleshooting') setTroubleEvidence((items) => [...items, `Connectivity test · ${result.status}`].slice(-12))
  }

  const changeTroubleSetting = (value: string) => {
    setTroubleConfig((current) => editTroubleshootingSetting(current, troubleSetting, value))
    setTroubleChanges((items) => [...items, `${troubleSettings.find((item) => item.value === troubleSetting)?.label ?? troubleSetting} changed`].slice(-10))
    setTroubleVerification(null)
    setSubmittedDiagnosis(false)
  }

  const resetTroubleSetting = () => {
    setTroubleConfig((current) => correctTroubleshootingSetting(current, troubleSetting))
    setTroubleChanges((items) => [...items, `${troubleSettings.find((item) => item.value === troubleSetting)?.label ?? troubleSetting} restored`].slice(-10))
    setTroubleVerification(null)
  }

  const verifyTroubleshooting = () => {
    const checked = probeTroubleshooting(troubleConfig, optionsForFault(trouble.id))
    setTroubleVerification(checked)
    setTroubleEvidence((items) => [...items, `Final verification · ${checked.status}`].slice(-12))
    onRouteUpdate(checked.route)
  }

  const submitDiagnosis = () => setSubmittedDiagnosis(true)

  const applyLinkPatch = (patch: Partial<LinkCondition>) => {
    if (!currentLink) return
    onLinkPatch(currentLink.id, patch)
    setProbeResult(null)
  }

  const addRoute = () => {
    const prefix = routeDraft.prefix.trim()
    const nextHop = routeDraft.nextHop.trim()
    if (!validRoutePrefix(prefix)) { setRouteError('Enter a valid IPv4 or IPv6 prefix, such as 10.20.30.0/24.'); return }
    if (!validIpAddress(nextHop) || prefix.includes(':') !== nextHop.includes(':')) { setRouteError('Enter a valid next hop in the same IP version as the prefix.'); return }
    setRouteError('')
    const entry: RouteEntry = { prefix, nextHop, interface: routeDraft.interface.trim() || 'Gi0/0', protocol: 'static', metric: Math.max(1, Number(routeDraft.metric) || 1), administrativeDistance: 1 }
    setRouteEntries((current) => [...current.filter((route) => route.prefix !== entry.prefix), entry])
  }

  const selectCapture = (row: CaptureRow) => { setView('packet'); onSelectStep(Math.max(0, Math.min(row.eventIndex, scenario.steps.length - 1))) }

  const renderTroubleEditor = () => {
    const selected = troubleSettings.find((item) => item.value === troubleSetting) ?? troubleSettings[0]
    const currentValue = readTroubleSetting(troubleConfig, troubleSetting)
    return <div className="trouble-edit-grid">
      <label className="phase-field"><span>Configuration item</span><select value={troubleSetting} onChange={(event) => setTroubleSetting(event.target.value as TroubleSetting)}>{troubleSettings.map((item) => <option value={item.value} key={item.value}>{item.label}</option>)}</select></label>
      <label className="phase-field"><span>Current value · {selected.label}</span>{selected.type === 'select' ? <select value={currentValue} onChange={(event) => changeTroubleSetting(event.target.value)}>{settingOptions(troubleSetting).map((option) => <option value={option.value} key={option.value}>{option.label}</option>)}</select> : <input type={selected.type} value={currentValue} onChange={(event) => changeTroubleSetting(event.target.value)} />}</label>
      <button className="phase-quiet-button" onClick={resetTroubleSetting}><RotateCcw size={13} /> Restore this setting</button>
    </div>
  }

  const diagnosisIsCorrect = diagnosis === trouble.id
  const troubleshootingComplete = diagnosisIsCorrect && troubleVerification?.ok === true
  const score = Number(troubleEvidence.length > 0) + Number(diagnosisIsCorrect) + Number(troubleVerification?.ok === true)

  return <aside className="panel inspector-panel phase2-panel">
    <div className="inspector-top phase2-heading">
      <div className="inspector-kicker"><span className="event-badge" style={{ color: scenario.accent, backgroundColor: `${scenario.accent}15`, borderColor: `${scenario.accent}35` }}><Activity size={13} /></span><span>LAB WORKBENCH</span><span className="event-kind">{scenario.id === 'troubleshooting' ? 'FAULT PRACTICE' : `EVENT ${String(step.order).padStart(2, '0')}`}</span></div>
      <h2>{scenario.id === 'troubleshooting' ? 'Investigate the network' : step.protocol}</h2>
      <div className="layer-chip"><span className="layer-dot" style={{ background: scenario.accent }} />{scenario.id === 'troubleshooting' ? 'One simulated network · no live traffic' : step.osiLayer}</div>
    </div>
    <div className="phase-tabs" role="tablist" aria-label="Simulation tools">
      {tabs.map(({ id, label, Icon }) => <button key={id} role="tab" aria-selected={view === id} className={view === id ? 'active' : ''} onClick={() => setView(id)} title={label}><Icon size={13} /><span>{label}</span></button>)}
    </div>
    <div className="inspector-scroll phase2-scroll">
      {view === 'packet' && <>
        <section className="checkpoint-card" aria-label="Study checkpoint">
          <div className="checkpoint-kicker"><BookOpen size={15} /><span>NETWORK+ QUICK CHECK</span>{checkpointComplete && <BadgeCheck size={16} className="checkpoint-done" />}</div>
          <p className="checkpoint-idea">{checkpoint.idea}</p>
          <h3>{checkpoint.question}</h3>
          <div className="checkpoint-choices">{checkpoint.choices.map((choice, index) => <button key={choice} className={checkpointAnswer === index ? index === checkpoint.correct ? 'correct' : 'incorrect' : ''} onClick={() => { setCheckpointAnswer(index); if (index === checkpoint.correct) onCompleteCheckpoint(scenario.id) }} aria-pressed={checkpointAnswer === index}><span>{String.fromCharCode(65 + index)}</span>{choice}</button>)}</div>
          {checkpointAnswer !== null && <div className={`checkpoint-feedback ${checkpointAnswer === checkpoint.correct ? 'correct' : 'incorrect'}`} role="status"><b>{checkpointAnswer === checkpoint.correct ? 'Yes — that is the network decision.' : 'Take another look at the network decision.'}</b><p>{checkpoint.explanation}</p><button onClick={() => { onSelectStep(Math.min(checkpoint.eventIndex, scenario.steps.length - 1)); setView('packet') }}>Show the related event <ArrowRight size={13} /></button></div>}
          <a href={checkpoint.reference.url} target="_blank" rel="noreferrer">{checkpoint.reference.label} <ArrowRight size={12} /></a>
        </section>
        <div className="why-card"><div className="why-heading"><span className="why-icon"><BookOpen size={13} /></span><span>WHY THIS STEP?</span></div><p>{step.explanation}</p>{step.callout && <div className="callout">{step.callout}</div>}</div>
        <div className="transition-stack">
          <PacketSummary title="BEFORE · arriving fields" packet={packet.before} />
          <section className="transition-card decision-card"><div className="transition-heading">DEVICE DECISION · {packet.decision.device}</div><div className="transition-line"><span>Lookup</span><code>{packet.decision.lookup}</code></div><div className="transition-line"><span>Result</span><code>{packet.decision.result}</code></div><p>{packet.decision.explanation}</p>
            {scenario.id === 'route-lpm' && <div className="route-candidate-list">{lookup.candidates.map((route) => <div className={`route-candidate ${route === lookup.winner ? 'winner' : ''}`} key={`${route.prefix}-${route.nextHop}`}><code>{route.prefix}</code><span>{route === lookup.winner ? 'WINNER' : 'MATCH'}</span></div>)}</div>}
          </section>
          <PacketSummary title="AFTER · forwarded copy" packet={packet.after} />
        </div>
        <div className="detail-section"><div className="section-label"><span>PACKET / FRAME DETAILS</span><span className="protocol-pill">{step.kind.toUpperCase()}</span></div>
          <div className="field-card">
            <div className="field-group-title"><span className="field-index">L2</span>ETHERNET</div>
            {step.ethernet ? <><InterfaceRow label="Source MAC" value={step.ethernet.source} /><InterfaceRow label="Destination MAC" value={step.ethernet.destination} />{step.ethernet.vlan && <InterfaceRow label="802.1Q VLAN" value={step.ethernet.vlan} />}{step.ethernet.note && <div className="field-note">{step.ethernet.note}</div>}</> : <div className="field-note no-border">Decision event · no Ethernet frame at this point.</div>}
            <div className="field-divider" /><div className="field-group-title"><span className="field-index l3">L3</span>{step.network?.protocol ?? 'Network layer'}</div>
            <InterfaceRow label="Source" value={step.network?.source ?? '—'} /><InterfaceRow label="Destination" value={step.network?.destination ?? '—'} />{step.network?.ttl && <InterfaceRow label={step.network.protocol === 'IPv6' ? 'Hop Limit' : 'TTL'} value={String(step.network.ttl)} />}
            {step.transport && <><div className="field-divider" /><div className="field-group-title"><span className="field-index l4">L4</span>{step.transport.protocol}</div><InterfaceRow label="Ports / flags" value={[step.transport.sourcePort, step.transport.destinationPort].filter(Boolean).join(' → ') || step.transport.flags || '—'} /></>}
          </div>
          <div className="payload-row"><span>MESSAGE</span><code>{step.payload}</code></div>
        </div>
        {step.hopFrames?.length ? <div className="detail-section"><div className="section-label"><span>LINK HEADER AT EACH HOP</span><span className="protocol-pill">MAC CHANGES</span></div>{step.hopFrames.map((hop, index) => <div className="hop-card" key={`${hop.fromDevice}-${hop.toDevice}-${index}`}><div className="hop-heading"><span>{devices[hop.fromDevice].shortName} <ArrowRight size={12} /> {devices[hop.toDevice].shortName}</span><small>{hop.egressInterface}</small></div><div className="hop-addresses"><code>{hop.sourceMac}</code><ArrowRight size={13} /><code>{hop.destinationMac}</code></div>{hop.note && <div className="hop-note">{hop.note}</div>}</div>)}</div> : null}
        <div className="detail-section"><div className="section-label"><span>DEVICE STATE CHANGES</span><span className="change-count">{step.deviceChanges.length} CHANGES</span></div>{step.deviceChanges.length ? step.deviceChanges.map((item, index) => <div className="state-row state-changed" key={`${item.deviceId}-${item.table}-${item.key}-${index}`}><span>{devices[item.deviceId].shortName} · {item.table}</span><code>{item.key}: {item.value}</code></div>) : <div className="transition-empty">This event makes no persistent table change.</div>}</div>
        {scenario.networkPlusTopics?.length ? <div className="topic-tags"><span>NETWORK+ TOPICS</span><div>{scenario.networkPlusTopics.map((topic) => <i key={topic}>{topic}</i>)}</div></div> : null}
      </>}

      {view === 'state' && <>
        <div className="workbench-intro"><span className="eyebrow">DEVICE STATE · EVENT {step.order}</span><p>Tables are replayed from the selected lab’s starting configuration and packet events.</p></div>
        <label className="phase-field"><span>Inspect device</span><select value={selectedDevice} onChange={(event) => setSelectedDevice(event.target.value as DeviceId)}>{devicesInScenario.map((id) => <option key={id} value={id}>{scenario.topology?.nodes?.[id]?.name ?? devices[id].name}</option>)}</select></label>
        <div className="state-card"><div className="state-card-title">{selectedDeviceState.name} · {selectedDeviceState.kind}</div>
          {selectedDevice === 'windows' && scenario.id === 'ip-sandbox' ? <><InterfaceRow label="IPv4 address" value={sandboxConfig.client.address} /><InterfaceRow label="Subnet mask" value={sandboxConfig.client.mask} /><InterfaceRow label="Default gateway" value={sandboxConfig.client.gateway} /><InterfaceRow label="Access VLAN" value={sandboxConfig.client.vlan} /></> : <><InterfaceRow label="IPv4 address" value={displayAddress(selectedDeviceState.ipv4)} changed={currentChanges.has(`${selectedDevice}:IPv4 configuration:IPv4 address`)} /><InterfaceRow label="Default gateway" value={selectedDeviceState.ipv4.gateway} /><InterfaceRow label="DNS resolver" value={selectedDeviceState.ipv4.dns} /><InterfaceRow label="VLAN" value={selectedDeviceState.ipv4.vlan} /></>}
          {selectedDeviceState.ipv6.addresses.length > 0 && <><div className="state-subheading">IPv6</div><InterfaceRow label="Addresses" value={selectedDeviceState.ipv6.addresses.join(' · ')} /><InterfaceRow label="Default router" value={selectedDeviceState.ipv6.gateway} />{Object.keys(selectedDeviceState.neighborCache).map((address) => <InterfaceRow key={address} label={`NDP · ${address}`} value={selectedDeviceState.neighborCache[address]} changed={currentChanges.has(`${selectedDevice}:IPv6 neighbor cache:${address}`)} />)}</>}
        </div>
        {selectedDevice === 'ap' && scenario.id === 'wireless-rf' && <div className="state-card"><div className="state-card-title">Wireless radio · current lab settings</div><InterfaceRow label="Band / channel" value={`${radio.band} · ${radio.channel}`} /><InterfaceRow label="Width / estimate" value={`${radio.widthMHz} MHz · ${rfEstimate.rssiDbm} dBm`} /><InterfaceRow label="Security" value="WPA2/WPA3 · protected data" /></div>}
        {Object.entries(selectedDeviceState.arpCache).length > 0 && <StateTable title="ARP cache · IPv4" rows={Object.entries(selectedDeviceState.arpCache)} />}
        {Object.entries(selectedDeviceState.neighborCache).length > 0 && <StateTable title="Neighbor cache · IPv6 NDP" rows={Object.entries(selectedDeviceState.neighborCache)} />}
        {Object.entries(selectedDeviceState.macTable).length > 0 && <StateTable title="MAC / CAM table" rows={Object.entries(selectedDeviceState.macTable)} />}
        {visibleTables.length > 0 && <>{visibleTables.map(([name, table]) => <StateTable key={name} title={name} rows={Object.entries(table)} highlights={currentChanges} deviceId={selectedDevice} />)}</>}
        {effectiveRoutes.length > 0 && <div className="state-card"><div className="state-card-title">Routing table</div>{effectiveRoutes.map((route) => <div className="route-state-row" key={`${route.prefix}-${route.nextHop}`}><code>{route.prefix}</code><span>{route.protocol} · {route.nextHop} · {route.interface} · metric {route.metric}</span></div>)}</div>}
        <div className="state-card"><div className="state-card-title">Interfaces · counters through this event</div>{selectedDeviceState.interfaces.map((iface) => <div className="interface-card" key={iface.name}><b>{iface.name}</b><span className={iface.status === 'up' ? 'interface-up' : 'interface-down'}>{iface.status.toUpperCase()}</span><small>{iface.speedMbps} Mbps · {iface.duplex}-duplex · MTU {iface.mtu}</small><small>In {iface.packetsIn} · out {iface.packetsOut} · errors {iface.errors} · drops {iface.drops}</small></div>)}</div>
        {runtime.recentChanges.length > 0 && <div className="state-note"><BadgeCheck size={14} />{runtime.recentChanges.length} table change(s) in event {step.order} are highlighted.</div>}
      </>}

      {view === 'cli' && <>
        <div className="workbench-intro"><span className="eyebrow">SIMULATED COMMAND LINE</span><p>Commands inspect this lab’s current state. Nothing runs on your computer or a real network.</p></div>
        <div className="cli-quick-commands">{['ipconfig /all', 'arp -a', 'route print', ...(scenario.id === 'arp-ping' ? ['ping 10.10.10.22'] : scenario.id === 'routing' ? ['ping 203.0.113.25'] : scenario.id === 'route-lpm' ? ['ping 10.20.30.140'] : []), ...(scenario.id === 'https' ? ['nslookup example.test'] : []), 'show ip route', 'show interfaces'].map((value) => <button key={value} onClick={() => setCommand(value)}>{value}</button>)}</div>
        <div className="terminal-output" role="log" aria-live="polite">{consoleLines.map((line, index) => <div className={line.startsWith('>') ? 'terminal-command' : ''} key={`${index}-${line}`}>{line || ' '}</div>)}</div>
        <form className="terminal-input" onSubmit={(event) => { event.preventDefault(); runCommand() }}><span>netlab$</span><input aria-label="Simulated network command" value={command} onChange={(event) => setCommand(event.target.value)} placeholder="Type help" /><button aria-label="Run command"><Send size={14} /></button></form>
        <div className="help-note">Supported commands intentionally cover common Network+ checks, not a full operating-system shell or Cisco IOS.</div>
      </>}

      {view === 'capture' && <>
        <div className="workbench-intro"><span className="eyebrow">SIMULATED PACKET CAPTURE · {capture.length} FRAME / PACKET EVENTS</span><p>Capture rows are derived from the selected event history. Select a row to open its inspector.</p></div>
        <label className="phase-field"><span>Display filter</span><input value={captureFilter} onChange={(event) => setCaptureFilter(event.target.value)} placeholder="arp · icmp · dhcp · tcp.port == 443 · ip.addr == ..." /></label>
        <div className="filter-presets">{['arp', 'icmp', 'dhcp', 'dns', 'tcp', 'udp', 'ipv6', 'tcp.port == 443', 'udp.port == 53'].map((filter) => <button key={filter} onClick={() => setCaptureFilter(filter)}>{filter}</button>)}</div>
        <div className="capture-table-wrap"><table className="capture-table"><thead><tr><th>#</th><th>Time</th><th>Protocol</th></tr></thead><tbody>{filteredCapture.map((row) => <tr key={`${row.number}-${row.eventIndex}`} onClick={() => selectCapture(row)} tabIndex={0} onKeyDown={(event) => { if (event.key === 'Enter') selectCapture(row) }} title={`${row.source} → ${row.destination} · ${row.info}`}><td>{row.number}</td><td>{row.time}</td><td>{row.protocol}</td></tr>)}</tbody></table>{filteredCapture.length === 0 && <div className="capture-empty">No events match this filter.</div>}</div>
        <div className="capture-info">Full packet description: {filteredCapture.at(-1)?.info ?? 'Select a filter or clear the search.'}</div>
      </>}

      {view === 'troubleshoot' && <>
        <div className="trouble-case-banner"><div className="trouble-title"><ShieldAlert size={16} /><span>CASE {String(caseIndex + 1).padStart(2, '0')} · ROOT CAUSE HIDDEN</span></div><p>{trouble.symptom}</p><button className="phase-quiet-button" onClick={() => setCaseIndex((index) => (index + 1) % troubleshootingCases.length)}><RotateCcw size={13} /> New case</button></div>
        <div className="trouble-method"><b>Investigate</b><span>Inspect evidence → form a theory → change a setting → verify.</span></div>
        <details className="trouble-config-disclosure"><summary>Edit simulated configuration</summary>{renderTroubleEditor()}</details>
        <div className="state-card"><div className="state-card-title">Collect evidence</div><div className="trouble-action-row">{['ipconfig /all', 'arp -a', 'route print', 'show vlan', 'show interfaces', 'ping 192.168.20.20', 'ping -l 1472 192.168.20.20', 'nslookup fileserver.example'].map((cmd) => <button key={cmd} onClick={() => { setCommand(cmd); setView('cli') }}>{cmd}</button>)}</div>{troubleEvidence.length > 0 ? <div className="evidence-list"><span>EVIDENCE INSPECTED</span>{troubleEvidence.slice(-5).map((item, index) => <code key={`${item}-${index}`}>{item}</code>)}</div> : <div className="transition-empty">No evidence checked yet. Run a command or connectivity test.</div>}</div>
        <label className="phase-field"><span>Your root-cause diagnosis</span><select value={diagnosis} onChange={(event) => { setDiagnosis(event.target.value); setSubmittedDiagnosis(false) }}><option value="">Choose the most likely cause…</option>{troubleshootingCases.map((item) => <option value={item.id} key={item.id}>{faultLabels[item.id]}</option>)}</select></label>
        <button className="phase-primary-button" onClick={submitDiagnosis}>Submit diagnosis</button>
        {submittedDiagnosis && <div className={`diagnosis-result ${diagnosisIsCorrect ? 'success' : 'failure'}`}><b>{diagnosisIsCorrect ? 'Diagnosis matches the hidden cause.' : 'That diagnosis does not match this case.'}</b>{diagnosisIsCorrect && <p>{trouble.diagnosis}</p>}<small>{troubleChanges.length} configuration change(s) · {troubleEvidence.length} evidence item(s)</small></div>}
        <button className="phase-primary-button verify-button" onClick={verifyTroubleshooting}><Check size={14} /> Verify connectivity</button>
        {troubleVerification && <div className={`probe-result ${troubleVerification.ok ? 'success' : 'failure'}`}><span>{troubleVerification.ok ? <CircleCheck size={15} /> : <CircleAlert size={15} />}{troubleVerification.status}</span><p>{troubleVerification.explanation}</p>{troubleshootingComplete && <><b>Case complete · {score}/3</b><div className="trouble-feedback"><strong>ROOT CAUSE</strong>{trouble.diagnosis}<strong>FIX</strong>{trouble.repair}<strong>VERIFICATION</strong>{troubleVerification.explanation}</div></>}</div>}
      </>}

      {view === 'lab' && <>
        <div className="workbench-intro"><span className="eyebrow">NETWORK CONTROLS</span><p>Change simulated properties, run a probe, and compare the result with the topology and device views.</p></div>
        <div className="state-card link-lab"><div className="state-card-title"><Cable size={14} /> Link / interface properties</div>
          {linkConditions.length > 0 ? <>
            <label className="phase-field"><span>Link</span><select value={currentLinkId ?? ''} onChange={(event) => setLinkId(event.target.value)}>{linkConditions.map((link) => <option value={link.id} key={link.id}>{devices[link.from].shortName} ↔ {devices[link.to].shortName}</option>)}</select></label>
            {currentLink && <div className="link-control-grid">
              <label><span>Status</span><select value={currentLink.status} onChange={(event) => applyLinkPatch({ status: event.target.value as LinkCondition['status'] })}><option value="up">Up</option><option value="down">Down</option></select></label>
              <label><span>Speed</span><select value={currentLink.speedMbps} onChange={(event) => applyLinkPatch({ speedMbps: Number(event.target.value) })}><option value={10}>10 Mbps</option><option value={100}>100 Mbps</option><option value={1000}>1 Gbps</option></select></label>
              <label><span>Duplex</span><select value={currentLink.duplex} onChange={(event) => applyLinkPatch({ duplex: event.target.value as LinkCondition['duplex'] })}><option value="full">Full</option><option value="half">Half</option></select></label>
              <label><span>MTU · bytes</span><input type="number" min="576" max="9216" value={currentLink.mtu} onChange={(event) => applyLinkPatch({ mtu: Math.max(576, Math.min(9216, Number(event.target.value) || 1500)) })} /></label>
              <label><span>Latency · ms</span><input type="number" min="0" max="2000" value={currentLink.latencyMs} onChange={(event) => applyLinkPatch({ latencyMs: Math.max(0, Number(event.target.value) || 0) })} /></label>
              <label><span>Jitter · ms</span><input type="number" min="0" max="2000" value={currentLink.jitterMs} onChange={(event) => applyLinkPatch({ jitterMs: Math.max(0, Number(event.target.value) || 0) })} /></label>
              <label className="wide-field"><span>Packet loss · %</span><input type="range" min="0" max="100" value={currentLink.lossPercent} onChange={(event) => applyLinkPatch({ lossPercent: Number(event.target.value) })} /><code>{currentLink.lossPercent}%</code></label>
            </div>}
          </> : <div className="transition-empty">This event has no visible link properties.</div>}
          <label className="phase-field"><span>Probe payload · bytes</span><input type="number" min="32" max="8972" value={probeBytes} onChange={(event) => setProbeBytes(Math.max(32, Number(event.target.value) || 32))} /></label>
          <button className="phase-primary-button" onClick={runPathTest}><Send size={14} /> {scenario.id === 'route-lpm' ? 'Check route selection' : 'Check modeled path'}</button>
          {probeResult && <div className={`probe-result ${probeResult.ok ? 'success' : 'failure'}`}><span>{probeResult.ok ? <CircleCheck size={15} /> : <CircleAlert size={15} />}{probeResult.status}{probeResult.latencyMs !== undefined ? ` · ${probeResult.latencyMs} ms` : ''}</span><p>{probeResult.explanation}</p></div>}
          <div className="help-note">Default model: 1 Gbps · full duplex · MTU 1500 · 2 ms · no loss. Loss and jitter are seeded by lab, attempt, and link for repeatable results.</div>
        </div>

        {(scenario.id === 'route-lpm' || scenario.id === 'routing' || scenario.id === 'ipv6-routing') && <div className="state-card route-lab"><div className="state-card-title">Interactive route lookup · LPM</div>
          <label className="phase-field"><span>Destination address</span><input value={routeTarget} onChange={(event) => setRouteTarget(event.target.value)} placeholder="10.20.30.140 or 2001:db8:…" /></label>
          <div className="route-winner">{lookup.winner ? <><b>{lookup.winner.prefix} wins</b><span>via {lookup.winner.nextHop} · {lookup.winner.interface} · metric {lookup.winner.metric}</span></> : <><b>No matching route</b><span>The packet cannot be forwarded from this table.</span></>}</div>
          {lookup.candidates.map((route) => <div className={`route-candidate ${route === lookup.winner ? 'winner' : ''}`} key={`${route.prefix}-${route.nextHop}`}><code>{route.prefix}</code><span>{route.protocol} · {route.nextHop}</span></div>)}
          <details className="route-editor"><summary>Edit a simulated static route</summary><div className="route-draft"><input aria-label="Route prefix" value={routeDraft.prefix} onChange={(event) => setRouteDraft({ ...routeDraft, prefix: event.target.value })} /><input aria-label="Next hop" value={routeDraft.nextHop} onChange={(event) => setRouteDraft({ ...routeDraft, nextHop: event.target.value })} /><button className="phase-quiet-button" onClick={addRoute}>Install / replace route</button></div>{routeError && <p role="alert" className="help-note">{routeError}</p>}<div className="route-editor-list">{routeEntries.map((route) => <div key={`${route.prefix}-${route.nextHop}`}><code>{route.prefix}</code><span>{route.nextHop} · {route.protocol}</span>{route.protocol === 'static' && <button aria-label={`Remove ${route.prefix}`} onClick={() => setRouteEntries((items) => items.filter((item) => item !== route))}>×</button>}</div>)}</div></details>
          <div className="state-card-title ospf-heading">Bounded OSPF path example</div><p className="small-copy">R1 — R2 and R1 — R3 — R2 · shortest path follows configured link cost.</p><label className="toggle-row"><span>Fail the direct R1–R2 link</span><input type="checkbox" checked={!ospfPrimaryUp} onChange={(event) => setOspfPrimaryUp(!event.target.checked)} /></label><div className="ospf-result">{ospfPath ? `${ospfPath.nodes.join(' → ')} · cost ${ospfPath.cost}` : 'No route after failure'}</div>
        </div>}

        {scenario.id === 'stp-loop' && <div className="state-card stp-lab"><div className="state-card-title">STP election + reconvergence</div><label className="phase-field"><span>SW-01 bridge priority</span><select value={stpPriority} onChange={(event) => setStpPriority(Number(event.target.value))}>{[4096, 8192, 12288, 32768, 49152].map((value) => <option value={value} key={value}>{value}</option>)}</select></label><div className="route-winner"><b>Root bridge · {rootBridge}</b><span>Lowest bridge ID wins · priority, then MAC address.</span></div>{stpLink && <label className="toggle-row"><span>Fail primary SW-01 ↔ SW-03 link</span><input type="checkbox" checked={stpLinkFailed} onChange={(event) => { setStpLinkFailed(event.target.checked); onRouteUpdate(event.target.checked ? ['windows', 'switch', 'switch2', 'switch3', 'linux'] : null) }} /></label>}<div className="ospf-result">{stpLinkFailed ? 'The alternate SW-01 → SW-02 → SW-03 path forwards after reconvergence.' : 'SW-03 keeps its SW-02 alternate port discarding to prevent a Layer 2 loop.'}</div></div>}

        {scenario.id === 'wireless-rf' && <div className="state-card rf-lab"><div className="state-card-title"><Wifi size={14} /> RF coverage estimate</div>
          <div className="link-control-grid"><label><span>Band</span><select value={radio.band} onChange={(event) => { const band = event.target.value as WirelessRadio['band']; setRadio({ ...radio, band, channel: band === '2.4 GHz' ? 6 : band === '5 GHz' ? 36 : 37 }) }}><option>2.4 GHz</option><option>5 GHz</option><option>6 GHz</option></select></label><label><span>Channel</span><select value={radio.channel} onChange={(event) => setRadio({ ...radio, channel: Number(event.target.value) })}>{(radio.band === '2.4 GHz' ? [1, 6, 11] : radio.band === '5 GHz' ? [36, 40, 44, 48, 149, 153, 157, 161] : [5, 21, 37, 53, 69, 85, 101, 117, 133, 149, 165, 181, 197, 213]).map((channel) => <option key={channel} value={channel}>{channel}</option>)}</select></label><label><span>Channel width</span><select value={radio.widthMHz} onChange={(event) => setRadio({ ...radio, widthMHz: Number(event.target.value) as WirelessRadio['widthMHz'] })}>{[20, 40, 80, 160].map((width) => <option key={width} value={width}>{width} MHz</option>)}</select></label><label><span>Distance · m</span><input type="range" min="1" max="40" value={radio.distanceMeters} onChange={(event) => setRadio({ ...radio, distanceMeters: Number(event.target.value) })} /><code>{radio.distanceMeters} m</code></label><label><span>Walls</span><input type="range" min="0" max="5" value={radio.walls} onChange={(event) => setRadio({ ...radio, walls: Number(event.target.value) })} /><code>{radio.walls}</code></label><label><span>Interference</span><input type="range" min="0" max="100" value={radio.interference} onChange={(event) => setRadio({ ...radio, interference: Number(event.target.value) })} /><code>{radio.interference}%</code></label></div>
          <div className="rf-heatmap" style={{ '--signal': `${rfEstimate.coveragePercent}%`, '--client-position': `${Math.max(8, Math.min(92, 12 + radio.distanceMeters * 1.8))}%` } as CSSProperties}><span className="rf-ap"><Wifi size={14} /> AP</span><i className="rf-client" /><small>CLIENT · {rfEstimate.rssiDbm} dBm</small></div>
          <div className={`rf-reading ${rfEstimate.quality.toLowerCase().replaceAll(' ', '-')}`}><b>{rfEstimate.quality} · {rfEstimate.rssiDbm} dBm</b><span>{rfEstimate.note}</span><small>Deterministic comparison model · not an RF site-survey prediction.</small></div>
        </div>}
      </>}
    </div>
    <div className="phase2-footnote"><span><span className="simulation-note-dot" />SIMULATED · BROWSER LOCAL</span><span>NO REAL NETWORK TRAFFIC</span></div>
  </aside>
}

function StateTable({ title, rows, highlights = new Set<string>(), deviceId }: { title: string; rows: Array<[string, string]>; highlights?: Set<string>; deviceId?: DeviceId }) {
  if (!rows.length) return null
  return <div className="state-card"><div className="state-card-title">{title}</div>{rows.map(([key, value]) => <InterfaceRow key={key} label={key} value={value} changed={deviceId ? highlights.has(`${deviceId}:${title}:${key}`) : false} />)}</div>
}

function optionsForFault(id: string, payloadBytes?: number) {
  if (id === 'firewall-block') return { test: 'service' as const, hostname: false, payloadBytes }
  if (id === 'dns-failure') return { test: 'ping' as const, hostname: true, payloadBytes }
  if (id === 'dhcp-exhausted') return { test: 'dhcp' as const, hostname: false, payloadBytes }
  if (id === 'mtu-mismatch') return { test: 'ping' as const, hostname: false, payloadBytes: payloadBytes ?? 1472 }
  return { test: 'ping' as const, hostname: false, payloadBytes }
}

function readTroubleSetting(config: TroubleshootingConfig, setting: TroubleSetting): string {
  switch (setting) {
    case 'address': return config.address
    case 'mask': return config.mask
    case 'gateway': return config.gateway
    case 'vlan': return String(config.vlan)
    case 'trunkVlans': return config.trunkVlans.join(',')
    case 'interfaceStatus': return config.interfaceStatus
    case 'duplicateAddress': return String(config.duplicateAddress)
    case 'staticRouteNextHop': return config.routes.find((route) => route.prefix === '10.20.30.128/25')?.nextHop ?? ''
    case 'routes': return config.routes.some((route) => route.prefix === '10.20.0.0/16') ? 'present' : 'missing'
    case 'firewallAllows': return String(config.firewallAllows)
    case 'dnsAvailable': return String(config.dnsAvailable)
    case 'dhcpAvailable': return String(config.dhcpAvailable)
    case 'stpPathAvailable': return String(config.stpPathAvailable)
    case 'mtu': return String(config.mtu)
    case 'duplexLocal': return config.duplexLocal
    case 'duplexRemote': return config.duplexRemote
  }
}

function settingOptions(setting: TroubleSetting): Array<{ value: string; label: string }> {
  if (setting === 'interfaceStatus') return [{ value: 'up', label: 'Up' }, { value: 'down', label: 'Down' }]
  if (setting === 'duplicateAddress' || setting === 'firewallAllows' || setting === 'dnsAvailable' || setting === 'dhcpAvailable' || setting === 'stpPathAvailable') return [{ value: 'false', label: 'No' }, { value: 'true', label: 'Yes' }]
  if (setting === 'routes') return [{ value: 'present', label: 'Route table as configured' }, { value: 'restore', label: 'Restore the route set' }]
  if (setting === 'duplexLocal' || setting === 'duplexRemote') return [{ value: 'full', label: 'Full duplex' }, { value: 'half', label: 'Half duplex' }]
  return []
}
