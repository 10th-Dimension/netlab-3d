import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Canvas, useFrame } from '@react-three/fiber'
import { ContactShadows, Html, Line, OrbitControls } from '@react-three/drei'
import { Vector3, type Group } from 'three'
import {
  Activity, ArrowDownUp, ArrowLeft, ArrowRight, ArrowUpRight, BadgeCheck, ChevronDown,
  Layers3, LockKeyhole, Network, Pause, Play, Radio, RotateCcw, Router as RouterIcon, SlidersHorizontal,
  SkipBack, SkipForward,
} from 'lucide-react'
import { AddressingSandbox } from './AddressingSandbox'
import { Phase2Panel } from './Phase2Panel'
import { createNetworkState, linkKey, scenarioLinks, type LinkCondition } from './networkEngine'
import { devices, links, scenarios, type Device, type DeviceId, type Scenario, type SimulationStep } from './simulation'
import { packetPositionAt, packetProgressAt } from './packetAnimation'
import { initialLabConfig, type LabConfig } from './labModel'
import { studyPath } from './studyGuide'

type WebMcpTool = {
  name: string
  title: string
  description: string
  inputSchema: Record<string, unknown>
  annotations?: { readOnlyHint?: boolean; untrustedContentHint?: boolean }
  execute(input: unknown): unknown | Promise<unknown>
}

type WebMcpContext = { registerTool(tool: WebMcpTool, options?: { signal?: AbortSignal }): void | Promise<void> }

