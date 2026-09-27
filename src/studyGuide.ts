import type { Scenario } from './simulation'

type ScenarioId = Scenario['id']

export type StudyCheckpoint = {
  idea: string
  question: string
  choices: [string, string, string]
  correct: number
  explanation: string
  reference: { label: string; url: string }
  eventIndex: number
}

const rfc = (number: number) => ({ label: `Read RFC ${number}`, url: `https://www.rfc-editor.org/info/rfc${number}/` })
const cisco = (label: string, url: string) => ({ label, url })

export const studyPath: Array<{ title: string; description: string; ids: ScenarioId[] }> = [
  { title: '1 · Get connected', description: 'Addresses, neighbors, gateways, and web traffic', ids: ['dhcp', 'arp-ping', 'routing', 'https'] },
  { title: '2 · Change the network', description: 'Practice addressing and local network services', ids: ['ip-sandbox', 'dhcp-relay', 'ipv6-addressing', 'ipv6-ndp', 'ipv6-slaac', 'ipv6-gateway', 'ipv6-dual-stack'] },
  { title: '3 · Switch and segment', description: 'VLANs, trunks, and loop prevention', ids: ['vlan-routing', 'trunk-fault', 'stp-loop'] },
  { title: '4 · Route between networks', description: 'Routes, translation, and hop behavior', ids: ['nat-pat', 'traceroute', 'ipv6-routing', 'ipv6-nat64', 'route-lpm'] },
  { title: '5 · Secure and troubleshoot', description: 'Wireless, firewall state, and evidence', ids: ['wifi-join', 'stateful-firewall', 'wireless-rf', 'troubleshooting'] },
]

