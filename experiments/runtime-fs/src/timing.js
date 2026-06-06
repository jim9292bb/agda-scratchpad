export function nowMs() {
  return performance.now()
}

export function durationSince(startMs) {
  return Math.round((performance.now() - startMs) * 1000) / 1000
}
