// Procedural soundtrack and sound effects (Web Audio, no asset files).
//
// Music, "Troll Climb": an original, sneaky-bouncy 116 BPM shuffle in D minor (Dm - Bb - Gm - A,
// Dm - Bb - C - A). It tiptoes in (pizzicato walking bass, finger snaps, woodblock ticks, a staccato
// clarinet sneaking round the chords), then bounces (oom-pah tuba, kick and claps, marimba stabs, a
// buzzing kazoo hook), climbs a tone higher with glockenspiel sparkles, breaks down to a "wah wah wah
// waaah" trombone (the troll laughing at you), bounces again and drum-rolls back round. 48 bars.
// The higher you climb, the more layers join in (setMusicIntensity: the lobby, then each colour band).
//
// Footsteps: studs, wooden planks, trusses, keycaps, ice, trampolines, glass... all synthesized.

let ctx = null, master, comp, musicBus, musicOut, duckFilter, sfxBus, asmrBus, reverb, roomVerb, delay;
let noiseBuf = null, meter = null;
let musicOn = false, schedTimer = null, seqStep = 0, nextTime = 0, ducked = false;
const settings = { music: 0.5, sfx: 0.8, asmr: 0.9, master: 1, muted: false };
try { Object.assign(settings, JSON.parse(localStorage.getItem('tet_audio') || '{}')); } catch (e) { /* defaults */ }

const BPM = 116, STEP = 60 / BPM / 4, SWING = 0.16;
const midi = (n) => 440 * Math.pow(2, (n - 69) / 12);
// eight bars of chords: root (bass) and a mid voicing
const CHORDS = [
    { root: 38, notes: [62, 65, 69] },   // Dm
    { root: 34, notes: [62, 65, 70] },   // Bb
    { root: 43, notes: [62, 67, 70] },   // Gm
    { root: 45, notes: [61, 64, 69] },   // A
    { root: 38, notes: [62, 65, 69] },   // Dm
    { root: 34, notes: [62, 65, 70] },   // Bb
    { root: 36, notes: [64, 67, 72] },   // C
    { root: 45, notes: [61, 64, 69] },   // A
];
// [step, midi, length] per bar
// the sneak: a staccato clarinet tiptoeing round the chords, with chromatic slides
const SNEAK = [
    [[0, 62, 1], [2, 65, 1], [4, 69, 2], [7, 68, 1], [8, 69, 1], [10, 65, 1], [12, 62, 2]],
    [[0, 62, 1], [2, 65, 1], [4, 70, 2], [7, 69, 1], [8, 70, 1], [10, 74, 2], [13, 72, 1], [14, 70, 1]],
    [[0, 67, 1], [2, 70, 1], [4, 74, 2], [6, 72, 1], [8, 70, 1], [10, 67, 1], [12, 70, 2], [14, 69, 1]],
    [[0, 69, 2], [2, 73, 1], [4, 76, 2], [8, 73, 1], [9, 72, 1], [10, 71, 1], [11, 70, 1], [12, 69, 3]],
    [[0, 62, 1], [2, 65, 1], [4, 69, 2], [7, 68, 1], [8, 69, 1], [10, 65, 1], [12, 62, 2]],
    [[0, 62, 1], [2, 65, 1], [4, 70, 2], [7, 69, 1], [8, 70, 1], [10, 74, 2], [13, 72, 1], [14, 70, 1]],
    [[0, 72, 1], [2, 76, 1], [4, 79, 2], [7, 78, 1], [8, 79, 1], [10, 76, 1], [12, 72, 2]],
    [[0, 73, 1], [1, 74, 1], [2, 76, 1], [4, 81, 3], [8, 79, 1], [10, 77, 1], [12, 76, 1], [14, 73, 1]],
];
// the hook: the kazoo's bouncy tune
const HOOK = [
    [[0, 74, 3], [3, 74, 1], [4, 77, 2], [6, 74, 2], [8, 72, 2], [10, 69, 2], [12, 72, 4]],
    [[0, 70, 2], [2, 74, 2], [4, 77, 3], [7, 76, 1], [8, 74, 2], [10, 72, 2], [12, 70, 4]],
    [[0, 67, 2], [2, 70, 2], [4, 74, 2], [6, 77, 2], [8, 79, 3], [11, 77, 1], [12, 74, 4]],
    [[0, 73, 2], [2, 76, 2], [4, 79, 2], [6, 81, 2], [8, 79, 1], [9, 77, 1], [10, 76, 1], [11, 74, 1], [12, 73, 4]],
    [[0, 74, 3], [3, 74, 1], [4, 77, 2], [6, 74, 2], [8, 72, 2], [10, 69, 2], [12, 72, 4]],
    [[0, 74, 2], [2, 77, 2], [4, 82, 3], [7, 81, 1], [8, 79, 2], [10, 77, 2], [12, 74, 4]],
    [[0, 72, 2], [2, 76, 2], [4, 79, 4], [8, 81, 2], [10, 79, 2], [12, 76, 2], [14, 72, 2]],
    [[0, 81, 2], [2, 79, 1], [3, 77, 1], [4, 76, 2], [6, 73, 2], [8, 73, 2], [10, 76, 2], [12, 74, 4]],
];
const SECTION = (bar) => {
    const b = bar % 48;
    if (b < 8) return 'sneak';
    if (b < 16) return 'bounce';
    if (b < 24) return 'climb';
    if (b < 28) return 'break';
    if (b < 36) return 'bounce2';
    if (b < 44) return 'sneak2';
    return 'turn';
};
let intensity = 0;
// 0 the lobby, 1..3 as you climb the colour bands: more layers join the music
export function setMusicIntensity(k) { intensity = Math.max(0, Math.min(3, k | 0)); }

