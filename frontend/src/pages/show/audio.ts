// The TV's sound: effects, synthesised instruments for the music round, and half-time lounge music.
// Everything is generated with the Web Audio API, so there are no sound files to load.
import type { Quiz } from '../../lib/types';

type Tune = NonNullable<Quiz['tunes']>[number];
type Inst = (f: number, t: number, d: number, dest: AudioNode, v?: number) => void;

const SEMI: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
export function noteFreq(n: string, transpose = 0): number {
  const m = /^([A-G])(#|b)?(-?\d)$/.exec(n);
  if (!m) return 440;
  const midi = (+m[3] + 1) * 12 + SEMI[m[1]] + (m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0) + transpose;
  return 440 * Math.pow(2, (midi - 69) / 12);
}
const parseNotes = (str: string) => str.trim().split(/\s+/).map(tok => {
  const [p, l] = tok.split(':');
  return { pitch: p === 'R' ? null : p, len: parseFloat(l || '1') };
});

interface ToneOpts { vol?: number; attack?: number; sustain?: boolean; release?: number; dest?: AudioNode; detune?: number; lp?: number; glide?: number }
interface NoiseOpts { vol?: number; type?: BiquadFilterType; freq?: number; q?: number; attack?: number; sweepTo?: number; dest?: AudioNode }

class SoundEngine {
  ctx: AudioContext | null = null;
  out: GainNode | null = null;
  private noiseBuf: AudioBuffer | null = null;
  volume = 0.7;
  muted = false;
  onState: () => void = () => {};

  /** Create the audio graph on first use. Browsers only allow this after a click or key press. */
  ensure(): AudioContext | null {
    if (!this.ctx) {
      const AC = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AC) return null;
      const ctx = new AC();
      this.ctx = ctx;
      this.out = ctx.createGain();
      const comp = ctx.createDynamicsCompressor();
      comp.threshold.value = -14; comp.ratio.value = 4;
      this.out.connect(comp); comp.connect(ctx.destination);
      const len = ctx.sampleRate * 3, buf = ctx.createBuffer(1, len, ctx.sampleRate), d = buf.getChannelData(0);
      for (let k = 0; k < len; k++) d[k] = Math.random() * 2 - 1;
      this.noiseBuf = buf;
      ctx.onstatechange = () => this.onState();
      this.applyVolume();
    }
    if (this.ctx.state === 'suspended') this.ctx.resume().catch(() => {});
    return this.ctx;
  }

  get ready(): boolean { return this.ctx?.state === 'running'; }

  private start(): number | null {
    const c = this.ensure();
    return c && !this.muted ? c.currentTime + 0.01 : null;
  }

  applyVolume(): void {
    if (this.out && this.ctx) this.out.gain.setTargetAtTime(this.muted ? 0 : this.volume, this.ctx.currentTime, 0.02);
  }

  tone(type: OscillatorType, freq: number, t0: number, dur: number, { vol = 0.15, attack = 0.006, sustain = false, release = 0.12, dest, detune = 0, lp = 0, glide = 0 }: ToneOpts = {}): void {
    const c = this.ctx!, o = c.createOscillator(), g = c.createGain();
    o.type = type; o.frequency.setValueAtTime(freq, t0);
    if (glide) o.frequency.exponentialRampToValueAtTime(glide, t0 + dur);
    if (detune) o.detune.value = detune;
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(vol, t0 + attack);
    if (sustain) g.gain.setValueAtTime(vol, Math.max(t0 + attack + 0.01, t0 + dur - release));
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    let n: AudioNode = o;
    if (lp) { const f = c.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = lp; o.connect(f); n = f; }
    n.connect(g); g.connect(dest || this.out!);
    o.start(t0); o.stop(t0 + dur + 0.05);
  }

  noise(t0: number, dur: number, { vol = 0.2, type = 'highpass', freq = 1000, q = 0.7, attack = 0.002, sweepTo = 0, dest }: NoiseOpts = {}): void {
    const c = this.ctx!, s = c.createBufferSource(), f = c.createBiquadFilter(), g = c.createGain();
    s.buffer = this.noiseBuf;
    f.type = type; f.frequency.setValueAtTime(freq, t0); f.Q.value = q;
    if (sweepTo) f.frequency.exponentialRampToValueAtTime(sweepTo, t0 + dur);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(vol, t0 + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    s.connect(f); f.connect(g); g.connect(dest || this.out!);
    s.start(t0, Math.random() * 0.8); s.stop(t0 + dur + 0.05);
  }

  private brass(f: number, t: number, d: number, vol = 0.05): void {
    this.tone('sawtooth', f, t, d, { vol, attack: 0.03, sustain: true, release: 0.12, lp: 2300, detune: -6 });
    this.tone('sawtooth', f, t, d, { vol, attack: 0.03, sustain: true, release: 0.12, lp: 2300, detune: 6 });
  }
  private bell(t: number): void {
    this.tone('sine', 880, t, 1.4, { vol: 0.12 }); this.tone('sine', 2346, t, 0.8, { vol: 0.04 }); this.tone('sine', 1760, t, 1.0, { vol: 0.03 });
  }

  chime() { const t = this.start(); if (t == null) return;
    this.tone('sine', 1046.5, t, 0.7, { vol: 0.09 }); this.tone('triangle', 523.25, t, 0.5, { vol: 0.05 });
    this.tone('sine', 1568, t + 0.1, 0.8, { vol: 0.08 }); this.tone('triangle', 784, t + 0.1, 0.6, { vol: 0.04 }); }
  reveal() { const t = this.start(); if (t == null) return;
    [523.25, 659.25, 783.99, 1046.5].forEach((f, k) => this.tone('triangle', f, t + k * 0.07, k === 3 ? 0.9 : 0.35, { vol: 0.13 }));
    this.tone('sine', 2093, t + 0.3, 0.6, { vol: 0.035 }); this.tone('sine', 2637, t + 0.36, 0.6, { vol: 0.03 }); }
  fanfare() { const t = this.start(); if (t == null) return;
    [0, 0.15, 0.3].forEach(dt => this.brass(noteFreq('C5'), t + dt, 0.13, 0.055));
    ['C5', 'E5', 'G5', 'C6'].forEach(n => this.brass(noteFreq(n), t + 0.45, 1.0, 0.04));
    this.noise(t + 0.45, 1.0, { vol: 0.07, type: 'highpass', freq: 6000 }); }
  whoosh() { const t = this.start(); if (t == null) return; this.noise(t, 0.6, { vol: 0.16, type: 'bandpass', freq: 300, q: 1.2, attack: 0.28, sweepTo: 3600 }); }
  tick() { const t = this.start(); if (t == null) return; this.tone('square', 1600, t, 0.035, { vol: 0.035 }); }
  beep() { const t = this.start(); if (t == null) return; this.tone('sine', 880, t, 0.22, { vol: 0.17 }); }
  buzzer() { const t = this.start(); if (t == null) return;
    this.tone('sawtooth', 98, t, 0.95, { vol: 0.16, sustain: true, release: 0.2, lp: 1100 });
    this.tone('square', 103.8, t, 0.95, { vol: 0.08, sustain: true, release: 0.2, lp: 800 }); }
  swap() { const t = this.start(); if (t == null) return; [0, 0.28, 0.56].forEach(dt => this.bell(t + dt)); }
  hint() { const t = this.start(); if (t == null) return; this.tone('triangle', 660, t, 0.18, { vol: 0.09 }); this.tone('triangle', 990, t + 0.09, 0.3, { vol: 0.09 }); }
  blip(k: number) { const t = this.start(); if (t == null) return; this.tone('triangle', 392 * Math.pow(2, Math.min(k, 14) * 2 / 12), t, 0.2, { vol: 0.08 }); }
  breakOver() { const t = this.start(); if (t == null) return; [0, 0.6, 1.2].forEach(dt => this.bell(t + dt)); }
  drumroll(sec: number) { const t0 = this.start(); if (t0 == null) return;
    let t = t0; const end = t0 + sec;
    while (t < end) { const p = (t - t0) / sec; this.noise(t, 0.09, { vol: 0.07 + 0.22 * p, type: 'bandpass', freq: 1800, q: 0.8 }); this.tone('triangle', 170, t, 0.05, { vol: 0.04 + 0.08 * p }); t += 0.055 - 0.018 * p; }
    this.noise(end, 1.8, { vol: 0.42, type: 'highpass', freq: 4500 }); this.tone('sine', 62, end, 0.45, { vol: 0.5 }); }
  winFanfare() { const t = this.start(); if (t == null) return;
    ([['G4', 0, 0.14], ['C5', 0.15, 0.14], ['E5', 0.3, 0.14], ['G5', 0.45, 0.4], ['E5', 0.86, 0.14], ['G5', 1.0, 1.5]] as const).forEach(([n, dt, d]) => this.brass(noteFreq(n), t + dt, d, 0.06));
    ['C4', 'E4', 'G4', 'C5'].forEach(n => this.brass(noteFreq(n), t + 1.0, 1.5, 0.035));
    this.noise(t + 1.0, 1.6, { vol: 0.12, type: 'highpass', freq: 5000 }); }
}

export const SFX = new SoundEngine();

/* ---------- Instruments for the music round ---------- */

const INST: Record<Tune['inst'], Inst> = {
  strings(f, t, d, dest, v = 1) {
    const c = SFX.ctx!, g = c.createGain(), vol = 0.07 * v, end = t + d * 0.95;
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + 0.05);
    g.gain.setValueAtTime(vol, Math.max(t + 0.06, end - 0.08)); g.gain.exponentialRampToValueAtTime(0.0001, end + 0.12);
    const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = Math.min(4200, f * 6);
    const lfo = c.createOscillator(), lg = c.createGain(); lfo.frequency.value = 5.5; lg.gain.value = f * 0.004; lfo.connect(lg);
    [-8, 8].forEach(dt => { const o = c.createOscillator(); o.type = 'sawtooth'; o.frequency.value = f; o.detune.value = dt; lg.connect(o.frequency); o.connect(lp); o.start(t); o.stop(end + 0.2); });
    lfo.start(t); lfo.stop(end + 0.2); lp.connect(g); g.connect(dest);
  },
  organ(f, t, d, dest, v = 1) {
    const c = SFX.ctx!, g = c.createGain(), vol = 0.06 * v, end = t + d * 0.97;
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + 0.012);
    g.gain.setValueAtTime(vol, Math.max(t + 0.02, end - 0.05)); g.gain.exponentialRampToValueAtTime(0.0001, end + 0.08);
    const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 3600;
    ([['square', 1, 0.45], ['sine', 1, 1], ['sine', 2, 0.35]] as const).forEach(([type, mul, lv]) => {
      const o = c.createOscillator(), og = c.createGain(); o.type = type; o.frequency.value = f * mul; og.gain.value = lv; o.connect(og); og.connect(lp); o.start(t); o.stop(end + 0.1);
    });
    lp.connect(g); g.connect(dest);
  },
  brass(f, t, d, dest, v = 1) {
    const c = SFX.ctx!, g = c.createGain(), vol = 0.06 * v, end = t + d * 0.9;
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + 0.025);
    g.gain.setValueAtTime(vol, Math.max(t + 0.03, end - 0.06)); g.gain.exponentialRampToValueAtTime(0.0001, end + 0.08);
    const lp = c.createBiquadFilter(); lp.type = 'lowpass';
    lp.frequency.setValueAtTime(f * 1.5, t); lp.frequency.linearRampToValueAtTime(Math.min(5200, f * 7), t + 0.05); lp.frequency.linearRampToValueAtTime(Math.min(4000, f * 4), t + 0.2);
    [-5, 5].forEach(dt => { const o = c.createOscillator(); o.type = 'sawtooth'; o.frequency.value = f; o.detune.value = dt; o.connect(lp); o.start(t); o.stop(end + 0.1); });
    lp.connect(g); g.connect(dest);
  },
  piano(f, t, d, dest, v = 1) {
    const c = SFX.ctx!, g = c.createGain(), vol = 0.14 * v, end = t + Math.min(d * 1.6 + 0.3, 1.6);
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + 0.005); g.gain.exponentialRampToValueAtTime(0.0001, end);
    ([['triangle', 1, 1], ['sine', 2, 0.25], ['sine', 3, 0.08]] as const).forEach(([type, mul, lv]) => {
      const o = c.createOscillator(), og = c.createGain(); o.type = type; o.frequency.value = f * mul; og.gain.value = lv; o.connect(og); og.connect(g); o.start(t); o.stop(end + 0.05);
    });
    g.connect(dest);
  },
  pluck(f, t, _d, dest, v = 1) {
    const c = SFX.ctx!, g = c.createGain(), vol = 0.16 * v, end = t + 0.32;
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + 0.004); g.gain.exponentialRampToValueAtTime(0.0001, end);
    ([['triangle', 1, 1], ['sine', 2, 0.3]] as const).forEach(([type, mul, lv]) => {
      const o = c.createOscillator(), og = c.createGain(); o.type = type; o.frequency.value = f * mul; og.gain.value = lv; o.connect(og); og.connect(g); o.start(t); o.stop(end + 0.05);
    });
    g.connect(dest);
  }
};

