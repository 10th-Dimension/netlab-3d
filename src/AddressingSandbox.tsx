import { useEffect, useMemo, useState } from 'react'
import { Activity, AlertTriangle, BadgeCheck, RotateCcw, Send, ShieldAlert, SlidersHorizontal } from 'lucide-react'
import { analyzeLab, initialLabConfig, subnetSummary, type EndpointConfig, type LabAnalysis, type LabConfig } from './labModel'

type EndpointKey = 'client' | 'server'

const faultPresets = [
  { label: 'Subnet mask too wide', apply: (config: LabConfig): LabConfig => ({ ...config, client: { ...config.client, mask: '255.255.0.0' } }) },
  { label: 'Wrong default gateway', apply: (config: LabConfig): LabConfig => ({ ...config, client: { ...config.client, gateway: '192.168.10.254' } }) },
  { label: 'Wrong access VLAN', apply: (config: LabConfig): LabConfig => ({ ...config, client: { ...config.client, vlan: '30' } }) },
  { label: 'Duplicate the gateway IP', apply: (config: LabConfig): LabConfig => ({ ...config, client: { ...config.client, address: '192.168.10.1' } }) },
  { label: 'Block ICMP at firewall', apply: (config: LabConfig): LabConfig => ({ ...config, allowPing: false }) },
]

export function AddressingSandbox({ onConfigChange }: { onConfigChange?: (config: LabConfig) => void }) {
  const [config, setConfig] = useState<LabConfig>(initialLabConfig)
  const [hasRun, setHasRun] = useState(false)
  const [prediction, setPrediction] = useState<'server' | 'gateway' | 'none' | null>(null)
  const analysis = useMemo(() => analyzeLab(config), [config])
  const expectedPrediction = analysis.decision.startsWith('LOCAL') ? 'server' : analysis.decision.startsWith('REMOTE') ? 'gateway' : 'none'
  useEffect(() => { onConfigChange?.(config) }, [config, onConfigChange])
  const updateEndpoint = (endpoint: EndpointKey, key: keyof EndpointConfig, value: string) => {
    setConfig((current) => ({ ...current, [endpoint]: { ...current[endpoint], [key]: value } }))
    setHasRun(false)
    setPrediction(null)
  }
  const applyFault = (apply: (value: LabConfig) => LabConfig) => {
    setConfig((current) => apply(current))
    setHasRun(false)
    setPrediction(null)
  }
  const reset = () => { setConfig(initialLabConfig); setHasRun(false); setPrediction(null) }

  return <section className="panel sandbox-panel" aria-labelledby="sandbox-title">
    <div className="sandbox-header">
      <div className="stage-title-wrap">
        <span className="eyebrow"><SlidersHorizontal size={13} /> INTERACTIVE LAB <i /> IPV4 ADDRESSING + ROUTING</span>
        <h1 id="sandbox-title">Change a setting. Follow the failure.</h1>
        <p>Edit both hosts, run a simulated ping, and find the first point where the packet stops.</p>
      </div>
      <button className="sandbox-reset" onClick={reset}><RotateCcw size={14} /> Reset lab</button>
    </div>

    <div className="sandbox-body">
      <div className="sandbox-config-column">
        <div className="sandbox-host-grid">
          <EndpointCard title="PC-A · Client" endpoint={config.client} endpointKey="client" onChange={updateEndpoint} accent="client" />
          <EndpointCard title="Server-B · Destination" endpoint={config.server} endpointKey="server" onChange={updateEndpoint} accent="server" />
        </div>

        <label className="sandbox-policy">
          <span className="sandbox-policy-icon"><ShieldAlert size={16} /></span>
          <span><b>Router policy · ICMP echo across VLANs</b><small>Controls ping through the simulated routed firewall.</small></span>
          <input type="checkbox" checked={config.allowPing} onChange={(event) => { setConfig((current) => ({ ...current, allowPing: event.target.checked })); setHasRun(false); setPrediction(null) }} />
          <em>{config.allowPing ? 'ALLOW' : 'DENY'}</em>
        </label>

        <div className="sandbox-faults">
          <div className="sandbox-section-label"><span>INJECT A COMMON CONFIGURATION FAULT</span><span>5 PRACTICE CASES</span></div>
          <div className="sandbox-fault-list">
            {faultPresets.map((fault) => <button key={fault.label} onClick={() => applyFault(fault.apply)}>{fault.label}</button>)}
          </div>
        </div>

        <div className="sandbox-run-row">
          <button className="sandbox-run" onClick={() => setHasRun(true)}><Send size={15} /> Send simulated ping</button>
          <span>Edits clear the previous result. Nothing leaves this browser.</span>
        </div>
        <div className="sandbox-model-note"><Activity size={13} /><span>Model scope: IPv4, subnet masks, ARP, VLAN boundaries, one router, and an ICMP policy. This is a learning model, not a full device OS.</span></div>
      </div>

      <div className="sandbox-observe-column">
        <div className="sandbox-section-label"><span>LIVE ADDRESSING MATH</span><span>RECALCULATES AS YOU TYPE</span></div>
        <div className="sandbox-subnet-grid">
          <SubnetCard title="PC-A subnet" address={config.client.address} mask={config.client.mask} />
          <SubnetCard title="Server-B subnet" address={config.server.address} mask={config.server.mask} />
        </div>

        <div className="sandbox-prediction"><b>Before you send: which IPv4 address will PC-A ARP for?</b><div>{[
          { id: 'server' as const, label: 'Server-B address' },
          { id: 'gateway' as const, label: 'Default gateway' },
          { id: 'none' as const, label: 'No ARP · invalid settings' },
        ].map((choice) => <button key={choice.id} className={prediction === choice.id ? 'selected' : ''} onClick={() => setPrediction(choice.id)} aria-pressed={prediction === choice.id}>{choice.label}</button>)}</div></div>
        <div className={`sandbox-decision ${analysis.verdict === 'success' ? 'success' : analysis.verdict === 'invalid' ? 'invalid' : 'blocked'}`}>
          <div className="sandbox-decision-icon">{analysis.verdict === 'success' ? <BadgeCheck size={16} /> : <AlertTriangle size={16} />}</div>
          <div><span className="sandbox-section-label">PC-A ROUTING DECISION</span>{hasRun ? <><b>{analysis.decision}</b><small>Next ARP target · <code>{analysis.arpTarget}</code></small></> : <b>Choose a prediction, then send the ping to reveal the decision.</b>}</div>
        </div>

        <div className="sandbox-result" aria-live="polite">
          {hasRun ? <><div className={`sandbox-prediction-result ${prediction === expectedPrediction ? 'correct' : 'incorrect'}`}>{prediction === null ? 'No prediction selected. Try one before the next ping.' : prediction === expectedPrediction ? 'Prediction matched the subnet decision.' : `Prediction differed. The mask led PC-A to ${expectedPrediction === 'none' ? 'stop before ARP' : expectedPrediction === 'server' ? 'ARP for Server-B' : 'ARP for its gateway'}.`}</div><ResultCard analysis={analysis} /></> : <div className="sandbox-prompt"><span className="sandbox-prompt-icon"><Send size={16} /></span><div><b>Predict, then test</b><p>Choose the ARP target above, send the ping, and compare your answer with the first decision in the event trace.</p></div></div>}
        </div>
      </div>
    </div>
  </section>
}

