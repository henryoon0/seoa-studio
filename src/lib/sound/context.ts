/*
 * Adapted from procedural-sounds (https://github.com/m1ckc3s/procedural-sounds),
 * lib/audio/context.ts, itself adapted from @web-kits/audio
 * (https://github.com/raphaelsalaja/audio). MIT License — see ./NOTICE.md.
 *
 * One AudioContext for the whole app, created lazily on the first sound so we
 * never open audio hardware for a session that stays silent.
 */

let ctx: AudioContext | null = null;
let masterGain: GainNode | null = null;
let pendingVolume = 1;

export function getContext(): AudioContext {
  if (!ctx || ctx.state === "closed") {
    ctx = new AudioContext();
    masterGain = null;
  }
  if (ctx.state === "suspended") {
    void ctx.resume();
  }
  return ctx;
}

export async function ensureReady(): Promise<AudioContext> {
  const audio = getContext();
  if (audio.state === "suspended") {
    await audio.resume();
  }
  return audio;
}

export function getMasterBus(): GainNode {
  const c = getContext();
  if (!masterGain || masterGain.context !== c) {
    masterGain = c.createGain();
    masterGain.gain.value = pendingVolume;
    masterGain.connect(c.destination);
  }
  return masterGain;
}

export function getDestination(): AudioNode {
  return getMasterBus();
}

/**
 * Remembered even before the context exists, so a volume set at boot survives
 * until the first sound actually builds the bus.
 */
export function setMasterVolume(volume: number): void {
  pendingVolume = volume;
  if (masterGain && ctx && masterGain.context === ctx) {
    masterGain.gain.value = volume;
  }
}