function App() {
  const [scenarioId, setScenarioId] = useState<Scenario['id']>('dhcp')
  const [stepIndex, setStepIndex] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [focusedDevice, setFocusedDevice] = useState<DeviceId | null>(null)
  const [linkOverrides, setLinkOverrides] = useState<Record<string, Partial<LinkCondition>>>({})
  const [routeOverride, setRouteOverride] = useState<DeviceId[] | null>(null)
  const [resetNonce, setResetNonce] = useState(0)
  const [playbackNonce, setPlaybackNonce] = useState(0)
  const [sandboxConfig, setSandboxConfig] = useState<LabConfig>(initialLabConfig)
  const [labSearch, setLabSearch] = useState('')
  const [completedLabs, setCompletedLabs] = useState<Scenario['id'][]>(() => {
    try {
      const saved = JSON.parse(window.localStorage.getItem('netlab-study-checkpoints-v1') ?? '[]')
      return Array.isArray(saved) ? saved.filter((id): id is Scenario['id'] => scenarios.some((item) => item.id === id)) : []
    } catch { return [] }
  })
  const scenario = scenarios.find((item) => item.id === scenarioId) ?? scenarios[0]
  const step = scenario.steps[stepIndex]
  const networkState = useMemo(() => createNetworkState(scenario, stepIndex), [scenario, stepIndex])
  const progress = ((stepIndex + 1) / scenario.steps.length) * 100
  const isSandbox = scenario.id === 'ip-sandbox'
  const visibleNodes = scenario.topology?.visibleNodes ?? Object.keys(devices).filter((id) => id !== 'switch2' && id !== 'switch3') as DeviceId[]
  const topologyLinks = scenario.topology?.links ?? links
  const activeLinks = useMemo(() => scenarioLinks(scenario).map((link) => ({ ...link, ...(linkOverrides[`${scenario.id}:${link.id}`] ?? {}) })), [scenario, scenarioId, linkOverrides])
  const routeForStage = routeOverride ?? step.route
  const blockedAt = routeForStage.findIndex((device, index) => index < routeForStage.length - 1 && activeLinks.some((link) => link.id === linkKey(device, routeForStage[index + 1]) && link.status === 'down'))
  const blockedLink = blockedAt >= 0 ? `${deviceName(scenario, routeForStage[blockedAt])} ↔ ${deviceName(scenario, routeForStage[blockedAt + 1])}` : null
  const blockedHop = routeOverride ? null : step.blockedHop ?? null
  const blockedHopKey = blockedHop ? linkKey(blockedHop[0], blockedHop[1]) : null
  const routeNames = routeForStage.map((device) => deviceName(scenario, device))
  const routeSummary = routeForStage.length > 1
    ? routeNames.join(' → ')
    : `${deviceName(scenario, routeForStage[0] ?? step.sourceDevice)} · no frame sent`
  const routeOutcome = blockedHop ? ` · dropped before ${deviceName(scenario, blockedHop[1])}` : ''
  const viewState = useRef({ scenarioId, stepIndex, playing })
  viewState.current = { scenarioId, stepIndex, playing }

  useEffect(() => { setRouteOverride(null) }, [scenario.id, stepIndex])

  useEffect(() => {
    if (!playing) return
    const timer = window.setTimeout(() => {
      if (blockedAt >= 0 || stepIndex >= scenario.steps.length - 1) setPlaying(false)
      else setStepIndex(stepIndex + 1)
    }, 4800)
    return () => window.clearTimeout(timer)
  }, [playing, scenario.steps.length, stepIndex, blockedAt])

  useEffect(() => {
    try { window.localStorage.setItem('netlab-study-checkpoints-v1', JSON.stringify(completedLabs)) } catch { /* Progress still works for this visit. */ }
  }, [completedLabs])

  useEffect(() => {
    const context = typeof document === 'undefined' ? undefined : (document as Document & { modelContext?: WebMcpContext }).modelContext
    if (!context?.registerTool) return
    const lifecycle = new AbortController()
    const afterPaint = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
    const register = (tool: WebMcpTool) => {
      try { void Promise.resolve(context.registerTool(tool, { signal: lifecycle.signal })).catch(() => undefined) } catch { /* WebMCP is optional in this browser. */ }
    }

    register({
      name: 'select_packet_journey_scenario',
      title: 'Select a networking scenario',
      description: 'Show one of the networking scenarios in NetLab 3D and reset it to the first event.',
      inputSchema: { type: 'object', properties: { scenarioId: { type: 'string', enum: scenarios.map((item) => item.id) } }, required: ['scenarioId'], additionalProperties: false },
      annotations: { readOnlyHint: false, untrustedContentHint: false },
      execute: async (input) => {
        const id = (input as { scenarioId?: unknown } | null)?.scenarioId
        const chosen = scenarios.find((item) => item.id === id)
        if (!chosen) throw new TypeError('Choose a scenario listed in NetLab 3D.')
        setPlaying(false); setScenarioId(chosen.id); setStepIndex(0); setFocusedDevice(null); setPlaybackNonce((value) => value + 1)
        await afterPaint()
        return { scenarioId: chosen.id, title: chosen.title, eventOrder: 1, event: chosen.steps[0].protocol }
      },
    })

    register({
      name: 'move_packet_journey',
      title: 'Move through packet events',
      description: 'Advance, go back, or restart the currently selected Packet Journey and return the visible event.',
      inputSchema: { type: 'object', properties: { action: { type: 'string', enum: ['next', 'previous', 'restart'] } }, required: ['action'], additionalProperties: false },
      annotations: { readOnlyHint: false, untrustedContentHint: false },
      execute: async (input) => {
        const action = (input as { action?: unknown } | null)?.action
        if (!['next', 'previous', 'restart'].includes(String(action))) throw new TypeError('Choose next, previous, or restart.')
        const current = viewState.current
        const selected = scenarios.find((item) => item.id === current.scenarioId) ?? scenarios[0]
        const order = action === 'restart' ? 0 : action === 'next' ? Math.min(current.stepIndex + 1, selected.steps.length - 1) : Math.max(current.stepIndex - 1, 0)
        setPlaying(false); setStepIndex(order); setPlaybackNonce((value) => value + 1)
        await afterPaint()
        return { scenarioId: selected.id, eventOrder: order + 1, event: selected.steps[order].protocol, kind: selected.steps[order].kind }
      },
    })

    register({
      name: 'control_packet_journey_playback',
      title: 'Control Packet Journey playback',
      description: 'Start automatic playback, pause it, or restart at the first event.',
      inputSchema: { type: 'object', properties: { action: { type: 'string', enum: ['start', 'pause', 'restart'] } }, required: ['action'], additionalProperties: false },
      annotations: { readOnlyHint: false, untrustedContentHint: false },
      execute: async (input) => {
        const action = (input as { action?: unknown } | null)?.action
        if (!['start', 'pause', 'restart'].includes(String(action))) throw new TypeError('Choose start, pause, or restart.')
        const current = viewState.current
        const selected = scenarios.find((item) => item.id === current.scenarioId) ?? scenarios[0]
        if (action === 'restart') { setPlaying(false); setStepIndex(0); setPlaybackNonce((value) => value + 1) }
        if (action === 'start') setPlaying(true)
        if (action === 'pause') setPlaying(false)
        await afterPaint()
        return { action, scenarioId: selected.id, status: action === 'start' ? 'playing' : 'paused', eventOrder: action === 'restart' ? 1 : viewState.current.stepIndex + 1 }
      },
    })

    return () => lifecycle.abort()
  }, [])

  const selectScenario = (id: Scenario['id']) => {
    setScenarioId(id)
    setStepIndex(0)
    setPlaying(false)
    setPlaybackNonce((value) => value + 1)
    setFocusedDevice(null)
    setRouteOverride(null)
    if (id === 'ip-sandbox') setSandboxConfig(initialLabConfig)
    setPlaybackNonce((value) => value + 1)
    setResetNonce((value) => value + 1)
  }
  const showJourneyStep = (index: number) => {
    setPlaying(false)
    setStepIndex(index)
    setPlaybackNonce((value) => value + 1)
  }
  const next = () => showJourneyStep(Math.min(stepIndex + 1, scenario.steps.length - 1))
  const previous = () => showJourneyStep(Math.max(stepIndex - 1, 0))
  const restart = () => {
    setPlaying(false)
    setStepIndex(0)
    setRouteOverride(null)
    setPlaybackNonce((value) => value + 1)
    setResetNonce((value) => value + 1)
    setLinkOverrides((current) => Object.fromEntries(Object.entries(current).filter(([key]) => !key.startsWith(`${scenario.id}:`))))
  }
  const togglePlay = () => {
    if (playing) {
      setPlaying(false)
      return
    }
    setPlaying(true)
  }
  const patchLink = useCallback((linkId: string, patch: Partial<LinkCondition>) => {
    setLinkOverrides((current) => {
      const key = `${scenario.id}:${linkId}`
      const previous = current[key] ?? {}
      const unchanged = Object.entries(patch).every(([name, value]) => previous[name as keyof LinkCondition] === value)
      return unchanged ? current : { ...current, [key]: { ...previous, ...patch } }
    })
  }, [scenario.id])
  const completeCheckpoint = useCallback((id: Scenario['id']) => {
    setCompletedLabs((current) => current.includes(id) ? current : [...current, id])
  }, [])
  const matchingPath = studyPath.map((group) => ({ ...group, ids: group.ids.filter((id) => {
    const item = scenarios.find((candidate) => candidate.id === id)
    return item && `${item.title} ${item.subtitle} ${item.networkPlusTopics?.join(' ') ?? ''}`.toLowerCase().includes(labSearch.trim().toLowerCase())
  }) })).filter((group) => group.ids.length > 0)

  return (
    <div className={`app-shell ${isSandbox ? 'sandbox-mode' : ''}`}>
      <header className="topbar">
        <div className="brand-lockup">
          <div className="brand-mark"><Network size={19} strokeWidth={2.25} /></div>
          <div className="brand-name">NetLab <span>3D</span><small>NETWORKING, IN MOTION</small></div>
        </div>
        <div className="topbar-center"><span className="live-dot" />{isSandbox ? 'IP ADDRESSING LAB' : 'PACKET JOURNEY'}<i /> SIMULATED · NO LIVE TRAFFIC</div>
        {!isSandbox && <div className="topbar-actions">
          <div className={`run-state ${playing ? 'is-playing' : ''}`}><span />{playing ? 'PLAYING' : 'PAUSED'}</div>
          <div className="transport-controls" aria-label="Packet Journey controls">
            <button className="icon-button" onClick={restart} title="Restart" aria-label="Restart"><RotateCcw size={15} /></button>
            <button className="icon-button" onClick={previous} title="Previous step" aria-label="Previous step" disabled={stepIndex === 0}><SkipBack size={15} /></button>
            <button className="play-button" onClick={togglePlay} aria-label={playing ? 'Pause simulation' : 'Start simulation'}>
              {playing ? <Pause size={15} fill="currentColor" /> : <Play size={15} fill="currentColor" />}
              <span>{playing ? 'Pause' : 'Start'}</span>
            </button>
            <button className="icon-button" onClick={next} title="Next step" aria-label="Next step" disabled={stepIndex === scenario.steps.length - 1}><SkipForward size={15} /></button>
          </div>
        </div>}
      </header>

      <main className="workspace">
        <aside className="sidebar">
          <section className="panel scenario-panel">
            <div className="panel-heading">
              <div><span className="eyebrow">NETWORK+ PRACTICE</span><h2>Learn by doing</h2></div>
              <span className="count-pill">{String(scenarios.length).padStart(2, '0')}</span>
            </div>
            <div className="study-progress"><span>{completedLabs.length} / {scenarios.length} checkpoints answered</span><div><i style={{ width: `${completedLabs.length / scenarios.length * 100}%` }} /></div></div>
            <label className="scenario-search"><span>Find a lab or topic</span><input value={labSearch} onChange={(event) => setLabSearch(event.target.value)} placeholder="Search DHCP, VLAN, IPv6…" /></label>
            <div className="scenario-list">
              {matchingPath.map((group) => <div className="study-group" key={group.title}><div className="study-group-heading"><b>{group.title}</b><small>{group.description}</small></div>{group.ids.map((id) => {
                const item = scenarios.find((candidate) => candidate.id === id)!
                return <ScenarioButton key={id} scenario={item} number={scenarios.indexOf(item) + 1} active={scenario.id === id} completed={completedLabs.includes(id)} onClick={() => selectScenario(id)} />
              })}</div>)}
              {matchingPath.length === 0 && <p className="scenario-empty">No matching lab. Try an address, protocol, or device name.</p>}
            </div>
            <details className="scenario-goal">
              <summary><BadgeCheck size={15} aria-hidden="true" /><span>GOAL</span><ChevronDown size={14} aria-hidden="true" /></summary>
              <p>{scenario.outcome}</p>
              <a className="objectives-link" href="https://comptiacdn.azureedge.net/webcontent/docs/default-source/exam-objectives/comptia-network-n10-009-exam-objectives-%284-0%29-%281%29.pdf?sfvrsn=f31cc6c4_4" target="_blank" rel="noreferrer">Compare with official Network+ N10-009 objectives <ArrowUpRight size={13} /></a>
            </details>
          </section>

          <section className="panel osi-panel">
            <div className="panel-heading osi-heading">
              <div><span className="eyebrow">REFERENCE</span><h2>OSI model</h2></div>
              <Layers3 size={16} className="muted-icon" />
            </div>
            <div className="osi-stack">
              {[
                ['7', 'Application', 'DNS / HTTP'],
                ['6', 'Presentation', 'TLS / format'],
                ['5', 'Session', 'dialog state'],
                ['4', 'Transport', 'TCP / UDP'],
                ['3', 'Network', 'IPv4 / routes'],
                ['2', 'Data Link', 'MAC / ARP'],
                ['1', 'Physical', 'signals'],
              ].map(([number, name, hint]) => {
                const currentLayer = Number(step.osiLayer.match(/Layer (\d)/)?.[1] ?? 0)
                return <div className={`osi-row ${currentLayer === Number(number) ? 'current' : ''}`} key={number}>
                  <span className="osi-number">{number}</span><span className="osi-name">{name}</span><span className="osi-hint">{hint}</span>
                </div>
              })}
            </div>
            <p className="osi-note"><span className="osi-dot" /> Highlighted layer is active in this event</p>
          </section>
        </aside>

        {isSandbox ? <AddressingSandbox onConfigChange={setSandboxConfig} /> : <>
        <section className="panel stage-panel">
          <div className="stage-heading">
            <div className="stage-title-wrap"><span className="eyebrow">NETWORK MAP <i /> INTERACTIVE 3D</span><h1>{scenario.title}</h1><p>{scenario.objective}</p></div>
            <div className="stage-tools"><span className="step-indicator"><b>{String(step.order).padStart(2, '0')}</b><i>/</i>{String(scenario.steps.length).padStart(2, '0')}</span><span className="scene-control"><ArrowDownUp size={13} />Drag to rotate · scroll to zoom</span></div>
          </div>
          <div className="scene-wrap">
            <div className="zone-tag zone-lan"><span className="zone-pin" /><div><b>{scenario.topology?.zones.left.label ?? 'ACCESS LAN'}</b><small>{scenario.topology?.zones.left.detail ?? '192.168.10.0/24 · VLAN 10'}</small></div></div>
            {scenario.topology?.zones.right && <div className="zone-tag zone-wan"><span className="zone-pin wan" /><div><b>{scenario.topology.zones.right.label}</b><small>{scenario.topology.zones.right.detail}</small></div></div>}
            <Canvas camera={{ position: [0, 12, 15], fov: 42 }} dpr={[1, 1.6]} gl={{ antialias: true, alpha: false }}>
              <color attach="background" args={['#0a1421']} />
              <fog attach="fog" args={['#0a1421', 18, 33]} />
              <ambientLight intensity={1.15} />
              <directionalLight position={[-4, 9, 5]} intensity={2.15} color="#d2f2ff" />
              <pointLight position={[0, 5, -4]} intensity={24} color="#238e9e" distance={16} />
              <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.04, 0]} receiveShadow>
                <planeGeometry args={[200, 200]} /><meshStandardMaterial color="#0a1421" roughness={0.95} />
              </mesh>
              <gridHelper args={[20, 20, '#1e3548', '#142638']} position={[0, 0.005, 0]} />
              <ContactShadows position={[0, 0.01, 0]} opacity={0.28} scale={18} blur={2.8} far={4} />
              {topologyLinks.map(([from, to]) => <NetworkLink key={`${from}-${to}`} from={from} to={to} active={routeHasLink(routeForStage, from, to)} status={activeLinks.find((link) => link.id === linkKey(from, to))?.status ?? 'up'} blocked={blockedHopKey === linkKey(from, to)} accent={scenario.accent} />)}
              {Object.values(devices).filter((device) => visibleNodes.includes(device.id)).map((device) => {
                const label = scenario.topology?.nodes?.[device.id]
                const runtimeDevice = networkState.devices[device.id]
                const leaseActive = runtimeDevice.ipv4.address !== 'Unconfigured · DHCP pending' && runtimeDevice.ipv4.address !== 'No IPv4 address'
                const detail = device.id === 'windows' && scenario.id === 'dhcp'
                  ? leaseActive ? '192.168.10.42/24 · lease active' : 'DHCP client · no address yet'
                  : device.id === 'windows' && scenario.id === 'dhcp-relay'
                    ? leaseActive ? '10.20.0.42/24 · lease active' : 'DHCP client · no address yet'
                    : device.id === 'windows' && scenario.id.startsWith('ipv6-')
                      ? `${runtimeDevice.ipv6.addresses.find((address) => address.startsWith('2001:')) ?? runtimeDevice.ipv6.addresses[0] ?? 'No IPv6 address'}${runtimeDevice.ipv6.gateway !== '—' ? ` · router ${runtimeDevice.ipv6.gateway}` : ' · awaiting router advertisement'}`
                      : label?.detail ?? device.address ?? ''
                return <DeviceModel key={device.id} device={device} label={label?.name ?? device.name} detail={detail} active={routeForStage.includes(device.id)} focused={focusedDevice === device.id} onSelect={() => setFocusedDevice(device.id)} />
              })}
              <PacketActor key={`${scenario.id}-${step.order}-${routeForStage.join('-')}-${playbackNonce}`} step={{ ...step, route: routeForStage }} color={scenario.accent} playing={playing} blockedAfter={blockedAt >= 0 ? blockedAt : undefined} />
              <OrbitControls makeDefault enablePan={false} minDistance={9} maxDistance={22} minPolarAngle={0.22} maxPolarAngle={1.43} rotateSpeed={0.55} zoomSpeed={0.7} />
            </Canvas>
            <div className="scene-legend"><span><i className="legend-cable" />Network link</span><span><i className="legend-packet" style={{ background: blockedHop ? '#fa7785' : scenario.accent, boxShadow: `0 0 9px ${blockedHop ? '#fa7785' : scenario.accent}` }} />{routeForStage.length > 1 ? blockedHop ? 'Packet stops at the red drop point' : playing ? 'Packet moving · press Pause to hold' : 'Press Start to move the packet' : step.kind === 'decision' ? 'Local action · no frame on the network' : 'Device processing'}</span></div>
            {focusedDevice && <button className="focus-chip" onClick={() => setFocusedDevice(null)}>{deviceName(scenario, focusedDevice)}<span>×</span></button>}
          </div>
          <div className={`stage-explanation ${blockedLink || blockedHop ? 'blocked' : ''}`} aria-live="polite"><span>{blockedLink ? 'LINK DOWN · PACKET STOPS HERE' : blockedHop ? `FRAME DROPPED BEFORE ${deviceName(scenario, blockedHop[1])}` : routeForStage.length === 1 && step.kind === 'decision' ? `LOCAL EVENT · ${deviceName(scenario, routeForStage[0])} · NO FRAME SENT` : `EVENT ${step.order} · ${step.protocol}`}</span><p>{blockedLink ? `${blockedLink} is down. The packet stops before that link; open Lab Tools to restore the link or test a different path.` : step.explanation}</p></div>
        </section>

        <section className="panel timeline-panel">
          <div className="timeline-heading">
            <div><span className="eyebrow">PACKET JOURNEY <i /> EVENT LOG</span><h2>Step through the exchange</h2><p className="timeline-instruction">Select an event or use Next Step.</p></div>
            <div className="timeline-meta"><span>{stepIndex + 1} <i>/</i> {scenario.steps.length} EVENTS</span><span className="timeline-progress"><i style={{ width: `${progress}%`, background: scenario.accent }} /></span></div>
          </div>
          <div className="event-rail-wrap">
            <div className="event-rail-line" />
            <div className="event-rail">
              {scenario.steps.map((event, index) => <button key={`${event.order}-${event.protocol}`} className={`event-stop ${index === stepIndex ? 'current' : ''} ${index < stepIndex ? 'complete' : ''} ${event.kind === 'decision' ? 'decision-stop' : ''}`} style={{ '--event-accent': scenario.accent } as React.CSSProperties} onClick={() => showJourneyStep(index)} aria-label={`Go to event ${event.order}: ${event.protocol}`} aria-current={index === stepIndex ? 'step' : undefined}>
                <span className="event-stop-index">{index < stepIndex ? <BadgeCheck size={13} /> : String(event.order).padStart(2, '0')}</span>
                <span className="event-stop-label">{event.protocol.replace(' · ', ' ').replace(' · ', ' ').replace('REQUEST ', 'REQ ').replace('RESPONSE', 'RESP').replace('DEFAULT GATEWAY', 'GATEWAY')}</span>
                <span className="event-stop-time">{event.kind === 'decision' ? event.route.length === 1 ? 'LOCAL · NO FRAME' : event.blockedHop ? 'DROP POINT' : 'PATH CHECK' : event.kind === 'frame' ? 'FRAME' : 'IP PACKET'}</span>
              </button>)}
            </div>
          </div>
          <div className="timeline-footer">
            <div className={`timeline-route-summary ${routeForStage.length === 1 ? 'is-local' : ''} ${blockedHop ? 'is-dropped' : ''}`} data-route={routeForStage.join('>')} data-event-kind={step.kind} aria-live="polite">
              <b>{routeForStage.length === 1 ? 'LOCAL' : blockedHop ? 'DROP' : 'PATH'}</b>
              <span>{routeSummary}{routeOutcome}</span>
            </div>
            <span className="timeline-footer-payload" title={step.payload}>{step.payload}</span>
            <div className="timeline-next-buttons"><button onClick={previous} disabled={stepIndex === 0}><ArrowLeft size={13} /> PREVIOUS</button><button onClick={next} disabled={stepIndex === scenario.steps.length - 1}>NEXT STEP <ArrowRight size={13} /></button></div>
          </div>
        </section>
        </>}
        <Phase2Panel
          key={`${scenario.id}-${resetNonce}`}
          scenario={scenario}
          stepIndex={stepIndex}
          onSelectStep={showJourneyStep}
          linkConditions={activeLinks}
          onLinkPatch={patchLink}
          onRouteUpdate={setRouteOverride}
          sandboxConfig={sandboxConfig}
          focusedDevice={focusedDevice}
          checkpointComplete={completedLabs.includes(scenario.id)}
          onCompleteCheckpoint={completeCheckpoint}
        />
      </main>
      <footer className="bottom-note"><span className="guide-label">HOW TO USE</span>{isSandbox ? <><span className="guide-step"><b>1</b> Change an address, mask, gateway, VLAN, or rule</span><ArrowRight size={13} /><span className="guide-step"><b>2</b> Predict the next hop</span><ArrowRight size={13} /><span className="guide-step"><b>3</b> Run the ping and inspect the first failure</span></> : <><span className="guide-step"><b>1</b> Choose a scenario on the left</span><ArrowRight size={13} /><span className="guide-step"><b>2</b> Follow each event below</span><ArrowRight size={13} /><span className="guide-step"><b>3</b> Read the explanation and packet fields on the right</span></>}<span className="simulation-note">Illustrative model only · nothing is sent to a real network.</span></footer>
    </div>
  )
}