export function initAudio() {
    if (ctx) { if (ctx.state === 'suspended') ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    ctx = new AC();
    comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14; comp.ratio.value = 3.5; comp.attack.value = 0.004; comp.release.value = 0.2;
    master = ctx.createGain(); master.gain.value = 1.0;
    comp.connect(master).connect(ctx.destination);
    meter = ctx.createAnalyser(); meter.fftSize = 2048; master.connect(meter);
    musicBus = ctx.createGain();
    duckFilter = ctx.createBiquadFilter(); duckFilter.type = 'lowpass'; duckFilter.frequency.value = 20000; duckFilter.Q.value = 0.5;
    // a gentle top-end roll-off so the bright mix never gets harsh
    const warm = ctx.createBiquadFilter(); warm.type = 'lowpass'; warm.frequency.value = 9000; warm.Q.value = 0.3;
    musicOut = ctx.createGain();
    musicBus.connect(warm).connect(duckFilter).connect(musicOut).connect(comp);
    sfxBus = ctx.createGain(); sfxBus.connect(comp);
    asmrBus = ctx.createGain(); asmrBus.connect(comp);
    applyVolumes();

    noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;

    const ir = (secs, decay) => {
        const len = ctx.sampleRate * secs, b = ctx.createBuffer(2, len, ctx.sampleRate);
        for (let c = 0; c < 2; c++) { const ch = b.getChannelData(c); for (let i = 0; i < len; i++) ch[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay); }
        return b;
    };
    reverb = ctx.createConvolver(); reverb.buffer = ir(2.8, 3);
    const revGain = ctx.createGain(); revGain.gain.value = 0.32;
    reverb.connect(revGain).connect(musicBus);
    // a small room for the ASMR sounds: close and intimate
    roomVerb = ctx.createConvolver(); roomVerb.buffer = ir(0.5, 4);
    const roomGain = ctx.createGain(); roomGain.gain.value = 0.22;
    roomVerb.connect(roomGain).connect(asmrBus);
    delay = ctx.createDelay(1);
    delay.delayTime.value = STEP * 3;
    const fb = ctx.createGain(); fb.gain.value = 0.32;
    const dlf = ctx.createBiquadFilter(); dlf.type = 'lowpass'; dlf.frequency.value = 2400;
    const dlGain = ctx.createGain(); dlGain.gain.value = 0.25;
    delay.connect(dlf).connect(fb).connect(delay);
    dlf.connect(dlGain).connect(musicBus);
    void startCrackle; void crackle;

    document.addEventListener('visibilitychange', () => {
        if (!ctx) return;
        if (document.hidden) ctx.suspend(); else ctx.resume();
    });
}

function applyVolumes() {
    if (!ctx) return;
    const t = ctx.currentTime;
    const m = settings.master ?? 1;
    musicOut.gain.setTargetAtTime(settings.muted ? 0 : settings.music * 1.6 * m * (ducked ? 0.6 : 1), t, 0.08);
    sfxBus.gain.setTargetAtTime(settings.sfx * m, t, 0.05);
    asmrBus.gain.setTargetAtTime((settings.asmr ?? 1) * 1.1 * m, t, 0.05);
}
function save() { try { localStorage.setItem('tet_audio', JSON.stringify(settings)); } catch (e) { /* ignore */ } }
export function getVolumes() { return { ...settings }; }
export function setVolume(kind, v) {
    settings[kind] = Math.max(0, Math.min(1, v));
    save();
    applyVolumes();
}
export function toggleMusic() { settings.muted = !settings.muted; save(); applyVolumes(); return !settings.muted; }
export const musicMuted = () => !!settings.muted;
// Browsers keep audio off until a click or key press: every gesture retries until it's running
export function resumeAudio() { initAudio(); if (ctx && ctx.state !== 'running') ctx.resume().catch(() => {}); if (ctx && !musicOn && wantMusic) startMusic(); }
const level = () => { if (!meter) return 0; const a = new Float32Array(meter.fftSize); meter.getFloatTimeDomainData(a); let p = 0; for (const v of a) p = Math.max(p, Math.abs(v)); return +p.toFixed(3); };
export const audioDebug = () => ({ peak: level(), state: ctx && ctx.state, musicOn, settings: { ...settings } });
export const audioSuspended = () => !ctx || ctx.state !== 'running';
// Menus open: the music goes muffled and a little quieter
export function setMusicDuck(on) {
    if (!ctx || on === ducked) return;
    ducked = on;
    duckFilter.frequency.setTargetAtTime(on ? 900 : 20000, ctx.currentTime, 0.12);
    applyVolumes();
}

// ----- building blocks -----
function env(g, t, a, peak, d, sustain, r, end) {
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + a);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0001, sustain), t + a + d);
    if (end) { g.gain.setValueAtTime(Math.max(0.0001, sustain), end); g.gain.exponentialRampToValueAtTime(0.0001, end + r); }
}
function noise(t, dur, type, freq, q, gain, out, freqEnd, attack) {
    const src = ctx.createBufferSource(); src.buffer = noiseBuf;
    const f = ctx.createBiquadFilter(); f.type = type; f.frequency.setValueAtTime(freq, t); f.Q.value = q || 1;
    if (freqEnd) f.frequency.exponentialRampToValueAtTime(freqEnd, t + dur);
    const g = ctx.createGain();
    if (attack) { g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(gain, t + attack); } else g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f).connect(g).connect(out || musicBus);
    src.start(t, Math.random() * 1.5); src.stop(t + dur + 0.05);
    return { f, g };
}
function tone(t, type, f0, f1, dur, gain, out, attack) {
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = type; o.frequency.setValueAtTime(f0, t);
    if (f1) o.frequency.exponentialRampToValueAtTime(f1, t + dur);
    if (attack) { g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(gain, t + attack); } else g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(out || sfxBus); o.start(t); o.stop(t + dur + 0.05);
    return o;
}

// ----- the soundtrack -----
function startCrackle() {
    // Vinyl hiss bed
    const src = ctx.createBufferSource(); src.buffer = noiseBuf; src.loop = true;
    const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 3200; f.Q.value = 0.6;
    const g = ctx.createGain(); g.gain.value = 0.006;
    src.connect(f).connect(g).connect(musicBus); src.start();
}
function crackle(t) {
    // A few random pops and ticks per beat
    for (let i = 0; i < 3; i++) if (Math.random() < 0.5) noise(t + Math.random() * STEP * 4, 0.004 + Math.random() * 0.006, 'highpass', 2500 + Math.random() * 3000, 0.7, 0.03 + Math.random() * 0.05, musicBus);
}
function sub(t, n, dur, gain) {
    const g = ctx.createGain();
    env(g, t, 0.02, gain, dur * 0.5, gain * 0.6, 0.12, t + dur);
    const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.value = midi(n);
    const o2 = ctx.createOscillator(); o2.type = 'triangle'; o2.frequency.value = midi(n); const g2 = ctx.createGain(); g2.gain.value = 0.18;
    o.connect(g); o2.connect(g2).connect(g); g.connect(musicBus);
    o.start(t); o.stop(t + dur + 0.2); o2.start(t); o2.stop(t + dur + 0.2);
}
function kick(t, gain) {
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.frequency.setValueAtTime(110, t); o.frequency.exponentialRampToValueAtTime(42, t + 0.12);
    g.gain.setValueAtTime(gain, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.32);
    o.connect(g).connect(musicBus); o.start(t); o.stop(t + 0.35);
    noise(t, 0.015, 'lowpass', 1200, 0.7, gain * 0.25, musicBus);
}
// Brushed snare: soft noise with a long airy tail and a little body
function snare(t, gain) {
    noise(t, 0.22, 'bandpass', 1900, 0.7, gain, musicBus, 1100);
    noise(t, 0.35, 'highpass', 4000, 0.5, gain * 0.35, reverb);
    tone(t, 'triangle', 190, 150, 0.08, gain * 0.5, musicBus);
}
function hat(t, gain, open) { noise(t, open ? 0.16 : 0.035, 'highpass', 7500, 0.8, gain, musicBus); }
function shaker(t, gain) { noise(t, 0.06, 'bandpass', 5500, 1.2, gain, musicBus, 0, 0.02); }

