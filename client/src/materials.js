// Textures and materials, all drawn in code at load (no image files) and all matte (Lambert) or
// unlit (Basic): wooden planks, the white truss lattice, glowing kill bricks, lava and freezing
// water floors, slippery ice, conveyor belts, keyboard keycaps, glass windows, checkpoint pads and
// flags, the rainbow path, the magic carpet, and the troll grin (our own drawing) used on signs,
// buttons and the jumpscare. Each is made once and shared. Glows are painted into emissive maps
// or drawn unlit: no bloom, no reflections.
import { T, texFrom, matte, NEON_BOOST } from './engine.js';

const cache = new Map();
const once = (key, make) => { if (!cache.has(key)) cache.set(key, make()); return cache.get(key); };
const canvas = (w, h) => { const c = document.createElement('canvas'); c.width = w; c.height = h || w; return c; };
function seeded(seed) { let s = seed; return () => { s = (s * 16807) % 2147483647; return s / 2147483647; }; }
const wrap = (t) => { t.wrapS = t.wrapT = T.RepeatWrapping; return t; };
const pick = (rnd, a) => a[Math.floor(rnd() * a.length) % a.length];
// Draws fn at (x, y) and at its wrapped copies near the edges, so the texture tiles seamlessly
function wrapped(W, H, x, y, r, fn) {
    for (const ox of [-W, 0, W]) for (const oy of [-H, 0, H]) {
        const px = x + ox, py = y + oy;
        if (px + r < 0 || px - r > W || py + r < 0 || py - r > H) continue;
        fn(px, py);
    }
}
function fillNoise(x, W, H, rnd, n, colors, size, alpha) {
    for (let i = 0; i < n; i++) {
        const px = rnd() * W, py = rnd() * H, s = size * (0.5 + rnd());
        x.globalAlpha = alpha ?? 1;
        x.fillStyle = pick(rnd, colors);
        wrapped(W, H, px, py, s, (a, b) => x.fillRect(a, b, s, s));
    }
    x.globalAlpha = 1;
}
// Cell edges of a wrapped Voronoi pattern (water caustics, lava veins): 0 in the cells, 1 on the edges
function voronoiEdges(N, pts, width) {
    const out = new Float32Array(N * N);
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
        let d1 = 1e9, d2 = 1e9;
        for (const [px, py] of pts) {
            let dx = Math.abs(x - px), dy = Math.abs(y - py);
            if (dx > N / 2) dx = N - dx;
            if (dy > N / 2) dy = N - dy;
            const d = Math.sqrt(dx * dx + dy * dy);
            if (d < d1) { d2 = d1; d1 = d; } else if (d < d2) d2 = d;
        }
        out[y * N + x] = Math.max(0, 1 - (d2 - d1) / width);
    }
    return out;
}
function imageFrom(N, fn) {
    const c = canvas(N), x = c.getContext('2d'), img = x.createImageData(N, N);
    for (let i = 0; i < N * N; i++) { const [r, g, b] = fn(i); img.data[i * 4] = r; img.data[i * 4 + 1] = g; img.data[i * 4 + 2] = b; img.data[i * 4 + 3] = 255; }
    x.putImageData(img, 0, 0);
    return c;
}
const tex = (c) => wrap(texFrom(c));
const lerp = (a, b, k) => a + (b - a) * k;
function cracks(x, N, rnd, n, color, width) {
    x.strokeStyle = color; x.lineWidth = width; x.lineJoin = 'round';
    for (let i = 0; i < n; i++) {
        let px = rnd() * N, py = rnd() * N, a = rnd() * Math.PI * 2;
        const pts = [[px, py]];
        for (let k = 0; k < 6 + rnd() * 8; k++) { a += (rnd() - 0.5) * 1.3; px += Math.cos(a) * 9; py += Math.sin(a) * 9; pts.push([px, py]); }
        for (const ox of [-N, 0, N]) for (const oy of [-N, 0, N]) { x.beginPath(); pts.forEach(([u, v], j) => (j ? x.lineTo(u + ox, v + oy) : x.moveTo(u + ox, v + oy))); x.stroke(); }
    }
}