/** Plays one of the quiz's tunes; calls onEnd(natural) when it finishes or is stopped. */
export class TunePlayer {
  private bus: GainNode | null = null;
  private endTimer = 0;
  playing = -1;
  onChange: (playing: number, natural: boolean) => void = () => {};

  play(tunes: Tune[], idx: number): string | null {
    const c = SFX.ensure();
    if (!c) return 'This browser cannot play sound.';
    this.stop();
    if (SFX.muted) return 'Sound is muted. Press M to unmute.';
    const tune = tunes[idx];
    if (!tune) return null;
    this.bus = c.createGain(); this.bus.gain.value = 0.95; this.bus.connect(SFX.out!);
    let t = c.currentTime + 0.08;
    for (const n of parseNotes(tune.notes)) {
      const d = n.len * tune.unit;
      if (n.pitch) {
        const f = noteFreq(n.pitch, tune.transpose || 0);
        INST[tune.inst](f, t, d, this.bus);
        if (tune.double) INST[tune.inst](f * Math.pow(2, tune.double / 12), t, d, this.bus, 0.6);
      }
      t += d;
    }
    this.playing = idx;
    this.endTimer = window.setTimeout(() => this.stop(true), (t - c.currentTime) * 1000 + 350);
    this.onChange(idx, false);
    return null;
  }