function EndpointCard({ title, endpoint, endpointKey, onChange, accent }: { title: string; endpoint: EndpointConfig; endpointKey: EndpointKey; onChange: (endpoint: EndpointKey, key: keyof EndpointConfig, value: string) => void; accent: 'client' | 'server' }) {
  return <div className={`sandbox-host-card ${accent}`}>
    <div className="sandbox-host-heading"><span className="sandbox-host-dot" /><b>{title}</b><small>VLAN {endpoint.vlan || '—'}</small></div>
    <div className="sandbox-fields">
      <LabInput label="IPv4 address" value={endpoint.address} onChange={(value) => onChange(endpointKey, 'address', value)} />
      <LabInput label="Subnet mask" value={endpoint.mask} onChange={(value) => onChange(endpointKey, 'mask', value)} />
      <LabInput label="Default gateway" value={endpoint.gateway} onChange={(value) => onChange(endpointKey, 'gateway', value)} />
      <LabInput label="Access VLAN" value={endpoint.vlan} onChange={(value) => onChange(endpointKey, 'vlan', value)} />
    </div>
  </div>
}

function LabInput({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return <label className="sandbox-field"><span>{label}</span><input inputMode="decimal" spellCheck={false} value={value} onChange={(event) => onChange(event.target.value)} /></label>
}

function SubnetCard({ title, address, mask }: { title: string; address: string; mask: string }) {
  const subnet = subnetSummary(address, mask)
  return <div className={`sandbox-subnet-card ${subnet ? '' : 'invalid'}`}>
    <span>{title}</span>
    {subnet ? <><b>{subnet.network}</b><small>Network ID · {subnet.network.split('/')[0]}</small><small>Broadcast · {subnet.broadcast}</small><small>Usable · {subnet.usableRange}</small><small>{subnet.usableHosts.toLocaleString()} host addresses</small></> : <><b>Cannot calculate</b><small>Check the IPv4 address and use a contiguous /1–/30 LAN mask.</small></>}
  </div>
}

function ResultCard({ analysis }: { analysis: LabAnalysis }) {
  const statusLabel = analysis.verdict === 'success' ? 'REPLY RECEIVED' : analysis.verdict === 'filtered' ? 'POLICY DROP' : analysis.verdict === 'invalid' ? 'CONFIGURATION ERROR' : 'REQUEST FAILED'
  return <div className={`sandbox-trace ${analysis.verdict}`}>
    <div className="sandbox-trace-heading"><div><span className="sandbox-section-label">SIMULATED PING RESULT</span><h2>{analysis.title}</h2></div><span className={`sandbox-status ${analysis.verdict}`}>{statusLabel}</span></div>
    <p className="sandbox-summary">{analysis.summary}</p>
    <ol className="sandbox-event-list">{analysis.events.map((event, index) => <li key={`${event.title}-${index}`} className={event.state}>
      <span className="sandbox-event-marker">{event.state === 'ok' ? <BadgeCheck size={13} /> : event.state === 'blocked' ? <AlertTriangle size={13} /> : String(index + 1).padStart(2, '0')}</span>
      <div><b>{event.title}</b><p>{event.detail}</p></div>
    </li>)}</ol>
    <div className="sandbox-repair"><b>{analysis.verdict === 'success' ? 'NEXT EXPERIMENT' : 'HOW TO FIX IT'}</b><p>{analysis.repair}</p></div>
  </div>
}
