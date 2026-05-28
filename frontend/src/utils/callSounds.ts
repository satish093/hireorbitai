/**
 * Call sounds via the Web Audio API — no audio files needed.
 *
 * ring()     — looping phone ring (440 Hz + 480 Hz dual-tone, classic POTS ring pattern)
 * stopRing() — stop the ring loop
 * playConnect()    — short ascending two-tone chirp (call connected)
 * playDisconnect() — short descending two-tone chirp (call ended / rejected)
 */

let audioCtx: AudioContext | null = null;

function ctx(): AudioContext {
  if (!audioCtx || audioCtx.state === 'closed') {
    audioCtx = new AudioContext();
  }
  return audioCtx;
}

// ---------------------------------------------------------------------------
// Ring loop
// ---------------------------------------------------------------------------

let ringInterval: ReturnType<typeof setInterval> | null = null;
let ringNodes: AudioNode[] = [];

function playRingBurst(): void {
  const c = ctx();
  const gain = c.createGain();
  gain.connect(c.destination);

  const freqs = [440, 480]; // Classic North American ring dual-tone
  const nodes: OscillatorNode[] = freqs.map((freq) => {
    const osc = c.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(freq, c.currentTime);
    osc.connect(gain);
    return osc;
  });

  // Ring envelope: 0 → 0.3 in 20ms, hold, 0.3 → 0 in 50ms
  gain.gain.setValueAtTime(0, c.currentTime);
  gain.gain.linearRampToValueAtTime(0.3, c.currentTime + 0.02);
  gain.gain.setValueAtTime(0.3, c.currentTime + 0.38);
  gain.gain.linearRampToValueAtTime(0, c.currentTime + 0.4);

  nodes.forEach((n) => {
    n.start(c.currentTime);
    n.stop(c.currentTime + 0.4);
  });
  ringNodes.push(gain, ...nodes);

  // Cleanup after the burst finishes.
  setTimeout(() => {
    gain.disconnect();
    ringNodes = ringNodes.filter((n) => n !== gain && !nodes.includes(n as OscillatorNode));
  }, 500);
}

export function ring(): void {
  if (ringInterval) return; // already ringing
  // Pattern: burst at 0s, burst at 0.5s, silence until 4s, repeat
  playRingBurst();
  let beatCount = 0;
  ringInterval = setInterval(() => {
    beatCount++;
    if (beatCount === 1) {
      playRingBurst(); // second burst at 0.5s
    } else if (beatCount >= 8) {
      beatCount = 0; // 4s total cycle
    }
  }, 500);
}

export function stopRing(): void {
  if (ringInterval) {
    clearInterval(ringInterval);
    ringInterval = null;
  }
  ringNodes.forEach((n) => {
    try {
      (n as OscillatorNode).stop?.();
      n.disconnect?.();
    } catch {
      // node may already be stopped
    }
  });
  ringNodes = [];
}

// ---------------------------------------------------------------------------
// Connect chirp — ascending two notes
// ---------------------------------------------------------------------------

export function playConnect(): void {
  try {
    const c = ctx();
    const gain = c.createGain();
    gain.gain.setValueAtTime(0.25, c.currentTime);
    gain.gain.linearRampToValueAtTime(0, c.currentTime + 0.3);
    gain.connect(c.destination);

    [880, 1100].forEach((freq, i) => {
      const osc = c.createOscillator();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, c.currentTime);
      osc.connect(gain);
      osc.start(c.currentTime + i * 0.12);
      osc.stop(c.currentTime + i * 0.12 + 0.15);
    });
  } catch {
    // AudioContext may be suspended — not critical
  }
}

// ---------------------------------------------------------------------------
// Disconnect chirp — descending two notes
// ---------------------------------------------------------------------------

export function playDisconnect(): void {
  try {
    const c = ctx();
    const gain = c.createGain();
    gain.gain.setValueAtTime(0.2, c.currentTime);
    gain.gain.linearRampToValueAtTime(0, c.currentTime + 0.3);
    gain.connect(c.destination);

    [660, 440].forEach((freq, i) => {
      const osc = c.createOscillator();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, c.currentTime);
      osc.connect(gain);
      osc.start(c.currentTime + i * 0.12);
      osc.stop(c.currentTime + i * 0.12 + 0.15);
    });
  } catch {
    // not critical
  }
}