export const studyCheckpoints: Record<ScenarioId, StudyCheckpoint> = {
  dhcp: {
    idea: 'A new client needs a lease before it can use its IPv4 settings.',
    question: 'PC-A has no IPv4 address. How does it begin looking for a DHCP server?',
    choices: ['Unicast to its default gateway', 'Broadcast a DHCPDISCOVER', 'Send an ARP reply'], correct: 1,
    explanation: 'The client starts with 0.0.0.0 and broadcasts DHCPDISCOVER. The server can then offer a lease; the address is not active until the ACK.',
    reference: rfc(2131), eventIndex: 0,
  },
  'arp-ping': {
    idea: 'For a destination on the same IPv4 subnet, the host needs that neighbor’s MAC address.',
    question: 'PC-A wants to ping PC-B on the same /24. Whose MAC does it ask ARP to find?',
    choices: ['PC-B’s MAC', 'The gateway’s MAC', 'The DNS server’s MAC'], correct: 0,
    explanation: 'The subnet check says PC-B is local, so PC-A broadcasts an ARP request for PC-B’s IPv4 address and sends the frame directly to PC-B.',
    reference: rfc(826), eventIndex: 0,
  },
  routing: {
    idea: 'A remote destination keeps its IP address, while the local frame goes to the gateway.',
    question: 'PC-A sends to a server on another subnet. Which MAC goes in its first Ethernet frame?',
    choices: ['The remote server’s MAC', 'The default gateway’s MAC', 'The DNS server’s MAC'], correct: 1,
    explanation: 'PC-A ARPs for its local gateway. The IP destination stays the remote server; routers replace the link header at each hop.',
    reference: rfc(826), eventIndex: 1,
  },
  https: {
    idea: 'A hostname must resolve before the client can connect to the server IP.',
    question: 'For example.test, which service supplies the server address before TCP port 443 opens?',
    choices: ['DHCP', 'DNS', 'ARP'], correct: 1,
    explanation: 'DNS maps example.test to an IP address. Then the client can route to that address, establish TCP, and negotiate TLS.',
    reference: rfc(1035), eventIndex: 2,
  },
  'ip-sandbox': {
    idea: 'The subnet mask decides whether a host ARPs for the destination or for its gateway.',
    question: 'If Server-B is outside PC-A’s subnet, which IPv4 address should PC-A resolve with ARP?',
    choices: ['Server-B’s remote address', 'PC-A’s own address', 'Its local default gateway'], correct: 2,
    explanation: 'PC-A sends the remote IP packet in a local frame addressed to its gateway. Change the mask or gateway and watch that decision change.',
    reference: rfc(826), eventIndex: 0,
  },
  'dhcp-relay': {
    idea: 'DHCP broadcasts stay in one broadcast domain unless a relay forwards them.',
    question: 'The DHCP server sits beyond the client VLAN. What gets the client request across the router?',
    choices: ['A DHCP relay agent', 'A larger subnet mask alone', 'An ARP broadcast across the router'], correct: 0,
    explanation: 'The relay receives the local broadcast and forwards the request to the remote DHCP server with information about the client subnet.',
    reference: rfc(2131), eventIndex: 1,
  },
  'ipv6-addressing': {
    idea: 'A /64 divides the address into a 64-bit network prefix and a 64-bit interface portion.',
    question: 'In an IPv6 /64, what does the “64” describe?',
    choices: ['The number of usable hosts', 'The length of the network prefix in bits', 'The Hop Limit'], correct: 1,
    explanation: 'The first 64 bits identify the subnet prefix. A host also has a link-local address for communication on the local link.',
    reference: rfc(4291), eventIndex: 0,
  },
  'ipv6-ndp': {
    idea: 'IPv6 Neighbor Discovery uses ICMPv6 messages and multicast instead of IPv4 ARP.',
    question: 'Which message asks for the link-layer address of an IPv6 neighbor?',
    choices: ['ARP Request', 'Neighbor Solicitation', 'DHCPDISCOVER'], correct: 1,
    explanation: 'A Neighbor Solicitation goes to the target’s solicited-node multicast address. A Neighbor Advertisement supplies the neighbor information.',
    reference: rfc(4861), eventIndex: 0,
  },
  'ipv6-slaac': {
    idea: 'Router Advertisements provide a prefix and default-router information for SLAAC.',
    question: 'After receiving a usable prefix in an RA, what does the host check before using its new address?',
    choices: ['Duplicate Address Detection', 'IPv4 ARP', 'A NAT44 mapping'], correct: 0,
    explanation: 'The host forms a tentative IPv6 address, performs Duplicate Address Detection, then uses it if no conflict is found.',
    reference: rfc(4862), eventIndex: 2,
  },
  'ipv6-gateway': {
    idea: 'An off-link IPv6 packet is sent to the local router as its next hop.',
    question: 'What address does the host resolve for the first link of an off-link IPv6 trip?',
    choices: ['The remote server’s MAC', 'The local router’s link-local next hop', 'An IPv4 default gateway'], correct: 1,
    explanation: 'The IPv6 destination remains the remote server. Neighbor Discovery resolves the local router’s link-layer address for the first hop.',
    reference: rfc(4861), eventIndex: 1,
  },
  'ipv6-dual-stack': {
    idea: 'Dual-stack hosts keep separate IPv4 and IPv6 neighbor and route information.',
    question: 'Which pair resolves neighbors for the two IP families?',
    choices: ['IPv4 ARP and IPv6 NDP', 'IPv4 NDP and IPv6 ARP', 'DNS and DHCP only'], correct: 0,
    explanation: 'IPv4 uses ARP for a local next-hop MAC. IPv6 uses ICMPv6 Neighbor Discovery; neither cache substitutes for the other.',
    reference: rfc(4861), eventIndex: 0,
  },
  'vlan-routing': {
    idea: 'A VLAN is a separate Layer 2 broadcast domain; reaching another VLAN requires routing.',
    question: 'A host on VLAN 10 sends to VLAN 20. What moves the IP packet between VLANs?',
    choices: ['A router or Layer 3 switch', 'A broadcast frame alone', 'A DNS lookup alone'], correct: 0,
    explanation: 'The local VLAN carries the frame to a gateway. The gateway routes the packet into the other VLAN using a new Layer 2 header.',
    reference: cisco('Cisco VLAN trunks', 'https://www.cisco.com/c/en/us/td/docs/switches/lan/c9000/lyr2-fwd/vlan/vlan-configuration-guide/configure-vlan-trunks.html'), eventIndex: 1,
  },
  'trunk-fault': {
    idea: 'A trunk forwards only the VLANs its configuration permits.',
    question: 'VLAN 20 works on each switch but fails across the trunk. What should you inspect first?',
    choices: ['Allowed VLAN list on the trunk', 'The DNS TTL', 'The client’s Wi-Fi channel'], correct: 0,
    explanation: 'If VLAN 20 is omitted from the allowed list, its tagged frames cannot cross that trunk. Add VLAN 20 where the trunk should carry it.',
    reference: cisco('Cisco VLAN trunks', 'https://www.cisco.com/c/en/us/td/docs/switches/lan/c9000/lyr2-fwd/vlan/vlan-configuration-guide/configure-vlan-trunks.html'), eventIndex: 1,
  },
  'stp-loop': {
    idea: 'Spanning Tree keeps one redundant Layer 2 path from forwarding until it is needed.',
    question: 'Why does an alternate switch port discard traffic in the healthy topology?',
    choices: ['To stop a switching loop', 'To hide the VLAN from DNS', 'To increase the IP TTL'], correct: 0,
    explanation: 'Without a blocked path, redundant links could circulate frames. After a link failure, STP can move an alternate path into forwarding.',
    reference: cisco('Cisco STP port roles', 'https://www.cisco.com/c/en/us/td/docs/IIOT/switches/ie9300/stp/ie93xx-stp/wrapper-spanning-tree-protocol/r-stp-port-roles.html'), eventIndex: 1,
  },
  'nat-pat': {
    idea: 'PAT tracks outbound flows by translating the private source IP and source port.',
    question: 'What two source fields typically change when the client’s flow crosses PAT?',
    choices: ['Source IP and source port', 'Destination IP and destination port', 'Only the Ethernet destination MAC'], correct: 0,
    explanation: 'The translator uses a public source address and mapped source port so return traffic can find the original inside client.',
    reference: rfc(3022), eventIndex: 2,
  },
  traceroute: {
    idea: 'Traceroute uses an increasing TTL and learns from routers that expire probes.',
    question: 'What response reveals an intermediate IPv4 router when a probe’s TTL reaches zero?',
    choices: ['ICMP Time Exceeded', 'DHCP ACK', 'ARP Reply from the destination'], correct: 0,
    explanation: 'Each router decrements TTL. A router where it expires discards the probe and can return ICMP Time Exceeded, revealing that hop.',
    reference: rfc(792), eventIndex: 1,
  },
  'ipv6-routing': {
    idea: 'A router chooses the most specific matching prefix and decrements Hop Limit.',
    question: 'A destination matches /48, /64, and default. Which IPv6 route wins?',
    choices: ['The /64', 'The /48', 'The default route'], correct: 0,
    explanation: 'The /64 matches more leading bits than /48 or ::/0. The forwarding router also decreases Hop Limit by one.',
    reference: rfc(8200), eventIndex: 1,
  },
  'ipv6-nat64': {
    idea: 'DNS64 and NAT64 let an IPv6-only client reach a modeled IPv4-only server.',
    question: 'What does DNS64 return when it builds an IPv6 destination from an IPv4 A record?',
    choices: ['A synthesized AAAA record', 'An ARP reply', 'A DHCPv4 lease'], correct: 0,
    explanation: 'DNS64 synthesizes the AAAA answer. NAT64 then translates packets at the address-family boundary and keeps state for the return flow.',
    reference: rfc(6147), eventIndex: 0,
  },
  'route-lpm': {
    idea: 'Longest-prefix match chooses the matching route with the most specific prefix.',
    question: 'For 10.20.30.140, which route beats 10.20.30.0/24 and 10.20.0.0/16?',
    choices: ['10.20.30.128/25', '10.0.0.0/8', '0.0.0.0/0'], correct: 0,
    explanation: '10.20.30.140 lies in 10.20.30.128–255. The /25 matches 25 leading bits, more than the /24, /16, /8, or default.',
    reference: rfc(1812), eventIndex: 1,
  },
  'wifi-join': {
    idea: 'Association, security, VLAN access, and DHCP are separate checkpoints.',
    question: 'The laptop associates to an SSID but has no IPv4 address. What should you inspect next?',
    choices: ['Security handshake and DHCP path', 'Only the website certificate', 'Only the router’s BGP routes'], correct: 0,
    explanation: 'Association alone does not mean protected data can pass. Check authentication/key exchange, the mapped VLAN, and then DHCP.',
    reference: cisco('Cisco Wi-Fi association and security', 'https://www.cisco.com/c/en/us/support/docs/wireless-mobility/wireless-lan-wlan/116493-technote-technology-00.html'), eventIndex: 2,
  },
  'stateful-firewall': {
    idea: 'A stateful firewall treats a reply to an allowed flow differently from a new inbound flow.',
    question: 'Why is the HTTPS SYN-ACK allowed while a new inbound SSH SYN is dropped?',
    choices: ['The SYN-ACK matches tracked connection state', 'All WAN traffic is trusted', 'TCP port 22 is DNS'], correct: 0,
    explanation: 'The client initiated an allowed TCP 443 flow, so its return packet matches state. The unsolicited SSH attempt has no matching state or allow rule.',
    reference: cisco('NIST firewall policy guide', 'https://csrc.nist.gov/pubs/sp/800/41/r1/final'), eventIndex: 2,
  },
  'wireless-rf': {
    idea: 'Distance and walls often weaken received signal; channel conditions also affect performance.',
    question: 'What usually happens to received signal strength as the client moves farther away through more walls?',
    choices: ['It weakens (dBm becomes more negative)', 'It becomes stronger automatically', 'The IPv4 subnet mask changes'], correct: 0,
    explanation: 'Attenuation reduces received power. This lab uses a comparison model; a real site survey is needed to measure the actual space.',
    reference: cisco('Cisco wireless RF guide', 'https://www.cisco.com/c/en/us/td/docs/wireless/controller/9800/technical-reference/wireless-rf-reference-guide.html'), eventIndex: 1,
  },
  troubleshooting: {
    idea: 'Start with the symptom, collect evidence, test one likely cause, and verify after repair.',
    question: 'A setting has been changed and the symptom looks gone. What closes the troubleshooting loop?',
    choices: ['Verify the original symptom and record the result', 'Assume the change fixed everything', 'Change more settings without a test'], correct: 0,
    explanation: 'Re-run the failing check after the repair. A plausible cause is not proof of restoration until the original symptom is tested.',
    reference: cisco('CompTIA Network+ exam objectives', 'https://comptiacdn.azureedge.net/webcontent/docs/default-source/exam-objectives/comptia-network-n10-009-exam-objectives-%284-0%29-%281%29.pdf?sfvrsn=f31cc6c4_4'), eventIndex: 0,
  },
}
