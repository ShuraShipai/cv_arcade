// Square-wave beeps in the same style as the landing page. Respects the HUD mute toggle.

export interface Sound {
  beep(freq: number, dur?: number, type?: OscillatorType, vol?: number): void;
  warm(): void;
  muted: boolean;
}

export function createSound(muted: boolean): Sound {
  let ac: AudioContext | null = null;
  function ensure(): AudioContext | null {
    try {
      if (!ac) ac = new AudioContext();
      if (ac.state === 'suspended') void ac.resume();
      return ac;
    } catch {
      return null;
    }
  }
  return {
    muted,
    warm() {
      ensure();
    },
    beep(freq, dur = 0.07, type = 'square', vol = 0.04) {
      if (this.muted) return;
      const ctx = ensure();
      if (!ctx) return;
      try {
        const o = ctx.createOscillator(), v = ctx.createGain();
        o.type = type;
        o.frequency.value = freq;
        v.gain.value = vol;
        o.connect(v);
        v.connect(ctx.destination);
        o.start();
        v.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + dur);
        o.stop(ctx.currentTime + dur);
      } catch {
        // No audio available; the game is still playable.
      }
    },
  };
}
