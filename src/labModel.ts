export type EndpointConfig = {
  address: string
  mask: string
  gateway: string
  vlan: string
}

export type LabConfig = {
  client: EndpointConfig
  server: EndpointConfig
  allowPing: boolean
}

export type SubnetSummary = {
  address: string
  mask: string
  prefix: number
  network: string
  broadcast: string
  usableRange: string
  usableHosts: number
}

export type LabEvent = {
  title: string
  detail: string
  state: 'ok' | 'blocked' | 'note'
}

export type LabAnalysis = {
  verdict: 'success' | 'unreachable' | 'filtered' | 'invalid'
  title: string
  summary: string
  repair: string
  decision: string
  arpTarget: string
  clientSubnet?: SubnetSummary
  serverSubnet?: SubnetSummary
  events: LabEvent[]
}

export const initialLabConfig: LabConfig = {
  client: { address: '192.168.10.10', mask: '255.255.255.0', gateway: '192.168.10.1', vlan: '10' },
  server: { address: '192.168.20.20', mask: '255.255.255.0', gateway: '192.168.20.1', vlan: '20' },
  allowPing: true,
}

export function ipv4Number(value: string): number | undefined {
  const parts = value.trim().split('.')
  if (parts.length !== 4 || parts.some((part) => !/^\d{1,3}$/.test(part))) return undefined
  const octets = parts.map((part) => Number(part))
  if (octets.some((part) => part < 0 || part > 255)) return undefined
  return octets.reduce((address, octet) => address * 256 + octet, 0)
}

function ipv4Text(value: number): string {
  const address = Math.floor(value)
  return [24, 16, 8, 0].map((shift) => Math.floor(address / (2 ** shift)) % 256).join('.')
}

function maskPrefix(value: string): number | undefined {
  const numeric = ipv4Number(value)
  if (numeric === undefined) return undefined
  const bits = [24, 16, 8, 0].map((shift) => Math.floor(numeric / (2 ** shift)) % 256)
    .map((octet) => octet.toString(2).padStart(8, '0')).join('')
  if (!/^1*0*$/.test(bits)) return undefined
  return (bits.match(/1/g) ?? []).length
}

export function subnetSummary(address: string, mask: string): SubnetSummary | undefined {
  const addressNumber = ipv4Number(address)
  const prefix = maskPrefix(mask)
  if (addressNumber === undefined || prefix === undefined || prefix < 1 || prefix > 30) return undefined
  const blockSize = 2 ** (32 - prefix)
  const networkNumber = Math.floor(addressNumber / blockSize) * blockSize
  const broadcastNumber = networkNumber + blockSize - 1
  const firstHost = networkNumber + 1
  const lastHost = broadcastNumber - 1
  return {
    address,
    mask,
    prefix,
    network: `${ipv4Text(networkNumber)}/${prefix}`,
    broadcast: ipv4Text(broadcastNumber),
    usableRange: `${ipv4Text(firstHost)} – ${ipv4Text(lastHost)}`,
    usableHosts: blockSize - 2,
  }
}

function inSubnet(address: string, subnet: SubnetSummary): boolean {
  const value = ipv4Number(address)
  if (value === undefined) return false
  const blockSize = 2 ** (32 - subnet.prefix)
  return Math.floor(value / blockSize) * blockSize === ipv4Number(subnet.network.split('/')[0])
}

function hostAddressIsUsable(address: string, subnet: SubnetSummary): boolean {
  const value = ipv4Number(address)
  if (value === undefined) return false
  const network = ipv4Number(subnet.network.split('/')[0])!
  const broadcast = ipv4Number(subnet.broadcast)!
  return value > network && value < broadcast
}

function validAddress(value: string): boolean {
  return ipv4Number(value) !== undefined
}

function blocked(
  title: string,
  summary: string,
  repair: string,
  decision: string,
  arpTarget: string,
  events: LabEvent[],
  clientSubnet?: SubnetSummary,
  serverSubnet?: SubnetSummary,
  verdict: LabAnalysis['verdict'] = 'unreachable',
): LabAnalysis {
  return { verdict, title, summary, repair, decision, arpTarget, events, clientSubnet, serverSubnet }
}

const routerClient = '192.168.10.1'
const routerServer = '192.168.20.1'

