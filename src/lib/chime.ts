// A short two-tone chime, synthesized at runtime.
//
// Deliberately not an audio asset: no binary to bundle, no file to ship or
// version, and the tone is tweakable in code. Web Audio is already in the
// webview, so this costs nothing.

let ctx: AudioContext | null = null;

/** Lazily create the shared context. Returns null when audio is unavailable. */
function audio(): AudioContext | null {
  try {
    ctx ??= new AudioContext();
    // A context created without a user gesture starts suspended; resuming is a
    // no-op once it's already running.
    if (ctx.state === "suspended") void ctx.resume();
    return ctx;
  } catch {
    return null;
  }
}

/**
 * Unlock audio playback. Call from a real click — webviews refuse to start an
 * AudioContext without one, so the sound toggle doubles as the unlock.
 */
export function unlockAudio(): void {
  audio();
}

/** Play the alert chime. Silently does nothing if audio can't start. */
export function ding(volume = 0.22): void {
  const ac = audio();
  if (!ac) return;
  const now = ac.currentTime;
  // Two quick notes — a rising interval reads as "attention" rather than "error".
  const notes: [number, number][] = [
    [880, 0],
    [1318.5, 0.085],
  ];
  for (const [freq, at] of notes) {
    const osc = ac.createOscillator();
    const gain = ac.createGain();
    osc.type = "sine";
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(0.0001, now + at);
    gain.gain.linearRampToValueAtTime(volume, now + at + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + at + 0.3);
    osc.connect(gain).connect(ac.destination);
    osc.start(now + at);
    osc.stop(now + at + 0.32);
  }
}