// ----- wooden planks (the rope bridges): planks run across the texture's v, 8 studs a tile -----
export const plankTex = () => once('plank', () => {
    const N = 256, c = canvas(N), x = c.getContext('2d'), rnd = seeded(47);
    const PW = 32;
    for (let col = 0; col < N / PW; col++) {
        const px = col * PW, base = pick(rnd, ['#9a6038', '#a86c40', '#8c5632', '#b07446']);
        x.fillStyle = base; x.fillRect(px, 0, PW, N);
        for (let k = 0; k < 7; k++) {
            x.strokeStyle = pick(rnd, ['rgba(70,36,14,0.35)', 'rgba(200,150,100,0.25)']); x.lineWidth = 1 + rnd();
            x.beginPath(); const gx = px + 4 + rnd() * (PW - 8); x.moveTo(gx, 0);
            for (let py = 0; py <= N; py += 32) x.lineTo(gx + Math.sin(py * 0.05 + k) * 1.4, py);
            x.stroke();
        }
        // the gap between planks, a nail at each end
        x.fillStyle = 'rgba(28,14,6,0.85)'; x.fillRect(px, 0, 3, N);
        x.fillStyle = 'rgba(255,230,200,0.18)'; x.fillRect(px + 3, 0, 2, N);
        x.fillStyle = '#4a4a52';
        for (const ny of [10, N - 14]) { x.beginPath(); x.arc(px + PW / 2, ny, 2.4, 0, Math.PI * 2); x.fill(); }
    }
    return tex(c);
});
export const plankMaterial = () => once('plankmat', () => matte({ map: plankTex() }));

// The rock under the floating lobby terrace
const rockTex = () => once('rock', () => {
    const N = 256, c = canvas(N), x = c.getContext('2d'), rnd = seeded(83);
    x.fillStyle = '#7a6a5a'; x.fillRect(0, 0, N, N);
    fillNoise(x, N, N, rnd, 900, ['#6a5a4a', '#8a7a68', '#5a4c40', '#9a8a76'], 8, 0.7);
    x.fillStyle = '#4ac87a'; x.fillRect(0, 0, N, 18);
    fillNoise(x, N, 22, rnd, 300, ['#36a866', '#6ae89a'], 4, 0.9);
    return tex(c);
});
export const rockMaterial = () => once('rockmat', () => matte({ map: rockTex() }));

// ----- the white truss lattice (see-through between the bars) -----
export const trussTex = () => once('truss', () => {
    const N = 128, c = canvas(N), x = c.getContext('2d');
    x.clearRect(0, 0, N, N);
    x.strokeStyle = '#ffffff'; x.lineWidth = 12; x.lineCap = 'square';
    x.strokeRect(6, 6, N - 12, N - 12);
    x.beginPath(); x.moveTo(6, 6); x.lineTo(N - 6, N - 6); x.moveTo(N - 6, 6); x.lineTo(6, N - 6); x.stroke();
    x.strokeStyle = '#c8ffe8'; x.lineWidth = 4;
    x.strokeRect(6, 6, N - 12, N - 12);
    return wrap(texFrom(c));
});
export const trussMaterial = () => once('trussmat', () => matte({ map: trussTex(), alphaTest: 0.45, side: T.DoubleSide, emissive: 0xe8fff4, emissiveIntensity: 0.25 }));

// ----- kill bricks: glowing red with darker danger stripes (2 studs per tile) -----
export const killTex = () => once('kill', () => {
    const N = 64, c = canvas(N), x = c.getContext('2d');
    x.fillStyle = '#ff2a3a'; x.fillRect(0, 0, N, N);
    x.fillStyle = '#b8101e';
    for (let k = -2; k < 4; k++) { x.beginPath(); x.moveTo(k * 32, N); x.lineTo(k * 32 + 16, N); x.lineTo(k * 32 + 16 + N, 0); x.lineTo(k * 32 + N, 0); x.closePath(); x.fill(); }
    x.fillStyle = 'rgba(255,220,220,0.5)'; x.fillRect(0, 0, N, 3);
    return tex(c);
});