// Hand clap: three quick noise bursts and a short room tail
function clap(t, gain) {
    for (let k = 0; k < 3; k++) noise(t + k * 0.011, 0.02, 'bandpass', 1400, 1.4, gain * (k === 2 ? 1 : 0.7), musicBus);
    noise(t + 0.03, 0.16, 'bandpass', 1300, 1, gain * 0.5, musicBus, 900);
    noise(t + 0.03, 0.25, 'highpass', 3000, 0.5, gain * 0.2, reverb);
}
// A plucky cartoon lead: a square and a triangle an octave up through a snappy filter
function pluck(t, n, dur, gain) {
    const g = ctx.createGain(), f = ctx.createBiquadFilter();
    f.type = 'lowpass'; f.Q.value = 6; f.frequency.setValueAtTime(3800, t); f.frequency.exponentialRampToValueAtTime(700, t + Math.min(0.25, dur));
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(gain, t + 0.006); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    f.connect(g); g.connect(musicBus); g.connect(delay);
    for (const [k, type, a] of [[1, 'square', 0.5], [2, 'triangle', 0.6]]) {
        const o = ctx.createOscillator(), og = ctx.createGain(); o.type = type; o.frequency.value = midi(n) * k; og.gain.value = a;
        o.connect(og).connect(f); o.start(t); o.stop(t + dur + 0.05);
    }
}
// the end-of-phrase boing
function boingNote(t, gain) {
    const o = ctx.createOscillator(), g = ctx.createGain(), lfo = ctx.createOscillator(), lg = ctx.createGain();
    o.type = 'triangle'; o.frequency.setValueAtTime(140, t); o.frequency.exponentialRampToValueAtTime(420, t + 0.12); o.frequency.exponentialRampToValueAtTime(220, t + 0.5);
    lfo.frequency.value = 22; lg.gain.value = 30; lfo.connect(lg).connect(o.frequency);
    g.gain.setValueAtTime(gain, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.55);
    o.connect(g).connect(musicBus); o.start(t); o.stop(t + 0.6); lfo.start(t); lfo.stop(t + 0.6);
}
// Pizzicato strings: a plucked triangle and saw through a closing filter
function pizz(t, n, gain) {
    const g = ctx.createGain(), f = ctx.createBiquadFilter();
    f.type = 'lowpass'; f.Q.value = 2; f.frequency.setValueAtTime(2400, t); f.frequency.exponentialRampToValueAtTime(500, t + 0.22);
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(gain, t + 0.004); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.32);
    f.connect(g); g.connect(musicBus); g.connect(reverb);
    for (const [type, a, k] of [['triangle', 1, 1], ['sawtooth', 0.35, 1.003]]) {
        const o = ctx.createOscillator(), og = ctx.createGain(); o.type = type; o.frequency.value = midi(n) * k; og.gain.value = a;
        o.connect(og).connect(f); o.start(t); o.stop(t + 0.36);
    }
}
// Marimba: a warm sine with a quick woody overtone
function marimba(t, n, gain) {
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(gain, t + 0.003); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.55);
    g.connect(musicBus); g.connect(reverb);
    for (const [k, a, dur] of [[1, 1, 0.55], [3.93, 0.35, 0.08], [10.6, 0.08, 0.03]]) {
        const o = ctx.createOscillator(), og = ctx.createGain(); o.type = 'sine'; o.frequency.value = midi(n) * k;
        og.gain.setValueAtTime(a, t); og.gain.exponentialRampToValueAtTime(0.0001, t + dur);
        o.connect(og).connect(g); o.start(t); o.stop(t + dur + 0.02);
    }
}
// Glockenspiel: a bright bell with an inharmonic shimmer, ringing into the echo
function glock(t, n, gain) {
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(gain, t + 0.002); g.gain.exponentialRampToValueAtTime(0.0001, t + 1.3);
    g.connect(musicBus); g.connect(reverb); g.connect(delay);
    for (const [k, a] of [[1, 1], [2.76, 0.3], [5.4, 0.12]]) {
        const o = ctx.createOscillator(), og = ctx.createGain(); o.type = 'sine'; o.frequency.value = midi(n) * k; og.gain.value = a;
        o.connect(og).connect(g); o.start(t); o.stop(t + 1.35);
    }
}
// Kazoo: a buzzy saw through a nasal band-pass, scooping up into each note with a little vibrato
function kazoo(t, n, dur, gain) {
    const g = ctx.createGain(), bp = ctx.createBiquadFilter(), pk = ctx.createBiquadFilter();
    bp.type = 'bandpass'; bp.frequency.value = 1150; bp.Q.value = 2.2;
    pk.type = 'peaking'; pk.frequency.value = 2600; pk.Q.value = 3; pk.gain.value = 7;
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(gain, t + 0.025);
    g.gain.setValueAtTime(gain, t + Math.max(0.03, dur - 0.04)); g.gain.exponentialRampToValueAtTime(0.0001, t + dur + 0.05);
    bp.connect(pk).connect(g); g.connect(musicBus); g.connect(delay);
    const o = ctx.createOscillator(); o.type = 'sawtooth';
    o.frequency.setValueAtTime(midi(n) * 0.965, t); o.frequency.exponentialRampToValueAtTime(midi(n), t + 0.05);
    const vib = ctx.createOscillator(), vg = ctx.createGain(); vib.frequency.value = 5.6; vg.gain.setValueAtTime(0, t); vg.gain.linearRampToValueAtTime(midi(n) * 0.008, t + 0.18);
    vib.connect(vg).connect(o.frequency);
    o.connect(bp); o.start(t); o.stop(t + dur + 0.08); vib.start(t); vib.stop(t + dur + 0.08);
}
// A sneaky clarinet: a hollow square, soft attack, short and dry
function clar(t, n, dur, gain) {
    const g = ctx.createGain(), f = ctx.createBiquadFilter();
    f.type = 'lowpass'; f.frequency.value = 1700; f.Q.value = 0.8;
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(gain, t + 0.018); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    f.connect(g); g.connect(musicBus); g.connect(delay);
    const o = ctx.createOscillator(); o.type = 'square'; o.frequency.value = midi(n);
    o.connect(f); o.start(t); o.stop(t + dur + 0.03);
}
// Oom-pah tuba: a round, punchy low brass note
function tuba(t, n, dur, gain) {
    const g = ctx.createGain(), f = ctx.createBiquadFilter();
    f.type = 'lowpass'; f.Q.value = 1.2; f.frequency.setValueAtTime(900, t); f.frequency.exponentialRampToValueAtTime(380, t + dur);
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(gain, t + 0.02); g.gain.exponentialRampToValueAtTime(gain * 0.5, t + dur * 0.6); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    f.connect(g); g.connect(musicBus);
    for (const [type, a] of [['sawtooth', 0.6], ['triangle', 1]]) {
        const o = ctx.createOscillator(), og = ctx.createGain(); o.type = type; o.frequency.value = midi(n); og.gain.value = a;
        o.connect(og).connect(f); o.start(t); o.stop(t + dur + 0.05);
    }
}
// The troll's "wah wah wah waaah": a muted trombone whose mute opens and closes, sagging at the end
function trombone(t, n, dur, gain, sag) {
    const g = ctx.createGain(), f = ctx.createBiquadFilter();
    f.type = 'lowpass'; f.Q.value = 5; f.frequency.setValueAtTime(350, t);
    f.frequency.exponentialRampToValueAtTime(1700, t + 0.12); f.frequency.exponentialRampToValueAtTime(420, t + dur);
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(gain, t + 0.04); g.gain.setValueAtTime(gain, t + dur * 0.7); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    f.connect(g); g.connect(musicBus); g.connect(reverb);
    const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.setValueAtTime(midi(n), t);
    if (sag) o.frequency.exponentialRampToValueAtTime(midi(n) * 0.94, t + dur);
    const wob = ctx.createOscillator(), wg = ctx.createGain(); wob.frequency.value = sag ? 7 : 0.1; wg.gain.value = sag ? midi(n) * 0.012 : 0;
    wob.connect(wg).connect(o.frequency);
    o.connect(f); o.start(t); o.stop(t + dur + 0.05); wob.start(t); wob.stop(t + dur + 0.05);
}
function woodblock(t, hi, gain) {
    tone(t, 'sine', hi ? 1250 : 880, hi ? 1150 : 820, 0.06, gain, musicBus);
    noise(t, 0.012, 'bandpass', 2500, 1.5, gain * 0.5, musicBus);
}
function snap(t, gain) {
    noise(t, 0.045, 'bandpass', 2900, 2.4, gain, musicBus);
    noise(t, 0.12, 'highpass', 3500, 0.6, gain * 0.25, reverb);
}
function tom(t, n, gain) { tone(t, 'sine', midi(n) * 2, midi(n), 0.22, gain, musicBus); noise(t, 0.03, 'lowpass', 1500, 0.8, gain * 0.3, musicBus); }
function riser(t, dur, gain) { noise(t, dur, 'bandpass', 600, 2, gain, musicBus, 7000, dur * 0.9); }
const bassWalk = (bar) => {
    // root, fifth, octave, then a chromatic step into the next bar's root
    const r = CHORDS[bar % 8].root + 12, next = CHORDS[(bar + 1) % 8].root + 12;
    return [r, r + 7, r + 12, next + (next > r ? -1 : 1)];
};
function playStep(s, t) {
    const bar = Math.floor(s / 16), i = s % 16, sec = SECTION(bar), b8 = bar % 8;
    const up = sec === 'climb' ? 2 : 0, ch = CHORDS[b8], k = intensity;
    if (i % 2 === 1) t += STEP * SWING;
    const tr = (n) => n + up;
    if (sec === 'sneak' || sec === 'sneak2') {
        // tiptoe: walking pizzicato bass, finger snaps on 2 and 4, woodblock ticks
        if (i % 4 === 0) pizz(t, tr(bassWalk(bar)[i >> 2]) - 12, 0.16);
        if (i === 4 || i === 12) snap(t, 0.11);
        if (i % 4 === 2) woodblock(t, i === 6 || i === 14, 0.035);
        const line = SNEAK[b8];
        for (const [at, n, len] of line) if (at === i) {
            if (sec === 'sneak') clar(t, tr(n), STEP * len * 0.75, 0.05);
            else { marimba(t, tr(n), 0.07); if (k >= 1) glock(t, tr(n) + 12, 0.018); }
        }
        if (sec === 'sneak2' || k >= 1) { if (i === 0 || i === 8) kick(t, 0.26); if (i % 4 === 2) shaker(t, 0.016); }
        if (k >= 2 && (i === 6 || i === 14)) marimba(t, ch.notes[1], 0.035);
        if (b8 === 7 && i === 12) boingNote(t, 0.07);
        return;
    }
    if (sec === 'break') {
        // the troll laughs: wah, wah, wah, waaah over trembling pizzicato chords
        if (i === 0) trombone(t, [69, 68, 67, 66][bar % 4] - 12, bar % 4 === 3 ? STEP * 14 : STEP * 7, 0.07, bar % 4 === 3);
        if (i % 2 === 0) pizz(t, ch.notes[(i >> 1) % 3] - 12, 0.05);
        if (i === 0) sub(t, ch.root, STEP * 12, 0.1);
        if (bar % 4 === 3 && i === 14) boingNote(t, 0.09);
        return;
    }
    if (sec === 'turn') {
        // drum roll back round: snare hits closer and closer, a riser, a boing
        const n4 = bar % 4, every = [4, 2, 1, 1][n4];
        if (i % every === 0) snare(t, 0.06 + n4 * 0.025 + (i / 16) * 0.03);
        if (i % 4 === 0) pizz(t, tr(bassWalk(bar)[i >> 2]) - 12, 0.14);
        if (n4 === 2 && i === 0) riser(t, STEP * 30, 0.05);
        if (n4 === 3 && i === 12) { tom(t, 50, 0.16); tom(t + STEP, 45, 0.16); boingNote(t + STEP * 2, 0.09); }
        if (i === 0) marimba(t, ch.notes[2] + 12, 0.05);
        return;
    }
    // the bounce: oom-pah tuba, kick and claps, marimba stabs on the off-beats, the kazoo's hook
    if (i === 0 || i === 8) tuba(t, tr(ch.root), STEP * 3, 0.17);
    if (i === 6) tuba(t, tr(ch.root + 7), STEP * 1.5, 0.1);
    if (i === 14) tuba(t, tr(bassWalk(bar)[3] - 12), STEP * 1.5, 0.1);
    if (i === 0 || i === 8) kick(t, 0.42);
    if (i === 6 && k >= 1) kick(t, 0.22);
    if (i === 4 || i === 12) clap(t, 0.14);
    if (i % 4 === 2) hat(t, 0.024);
    if (k >= 2 && i % 2 === 1) shaker(t, 0.014);
    if (i === 4 || i === 12) for (const n of ch.notes) marimba(t, tr(n), 0.03);
    const hook = HOOK[b8];
    for (const [at, n, len] of hook) if (at === i) {
        kazoo(t, tr(n), STEP * len * 0.85, sec === 'bounce2' ? 0.045 : 0.05);
        if (sec === 'climb') glock(t, tr(n) + 12, 0.022);
        if (k >= 3 || sec === 'bounce2') pluck(t, tr(n) + 12, STEP * len * 0.6, 0.016);
    }
    // sparkly arpeggios once you're high up
    if ((sec === 'climb' || k >= 2) && i % 2 === 0) glock(t, tr(ch.notes[(i >> 1) % 3]) + 24, 0.008 + k * 0.003);
    if (b8 === 7 && i === 12) { tom(t, 52, 0.12); tom(t + STEP, 47, 0.12); }
    if (bar % 16 === 15 && i === 14) boingNote(t, 0.07);
}
function scheduler() {
    while (nextTime < ctx.currentTime + 0.2) {
        playStep(seqStep, nextTime);
        nextTime += STEP;
        seqStep++;
    }
}
let wantMusic = false;
export function startMusic() {
    wantMusic = true;
    if (!ctx || musicOn) return;
    musicOn = true;
    seqStep = 0; nextTime = ctx.currentTime + 0.1;
    schedTimer = setInterval(scheduler, 30);
}
export function stopMusic() { musicOn = false; clearInterval(schedTimer); }

