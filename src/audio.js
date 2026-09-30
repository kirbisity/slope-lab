// Procedural sound: one looping noise buffer shaped into wind and snow hiss,
// plus short one-shots for landings, crashes and chimes. Browsers allow audio
// only after a user gesture, so nothing is created until unlock() runs from one.

// Wind is felt from ~10 m/s and is loud by 40 m/s; hiss follows ground speed.
const WIND_FULL_SPEED = 40;
const HISS_FULL_SPEED = 30;
const MASTER_VOLUME = 0.7;

export function createAudio() {
  return { context: null, muted: false, nodes: null };
}

function noiseBuffer(context) {
  const buffer = context.createBuffer(1, context.sampleRate * 2, context.sampleRate);
  const data = buffer.getChannelData(0);
  for (let index = 0; index < data.length; index += 1) data[index] = Math.random() * 2 - 1;
  return buffer;
}

/** Create the audio graph; call from inside a click or key handler. */
export function unlock(audio) {
  if (audio.context) {
    if (audio.context.state === 'suspended') audio.context.resume().catch(() => {});
    return;
  }
  const AudioContextClass = globalThis.AudioContext || globalThis.webkitAudioContext;
  if (!AudioContextClass) return;
  try {
    const context = new AudioContextClass();
    const master = context.createGain();
    master.gain.value = audio.muted ? 0 : MASTER_VOLUME;
    master.connect(context.destination);
    const noise = noiseBuffer(context);
    const source = context.createBufferSource();
    source.buffer = noise;
    source.loop = true;

    const windFilter = context.createBiquadFilter();
    windFilter.type = 'bandpass';
    windFilter.Q.value = 0.7;
    windFilter.frequency.value = 300;
    const windGain = context.createGain();
    windGain.gain.value = 0;
    source.connect(windFilter).connect(windGain).connect(master);

    const hissFilter = context.createBiquadFilter();
    hissFilter.type = 'highpass';
    hissFilter.frequency.value = 2400;
    const hissGain = context.createGain();
    hissGain.gain.value = 0;
    source.connect(hissFilter).connect(hissGain).connect(master);

    source.start();
    audio.context = context;
    audio.nodes = { master, windFilter, windGain, hissGain, noise };
  } catch {
    audio.context = null;
  }
}

export function setMuted(audio, muted) {
  audio.muted = muted;
  if (audio.nodes) audio.nodes.master.gain.setTargetAtTime(muted ? 0 : MASTER_VOLUME, audio.context.currentTime, 0.05);
}

/** Follow the skier: called every frame while riding (or with speed 0 to fade out). */
export function updateAmbience(audio, speed, onSnow, braking) {
  if (!audio.nodes) return;
  const now = audio.context.currentTime;
  const wind = Math.min(1, Math.max(0, (speed - 6) / (WIND_FULL_SPEED - 6)));
  audio.nodes.windGain.gain.setTargetAtTime(0.35 * wind * wind, now, 0.15);
  audio.nodes.windFilter.frequency.setTargetAtTime(250 + speed * 22, now, 0.2);
  const hiss = onSnow ? Math.min(1, speed / HISS_FULL_SPEED) * (braking ? 1.8 : 1) : 0;
  audio.nodes.hissGain.gain.setTargetAtTime(0.09 * hiss, now, onSnow ? 0.05 : 0.02);
}

function burst(audio, { duration, filterType, frequency, volume }) {
  const { context, nodes } = audio;
  const source = context.createBufferSource();
  source.buffer = nodes.noise;
  const filter = context.createBiquadFilter();
  filter.type = filterType;
  filter.frequency.value = frequency;
  const gain = context.createGain();
  const now = context.currentTime;
  gain.gain.setValueAtTime(volume, now);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
  source.connect(filter).connect(gain).connect(nodes.master);
  source.start(now, Math.random());
  source.stop(now + duration + 0.05);
}

function tone(audio, frequency, start, duration, volume, type = 'sine') {
  const { context, nodes } = audio;
  const oscillator = context.createOscillator();
  oscillator.type = type;
  oscillator.frequency.value = frequency;
  const gain = context.createGain();
  const at = context.currentTime + start;
  gain.gain.setValueAtTime(0.0001, at);
  gain.gain.exponentialRampToValueAtTime(volume, at + 0.01);
  gain.gain.exponentialRampToValueAtTime(0.0001, at + duration);
  oscillator.connect(gain).connect(nodes.master);
  oscillator.start(at);
  oscillator.stop(at + duration + 0.05);
}

/** A landing thump whose weight follows the impact speed (m/s into the snow). */
export function playLanding(audio, impact) {
  if (!audio.nodes || impact < 0.8) return;
  const weight = Math.min(1, impact / 11);
  burst(audio, { duration: 0.12 + weight * 0.25, filterType: 'lowpass', frequency: 300 + weight * 500, volume: 0.25 + weight * 0.6 });
  if (weight > 0.35) tone(audio, 70, 0, 0.25, 0.3 * weight, 'triangle');
}

export function playCrash(audio) {
  if (!audio.nodes) return;
  burst(audio, { duration: 0.7, filterType: 'lowpass', frequency: 900, volume: 0.9 });
  tone(audio, 55, 0, 0.4, 0.4, 'triangle');
}

export function playChime(audio, notes = [880, 1320]) {
  if (!audio.nodes) return;
  notes.forEach((frequency, index) => tone(audio, frequency, index * 0.09, 0.35, 0.18));
}