function ScenarioButton({ scenario, number, active, completed, onClick }: { scenario: Scenario; number: number; active: boolean; completed: boolean; onClick: () => void }) {
  const iconByName = { broadcast: Radio, radar: Activity, route: RouterIcon, lock: LockKeyhole, layers: Layers3, relay: Radio, nat: ArrowDownUp, trace: ArrowUpRight, tree: Network, wifi: Radio, shield: LockKeyhole, edit: SlidersHorizontal }
  const navTitleById: Partial<Record<Scenario['id'], string>> = { dhcp: 'DHCP lease', 'arp-ping': 'ARP + ping', routing: 'Default gateway', https: 'Secure website', 'vlan-routing': 'Inter-VLAN routing', 'dhcp-relay': 'DHCP relay', 'nat-pat': 'NAT / PAT', traceroute: 'Traceroute', 'trunk-fault': 'VLAN trunk fault', 'stp-loop': 'STP loop prevention', 'wifi-join': 'Secure Wi-Fi join', 'stateful-firewall': 'Stateful firewall', 'ip-sandbox': 'IP addressing sandbox', 'ipv6-addressing': 'IPv6 addressing', 'ipv6-ndp': 'IPv6 neighbor discovery', 'ipv6-slaac': 'IPv6 SLAAC', 'ipv6-gateway': 'IPv6 default gateway', 'ipv6-dual-stack': 'Dual stack', 'ipv6-routing': 'IPv6 routing', 'ipv6-nat64': 'NAT64 basics', 'route-lpm': 'Longest-prefix match', troubleshooting: 'Blind troubleshooting', 'wireless-rf': 'Wireless RF lab' }
  const navHintById: Partial<Record<Scenario['id'], string>> = { dhcp: 'Assign an IPv4 address', 'arp-ping': 'Find a device on your LAN', routing: 'Reach another subnet', https: 'DNS, TCP and TLS', 'vlan-routing': 'Route between VLANs', 'dhcp-relay': 'Get a lease on VLAN 20', 'nat-pat': 'Translate IP + port', traceroute: 'See each router hop', 'trunk-fault': 'Find a missing allowed VLAN', 'stp-loop': 'Elect root · hold a backup link', 'wifi-join': 'Fix a key before DHCP', 'stateful-firewall': 'Compare reply vs new traffic', 'ip-sandbox': 'Edit IPs and inject faults', 'ipv6-addressing': 'Prefix, address and gateway', 'ipv6-ndp': 'Resolve with ICMPv6 multicast', 'ipv6-slaac': 'RS · RA · DAD', 'ipv6-gateway': 'Reach an off-link prefix', 'ipv6-dual-stack': 'ARP and NDP side by side', 'ipv6-routing': 'Prefix choice · Hop Limit', 'ipv6-nat64': 'DNS64 and address translation', 'route-lpm': 'Try overlapping routes', troubleshooting: 'Diagnose from evidence', 'wireless-rf': 'Channels and coverage' }
  const Icon = iconByName[scenario.icon as keyof typeof iconByName] ?? Network
  return <button className={`scenario-button ${active ? 'selected' : ''}`} onClick={onClick} aria-label={`${scenario.title}. ${scenario.subtitle}`} title={`${scenario.title} — ${scenario.subtitle}`} style={{ '--scenario-accent': scenario.accent } as React.CSSProperties}>
    <span className="scenario-number">{String(number).padStart(2, '0')}</span>
    <span className="scenario-icon"><Icon size={16} /></span>
    <span className="scenario-text"><b>{navTitleById[scenario.id] ?? scenario.title}</b><small>{navHintById[scenario.id] ?? scenario.subtitle}</small></span>
    {completed ? <BadgeCheck size={15} className="scenario-complete" aria-label="Checkpoint answered" /> : <ArrowUpRight size={13} className="scenario-arrow" />}
  </button>
}

