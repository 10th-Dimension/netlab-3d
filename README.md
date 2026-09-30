# NetLab 3D

NetLab 3D is an interactive networking study lab for CompTIA Network+ and introductory networking courses. Follow packets through 3D topologies, inspect device state, try commands, and change configurations to see why traffic succeeds or fails. The expanded network map gives packet paths more room while keeping scenario and lab controls close at hand.

NetLab 3D is aimed at students learning the foundations covered by Network+ and introductory networking courses. It is an independent educational project; it is not affiliated with or endorsed by CompTIA, Bellingham Technical College, or the organizations linked as references in the labs.

## What you can study

- IPv4 addressing, subnet masks, ARP, DHCP, DNS, routing, NAT/PAT, HTTPS, and traceroute
- VLANs, 802.1Q trunks, DHCP relay, spanning tree, Wi-Fi association, and firewall state
- IPv6 addressing, NDP, SLAAC, routing, dual stack, and NAT64
- Longest prefix match, packet captures, CLI output, and 14 troubleshooting fault cases
- An editable IP sandbox where changing the address, mask, gateway, or VLAN changes the modeled outcome

Choose a scenario from the left and read its goal. The journey opens paused; press **Start** to watch the packet move, **Pause** to hold it, or select an event to inspect that point. **Restart** returns to the first event. The timeline shows the route for the selected event. A **LOCAL** event keeps its marker at the device and says when no frame was sent; a dropped frame marks the blocked link and the device where it stops. Packet motion follows elapsed time so a skipped browser frame does not leave the marker stranded mid-route. Select a device to inspect its state. The **Lab** and **Troubleshoot** panels let you make changes and observe the modeled result. Checkpoints give you a question to answer after each journey.

Every animated route is checked against the devices and links drawn in its scene. In the VLAN trunk fault lab, the rejected frame travels from the PC to the switch, then the red drop marker shows that it cannot cross the trunk to the router.

## Run locally

Requirements: Node.js 22 or newer and pnpm 10 or newer.

```sh
pnpm install --frozen-lockfile
pnpm dev
```

Open the local address printed by Vite. To run the checks and make a static production build:

```sh
pnpm test
pnpm run build
```

The build output is in `dist/`; any static host can serve it. The app has no server component or required API keys. Checkpoint progress is stored in your browser's local storage.

## Project layout

| Path | Purpose |
| --- | --- |
| `src/simulation.ts` | Scenario topologies, packet steps, and device changes |
| `src/networkEngine.ts` | Device state, packet probes, route lookup, CLI, and troubleshooting logic |
| `src/labModel.ts` | Editable IP sandbox and outcome analysis |
| `src/studyGuide.ts` | Student checkpoints and source links |
| `src/App.tsx`, `src/Phase2Panel.tsx`, `src/AddressingSandbox.tsx` | Main interface and lab controls |
| `tests/networkEngine.test.mjs` | Model and scenario consistency checks |

## Scope and accuracy

This is a bounded teaching simulation. It models the specific devices, links, events, and faults shown in each lab. Its CLI and capture views are derived from that model; they are not a live operating system, network stack, packet capture, or a replacement for Packet Tracer/GNS3 or physical equipment. Some addresses use RFC documentation ranges deliberately. Each study checkpoint links to an external technical reference so you can compare the simplified model with protocol behavior.

If a scene, explanation, or expected outcome seems wrong, please [open an issue](https://github.com/10th-Dimension/netlab-3d/issues) with the scenario name, the settings you changed, and what you expected to happen.

## Contributing

Contributions are welcome, especially corrections backed by a protocol specification or vendor documentation. Keep changes to the model and the on-screen explanation in sync, and add a focused test when a behavior changes. See [CONTRIBUTING.md](CONTRIBUTING.md).

Licensed under [MIT](LICENSE).