  stop(natural = false): void {
    window.clearTimeout(this.endTimer);
    if (this.bus && SFX.ctx) {
      const b = this.bus;
      try { b.gain.setTargetAtTime(0, SFX.ctx.currentTime, 0.03); } catch { /* already gone */ }
      window.setTimeout(() => b.disconnect(), 400);
      this.bus = null;
    }
    const was = this.playing;
    this.playing = -1;
    if (was >= 0) this.onChange(-1, natural);
  }
}

/** Gentle chords for the half-time break. */
export class Lounge {
  on = false;
  private iv = 0;
  private bus: GainNode | null = null;
  private next = 0;
  private step = 0;
  private readonly chords = [['F3', 'A3', 'C4', 'E4'], ['E3', 'G3', 'B3', 'D4'], ['D3', 'F3', 'A3', 'C4'], ['C3', 'E3', 'G3', 'B3']];

  start(): string | null {
    const c = SFX.ensure();
    if (!c) return 'This browser cannot play sound.';
    if (SFX.muted) return 'Sound is muted. Press M to unmute.';
    this.stop(); this.on = true;
    this.bus = c.createGain(); this.bus.gain.value = 0.6; this.bus.connect(SFX.out!);
    this.next = c.currentTime + 0.1; this.step = 0;
    this.schedule(); this.iv = window.setInterval(() => this.schedule(), 150);
    return null;
  }