// =====================================================================================
// ASMR surfaces
// =====================================================================================
const R = (a, b) => a + Math.random() * (b - a);
const ASMR = {
    // Mechanical keycap: sharp click, hollow plastic thock as it bottoms out, soft clack on return
    keys(t, k) {
        const p = R(0.85, 1.15);
        noise(t, 0.012, 'bandpass', 6200 * p, 1.6, 0.3 * k, asmrBus);
        noise(t + 0.006, 0.05, 'bandpass', 1500 * p, 2.4, 0.3 * k, asmrBus);
        const o = ctx.createOscillator(), g = ctx.createGain();
        o.type = 'triangle'; o.frequency.setValueAtTime(380 * p, t + 0.008); o.frequency.exponentialRampToValueAtTime(150 * p, t + 0.07);
        g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.3 * k, t + 0.012); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.09);
        o.connect(g).connect(asmrBus); o.start(t); o.stop(t + 0.11);
        noise(t + 0.13, 0.02, 'bandpass', 3800 * p, 1.8, 0.1 * k, asmrBus);
    },
    // Wet slime: a squelch sweeping down, a low suck, then little bubbles popping
    slime(t, k) {
        const p = R(0.85, 1.2);
        const sq = noise(t, 0.16, 'bandpass', 2600 * p, 3.5, 0.36 * k, asmrBus, 420 * p, 0.006);
        sq.g.connect(roomVerb);
        tone(t, 'sine', 150 * p, 62 * p, 0.1, 0.22 * k, asmrBus, 0.004);
        noise(t + 0.05, 0.12, 'lowpass', 650, 1.5, 0.12 * k, asmrBus, 300);
        const n = 2 + Math.floor(Math.random() * 3);
        for (let i = 0; i < n; i++) {
            const at = t + R(0.04, 0.24), f = R(650, 1500);
            tone(at, 'sine', f, f * 1.5, 0.035, R(0.05, 0.1) * k, asmrBus, 0.003);
        }
    },
    // Gummy jelly: a wobbly "bloop" and a soft wet touch
    jelly(t, k) {
        const p = R(0.88, 1.15);
        const o = ctx.createOscillator(), g = ctx.createGain(), lfo = ctx.createOscillator(), lg = ctx.createGain();
        o.type = 'sine'; o.frequency.setValueAtTime(520 * p, t); o.frequency.exponentialRampToValueAtTime(205 * p, t + 0.1);
        lfo.frequency.value = 24; lg.gain.value = 28 * p; lfo.connect(lg).connect(o.frequency);
        g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.26 * k, t + 0.004); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.16);
        o.connect(g).connect(asmrBus); g.connect(roomVerb);
        o.start(t); o.stop(t + 0.18); lfo.start(t); lfo.stop(t + 0.18);
        noise(t, 0.05, 'bandpass', 950 * p, 2, 0.1 * k, asmrBus);
    },
    // Squishy foam dome: rubbery creak, a puff of air, a soft body thump
    dome(t, k) {
        const p = R(0.9, 1.15);
        const o = ctx.createOscillator(), bp = ctx.createBiquadFilter(), g = ctx.createGain(), am = ctx.createOscillator(), ag = ctx.createGain();
        o.type = 'sawtooth'; o.frequency.value = 92 * p;
        bp.type = 'bandpass'; bp.Q.value = 6; bp.frequency.setValueAtTime(650 * p, t); bp.frequency.exponentialRampToValueAtTime(1500 * p, t + 0.2);
        am.frequency.value = 46; ag.gain.value = 0.05 * k; am.connect(ag).connect(g.gain);
        g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.11 * k, t + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.22);
        o.connect(bp).connect(g).connect(asmrBus);
        o.start(t); o.stop(t + 0.24); am.start(t); am.stop(t + 0.24);
        noise(t, 0.14, 'lowpass', 420, 1, 0.26 * k, asmrBus, 0, 0.01);
        tone(t, 'sine', 210 * p, 110 * p, 0.12, 0.18 * k, asmrBus, 0.004);
    },
    // Soft waxy butter: a dull pat and the crinkle of the wrapper
    butter(t, k) {
        noise(t, 0.08, 'lowpass', R(420, 560), 1.2, 0.34 * k, asmrBus, 0, 0.003);
        tone(t, 'sine', R(150, 175), 100, 0.06, 0.14 * k, asmrBus);
        for (let i = 0; i < 6; i++) noise(t + R(0, 0.09), R(0.002, 0.005), 'highpass', R(4500, 7000), 0.8, R(0.03, 0.07) * k, asmrBus);
    },
    // Pop-it bubble popping in: a quick hollow "pok" and a click
    popit(t, k) {
        const p = R(0.85, 1.2);
        tone(t, 'sine', 920 * p, 380 * p, 0.04, 0.3 * k, asmrBus, 0.002);
        noise(t, 0.012, 'bandpass', 1700 * p, 1, 0.22 * k, asmrBus);
        tone(t, 'sine', 230 * p, 160, 0.05, 0.1 * k, asmrBus);
    },
    // Bubble wrap: a sharp crack with a tiny ringing tail (sometimes two)
    wrap(t, k) {
        const n = Math.random() < 0.35 ? 2 : 1;
        for (let i = 0; i < n; i++) {
            const at = t + i * R(0.04, 0.09);
            noise(at, 0.012, 'highpass', 1300, 0.7, 0.5 * k, asmrBus);
            noise(at, 0.035, 'bandpass', R(2800, 3600), 8, 0.14 * k, asmrBus);
        }
    },
    // Mochi spinner: a soft, floury squish
    mochi(t, k) {
        noise(t, 0.12, 'lowpass', 380, 1, 0.28 * k, asmrBus, 0, 0.012);
        tone(t, 'sine', R(170, 200), 95, 0.12, 0.16 * k, asmrBus, 0.006);
        noise(t + 0.02, 0.06, 'bandpass', 1300, 3, 0.05 * k, asmrBus);
    },
    // Lilac tiles: a clean little tap
    tile(t, k) {
        noise(t, 0.022, 'bandpass', R(2300, 2900), 1.2, 0.1 * k, asmrBus);
        noise(t, 0.04, 'lowpass', 700, 1, 0.1 * k, asmrBus);
    },
    // The green lobby floor: glossy and a little squishy
    floor(t, k) { ASMR.jelly(t, k * 0.55); },
    // Green blocks: a plastic thud
    block(t, k) {
        noise(t, 0.035, 'bandpass', R(820, 1000), 1.5, 0.2 * k, asmrBus);
        tone(t, 'sine', 180, 118, 0.05, 0.14 * k, asmrBus);
    },
    truss(t, k) {
        noise(t, 0.012, 'bandpass', R(2800, 3400), 2, 0.16 * k, asmrBus);
        tone(t, 'triangle', R(850, 1000), null, 0.02, 0.04 * k, asmrBus);
    },
    gold(t, k) {
        noise(t, 0.04, 'bandpass', 4000, 6, 0.12 * k, asmrBus);
        tone(t, 'sine', R(1700, 1900), null, 0.09, 0.04 * k, asmrBus);
    },
    // The giant rainbow squishy
    squishy(t, k) { ASMR.dome(t, k * 1.4); ASMR.slime(t + 0.03, k * 0.5); },
    bounce(t, k) { springTone(t, 210, 0.38, 0.2 * k); ASMR.dome(t, k * 0.7); },
    glass(t, k) { ASMR.tile(t, k); },
    wall(t, k) { ASMR.stud(t, k); },
    // Roblox studs: a crisp little plastic click with a hollow knock under it
    stud(t, k) {
        const p = R(0.9, 1.12);
        noise(t, 0.012, 'bandpass', 3600 * p, 1.6, 0.16 * k, asmrBus);
        noise(t + 0.004, 0.04, 'bandpass', 900 * p, 2, 0.16 * k, asmrBus);
        tone(t, 'triangle', 260 * p, 150 * p, 0.05, 0.12 * k, asmrBus, 0.003);
    },
    // A giant strawberry: a juicy squish with a little wet pop
    berry(t, k) {
        const p = R(0.9, 1.15);
        noise(t, 0.1, 'bandpass', 1800 * p, 3, 0.22 * k, asmrBus, 500 * p, 0.005);
        tone(t, 'sine', 240 * p, 120 * p, 0.08, 0.16 * k, asmrBus, 0.003);
        tone(t + R(0.03, 0.07), 'sine', R(700, 1100), R(1200, 1500), 0.03, 0.07 * k, asmrBus, 0.002);
    },
    // Sponge cake: a soft, dull, springy pat
    cake(t, k) {
        noise(t, 0.09, 'lowpass', R(500, 650), 1, 0.3 * k, asmrBus, 0, 0.006);
        tone(t, 'sine', R(150, 180), 95, 0.08, 0.14 * k, asmrBus, 0.004);
    },
    // Whipped cream: a puffy squish
    cream(t, k) { ASMR.dome(t, k * 0.9); },
    // Strawberry milk: a splash with a few bubbles
    milk(t, k) { ASMR.slime(t, k * 0.9); },
    // Glossy icing: a squeaky glide
    icing(t, k) {
        const p = R(0.9, 1.2);
        const o = ctx.createOscillator(), g = ctx.createGain(), bp = ctx.createBiquadFilter();
        o.type = 'sawtooth'; o.frequency.setValueAtTime(900 * p, t); o.frequency.exponentialRampToValueAtTime(1500 * p, t + 0.08);
        bp.type = 'bandpass'; bp.frequency.value = 2200 * p; bp.Q.value = 5;
        g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.05 * k, t + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.1);
        o.connect(bp).connect(g).connect(asmrBus); o.start(t); o.stop(t + 0.12);
        ASMR.cake(t, k * 0.5);
    },
    // Grey sky plates: a hollow metallic knock
    plate(t, k) {
        noise(t, 0.03, 'bandpass', R(1500, 1900), 4, 0.16 * k, asmrBus);
        tone(t, 'sine', R(420, 480), null, 0.12, 0.06 * k, asmrBus, 0.002);
        tone(t, 'sine', R(1100, 1250), null, 0.07, 0.03 * k, asmrBus, 0.002);
    },
};
// ----- more surfaces -----
// Shallow water: a light splash and a couple of bubbles
ASMR.water = (t, k) => {
    const p = R(0.9, 1.2);
    noise(t, 0.12, 'bandpass', 2200 * p, 2.2, 0.2 * k, asmrBus, 700 * p, 0.004);
    noise(t + 0.02, 0.1, 'highpass', 3500, 0.7, 0.05 * k, asmrBus);
    for (let i = 0; i < 2; i++) { const f = R(800, 1500); tone(t + R(0.03, 0.12), 'sine', f, f * 1.6, 0.03, R(0.03, 0.06) * k, asmrBus, 0.003); }
};
// Asphalt: a soft, flat thud
ASMR.asphalt = (t, k) => { noise(t, 0.05, 'lowpass', R(800, 1000), 1, 0.22 * k, asmrBus); noise(t, 0.02, 'bandpass', 2600, 1.4, 0.05 * k, asmrBus); };
// Red dirt: a little gravelly crunch
ASMR.dirt = (t, k) => {
    for (let i = 0; i < 4; i++) noise(t + i * R(0.008, 0.018), 0.015, 'bandpass', R(1800, 3400), 2, R(0.06, 0.1) * k, asmrBus);
    noise(t, 0.06, 'lowpass', 600, 1, 0.12 * k, asmrBus);
};
// Smooth plastic: a crisp thud
ASMR.plastic = (t, k) => ASMR.block(t, k);
// Grass: a soft rustle over a padded step
ASMR.grass = (t, k) => { noise(t, 0.09, 'highpass', R(3000, 4200), 0.8, 0.07 * k, asmrBus, 0, 0.02); noise(t, 0.05, 'lowpass', 500, 1, 0.14 * k, asmrBus); };
// Wooden boards: a hollow knock
ASMR.wood = (t, k) => {
    const p = R(0.9, 1.1);
    tone(t, 'triangle', 230 * p, 150 * p, 0.07, 0.16 * k, asmrBus, 0.002);
    noise(t, 0.03, 'bandpass', 900 * p, 3, 0.16 * k, asmrBus);
    tone(t + 0.004, 'sine', 520 * p, null, 0.05, 0.04 * k, asmrBus, 0.002);
};
// Carpet: muffled
ASMR.carpet = (t, k) => { noise(t, 0.07, 'lowpass', R(380, 480), 1, 0.26 * k, asmrBus, 0, 0.008); };
// Ice: a crisp crunch with a tiny glassy ring
ASMR.ice = (t, k) => {
    for (let i = 0; i < 3; i++) noise(t + i * 0.012, 0.012, 'highpass', R(4000, 6000), 1, 0.07 * k, asmrBus);
    tone(t, 'sine', R(2300, 2700), null, 0.12, 0.025 * k, asmrBus, 0.002);
    noise(t, 0.04, 'lowpass', 700, 1, 0.1 * k, asmrBus);
};
// Obsidian: hard stone
ASMR.stone = (t, k) => { noise(t, 0.03, 'bandpass', R(1400, 1800), 1.6, 0.16 * k, asmrBus); tone(t, 'sine', 140, 90, 0.06, 0.14 * k, asmrBus); };
// Candy: a sugary crunch
ASMR.candy = (t, k) => {
    for (let i = 0; i < 3; i++) noise(t + i * R(0.01, 0.02), 0.02, 'bandpass', R(2600, 4200), 3, 0.08 * k, asmrBus);
    ASMR.cake(t, k * 0.4);
};
// Neon panels: a tile tap with a little electric buzz
ASMR.neon = (t, k) => { ASMR.tile(t, k); tone(t, 'square', R(110, 130), null, 0.06, 0.02 * k, asmrBus, 0.003); tone(t + 0.01, 'sine', R(1600, 1900), null, 0.05, 0.025 * k, asmrBus); };
export const ASMR_KINDS = Object.keys(ASMR);
// A footstep (or a landing, louder) on a surface
export function step(surface, landing) {
    if (!ctx || (settings.asmr ?? 1) <= 0) return;
    const f = ASMR[surface] || ASMR.block;
    f(ctx.currentTime + 0.004, landing ? 1.45 : 0.8);
}
// The "fwip" of a pop-it flipping back over
export function popitFlip() {
    if (!ctx) return;
    const t = ctx.currentTime + 0.01;
    noise(t, 0.18, 'bandpass', 400, 2, 0.2, asmrBus, 3200, 0.02);
    for (let i = 0; i < 5; i++) tone(t + 0.03 + i * 0.025, 'sine', R(500, 800), 300, 0.03, 0.08, asmrBus);
}