function deviceName(scenario: Scenario, id: DeviceId) {
  return scenario.topology?.nodes?.[id]?.name ?? devices[id].name
}

function routeHasLink(route: DeviceId[], from: DeviceId, to: DeviceId) {
  return route.some((device, index) => (device === from && route[index + 1] === to) || (device === to && route[index + 1] === from))
}

function NetworkLink({ from, to, active, status, blocked, accent }: { from: DeviceId; to: DeviceId; active: boolean; status: 'up' | 'down'; blocked: boolean; accent: string }) {
  const start = devices[from].position
  const end = devices[to].position
  const midpoint: [number, number, number] = [(start[0] + end[0]) / 2, 0.14 + Math.min(0.28, Math.abs(start[2] - end[2]) * 0.035), (start[2] + end[2]) / 2]
  const points = [new Vector3(start[0], 0.18, start[2]), new Vector3(...midpoint), new Vector3(end[0], 0.18, end[2])]
  const dropPoint: [number, number, number] = [start[0] + (end[0] - start[0]) * 0.17, 0.48, start[2] + (end[2] - start[2]) * 0.17]
  const lineColor = status === 'down' || blocked ? '#f07886' : active ? accent : '#325069'
  return <>
    <Line points={points} color={lineColor} lineWidth={active || status === 'down' || blocked ? 2.2 : 1.05} transparent opacity={status === 'down' || blocked ? 0.94 : active ? 0.96 : 0.48} dashed={blocked} />
    {active && status === 'up' && <Line points={points} color={accent} lineWidth={5} transparent opacity={0.11} />}
    {blocked && <Html center position={dropPoint} zIndexRange={[30, 0]}><span className="packet-drop-marker" title="Frame filtered here">×</span></Html>}
  </>
}