// ----- the deadly floors: lava (basalt veined with glowing lava) and freezing water -----
const lavaPts = () => { const rnd = seeded(79); return Array.from({ length: 16 }, () => [rnd() * 256, rnd() * 256]); };
// dark basalt plates floating on glowing lava: the cracks between them burn bright
export const lavaTex = () => once('lava', () => {
    const N = 256, e = voronoiEdges(N, lavaPts(), 14);
    return tex(imageFrom(N, (i) => { const k = Math.min(1, e[i] * 1.4); const n = ((i * 2654435761) >>> 0) % 12; return [lerp(58 + n, 255, k), lerp(30 + n, 150, k * k), lerp(28 + n, 30, k)]; }));
});
export const lavaGlow = () => once('lavaglow', () => {
    const N = 256, e = voronoiEdges(N, lavaPts(), 14);
    return tex(imageFrom(N, (i) => { const k = Math.min(1, e[i] * 1.5) ** 1.4; return [255 * k, 120 * k, 18 * k]; }));
});
export const lavaMaterial = () => once('lavamat', () => matte({ map: lavaTex(), emissive: 0xffffff, emissiveMap: lavaGlow(), emissiveIntensity: 1 }));
export const acidTex = () => once('acid', () => {
    const N = 256, rnd = seeded(41);
    const a = voronoiEdges(N, Array.from({ length: 22 }, () => [rnd() * N, rnd() * N]), 7);
    const b = voronoiEdges(N, Array.from({ length: 9 }, () => [rnd() * N, rnd() * N]), 12);
    const TAU = Math.PI * 2;
    return tex(imageFrom(N, (i) => {
        const x = i % N, y = Math.floor(i / N);
        const w = 0.5 + 0.25 * Math.sin((x + y) / N * TAU * 2) + 0.25 * Math.sin((x - 2 * y) / N * TAU * 3);
        const k = Math.min(1, a[i] ** 2 * 0.8 + b[i] ** 2 * 0.5);
        return [lerp(30 + w * 20, 210, k), lerp(150 + w * 30, 250, k), lerp(220 + w * 20, 255, k)];
    }));
});
export const acidMaterial = () => once('acidmat', () => matte({ map: acidTex(), emissive: 0x0a5a8a, emissiveIntensity: 0.6 }));

// ----- slippery ice (cracked, pale and glowing a little) -----
const iceTex = () => once('ice', () => {
    const N = 256, c = canvas(N), x = c.getContext('2d'), rnd = seeded(67);
    x.fillStyle = '#9ae4ff'; x.fillRect(0, 0, N, N);
    for (let i = 0; i < 26; i++) {
        const px = rnd() * N, py = rnd() * N, r = 16 + rnd() * 36;
        wrapped(N, N, px, py, r, (u, v) => { const gg = x.createRadialGradient(u, v, 0, u, v, r); gg.addColorStop(0, 'rgba(230,250,255,0.7)'); gg.addColorStop(1, 'rgba(230,250,255,0)'); x.fillStyle = gg; x.fillRect(u - r, v - r, r * 2, r * 2); });
    }
    cracks(x, N, rnd, 8, 'rgba(255,255,255,0.85)', 1.4);
    cracks(x, N, rnd, 5, 'rgba(90,170,220,0.6)', 1.2);
    return tex(c);
});
export const iceMaterial = () => once('icemat', () => matte({ map: iceTex(), emissive: 0x2a7aaa, emissiveIntensity: 0.35 }));

