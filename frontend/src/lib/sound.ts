// Dependency-free alarm tones via the Web Audio API — no audio assets to ship.
// A single lazily-created AudioContext is reused; browsers keep it "suspended"
// until the first user gesture, so unlockAudio() is called on first interaction.

let ctx: AudioContext | null = null

function getCtx(): AudioContext | null {
  if (typeof window === "undefined") return null
  if (!ctx) {
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!AC) return null
    ctx = new AC()
  }
  return ctx
}

export function unlockAudio(): void {
  const c = getCtx()
  if (c && c.state === "suspended") c.resume().catch(() => {})
}

function tone(c: AudioContext, freq: number, at: number, dur: number): void {
  const osc = c.createOscillator()
  const gain = c.createGain()
  osc.type = "square"
  osc.frequency.value = freq
  gain.gain.setValueAtTime(0.0001, at)
  gain.gain.exponentialRampToValueAtTime(0.18, at + 0.01)
  gain.gain.exponentialRampToValueAtTime(0.0001, at + dur)
  osc.connect(gain)
  gain.connect(c.destination)
  osc.start(at)
  osc.stop(at + dur + 0.02)
}

// critical → three urgent high beeps; warning → a softer double beep
export function playAlarm(severity: "critical" | "warning" = "critical"): void {
  const c = getCtx()
  if (!c) return
  if (c.state === "suspended") c.resume().catch(() => {})
  const now = c.currentTime
  const offsets = severity === "critical" ? [0, 0.2, 0.4] : [0, 0.18]
  const freq = severity === "critical" ? 880 : 600
  offsets.forEach((o) => tone(c, freq, now + o, 0.14))
}