function DeviceModel({ device, label, detail, active, focused, onSelect }: { device: Device; label: string; detail: string; active: boolean; focused: boolean; onSelect: () => void }) {
  const accent = active ? '#43d8c3' : focused ? '#b78bff' : '#66849c'
  const shell = active ? '#21454c' : '#192d3e'
  return <group position={device.position} onClick={(event) => { event.stopPropagation(); onSelect() }}>
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.025, 0]}>
      <ringGeometry args={[0.58, 0.78, 36]} /><meshBasicMaterial color={accent} transparent opacity={active || focused ? 0.5 : 0.12} side={2} />
    </mesh>
    {device.kind === 'pc' && <>
      <mesh castShadow position={[-0.33, 0.45, -0.04]}><boxGeometry args={[0.47, 0.76, 0.54]} /><meshStandardMaterial color={shell} roughness={0.53} /></mesh>
      <mesh position={[-0.33, 0.51, 0.24]}><boxGeometry args={[0.31, 0.56, 0.025]} /><meshStandardMaterial color="#0c1722" /></mesh>
      <mesh position={[-0.33, 0.7, 0.258]}><boxGeometry args={[0.045, 0.045, 0.012]} /><meshBasicMaterial color={accent} /></mesh>
      <mesh castShadow position={[0.42, 0.79, 0.02]}><boxGeometry args={[0.98, 0.64, 0.13]} /><meshStandardMaterial color="#263c4d" roughness={0.36} /></mesh>
      <mesh position={[0.42, 0.8, 0.1]}><boxGeometry args={[0.83, 0.48, 0.025]} /><meshStandardMaterial color={device.id === 'windows' ? '#0c2637' : '#13291f'} emissive={device.id === 'windows' ? '#0c2637' : '#102219'} emissiveIntensity={0.85} /></mesh>
      <mesh position={[0.42, 0.44, -0.03]}><boxGeometry args={[0.09, 0.25, 0.11]} /><meshStandardMaterial color="#30485a" /></mesh>
      <mesh position={[0.42, 0.29, 0.02]}><boxGeometry args={[0.47, 0.07, 0.33]} /><meshStandardMaterial color="#30485a" /></mesh>
      <mesh position={[0.42, 0.79, 0.12]}><boxGeometry args={[0.27, 0.19, 0.012]} /><meshBasicMaterial color={device.id === 'windows' ? '#1e9fa9' : '#49b578'} transparent opacity={0.4} /></mesh>
    </>}
    {device.kind === 'switch' && <>
      <mesh castShadow position={[0, 0.31, 0]}><boxGeometry args={[1.42, 0.42, 0.9]} /><meshStandardMaterial color={shell} roughness={0.55} /></mesh>
      <mesh position={[0, 0.53, 0]}><boxGeometry args={[1.22, 0.035, 0.73]} /><meshStandardMaterial color="#2b485a" /></mesh>
      {[-0.46, -0.3, -0.14, 0.02, 0.18, 0.34, 0.5].map((x, i) => <mesh key={x} position={[x, 0.553, 0.1]}><boxGeometry args={[0.055, 0.02, 0.08]} /><meshBasicMaterial color={active && i < 4 ? accent : i % 2 === 0 ? '#4a9b83' : '#526a79'} /></mesh>)}
      <mesh position={[-0.47, 0.555, -0.21]}><boxGeometry args={[0.12, 0.025, 0.08]} /><meshBasicMaterial color={active ? accent : '#567288'} /></mesh>
    </>}
    {device.kind === 'router' && <>
      <mesh castShadow position={[0, 0.38, 0]} rotation={[0, Math.PI / 8, 0]}><cylinderGeometry args={[0.76, 0.82, 0.56, 8]} /><meshStandardMaterial color={shell} roughness={0.42} /></mesh>
      <mesh position={[0, 0.67, 0]} rotation={[0, Math.PI / 8, 0]}><cylinderGeometry args={[0.67, 0.67, 0.06, 8]} /><meshStandardMaterial color="#2e5365" /></mesh>
      {[-0.49, -0.16, 0.16, 0.49].map((x, i) => <mesh key={x} position={[x, 0.718, 0.03]}><boxGeometry args={[0.085, 0.025, 0.075]} /><meshBasicMaterial color={active ? accent : i === 1 ? '#54b494' : '#527082'} /></mesh>)}
      {[-0.55, 0.55].map((x) => <mesh key={x} castShadow position={[x, 0.79, -0.28]} rotation={[0, 0, x > 0 ? -0.12 : 0.12]}><cylinderGeometry args={[0.035, 0.04, 0.68, 6]} /><meshStandardMaterial color="#455e70" /></mesh>)}
    </>}
    {device.kind === 'server' && <>
      <mesh castShadow position={[0, 0.69, 0]}><boxGeometry args={[0.93, 1.28, 0.78]} /><meshStandardMaterial color={shell} roughness={0.58} /></mesh>
      <mesh position={[0, 0.69, 0.405]}><boxGeometry args={[0.78, 1.11, 0.035]} /><meshStandardMaterial color="#10202d" /></mesh>
      {[0.25, 0.49, 0.73, 0.97].map((y, index) => <group key={y}>
        <mesh position={[0, y, 0.43]}><boxGeometry args={[0.69, 0.17, 0.035]} /><meshStandardMaterial color="#213b4d" /></mesh>
        <mesh position={[-0.22, y, 0.454]}><boxGeometry args={[0.035, 0.035, 0.012]} /><meshBasicMaterial color={active ? accent : '#54b494'} /></mesh>
        <mesh position={[0.08, y, 0.452]}><boxGeometry args={[0.23, 0.025, 0.012]} /><meshBasicMaterial color="#4c6678" /></mesh>
        {index === 3 && <mesh position={[0.28, y, 0.453]}><boxGeometry args={[0.08, 0.055, 0.016]} /><meshBasicMaterial color="#183342" /></mesh>}
      </group>)}
      <mesh position={[0, 0.1, 0]}><boxGeometry args={[1.03, 0.08, 0.88]} /><meshStandardMaterial color="#263d50" /></mesh>
    </>}
    {device.kind === 'ap' && <>
      <mesh castShadow position={[0, 0.34, 0]} rotation={[0, Math.PI / 8, 0]}><cylinderGeometry args={[0.57, 0.63, 0.22, 12]} /><meshStandardMaterial color={shell} /></mesh>
      <mesh position={[0, 0.47, 0]}><cylinderGeometry args={[0.42, 0.42, 0.045, 12]} /><meshStandardMaterial color="#2d5060" /></mesh>
      <mesh position={[0, 0.497, 0]}><sphereGeometry args={[0.075, 8, 6]} /><meshBasicMaterial color={active ? accent : '#5d8d9a'} /></mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.04, 0]}><torusGeometry args={[0.88, 0.012, 4, 36, Math.PI]} /><meshBasicMaterial color={active ? accent : '#365267'} transparent opacity={0.78} /></mesh>
    </>}
    {device.kind === 'cloud' && <group position={[0, 0.64, 0]}>
      <mesh castShadow position={[0, 0, 0]}><dodecahedronGeometry args={[0.51, 0]} /><meshStandardMaterial color={active ? '#234353' : '#1b3042'} roughness={0.56} flatShading /></mesh>
      {[[-0.4, -0.08, 0], [0.38, -0.08, 0], [-0.2, 0.25, 0], [0.2, 0.25, 0]].map(([x, y, z], index) => <mesh key={index} position={[x, y, z]} scale={index === 0 || index === 1 ? [0.75, 0.7, 0.72] : [0.68, 0.68, 0.72]}><icosahedronGeometry args={[0.31, 1]} /><meshStandardMaterial color={active ? '#2e6570' : '#2a485d'} flatShading /></mesh>)}
      <mesh position={[0.01, -0.015, 0.48]}><boxGeometry args={[0.82, 0.25, 0.12]} /><meshStandardMaterial color={active ? '#2d5d68' : '#274357'} /></mesh>
      <mesh position={[0, 0.03, 0.548]}><ringGeometry args={[0.07, 0.105, 12]} /><meshBasicMaterial color={active ? '#6fe3d1' : '#58849b'} side={2} /></mesh>
    </group>}
    <Html center position={[0, device.kind === 'server' ? 1.55 : device.kind === 'cloud' ? 1.62 : 1.45, 0]} distanceFactor={9} zIndexRange={[15, 0]}>
      <div className={`scene-label ${active ? 'active' : ''} ${focused ? 'focused' : ''}`} style={{ '--label-color': accent } as React.CSSProperties}>
        <span className="scene-label-dot" /><b>{label}</b><small>{detail}</small>
      </div>
    </Html>
  </group>
}