// ----- conveyor belts: dark rubber with yellow chevrons pointing along u (one tile = 4 studs) -----
export const conveyorTex = () => once('conveyor', () => {
    const N = 128, c = canvas(N), x = c.getContext('2d');
    x.fillStyle = '#2a2e38'; x.fillRect(0, 0, N, N);
    x.fillStyle = '#353a46'; for (let k = 0; k < N; k += 16) x.fillRect(k, 0, 8, N);
    x.fillStyle = '#ffd028'; x.strokeStyle = '#8a6a00'; x.lineWidth = 3; x.lineJoin = 'round';
    x.beginPath(); x.moveTo(30, 18); x.lineTo(78, 64); x.lineTo(30, 110); x.lineTo(50, 110); x.lineTo(98, 64); x.lineTo(50, 18); x.closePath(); x.fill(); x.stroke();
    x.fillStyle = 'rgba(0,0,0,0.35)'; x.fillRect(0, 0, N, 6); x.fillRect(0, N - 6, N, 6);
    return tex(c);
});
export const conveyorMaterial = () => once('conveyormat', () => matte({ map: conveyorTex(), emissive: 0xffd028, emissiveMap: conveyorTex(), emissiveIntensity: 0.15 }));

// ----- keyboard keycaps: one atlas of letters (8 x 8 cells), mint keys with dark letters -----
export const KEY_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ?!:)';
export const keyAtlas = () => once('keyatlas', () => {
    const N = 1024, S = N / 8, c = canvas(N), x = c.getContext('2d');
    for (let k = 0; k < 64; k++) {
        const cx = (k % 8) * S, cy = Math.floor(k / 8) * S;
        const g = x.createLinearGradient(cx, cy, cx, cy + S); g.addColorStop(0, '#8affc8'); g.addColorStop(1, '#3ad890');
        x.fillStyle = '#1e8a5a'; x.fillRect(cx, cy, S, S);
        x.fillStyle = g; x.beginPath(); x.roundRect(cx + 8, cy + 8, S - 16, S - 16, 18); x.fill();
        x.fillStyle = 'rgba(255,255,255,0.45)'; x.beginPath(); x.roundRect(cx + 14, cy + 12, S - 28, 14, 7); x.fill();
        const ch = k < KEY_CHARS.length ? KEY_CHARS[k] : '';
        if (ch) {
            x.font = '800 64px Fredoka, "Arial Rounded MT Bold", sans-serif'; x.textAlign = 'center'; x.textBaseline = 'middle';
            x.fillStyle = '#0e3a26'; x.fillText(ch === ')' ? ':)' : ch, cx + S / 2, cy + S / 2 + 4);
        }
    }
    const t = texFrom(c); t.anisotropy = 8;
    return t;
});
export const keyCell = (ch) => { const k = KEY_CHARS.indexOf(ch === ':)' ? ')' : ch); return k < 0 ? 0 : k; };
export const keyMaterial = () => once('keymat', () => matte({ map: keyAtlas() }));

// ----- glass windows and fences -----
export const glassMaterial = () => once('glassmat', () => new T.MeshBasicMaterial({ color: 0xbfeeff, transparent: true, opacity: 0.18, depthWrite: false, side: T.DoubleSide, forceSinglePass: true, toneMapped: false }));
export const latticeTex = () => once('lattice', () => {
    const N = 128, c = canvas(N), x = c.getContext('2d');
    x.fillStyle = 'rgba(190,255,236,0.26)'; x.fillRect(0, 0, N, N);
    x.strokeStyle = 'rgba(255,255,255,0.95)'; x.lineWidth = 4;
    x.beginPath(); x.moveTo(0, 0); x.lineTo(N, N); x.moveTo(N, 0); x.lineTo(0, N); x.stroke();
    x.strokeStyle = 'rgba(80,230,170,0.9)'; x.lineWidth = 2;
    x.beginPath(); x.moveTo(0, 0); x.lineTo(N, N); x.moveTo(N, 0); x.lineTo(0, N); x.stroke();
    return tex(c);
});
export const latticeMaterial = () => once('latticemat', () => new T.MeshBasicMaterial({ map: latticeTex(), transparent: true, depthWrite: false, side: T.DoubleSide, forceSinglePass: true, toneMapped: false }));
// The invisible blocks: almost clear, with a soft edge so a sharp eye can spot them
export const ghostTex = () => once('ghost', () => {
    const N = 64, c = canvas(N), x = c.getContext('2d');
    x.fillStyle = 'rgba(255,255,255,0.05)'; x.fillRect(0, 0, N, N);
    x.strokeStyle = 'rgba(255,255,255,0.55)'; x.lineWidth = 3; x.strokeRect(1.5, 1.5, N - 3, N - 3);
    return texFrom(c);
});
export const ghostMaterial = () => once('ghostmat', () => new T.MeshBasicMaterial({ map: ghostTex(), transparent: true, opacity: 0.55, depthWrite: false, toneMapped: false }));