// =====================================================================================
// Sound effects
// =====================================================================================
function springTone(t, f, dur, gain) {
    const o = ctx.createOscillator(), g = ctx.createGain(), lfo = ctx.createOscillator(), lg = ctx.createGain();
    o.type = 'triangle';
    o.frequency.setValueAtTime(f * 0.7, t); o.frequency.exponentialRampToValueAtTime(f * 1.9, t + dur * 0.35); o.frequency.exponentialRampToValueAtTime(f, t + dur);
    lfo.frequency.value = 28; lg.gain.value = f * 0.12; lfo.connect(lg).connect(o.frequency);
    g.gain.setValueAtTime(gain, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(sfxBus); o.start(t); o.stop(t + dur + 0.05); lfo.start(t); lfo.stop(t + dur + 0.05);
}
const SFX = {
    // UI: a soft bubbly pop
    click(t) { tone(t, 'sine', 720, 1250, 0.05, 0.13); noise(t, 0.01, 'bandpass', 2400, 1, 0.08, sfxBus); },
    clickBuy(t) { tone(t, 'sine', 620, 1100, 0.05, 0.13); tone(t + 0.05, 'sine', 1100, 1650, 0.06, 0.1); },
    jump(t) { tone(t, 'sine', 330, 620, 0.09, 0.08); },
    coin(t) { tone(t, 'square', midi(88), null, 0.07, 0.05); tone(t + 0.07, 'square', midi(93), null, 0.22, 0.05); tone(t, 'sine', midi(100), null, 0.25, 0.05); },
    checkpoint(t) {
        [76, 79, 84, 88].forEach((n, i) => tone(t + i * 0.07, 'triangle', midi(n), null, 0.32, 0.12));
        noise(t, 0.4, 'bandpass', 800, 1, 0.08, sfxBus, 6000, 0.05);
    },
    win(t) {
        [72, 76, 79, 84, 79, 84, 88].forEach((n, i) => tone(t + i * 0.1, 'square', midi(n), null, 0.28, 0.07));
        [60, 64, 67, 72].forEach((n) => tone(t + 0.7, 'triangle', midi(n), null, 1.4, 0.07));
        noise(t + 0.7, 1.2, 'highpass', 3000, 0.6, 0.08, sfxBus);
    },
    oops(t) { tone(t, 'sine', 1400, 300, 0.7, 0.12); tone(t + 0.72, 'sine', 140, 70, 0.2, 0.22); noise(t + 0.72, 0.18, 'lowpass', 700, 1, 0.25, sfxBus); },
    teleport(t) { for (let i = 0; i < 9; i++) tone(t + i * 0.028, 'sine', midi(74 + i * 3), null, 0.16, 0.06); noise(t, 0.35, 'bandpass', 600, 1.5, 0.08, sfxBus, 5000, 0.05); },
    buy(t) { [79, 84, 88, 91, 96].forEach((n, i) => tone(t + i * 0.05, 'sine', midi(n), null, 0.3, 0.14)); },
    denied(t) { tone(t, 'square', 220, 160, 0.14, 0.1); tone(t + 0.14, 'square', 180, 120, 0.18, 0.1); },
    gate(t) { [84, 88, 91, 96, 100].forEach((n, i) => tone(t + i * 0.035, 'sine', midi(n), null, 0.5, 0.08)); tone(t, 'triangle', 220, 880, 0.35, 0.1); },
    whoosh(t) { noise(t, 0.45, 'bandpass', 300, 2, 0.3, sfxBus, 3000, 0.18); },
    slap(t) {
        noise(t, 0.05, 'bandpass', 1400, 0.8, 0.6, sfxBus);
        noise(t, 0.12, 'lowpass', 500, 1, 0.4, sfxBus);
        tone(t, 'sine', 160, 70, 0.12, 0.3);
    },
    slapped(t) { SFX.slap(t); springTone(t + 0.05, 300, 0.4, 0.12); },
    nuke(t) {
        tone(t, 'sine', 90, 25, 2.2, 0.6);
        noise(t, 2.5, 'lowpass', 900, 0.8, 0.6, sfxBus, 80, 0.02);
        noise(t, 1.2, 'highpass', 2000, 0.6, 0.2, sfxBus);
    },
    grapple(t) { noise(t, 0.16, 'bandpass', 900, 3, 0.3, sfxBus, 4000, 0.01); tone(t, 'square', 1200, 400, 0.12, 0.05); },
    hook(t) { noise(t, 0.03, 'bandpass', 3000, 4, 0.3, sfxBus); tone(t, 'triangle', 1800, 900, 0.06, 0.08); },
    equip(t) { tone(t, 'triangle', midi(79), midi(84), 0.12, 0.1); noise(t, 0.04, 'bandpass', 3000, 2, 0.08, sfxBus); },
    spinTick(t) { tone(t, 'triangle', 1500, 1100, 0.025, 0.06); },
    hatchShake(t) { noise(t, 0.05, 'bandpass', 700, 2, 0.2, sfxBus); tone(t, 'sine', 300, 200, 0.06, 0.1); },
    common(t) { [79, 84].forEach((n, i) => tone(t + i * 0.08, 'triangle', midi(n), null, 0.3, 0.12)); },
    rare(t) { [79, 84, 88].forEach((n, i) => tone(t + i * 0.08, 'triangle', midi(n), null, 0.35, 0.12)); },
    epic(t) { [76, 79, 84, 88, 91].forEach((n, i) => tone(t + i * 0.07, 'square', midi(n), null, 0.35, 0.07)); },
    legendary(t) { SFX.win(t); },
    mythic(t) { SFX.win(t); SFX.nuke(t + 0.01); },
    quest(t) { [84, 91, 96].forEach((n, i) => tone(t + i * 0.09, 'triangle', midi(n), null, 0.35, 0.12)); },
    firework(t) { tone(t, 'sine', 900, 200, 0.35, 0.05); noise(t + 0.35, 0.4, 'lowpass', 2500, 0.8, 0.28, sfxBus); },
    gain(t) { tone(t, 'triangle', midi(88), null, 0.05, 0.05); },
    // Troll Gun: a sci-fi "pew" and an electric crackle
    zap(t) {
        tone(t, 'square', 2200, 300, 0.18, 0.06);
        tone(t, 'sawtooth', 1400, 200, 0.22, 0.04);
        noise(t, 0.2, 'bandpass', 3000, 2, 0.12, sfxBus, 800);
    },
    zapped(t) { SFX.zap(t); springTone(t + 0.05, 320, 0.5, 0.14); noise(t + 0.02, 0.3, 'highpass', 4000, 0.7, 0.1, sfxBus); },
    bonus(t) { [84, 88, 91, 96, 100, 103].forEach((n, i) => tone(t + i * 0.06, 'triangle', midi(n), null, 0.35, 0.1)); },
    shield(t) { for (let i = 0; i < 6; i++) tone(t + i * 0.04, 'sine', midi(86 + i * 2), null, 0.25, 0.04); },
    admin(t) { tone(t, 'sawtooth', 300, 1200, 0.25, 0.05); [84, 91].forEach((n, i) => tone(t + 0.1 + i * 0.08, 'triangle', midi(n), null, 0.3, 0.1)); },
    // a big slap: the crack, a deep thump and a ringing smack
    bigSlap(t) { SFX.slap(t); tone(t, 'sine', 110, 40, 0.3, 0.45); noise(t, 0.08, 'highpass', 2500, 0.8, 0.4, sfxBus); noise(t + 0.02, 0.4, 'bandpass', 900, 1, 0.12, sfxBus, 300); },
    // the troll laugh: a cheeky "ha-ha-ha-ha", each one a little lower
    laugh(t) {
        for (let k = 0; k < 5; k++) {
            const at = t + k * 0.13, f = 520 - k * 30;
            const o = ctx.createOscillator(), g = ctx.createGain(), bp = ctx.createBiquadFilter();
            o.type = 'sawtooth'; o.frequency.setValueAtTime(f * 1.15, at); o.frequency.exponentialRampToValueAtTime(f * 0.85, at + 0.1);
            bp.type = 'bandpass'; bp.frequency.value = 1100; bp.Q.value = 2.5;
            g.gain.setValueAtTime(0.0001, at); g.gain.exponentialRampToValueAtTime(0.16, at + 0.015); g.gain.exponentialRampToValueAtTime(0.0001, at + 0.11);
            o.connect(bp).connect(g).connect(sfxBus); o.start(at); o.stop(at + 0.13);
            noise(at, 0.05, 'bandpass', 2600, 1.5, 0.05, sfxBus);
        }
    },
    boing(t) { springTone(t, 170, 0.55, 0.22); },
    // the doll's lights: a happy rising chime for green, a low two-tone buzz for red
    greenLight(t) { [72, 76, 79].forEach((n, i) => tone(t + i * 0.08, 'triangle', midi(n), null, 0.3, 0.1)); },
    redLight(t) { tone(t, 'square', 220, null, 0.22, 0.07); tone(t + 0.24, 'square', 165, null, 0.4, 0.08); },
    alarm(t) { for (let k = 0; k < 3; k++) { tone(t + k * 0.22, 'sawtooth', 700, 1100, 0.11, 0.05); tone(t + k * 0.22 + 0.11, 'sawtooth', 1100, 700, 0.11, 0.05); } },
    splash(t) { noise(t, 0.6, 'bandpass', 1800, 0.8, 0.4, sfxBus, 300, 0.01); noise(t, 0.3, 'lowpass', 500, 1, 0.3, sfxBus); for (let k = 0; k < 4; k++) { const f = R(500, 1100); tone(t + 0.1 + k * 0.06, 'sine', f, f * 1.8, 0.05, 0.05); } },
    ghost(t) { const o = tone(t, 'sine', 380, 260, 1.0, 0.09, sfxBus, 0.2); const l = ctx.createOscillator(), lg = ctx.createGain(); l.frequency.value = 6; lg.gain.value = 18; l.connect(lg).connect(o.frequency); l.start(t); l.stop(t + 1.05); },
    freeze(t) { for (let k = 0; k < 8; k++) tone(t + k * 0.03, 'sine', midi(100 - k * 2), null, 0.25, 0.04); noise(t + 0.05, 0.15, 'highpass', 5000, 1, 0.2, sfxBus); noise(t + 0.2, 0.08, 'bandpass', 3000, 3, 0.15, sfxBus); },
    scare(t) { [48, 51, 55].forEach((n) => tone(t, 'sawtooth', midi(n), midi(n) * 0.97, 0.6, 0.06)); noise(t, 0.3, 'lowpass', 1500, 1, 0.3, sfxBus); },
    trap(t) { noise(t, 0.04, 'highpass', 3000, 1, 0.5, sfxBus); tone(t, 'square', 900, 300, 0.08, 0.08); tone(t + 0.02, 'triangle', 2400, null, 0.25, 0.04); },
    pop(t) { tone(t, 'sine', 900, 1800, 0.06, 0.18); noise(t, 0.03, 'highpass', 2000, 1, 0.2, sfxBus); },
    jump2(t) { tone(t, 'sine', 520, 980, 0.1, 0.09); tone(t + 0.04, 'triangle', 1300, 1700, 0.08, 0.04); },
    bonk(t) { tone(t, 'triangle', 300, 120, 0.12, 0.25); noise(t, 0.04, 'bandpass', 800, 2, 0.25, sfxBus); },
};
export function sfx(name) {
    if (!ctx || !SFX[name] || settings.sfx <= 0) return;
    SFX[name](ctx.currentTime + 0.005);
}

// ----- continuous sounds: jetpack thrust, carpet shimmer, grapple reel -----
const loops = {};
function makeLoop(kind) {
    const g = ctx.createGain(); g.gain.value = 0; g.connect(sfxBus);
    if (kind === 'jet') {
        const src = ctx.createBufferSource(); src.buffer = noiseBuf; src.loop = true;
        const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 900; f.Q.value = 0.8;
        src.connect(f).connect(g); src.start();
        const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = 55; const og = ctx.createGain(); og.gain.value = 0.15;
        o.connect(og).connect(f); o.start();
    } else if (kind === 'carpet') {
        for (const n of [84, 88, 91]) {
            const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.value = midi(n);
            const l = ctx.createOscillator(), lg = ctx.createGain(); l.frequency.value = 0.4 + Math.random(); lg.gain.value = 6; l.connect(lg).connect(o.detune);
            const og = ctx.createGain(); og.gain.value = 0.3; o.connect(og).connect(g); g.connect(reverb); o.start(); l.start();
        }
        const src = ctx.createBufferSource(); src.buffer = noiseBuf; src.loop = true;
        const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 900; f.Q.value = 0.8;
        const ng = ctx.createGain(); ng.gain.value = 0.6; src.connect(f).connect(ng).connect(g); src.start();
    } else if (kind === 'reel') {
        const o = ctx.createOscillator(); o.type = 'square'; o.frequency.value = 60;
        const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 1800; f.Q.value = 3;
        o.connect(f).connect(g); o.start();
    }
    return g;
}
export function loopSound(kind, level) {
    if (!ctx) return;
    if (!loops[kind]) { if (!level) return; loops[kind] = makeLoop(kind); }
    const vol = { jet: 0.22, carpet: 0.03, reel: 0.05 }[kind] || 0.1;
    loops[kind].gain.setTargetAtTime((level || 0) * vol, ctx.currentTime, 0.06);
}