function PacketActor({ step, color, playing, blockedAfter }: { step: SimulationStep; color: string; playing: boolean; blockedAfter?: number }) {
  const actorRef = useRef<Group>(null)
  const progress = useRef(0)
  const animationStartedAt = useRef<number | null>(null)
  const animationStartProgress = useRef(0)
  useFrame((state) => {
    const actor = actorRef.current
    if (!actor) return

    if (!playing) animationStartedAt.current = null
    else if (animationStartedAt.current === null) {
      animationStartedAt.current = state.clock.elapsedTime
      animationStartProgress.current = progress.current
    }

    const hasPath = step.route.length > 1
    if (hasPath) {
      const segmentCount = step.route.length - 1
      const targetProgress = blockedAfter === undefined ? 1 : Math.max(0, Math.min(1, (blockedAfter + 0.92) / segmentCount))
      if (playing && animationStartedAt.current !== null) {
        progress.current = packetProgressAt(state.clock.elapsedTime, animationStartedAt.current, 1.65, targetProgress, animationStartProgress.current)
      }
      const position = packetPositionAt(step.route, progress.current, devices)
      if (position) actor.position.set(...position)
      actor.scale.setScalar(step.kind === 'decision' ? 0.76 : blockedAfter !== undefined && progress.current >= targetProgress ? 0.86 : 1)
      return
    }

    // A one-device route is a local operation rather than a network transit.
    // Keep the depth-independent beacon visible at the device while it is inspected.
    const source = devices[step.route[0] ?? step.sourceDevice].position
    const pulse = playing ? (Math.sin(state.clock.elapsedTime * 5) + 1) * 0.1 : 0.025
    actor.position.set(source[0], 0.9 + pulse, source[2])
    actor.scale.setScalar(0.84 + pulse)
  })
  return <group ref={actorRef}>
    {step.route.length === 1 && <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.42, 0]} renderOrder={998}>
      <torusGeometry args={[0.3, 0.025, 6, 32]} />
      <meshBasicMaterial color={color} transparent opacity={playing ? 0.58 : 0.32} depthTest={false} depthWrite={false} toneMapped={false} />
    </mesh>}
    <mesh renderOrder={999}>
      <icosahedronGeometry args={[0.27, 1]} />
      <meshBasicMaterial color={color} transparent opacity={0.26} depthTest={false} depthWrite={false} toneMapped={false} />
    </mesh>
    <mesh renderOrder={1000}>
      {step.kind === 'decision' ? <octahedronGeometry args={[0.18, 0]} /> : <icosahedronGeometry args={[0.16, 1]} />}
      <meshBasicMaterial color="#f4fffc" depthTest={false} depthWrite={false} toneMapped={false} />
    </mesh>
    <pointLight position={[0, 0.2, 0]} color={color} intensity={step.kind === 'decision' ? 0.8 : 1.15} distance={2.5} />
  </group>
}

export default App