// ----- floor decals: big red arrows, the checkpoint pad -----
export const arrowTex = () => once('arrow', () => {
    const W = 256, H = 256, c = canvas(W, H), x = c.getContext('2d');
    const path = () => { x.beginPath(); x.moveTo(128, 10); x.lineTo(240, 128); x.lineTo(172, 128); x.lineTo(172, 246); x.lineTo(84, 246); x.lineTo(84, 128); x.lineTo(16, 128); x.closePath(); };
    path(); x.lineJoin = 'round'; x.lineWidth = 14; x.strokeStyle = '#3a0a0a'; x.stroke();
    const g = x.createLinearGradient(0, 0, 0, H); g.addColorStop(0, '#ff4a3a'); g.addColorStop(1, '#d8101a');
    path(); x.fillStyle = g; x.fill();
    x.fillStyle = 'rgba(255,255,255,0.25)'; x.beginPath(); x.moveTo(128, 30); x.lineTo(206, 114); x.lineTo(128, 96); x.lineTo(50, 114); x.closePath(); x.fill();
    return texFrom(c);
});
export const cpPadTex = (on) => once('cp' + (on ? 1 : 0), () => {
    const N = 256, c = canvas(N), x = c.getContext('2d');
    x.fillStyle = on ? '#5aff6a' : '#ffe03a'; x.fillRect(0, 0, N, N);
    x.fillStyle = on ? '#28c83a' : '#f0b814'; x.fillRect(0, 0, N, 12); x.fillRect(0, N - 12, N, 12); x.fillRect(0, 0, 12, N); x.fillRect(N - 12, 0, 12, N);
    // a chequered flag on the pad
    for (let r = 0; r < 4; r++) for (let q = 0; q < 6; q++) { x.fillStyle = (r + q) % 2 ? '#ffffff' : '#1a1a24'; x.fillRect(70 + q * 20, 78 + r * 20, 20, 20); }
    x.fillStyle = '#5a3a1a'; x.fillRect(60, 70, 10, 120);
    return texFrom(c);
});
export const cpPadMaterial = (on) => once('cpmat' + (on ? 1 : 0), () => matte({ map: cpPadTex(on), emissive: on ? 0x1a6a2a : 0x8a6a00, emissiveIntensity: 0.25 }));
export const flagTex = (on) => once('flag' + (on ? 1 : 0), () => {
    const c = canvas(128, 80), x = c.getContext('2d');
    for (let r = 0; r < 5; r++) for (let q = 0; q < 8; q++) { x.fillStyle = (r + q) % 2 ? (on ? '#2ad84a' : '#ffffff') : (on ? '#0e6a22' : '#1a1a24'); x.fillRect(q * 16, r * 16, 16, 16); }
    return texFrom(c);
});
export const flagMaterial = (on) => once('flagmat' + (on ? 1 : 0), () => matte({ map: flagTex(on), side: T.DoubleSide, emissive: 0xffffff, emissiveMap: flagTex(on), emissiveIntensity: 0.2 }));
export const checkerTex = () => once('checker', () => {
    const N = 128, c = canvas(N), x = c.getContext('2d'), H = N / 4;
    for (let r = 0; r < 4; r++) for (let q = 0; q < 4; q++) { x.fillStyle = (r + q) % 2 ? '#ffffff' : '#1a1a24'; x.fillRect(q * H, r * H, H, H); }
    return tex(c);
});
export const checkerMaterial = () => once('checkermat', () => matte({ map: checkerTex(), emissive: 0xffffff, emissiveMap: checkerTex(), emissiveIntensity: 0.15 }));