  private schedule(): void {
    const c = SFX.ctx!, beat = 0.32, pat = [0, 2, 1, 3, 2, 1, 3, 2];
    while (this.next < c.currentTime + 0.5) {
      const bar = Math.floor(this.step / 8) % 4, b = this.step % 8, ch = this.chords[bar].map(n => noteFreq(n)), t = this.next;
      if (b === 0) {
        ch.forEach(f => SFX.tone('sine', f, t, beat * 8, { vol: 0.03, attack: 0.4, sustain: true, release: 0.6, dest: this.bus! }));
        SFX.tone('triangle', ch[0] / 2, t, beat * 3, { vol: 0.1, dest: this.bus! });
      }
      if (b === 4) SFX.tone('triangle', ch[2] / 2, t, beat * 3, { vol: 0.08, dest: this.bus! });
      if (!(b === 7 && bar % 2)) SFX.tone('triangle', ch[pat[b]] * 2, t, beat * 1.6, { vol: 0.045, dest: this.bus! });
      this.next += beat; this.step++;
    }
  }

  stop(): void {
    window.clearInterval(this.iv);
    if (this.bus && SFX.ctx) { const b = this.bus; b.gain.setTargetAtTime(0, SFX.ctx.currentTime, 0.1); window.setTimeout(() => b.disconnect(), 900); this.bus = null; }
    this.on = false;
  }
}
