// Sound effects (small mp3 files) + a soft procedural music loop, all through one AudioContext.
// Browsers only allow audio after a user gesture: call audio.unlock() from input handlers.

const SFX = ['coin', 'jump', 'land', 'grab', 'place', 'buy', 'click', 'error', 'open', 'close', 'crack', 'whoosh',
  'step1', 'step2', 'thud', 'hatch', 'hatch_rare', 'caught', 'rebirth', 'unlock'];

let ctx = null, master = null, sfxGain = null, musicGain = null;
const buffers = {};
let soundOn = true, musicOn = true, suspended = 0, musicTimer = null;

function makeCtx() {
  if (ctx) return;
  try { ctx = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { return; }
  master = ctx.createGain(); master.connect(ctx.destination);
  sfxGain = ctx.createGain(); sfxGain.connect(master);
  musicGain = ctx.createGain(); musicGain.gain.value = 0.0; musicGain.connect(master);
  for (const name of SFX) {
    fetch(`./assets/sfx/${name}.mp3`).then((r) => r.arrayBuffer())
      .then((b) => new Promise((ok, bad) => ctx.decodeAudioData(b, ok, bad)))
      .then((buf) => { buffers[name] = buf; }).catch(() => { /* missing sound: stay silent */ });
  }
}

function apply() {
  if (!ctx) return;
  const audible = suspended === 0;
  if (audible && ctx.state === 'suspended') ctx.resume().catch(() => {});
  if (!audible && ctx.state === 'running') ctx.suspend().catch(() => {});
  sfxGain.gain.value = soundOn ? 1 : 0;
  musicGain.gain.setTargetAtTime(musicOn ? 0.16 : 0, ctx.currentTime, 0.3);
}

// --- procedural music: cheerful I–V–vi–IV loop, plucky lead + soft bass + light hats ----------
const BPM = 112, STEP = 60 / BPM / 2;                // eighth notes
const CHORDS = [[60, 64, 67], [55, 59, 62], [57, 60, 64], [53, 57, 60]]; // C G Am F
const LEAD = [ // 16 eighths per chord, -1 = rest
  [72, -1, 76, 79, 76, -1, 74, 72, 74, -1, 76, -1, 72, -1, -1, -1],
  [71, -1, 74, 79, 74, -1, 72, 71, 72, -1, 74, -1, 67, -1, -1, -1],
  [72, -1, 76, 81, 79, -1, 76, 74, 76, -1, 72, -1, 69, -1, -1, -1],
  [69, -1, 72, 77, 76, -1, 74, 72, 74, -1, 72, -1, 71, -1, 74, -1],
];
const hz = (m) => 440 * Math.pow(2, (m - 69) / 12);
let nextTime = 0, stepIdx = 0;

function note(freq, t, dur, type, vol, out) {
  const o = ctx.createOscillator(), g = ctx.createGain();
  o.type = type; o.frequency.value = freq;
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(vol, t + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(out);
  o.start(t); o.stop(t + dur + 0.05);
}
let noiseBuf = null;
function hat(t) {
  if (!noiseBuf) {
    noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 0.05, ctx.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / d.length);
  }
  const s = ctx.createBufferSource(), g = ctx.createGain(), f = ctx.createBiquadFilter();
  f.type = 'highpass'; f.frequency.value = 7000;
  s.buffer = noiseBuf; g.gain.value = 0.12;
  s.connect(f).connect(g).connect(musicGain); s.start(t);
}
function scheduleMusic() {
  if (!ctx || ctx.state !== 'running') return;
  if (nextTime < ctx.currentTime) nextTime = ctx.currentTime + 0.05;
  while (nextTime < ctx.currentTime + 0.4) {
    const bar = Math.floor(stepIdx / 16) % 4, s = stepIdx % 16;
    const chord = CHORDS[bar];
    if (s % 4 === 0) note(hz(chord[0] - 24), nextTime, STEP * 3.5, 'triangle', 0.35, musicGain);
    if (s % 4 === 2) note(hz(chord[0] - 12), nextTime, STEP * 1.5, 'triangle', 0.18, musicGain);
    if (s % 8 === 4) chord.forEach((m) => note(hz(m), nextTime, STEP * 2, 'sine', 0.06, musicGain));
    const l = LEAD[bar][s];
    if (l > 0) note(hz(l), nextTime, STEP * 1.8, 'square', 0.035, musicGain);
    if (s % 2 === 1) hat(nextTime);
    nextTime += STEP; stepIdx++;
  }
}

// iOS suspends/interrupts the context when the app is backgrounded; only a user gesture can resume it
for (const ev of ['touchend', 'pointerup', 'keydown']) {
  document.addEventListener(ev, () => { if (ctx && suspended === 0 && ctx.state !== 'running') ctx.resume().catch(() => {}); }, true);
}

export const audio = {
  unlock() {
    makeCtx();
    apply();
    if (!musicTimer && ctx) musicTimer = setInterval(scheduleMusic, 120);
  },
  play(name, { vol = 1, rate = 1 } = {}) {
    if (!ctx || !soundOn || suspended || !buffers[name]) return;
    const s = ctx.createBufferSource(), g = ctx.createGain();
    s.buffer = buffers[name]; s.playbackRate.value = rate; g.gain.value = vol;
    s.connect(g).connect(sfxGain); s.start();
  },
  // notes for quick UI blips that have no file
  blip(freqs, dur = 0.08, vol = 0.05) {
    if (!ctx || !soundOn || suspended) return;
    const t = ctx.currentTime;
    freqs.forEach((f, i) => note(f, t + i * dur, dur * 1.2, 'triangle', vol, sfxGain));
  },
  // ads, hidden tab, portal pause: stack-safe
  suspend() { suspended++; apply(); },
  resume() { if (suspended > 0) suspended--; apply(); },
  setSound(on) { soundOn = on; apply(); },
  setMusic(on) { musicOn = on; apply(); },
  get soundOn() { return soundOn; },
  get muted() { return suspended > 0 || (ctx ? ctx.state !== "running" : false); },
  get musicOn() { return musicOn; },
};