export const rainbowTex = () => once('rainbow', () => {
    const c = canvas(256, 16), x = c.getContext('2d');
    const g = x.createLinearGradient(0, 0, 256, 0);
    ['#ff3c5a', '#ff9a2a', '#ffe83a', '#46ec50', '#28c8ff', '#6a5aff', '#d84aff', '#ff3c5a'].forEach((col, i, a) => g.addColorStop(i / (a.length - 1), col));
    x.fillStyle = g; x.fillRect(0, 0, 256, 16);
    return wrap(texFrom(c));
});
export const carpetTex = () => once('carpet', () => {
    const c = canvas(128, 256), x = c.getContext('2d');
    // the reference's rainbow flying carpet with a gold fringe
    const cols = ['#ff3c5a', '#ff9a2a', '#ffe83a', '#46ec50', '#28c8ff', '#8a5aff'];
    cols.forEach((col, i) => { x.fillStyle = col; x.fillRect(0, i * (256 / cols.length), 128, 256 / cols.length + 1); });
    x.strokeStyle = '#ffd028'; x.lineWidth = 8; x.strokeRect(5, 5, 118, 246);
    x.fillStyle = 'rgba(255,255,255,0.35)';
    for (let k = 0; k < 8; k++) { x.beginPath(); x.arc(64, 20 + k * 31, 6, 0, Math.PI * 2); x.fill(); }
    return texFrom(c);
});

// Soft glow dot (pad glows, coins)
export const softTex = () => once('soft', () => {
    const c = canvas(64), x = c.getContext('2d');
    const g = x.createRadialGradient(32, 32, 0, 32, 32, 32);
    g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.45, 'rgba(255,255,255,0.5)'); g.addColorStop(1, 'rgba(255,255,255,0)');
    x.fillStyle = g; x.fillRect(0, 0, 64, 64);
    return texFrom(c);
});
// Fluffy cloud puff for the clouds drifting round the tower
export const cloudSpriteTex = () => once('cloudsprite', () => {
    const W = 256, H = 128, c = canvas(W, H), x = c.getContext('2d');
    const rnd = seeded(77);
    for (let i = 0; i < 16; i++) {
        const cx = 40 + rnd() * 176, cy = 54 + rnd() * 34, r = 22 + rnd() * 30;
        const g = x.createRadialGradient(cx, cy - r * 0.3, r * 0.1, cx, cy, r);
        g.addColorStop(0, 'rgba(255,255,255,0.95)'); g.addColorStop(0.6, 'rgba(250,250,255,0.8)'); g.addColorStop(1, 'rgba(240,244,255,0)');
        x.fillStyle = g; x.beginPath(); x.arc(cx, cy, r, 0, Math.PI * 2); x.fill();
    }
    return texFrom(c);
});
export const goldMaterial = () => once('goldmat', () => matte({ color: 0xffc828, emissive: 0x8a5a00, emissiveIntensity: 0.45 }));
// The troll coins: gold discs with a grin stamped on both faces
export const coinTex = () => once('coin', () => {
    const N = 128, c = canvas(N), x = c.getContext('2d'), m = N / 2;
    const g = x.createRadialGradient(m - 14, m - 18, 6, m, m, m);
    g.addColorStop(0, '#fff6a8'); g.addColorStop(0.6, '#ffd028'); g.addColorStop(1, '#e09a08');
    x.fillStyle = g; x.fillRect(0, 0, N, N);
    x.strokeStyle = '#b87400'; x.lineWidth = 8; x.beginPath(); x.arc(m, m, m - 8, 0, Math.PI * 2); x.stroke();
    x.save(); x.translate(m, m + 2); x.scale(0.42, 0.42); drawGrinLines(x, '#9a5a00', 9); x.restore();
    return texFrom(c);
});
export const coinMaterial = () => once('coinmat', () => matte({ map: coinTex(), emissive: 0x6a4000, emissiveIntensity: 0.55 }));