export function analyzeLab(config: LabConfig): LabAnalysis {
  const clientSubnet = subnetSummary(config.client.address, config.client.mask)
  const serverSubnet = subnetSummary(config.server.address, config.server.mask)
  if (!validAddress(config.client.address) || !validAddress(config.server.address)) {
    return blocked('Invalid IPv4 address', 'IPv4 addresses need four decimal octets, each from 0 to 255.', 'Correct the highlighted host address, then send the ping again.', 'Address cannot be evaluated', 'No ARP request sent', [{ title: 'Validate host addresses', detail: 'An invalid IPv4 address stops the test before a packet is created.', state: 'blocked' }], clientSubnet, serverSubnet, 'invalid')
  }
  if (!clientSubnet || !serverSubnet) {
    return blocked('Invalid subnet mask', 'Use a contiguous IPv4 subnet mask from /1 through /30 for this Ethernet-host lab. /31 and /32 are not modeled as host LANs here.', 'Use a valid mask such as 255.255.255.0 (/24), then test again.', 'Subnet calculation failed', 'No ARP request sent', [{ title: 'Validate subnet masks', detail: 'The mask must have consecutive 1 bits followed by 0 bits and leave host addresses.', state: 'blocked' }], clientSubnet, serverSubnet, 'invalid')
  }
  if (!validAddress(config.client.gateway) || !validAddress(config.server.gateway)) {
    return blocked('Invalid gateway address', 'A configured gateway must be a valid IPv4 address.', 'Enter the router interface address for that VLAN.', 'Gateway cannot be evaluated', 'No ARP request sent', [{ title: 'Validate default gateways', detail: 'A malformed gateway cannot be resolved with ARP.', state: 'blocked' }], clientSubnet, serverSubnet, 'invalid')
  }
  if (!hostAddressIsUsable(config.client.address, clientSubnet) || !hostAddressIsUsable(config.server.address, serverSubnet)) {
    return blocked('Network or broadcast address used as a host', 'The configured address is the network ID or broadcast address for its mask, not a usable host address on this Ethernet LAN.', 'Choose an address between the subnet’s first and last usable host.', 'Host address is not usable', 'No ARP request sent', [{ title: 'Check host address range', detail: 'The first and last values in an IPv4 subnet identify the network and directed broadcast.', state: 'blocked' }], clientSubnet, serverSubnet, 'invalid')
  }
  if (config.client.address === config.server.address) {
    return blocked('Duplicate IPv4 address', `Both endpoints claim ${config.client.address}. A router cannot distinguish the two hosts by destination IP.`, 'Assign unique host addresses and keep each one in its intended subnet.', 'Duplicate address conflict', config.client.address, [{ title: 'Address conflict', detail: 'Two endpoints configured with the same IPv4 address create ambiguous neighbor resolution.', state: 'blocked' }], clientSubnet, serverSubnet)
  }
  if (config.client.vlan === '10' && config.client.address === routerClient) {
    return blocked('Duplicate IPv4 address', `PC-A and the VLAN 10 router interface both claim ${routerClient}. ARP may receive conflicting replies.`, 'Give PC-A a unique usable host address, for example 192.168.10.10.', 'Host address conflicts with the gateway', routerClient, [{ title: 'ARP conflict on VLAN 10', detail: 'The workstation address duplicates the default gateway’s interface address.', state: 'blocked' }], clientSubnet, serverSubnet)
  }
  if (config.server.vlan === '20' && config.server.address === routerServer) {
    return blocked('Duplicate IPv4 address', `The server and VLAN 20 router interface both claim ${routerServer}.`, 'Give the server a unique address in the VLAN 20 subnet.', 'Host address conflicts with the gateway', routerServer, [{ title: 'ARP conflict on VLAN 20', detail: 'The server address duplicates its default gateway interface.', state: 'blocked' }], clientSubnet, serverSubnet)
  }

  const events: LabEvent[] = []
  const clientVlanOk = config.client.vlan === '10'
  const serverVlanOk = config.server.vlan === '20'
  const routerServerSubnet = subnetSummary(routerServer, '255.255.255.0')!
  const clientThinksDestinationLocal = inSubnet(config.server.address, clientSubnet)
  const serverThinksClientLocal = inSubnet(config.client.address, serverSubnet)
  const decision = clientThinksDestinationLocal
    ? 'LOCAL · use ARP for the server address'
    : `REMOTE · send toward the default gateway ${config.client.gateway}`
  const arpTarget = clientThinksDestinationLocal ? config.server.address : config.client.gateway
  events.push({ title: 'Apply the client mask', detail: clientThinksDestinationLocal ? `${config.server.address} falls in ${clientSubnet.network}, so PC-A treats it as on-link.` : `${config.server.address} is outside ${clientSubnet.network}, so PC-A selects its default gateway.`, state: 'ok' })

  if (!clientVlanOk) {
    events.push({ title: 'Resolve the next hop', detail: `PC-A is in VLAN ${config.client.vlan}, but this lab’s router has no gateway interface in that VLAN.`, state: 'blocked' })
    return blocked('No gateway on this VLAN', `VLAN ${config.client.vlan} has no router interface in the lab topology, so the client has no routed path.`, 'Put the access port in VLAN 10, or configure a matching router interface and subnet.', decision, arpTarget, events, clientSubnet, serverSubnet)
  }

  if (clientThinksDestinationLocal) {
    events.push({ title: `ARP for ${config.server.address}`, detail: 'The client broadcasts for the destination itself instead of asking its gateway.', state: 'note' })
    if (config.client.vlan !== config.server.vlan) {
      events.push({ title: 'Broadcast stays in VLAN 10', detail: `The server is attached to VLAN ${config.server.vlan}; an ARP broadcast cannot cross the VLAN boundary to reach it.`, state: 'blocked' })
      return blocked('Ping fails: ARP never reaches the server', `The client mask makes ${config.server.address} look local, but the server is in VLAN ${config.server.vlan}. The client ARPs on VLAN ${config.client.vlan}, and routers do not forward ARP broadcasts between VLANs.`, 'Use the intended /24 mask so the client treats VLAN 20 as remote, then route through 192.168.10.1.', decision, arpTarget, events, clientSubnet, serverSubnet)
    }
    events.push({ title: 'Destination receives the echo request', detail: 'Both endpoints share a VLAN, so the switch can deliver the frame directly after ARP resolution.', state: 'ok' })
    if (serverThinksClientLocal) {
      events.push({ title: 'Echo reply returns directly', detail: 'The server’s own mask also places the client on-link, so it replies with a direct Ethernet frame.', state: 'ok' })
      return { verdict: 'success', title: 'Ping succeeds on the local VLAN', summary: 'Both hosts use ARP on the same VLAN. The default gateways are not used for this exchange.', repair: 'No repair needed. Change one endpoint to another subnet to watch the gateway become the next hop.', decision, arpTarget, clientSubnet, serverSubnet, events }
    }
    if (config.server.vlan !== '20' || !inSubnet(config.server.gateway, serverSubnet) || config.server.gateway !== routerServer) {
      events.push({ title: 'Server return path fails', detail: `The server treats PC-A as remote but cannot resolve a valid gateway from ${config.server.gateway}.`, state: 'blocked' })
      return blocked('Request arrives, reply has no route', 'PC-A’s mask allows a direct request, but the server uses its own mask to choose a return path and its gateway configuration is not usable.', 'Set the server to its intended VLAN 20 address, /24 mask, and gateway 192.168.20.1.', decision, arpTarget, events, clientSubnet, serverSubnet)
    }
    events.push({ title: 'Reply takes the server gateway', detail: `The server’s mask places PC-A off-link, so its reply uses ${routerServer}.`, state: 'ok' })
    events.push({ title: 'Return packet is routed to PC-A', detail: 'The router delivers the echo reply to the client’s VLAN and address.', state: 'ok' })
    return { verdict: 'success', title: 'Ping succeeds, with an asymmetric path', summary: 'The request is direct on the shared VLAN, while the server routes its reply because its own mask places PC-A off-link.', repair: 'This works in the model, but matching subnet plans across a VLAN make the design easier to reason about.', decision, arpTarget, clientSubnet, serverSubnet, events }
  }

  if (!inSubnet(config.client.gateway, clientSubnet)) {
    events.push({ title: 'Gateway is outside the client subnet', detail: `${config.client.gateway} is not on ${clientSubnet.network}; PC-A cannot ARP for that next hop on VLAN 10.`, state: 'blocked' })
    return blocked('Ping fails: default gateway is off-link', `PC-A correctly classifies the server as remote, but its configured gateway is outside ${clientSubnet.network}.`, 'Use the gateway address on the same local subnet, normally 192.168.10.1 in this lab.', decision, config.client.gateway, events, clientSubnet, serverSubnet)
  }
  if (config.client.gateway !== routerClient) {
    events.push({ title: `ARP for ${config.client.gateway}`, detail: 'The address is on-link, but no router interface in this topology owns it, so neighbor resolution receives no usable reply.', state: 'blocked' })
    return blocked('Ping fails: gateway does not answer ARP', `The configured gateway ${config.client.gateway} is on the subnet, but the router’s VLAN 10 interface is ${routerClient}.`, `Correct PC-A’s default gateway to ${routerClient}.`, decision, config.client.gateway, events, clientSubnet, serverSubnet)
  }
  events.push({ title: `ARP for ${routerClient}`, detail: 'The client resolves the local gateway MAC. The server’s remote MAC is never requested on VLAN 10.', state: 'ok' })

  if (!serverVlanOk || !inSubnet(config.server.address, routerServerSubnet)) {
    events.push({ title: 'Router checks connected networks', detail: `The router has a VLAN 20 connected network ${routerServerSubnet.network}, but ${config.server.address} is not reachable on the server VLAN in this lab.`, state: 'blocked' })
    return blocked('Ping fails: no route to the server subnet', `The router can route only to its configured VLAN 10 and VLAN 20 networks here. The destination is not a usable host on VLAN 20.`, 'Place the server on VLAN 20 with an address in 192.168.20.0/24.', decision, routerClient, events, clientSubnet, serverSubnet)
  }
  events.push({ title: 'Router forwards toward VLAN 20', detail: 'The IP source and destination stay end-to-end; the Ethernet header is rebuilt for the next link.', state: 'ok' })
  if (!config.allowPing) {
    events.push({ title: 'Firewall denies ICMP echo', detail: 'The route exists, but the lab firewall rule blocks ping requests crossing between VLANs.', state: 'blocked' })
    return blocked('Ping filtered by the firewall', 'Addressing and routing are valid, but the firewall policy denies ICMP echo across the routed boundary.', 'Allow ICMP echo for this test, or verify reachability with an application protocol the policy permits.', decision, routerClient, events, clientSubnet, serverSubnet, 'filtered')
  }
  events.push({ title: 'Server receives the echo request', detail: 'The router delivers the packet to the server’s VLAN after resolving the server MAC there.', state: 'ok' })

  if (!serverThinksClientLocal) {
    if (!inSubnet(config.server.gateway, serverSubnet)) {
      events.push({ title: 'Server has no on-link gateway', detail: `${config.server.gateway} is outside the server’s own subnet ${serverSubnet.network}.`, state: 'blocked' })
      return blocked('Ping request arrives; reply has no route', 'The destination receives the request, but its configured gateway is not on the destination subnet.', 'Set the server gateway to 192.168.20.1, which is on VLAN 20.', decision, routerClient, events, clientSubnet, serverSubnet)
    }
    if (config.server.gateway !== routerServer) {
      events.push({ title: `Server ARPs for ${config.server.gateway}`, detail: 'The gateway address is on-link, but it does not match the router interface in this topology.', state: 'blocked' })
      return blocked('Ping request arrives; server gateway is wrong', `The server’s gateway is ${config.server.gateway}; the VLAN 20 router interface is ${routerServer}.`, `Correct the server default gateway to ${routerServer}.`, decision, routerClient, events, clientSubnet, serverSubnet)
    }
    events.push({ title: `Server ARPs for ${routerServer}`, detail: 'The server’s mask places PC-A on another network, so it sends the echo reply to its local gateway.', state: 'ok' })
  } else if (config.server.vlan !== config.client.vlan) {
    events.push({ title: 'Server ARPs for PC-A on VLAN 20', detail: 'The server mask says the client is local, but the client is on VLAN 10, so the return ARP cannot reach it.', state: 'blocked' })
    return blocked('Ping request arrives; reply is stranded', 'The server’s mask makes PC-A appear local, so it ARPs directly instead of returning through its gateway. The client is on another VLAN.', 'Use the intended /24 server mask so PC-A is remote from VLAN 20 and the reply uses 192.168.20.1.', decision, routerClient, events, clientSubnet, serverSubnet)
  } else {
    events.push({ title: 'Server ARPs directly for PC-A', detail: 'Both addresses are on the same VLAN and the server mask says the client is local.', state: 'ok' })
  }
  events.push({ title: 'Router returns the echo reply to VLAN 10', detail: 'The existing route and neighbor entries carry the reply to PC-A. The ping receives its response.', state: 'ok' })
  return { verdict: 'success', title: 'Ping succeeds across two VLANs', summary: 'PC-A ARPs for its gateway, the router forwards between connected networks, and the reply returns through the server’s gateway.', repair: 'No repair needed. Apply a fault above, predict the first broken step, and compare it with the event trace.', decision, arpTarget: routerClient, clientSubnet, serverSubnet, events }
}
