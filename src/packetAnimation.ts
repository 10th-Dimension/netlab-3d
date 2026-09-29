export type PacketPoint = [number, number, number]
export type PacketDevicePositions = Record<string, { position: PacketPoint }>

export function packetProgressAt(elapsedSeconds: number, startedAtSeconds: number, durationSeconds: number, limit = 1, startingProgress = 0): number {
  const duration = Number.isFinite(durationSeconds) && durationSeconds > 0 ? durationSeconds : 1
  const target = Number.isFinite(limit) ? Math.max(0, Math.min(1, limit)) : 1
  const elapsed = Number.isFinite(elapsedSeconds) && Number.isFinite(startedAtSeconds) ? elapsedSeconds - startedAtSeconds : 0
  const offset = Number.isFinite(startingProgress) ? Math.max(0, Math.min(1, startingProgress)) : 0
  return Math.min(target, Math.max(0, offset + elapsed / duration))
}

export function packetPositionAt(route: string[], progress: number, devices: PacketDevicePositions): PacketPoint | null {
  if (route.length < 2 || route.some((id) => !devices[id])) return null
  const normalized = Number.isFinite(progress) ? Math.max(0, Math.min(1, progress)) : 0
  const segmentCount = route.length - 1
  const scaled = normalized * segmentCount
  const segment = Math.min(Math.floor(scaled), segmentCount - 1)
  const local = normalized >= 1 ? 1 : scaled - segment
  const from = devices[route[segment]].position
  const to = devices[route[segment + 1]].position
  return [
    from[0] + (to[0] - from[0]) * local,
    0.53 + Math.sin(local * Math.PI) * 0.42,
    from[2] + (to[2] - from[2]) * local,
  ]
}