// Unlit glowing colour (neon trims, light panels), a little brighter than the colour itself
export const neon = (color, boost) => once('neon|' + color + '|' + (boost || 1.2), () => { const m = new T.MeshBasicMaterial({ color }); m.color.multiplyScalar(NEON_BOOST * (boost || 1.2) / 1.25); return m; });

// =====================================================================================
// The troll grin: our own cartoon face (a wide cheeky head, squinting eyes under raised brows and
// a huge toothy grin). Drawn into any 2D context centred on the origin, about 220 px across.
// =====================================================================================
function drawGrinLines(x, ink, w) {
    x.lineCap = 'round'; x.lineJoin = 'round'; x.strokeStyle = ink; x.lineWidth = w;
    // squinting eyes
    for (const s of [-1, 1]) {
        x.beginPath(); x.ellipse(s * 46, -34, 26, 13, s * 0.15, Math.PI * 1.05, Math.PI * 1.95); x.stroke();
        x.beginPath(); x.arc(s * 46 + s * 6, -36, 6.5, 0, Math.PI * 2); x.fillStyle = ink; x.fill();
        // raised brows
        x.beginPath(); x.moveTo(s * 18, -62); x.quadraticCurveTo(s * 44, -86, s * 78, -64); x.stroke();
    }
    // the grin: a wide crescent with a row of teeth
    x.beginPath(); x.moveTo(-86, 4); x.quadraticCurveTo(0, 36, 86, 4); x.quadraticCurveTo(70, 78, 0, 82); x.quadraticCurveTo(-70, 78, -86, 4); x.closePath();
    x.fillStyle = '#ffffff'; x.fill(); x.stroke();
    x.lineWidth = w * 0.6;
    for (let k = -3; k <= 3; k++) { const tx = k * 21; x.beginPath(); x.moveTo(tx, 18 + Math.abs(k) * -2.5 + 6); x.lineTo(tx * 0.92, 74 - Math.abs(k) * 4); x.stroke(); }
    x.beginPath(); x.moveTo(-80, 34); x.quadraticCurveTo(0, 58, 80, 34); x.stroke();
    // cheek creases
    x.lineWidth = w * 0.7;
    for (const s of [-1, 1]) { x.beginPath(); x.moveTo(s * 98, -6); x.quadraticCurveTo(s * 110, 20, s * 96, 46); x.stroke(); }
}
export function drawTrollFace(x, size, bg) {
    const k = size / 280;
    x.save();
    x.translate(size / 2, size / 2 + size * 0.02);
    x.scale(k, k);
    if (bg) { x.fillStyle = bg; x.beginPath(); x.roundRect(-140, -140, 280, 280, 40); x.fill(); }
    // the head: wide brow, bulging cheeks, a big jaw
    x.beginPath();
    x.moveTo(-104, -84); x.quadraticCurveTo(0, -150, 104, -84);
    x.quadraticCurveTo(138, -30, 124, 34); x.quadraticCurveTo(108, 112, 0, 118);
    x.quadraticCurveTo(-108, 112, -124, 34); x.quadraticCurveTo(-138, -30, -104, -84); x.closePath();
    x.fillStyle = '#ffffff'; x.fill();
    x.lineWidth = 10; x.strokeStyle = '#141420'; x.stroke();
    drawGrinLines(x, '#141420', 8);
    x.restore();
}
export const trollFaceTex = () => once('trollface', () => { const c = canvas(512); drawTrollFace(c.getContext('2d'), 512); return texFrom(c); });
export const trollFaceUrl = () => once('trollfaceurl', () => { const c = canvas(256); drawTrollFace(c.getContext('2d'), 256, '#ffd028'); return c.toDataURL('image/png'); });
export const trollFaceBareUrl = () => once('trollfacebare', () => { const c = canvas(512); drawTrollFace(c.getContext('2d'), 512); return c.toDataURL('image/png'); });
