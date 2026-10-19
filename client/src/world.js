// The world: the giant studded tower floating over the ocean (green, then magenta, blue and purple
// as it climbs), the lobby on its ground floor with the terrace outside (slap gloves on stands, a
// strolling giant), the 32 stages spiralling up its outside in the open sky (from shared/tower.js)
// with every troll on them, the roof with its fake WIN pad, the rainbow path and the victory
// platform. Every collider and animation lives here too.
//
// Static geometry is merged per colour band (eight stages) and material (a few draw calls per group,
// frustum culled as a whole, never hidden); the moving and animated parts of a stage live in its
// own zone, drawn and animated only near the player. Everything matte (Lambert) or unlit, shaded
// with a soft top-to-bottom gradient baked into the vertex colours; built in slices so the page
// never freezes while loading.
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import {
    T, V3, scene, mat, studVCMaterial, solids, triggers, prompts, tickers, solidBox, buildRig, animRig,
    billboard, texFrom, sharedTex, textCanvas, mergeChildren, fitFont,
} from './engine.js';
import {
    rockMaterial, plankMaterial, trussMaterial, killTex, iceMaterial, conveyorMaterial, conveyorTex,
    keyMaterial, keyCell, glassMaterial, latticeMaterial, ghostMaterial, arrowTex, cpPadMaterial, flagMaterial, checkerMaterial,
    rainbowTex, softTex, cloudSpriteTex, goldMaterial, coinMaterial, neon, trollFaceTex,
} from './materials.js';
import { gearModel, gloveMesh, gloveGeometry, gloveMaterial, bearTrap } from './gear.js';
import { S, actions, net } from './state.js';
import {
    CFG, STAGES, BANDS, gloveById, gearById, PASSES, passForTool, fmt, rngFrom, clock, ghostGate,
} from '../../shared/config.js';
import {
    A, IN, LOBBY_H, ROOF_Y, START_Y, BOARDS, COURSE, CHECKPOINTS, COINS, HOLES, OPENINGS, WINDOWS, DOLLS, GIANTS, FINISH, RAINBOW,
    LOBBY, TERRACE, GLOVE_STANDS, CHEST, VIP, CAGE, FIRE_STAND, TROLL_PAD, GEAR_PADS, stageAt, stageFrame,
} from '../../shared/tower.js';

export const SPAWN = new V3(LOBBY.spawn.x, LOBBY.spawn.y + 0.4, LOBBY.spawn.z);
export const SPAWN_YAW = LOBBY.yaw;
const N = STAGES.length;
const serverT = () => net.now() / 1000;
const spd = (zone) => (STAGES[zone] && STAGES[zone].speed) || 1;

// The palette: the bright Roblox plastic colours of the reference
export const C = {
    white: 0xf2f4f8, green: 0x4cf07a, mint: 0x3ee6a2, dmint: 0x22b47a, pink: 0xff6ae8, magenta: 0xe44ce4, blue: 0x6a7cff,
    dblue: 0x3434c8, red: 0xff3a4a, grey: 0xa4aab8, gold: 0xffc828, wood: 0x9a6038, ice: 0xbfefff, key: 0x8affc8,
    yellow: 0xffd028, black: 0x22242c, orange: 0xff8a2a, purple: 0xb46aff, cyan: 0x3ad8ff, banana: 0xffe04a,
};
const bandOf = (i) => STAGES[Math.max(0, Math.min(N - 1, i))].band;
// 'band' means the stage's own platform colour
const colorOf = (name, zone) => (name === 'band' ? BANDS[bandOf(zone)].plat : C[name] ?? C.white);
const RAINBOW_C = [0xff3a4a, 0xff8a2a, 0xffd83a, 0x46e84a, 0x2ac8ff, 0x3a6aff, 0xa84aff, 0xff4ad8];
// the soft light-from-above shading of the course's blocks (bottom, top)
const SHADE = [0.58, 1.08];
const arrowRot = (dx, dz) => Math.atan2(-dx, -dz);

// =====================================================================================
// Zones: the shell (-2, always drawn), the lobby and terrace (-1), one per stage (its moving and
// animated parts) and the static groups (100 + stage / 8, always drawn). The player only collides
// with nearby zones.
// =====================================================================================
const zoneGroups = new Map();
export function zoneGroup(z) {
    let g = zoneGroups.get(z);
    if (!g) { g = new T.Group(); g.name = 'zone' + z; scene.add(g); zoneGroups.set(z, g); }
    return g;
}
const staticZone = (i) => (i < 0 ? i : 100 + (i >> 3));
// The stage you're on and two either side are drawn and animated; the static course always shows
export function cullZones(stage) {
    const s = stage ?? -1;
    for (const [z, g] of zoneGroups) {
        if (z === -2 || z >= 100) continue;
        g.visible = z === -1 ? s <= 1 : Math.abs(z - Math.max(0, s)) <= 2;
        // a hidden zone isn't walked by the renderer's per-frame matrix update either
        g.matrixWorldAutoUpdate = g.visible;
    }
}
const anim = (o) => { o.userData.anim = true; return o; };
function freezeStatic() {
    const near = new Map(propLabels.map((l) => [l.sp, l.r2]));
    const wp = new V3();
    for (const g of zoneGroups.values()) {
        g.updateMatrixWorld(true);
        g.traverse((o) => {
            if (!o.userData.anim) o.matrixAutoUpdate = false;
            if (o.isSprite && !o.userData.keepFar) { o.getWorldPosition(wp); spriteLOD.push({ sp: o, x: wp.x, y: wp.y, z: wp.z, near2: near.get(o) || 0, far2: FAR_SIGNS * FAR_SIGNS }); }
        });
    }
}
const FAR_SIGNS = 90;
const spriteLOD = [];
const propLabels = [];
function propLabel(sp, x, z, r) { propLabels.push({ sp, x, z, r2: r * r }); return sp; }

// ----- static geometry, merged per zone and material at the end -----
const geoBatches = new Map();
function batchFor(zone, material, cast) {
    const k = zone + '|' + material.uuid + '|' + (cast ? 1 : 0);
    let b = geoBatches.get(k);
    if (!b) { b = { zone, material, cast, list: [], pos: [], nrm: [], uv: [], idx: [], col: [] }; geoBatches.set(k, b); }
    return b;
}
const white3 = new T.Color(0xffffff);
// Plain one-colour materials (matte or unlit, no texture) fold into two shared vertex-colour ones,
// so every zone has only a handful of batches (draw calls)
const smoothVCm = { m: null };
const smoothVC = () => smoothVCm.m || (smoothVCm.m = new T.MeshLambertMaterial({ vertexColors: true }));
let basicVCm = null;
const basicVC = () => basicVCm || (basicVCm = new T.MeshBasicMaterial({ vertexColors: true }));
function fold(material, color) {
    if (material.vertexColors || material.map || material.transparent || material.alphaTest > 0 || material.side !== T.FrontSide) return null;
    if (material.isMeshLambertMaterial && (!material.emissive || material.emissive.getHex() === 0)) return { m: smoothVC(), c: color ?? material.color };
    if (material.isMeshBasicMaterial && material.toneMapped !== false) return { m: basicVC(), c: color ?? material.color };
    return null;
}
const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
// shade: [bottom, top] brightness, shading the vertex colours by height within the geometry
function addGeo(zone, geo, material, cast, color, shade) {
    const f = fold(material, color);
    if (f) { material = f.m; color = f.c; }
    const b = batchFor(zone, material, cast);
    const vc = !!material.vertexColors;
    for (const name of Object.keys(geo.attributes)) if (!['position', 'normal', 'uv'].includes(name) && !(vc && name === 'color')) geo.deleteAttribute(name);
    if (!geo.attributes.uv) geo.setAttribute('uv', new T.Float32BufferAttribute(new Float32Array(geo.attributes.position.count * 2), 2));
    if (vc && (!geo.attributes.color || color !== undefined)) {
        const c = color !== undefined ? new T.Color(color) : white3, p = geo.attributes.position, n = p.count, a = new Float32Array(n * 3);
        let y0 = 0, y1 = 1;
        if (shade) { geo.computeBoundingBox(); y0 = geo.boundingBox.min.y; y1 = Math.max(y0 + 1e-3, geo.boundingBox.max.y); }
        for (let i = 0; i < n; i++) {
            const k = shade ? shade[0] + (shade[1] - shade[0]) * clamp01((p.getY(i) - y0) / (y1 - y0)) : 1;
            a[i * 3] = c.r * k; a[i * 3 + 1] = c.g * k; a[i * 3 + 2] = c.b * k;
        }
        geo.setAttribute('color', new T.BufferAttribute(a, 3));
    }
    if (!geo.index) { const idx = []; for (let i = 0; i < geo.attributes.position.count; i++) idx.push(i); geo.setIndex(idx); }
    b.list.push(geo);
}
// Axis-aligned boxes are written straight into their batch's vertex arrays (the same faces, order
// and UVs as THREE.BoxGeometry). uvDiv: UVs in world units / uvDiv (studs), or 0 for 0..1 per face.
// shade: [bottom, top(, y0, y1)] brightness by height (over the box, or the given range)
const BOX_FACES = [[2, 1, 0, -1, -1, 1, 2, 1], [2, 1, 0, 1, -1, -1, 2, 1], [0, 2, 1, 1, 1, 1, 0, 2], [0, 2, 1, 1, -1, -1, 0, 2], [0, 1, 2, 1, -1, 1, 0, 1], [0, 1, 2, -1, -1, -1, 0, 1]];
const vcTmp = new T.Color();
function addBoxFast(zone, material, cast, sx, sy, sz, x, y, z, uvDiv, color, skipBottom, uvFn, shade) {
    const f = fold(material, color);
    if (f) { material = f.m; color = f.c; }
    const b = batchFor(zone, material, cast);
    const vc = !!material.vertexColors;
    if (vc) vcTmp.set(color ?? 0xffffff);
    const size = [sx, sy, sz], c = [x, y, z], v = [0, 0, 0], n = [0, 0, 0];
    const ya = shade ? shade[2] ?? y - sy / 2 : 0, yb = shade ? shade[3] ?? y + sy / 2 : 1;
    for (let f = 0; f < 6; f++) {
        if (skipBottom && f === 3) continue;
        const [u, vv, w, ud, vd, ws, su, sv] = BOX_FACES[f];
        const base = b.pos.length / 3;
        const wu = size[u], hv = size[vv], dw = size[w] / 2 * ws;
        const us = uvDiv ? size[su] / uvDiv : 1, vs = uvDiv ? size[sv] / uvDiv : 1;
        for (let iy = 0; iy < 2; iy++) for (let ix = 0; ix < 2; ix++) {
            v[u] = (ix * wu - wu / 2) * ud; v[vv] = (iy * hv - hv / 2) * vd; v[w] = dw;
            b.pos.push(v[0] + c[0], v[1] + c[1], v[2] + c[2]);
            n[0] = n[1] = n[2] = 0; n[w] = ws;
            b.nrm.push(n[0], n[1], n[2]);
            if (uvFn) { const q = uvFn(f, ix, iy); b.uv.push(q[0], q[1]); }
            else b.uv.push(ix * us + (uvDiv ? (c[su] - size[su] / 2) / uvDiv : 0), (1 - iy) * vs + (uvDiv ? (c[sv] - size[sv] / 2) / uvDiv : 0));
            if (vc) {
                const k = shade ? shade[0] + (shade[1] - shade[0]) * clamp01((v[1] + y - ya) / (yb - ya)) : 1;
                b.col.push(vcTmp.r * k, vcTmp.g * k, vcTmp.b * k);
            }
        }
        b.idx.push(base, base + 2, base + 1, base + 2, base + 3, base + 1);
    }
}
function flushGeo() {
    for (const b of geoBatches.values()) {
        const parts = [...b.list];
        if (b.pos.length) {
            const g = new T.BufferGeometry();
            g.setAttribute('position', new T.Float32BufferAttribute(b.pos, 3));
            g.setAttribute('normal', new T.Float32BufferAttribute(b.nrm, 3));
            g.setAttribute('uv', new T.Float32BufferAttribute(b.uv, 2));
            if (b.col.length) g.setAttribute('color', new T.Float32BufferAttribute(b.col, 3));
            g.setIndex(b.idx);
            parts.push(g);
        }
        if (!parts.length) continue;
        const geo = parts.length === 1 ? parts[0] : mergeGeometries(parts);
        if (!geo) { console.warn('[world] could not merge a batch', b.zone); continue; }
        const mesh = new T.Mesh(geo, b.material);
        mesh.receiveShadow = true; mesh.castShadow = !!b.cast;
        mesh.matrixAutoUpdate = false;
        if (b.material.transparent) mesh.renderOrder = 2;
        zoneGroup(b.zone).add(mesh);
        if (parts.length > 1) for (const g of parts) g.dispose();
    }
    geoBatches.clear();
}
function roundGeo(sx, sy, sz, r) {
    return new RoundedBoxGeometry(sx, sy, sz, 2, Math.min(r ?? 0.45, sx * 0.3, sy * 0.3, sz * 0.3));
}
function worldUV(g, tile) {
    const p = g.attributes.position, nn = g.attributes.normal, uv = g.attributes.uv;
    for (let i = 0; i < p.count; i++) {
        const ax = Math.abs(nn.getX(i)), ay = Math.abs(nn.getY(i)), az = Math.abs(nn.getZ(i));
        if (ay >= ax && ay >= az) uv.setXY(i, p.getX(i) / tile, -p.getZ(i) / tile);
        else if (ax >= az) uv.setXY(i, -p.getZ(i) / tile, p.getY(i) / tile);
        else uv.setXY(i, p.getX(i) / tile, p.getY(i) / tile);
    }
    return g;
}
// A rounded studded plastic block (soft edges catch the light like moulded plastic)
function roundStud(zone, sx, sy, sz, x, y, z, color, o) {
    o = o || {};
    const g = roundGeo(sx, sy, sz, o.r);
    g.translate(x, y, z);
    addGeo(zone, worldUV(g, 8), studVCMaterial(), o.cast ?? true, color, o.shade);
    if (o.solid !== false) return solidBox(x, y, z, sx, sy, sz, { zone: o.solidZone ?? zone, mat: o.mat || 'stud', ...(o.extra || {}) });
    return null;
}
function studBox(zone, sx, sy, sz, x, y, z, color, o) {
    o = o || {};
    addBoxFast(zone, studVCMaterial(), o.cast, sx, sy, sz, x, y, z, 8, color, o.skipBottom, null, o.shade);
    if (o.solid !== false) return solidBox(x, y, z, sx, sy, sz, { zone: o.solidZone ?? zone, mat: o.mat || 'stud', ...(o.extra || {}) });
    return null;
}
function plainBox(zone, sx, sy, sz, x, y, z, material, o) {
    addBoxFast(zone, material, o && o.cast, sx, sy, sz, x, y, z, (o && o.uvDiv) ?? 0, o && o.color);
}
function cylGeo(r0, r1, h, x, y, z, seg) { const g = new T.CylinderGeometry(r0, r1, h, seg || 20); g.translate(x, y, z); return g; }
// a geometry painted one colour (for meshes that share the studded or smooth vertex-colour material)
function painted(g, color) {
    const n = g.attributes.position.count, a = new Float32Array(n * 3), c = new T.Color(color);
    for (let i = 0; i < n; i++) { a[i * 3] = c.r; a[i * 3 + 1] = c.g; a[i * 3 + 2] = c.b; }
    g.setAttribute('color', new T.BufferAttribute(a, 3));
    return g;
}
const css = (h) => '#' + h.toString(16).padStart(6, '0');
// Moves a static mesh into its zone's merged batches (one draw call per zone and material)
function bakeMesh(zone, mesh, cast) {
    mesh.updateWorldMatrix(true, false);
    addGeo(zone, mesh.geometry.clone().applyMatrix4(mesh.matrixWorld), mesh.material, cast);
    mesh.parent.remove(mesh);
}

// ----- rectangle minus holes: a wall or a floor with doorways / windows cut out -----
function subtractRect(a0, a1, b0, b1, holes) {
    const cuts = new Set([a0, a1]);
    for (const h of holes) { if (h.a0 > a0 && h.a0 < a1) cuts.add(h.a0); if (h.a1 > a0 && h.a1 < a1) cuts.add(h.a1); }
    const as = [...cuts].sort((p, q) => p - q), out = [];
    for (let i = 0; i < as.length - 1; i++) {
        const lo = as[i], hi = as[i + 1];
        const cut = holes.filter((h) => h.a0 <= lo + 1e-6 && h.a1 >= hi - 1e-6).map((h) => [Math.max(b0, h.b0), Math.min(b1, h.b1)]).filter(([p, q]) => q > p).sort((p, q) => p[0] - q[0]);
        let cur = b0;
        for (const [p, q] of cut) { if (p > cur) out.push({ a0: lo, a1: hi, b0: cur, b1: p }); cur = Math.max(cur, q); }
        if (cur < b1) out.push({ a0: lo, a1: hi, b0: cur, b1 });
    }
    // merge neighbours with the same b range (fewer, longer boxes)
    const merged = [];
    for (const r of out) {
        const m = merged.find((o) => o.a1 === r.a0 && o.b0 === r.b0 && o.b1 === r.b1);
        if (m) m.a1 = r.a1; else merged.push({ ...r });
    }
    return merged;
}

// =====================================================================================
// The tower shell: four studded walls from the ocean to the roof (a colour band per two laps, the
// doorways cut out), white trims and glowing lines between the bands, rows of painted windows, the
// corner pillars, the lobby's floor and ceiling, the roof
// =====================================================================================
const wallT = (w) => (w === 0 || w === 2 ? [-A, A] : [-IN, IN]);
const wallN = (w) => (w === 0 ? [-A, -IN] : w === 2 ? [IN, A] : w === 1 ? [IN, A] : [-A, -IN]);
// the outer face of wall w and which way it faces
const wallOut = (w) => (w === 0 || w === 3 ? -1 : 1);
// a box from wall coordinates (t along the wall, n across it, y up)
function wallBox(w, t0, t1, n0, n1, y0, y1) {
    const alongZ = w === 0 || w === 2;
    return alongZ ? { x: (n0 + n1) / 2, z: (t0 + t1) / 2, sx: n1 - n0, sz: t1 - t0, y: (y0 + y1) / 2, sy: y1 - y0 }
        : { x: (t0 + t1) / 2, z: (n0 + n1) / 2, sx: t1 - t0, sz: n1 - n0, y: (y0 + y1) / 2, sy: y1 - y0 };
}
const BAND_NAMES = ['green', 'pink', 'blue', 'purple'];
const BAND_BANNERS = [null, '🌸 TROLL TOWN 🌸', '🌀 DIZZY HEIGHTS 🌀', "👑 TROLL KING'S PEAK 👑"];
// Glowing lines whose colour runs round the tower like a rainbow (one material for all of them)
let rainbowNeonM = null;
const neonTime = { value: 0 };
function rainbowNeon() {
    if (rainbowNeonM) return rainbowNeonM;
    rainbowNeonM = new T.ShaderMaterial({
        uniforms: { uTime: neonTime },
        vertexShader: 'varying vec3 vW; void main(){ vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }',
        fragmentShader: `uniform float uTime; varying vec3 vW;
            vec3 hue(float h){ return clamp(abs(mod(h * 6.0 + vec3(0.0, 4.0, 2.0), 6.0) - 3.0) - 1.0, 0.0, 1.0); }
            void main(){ float h = atan(vW.z, vW.x) / 6.2832 + vW.y * 0.002 - uTime * 0.12; gl_FragColor = vec4(mix(vec3(1.0), hue(h), 0.85) * 1.15, 1.0);
                #include <colorspace_fragment>
            }`,
    });
    return rainbowNeonM;
}
function buildShell() {
    const Z = -2;
    // band k runs from the start of lap 2k to the start of lap 2k + 2; the rim on top
    const yb = [-2, START_Y[8] - 1, START_Y[16] - 1, START_Y[24] - 1, ROOF_Y - 2, ROOF_Y + 4];
    for (let k = 0; k < 5; k++) {
        const band = BANDS[BAND_NAMES[Math.min(3, k)]], y0 = yb[k], y1 = yb[k + 1];
        const shade = k < 4 ? [0.8, 1.04, y0, y1] : null;
        for (let w = 0; w < 4; w++) {
            const [t0, t1] = wallT(w), [n0, n1] = wallN(w);
            const holes = [
                ...OPENINGS.filter((o) => o.w === w && o.y1 > y0 && o.y0 < y1).map((o) => ({ a0: o.t0, a1: o.t1, b0: o.y0, b1: o.y1 })),
                ...WINDOWS.filter((o) => o.w === w && o.y1 > y0 && o.y0 < y1).map((o) => ({ a0: o.t0, a1: o.t1, b0: o.y0, b1: o.y1 })),
            ];
            for (const r of subtractRect(t0, t1, y0, y1, holes)) {
                const b = wallBox(w, r.a0, r.a1, n0, n1, r.b0, r.b1);
                addBoxFast(Z, studVCMaterial(), false, b.sx, b.sy, b.sz, b.x, b.y, b.z, 8, k === 4 ? band.dark : band.wall, false, null, shade);
                solidBox(b.x, b.y, b.z, b.sx, b.sy, b.sz, { zone: -2, mat: 'wall' });
            }
            if (k === 4) {
                // the rim's cap: a glowing rainbow trim on top
                for (const r of subtractRect(t0, t1, y1 - 0.1, y1 + 0.5, holes)) {
                    const b = wallBox(w, r.a0, r.a1, n0 - 0.2, n1 + 0.2, y1, y1 + 0.4);
                    plainBox(Z, b.sx, b.sy, b.sz, b.x, b.y, b.z, rainbowNeon());
                }
            }
        }
        // the corner pillars in the darker shade (the roof's way in is the south-west corner)
        for (const [x, z] of [[-A, -A], [-A, A], [A, -A], [A, A]]) {
            if (k === 4 && x < 0 && z < 0) continue;
            addBoxFast(Z, studVCMaterial(), false, 3.4, y1 - y0, 3.4, x, (y0 + y1) / 2, z, 8, band.dark, false, null, shade);
        }
        // between the bands: a thick white trim with glowing lines along it, and the band's name
        if (k > 0 && k < 4) {
            for (let w = 0; w < 4; w++) {
                const o = wallOut(w), face = o < 0 ? -A : A, ny = y0 + 7;
                const pos = w === 0 || w === 2 ? new V3(face + o * 0.6, ny, 0) : new V3(0, ny, face + o * 0.6);
                bigTitle(Z, BAND_BANNERS[k], 50, pos, pos.clone().add(w === 0 || w === 2 ? new V3(o * 50, 0, 0) : new V3(0, 0, o * 50)), ['#ffffff', '#fff2a0', '#ffc828'], '#2a0a3a');
            }
            const ty = y0;
            for (const [sx, sz, x, z] of [[A * 2 + 2, 1, 0, A + 0.5], [A * 2 + 2, 1, 0, -A - 0.5], [1, A * 2, A + 0.5, 0], [1, A * 2, -A - 0.5, 0]]) {
                addBoxFast(Z, studVCMaterial(), false, sx, 2, sz, x, ty, z, 8, 0xffffff);
                const nx = sx > sz ? sx + 0.4 : sx + 0.2, nz = sx > sz ? sz + 0.2 : sz;
                plainBox(Z, nx, 0.35, nz, x, ty + 1.15, z, rainbowNeon());
                plainBox(Z, nx, 0.35, nz, x, ty - 1.15, z, rainbowNeon());
            }
        }
    }
    // a thin white line round the tower at every lap's start
    for (let i = 4; i < N; i += 4) {
        if (i % 8 === 0) continue;
        const ty = START_Y[i] - 1;
        for (const [sx, sz, x, z] of [[A * 2 + 1.2, 0.6, 0, A + 0.3], [A * 2 + 1.2, 0.6, 0, -A - 0.3], [0.6, A * 2, A + 0.3, 0], [0.6, A * 2, -A - 0.3, 0]]) addBoxFast(Z, studVCMaterial(), false, sx, 1, sz, x, ty, z, 8, 0xffffff);
    }
    // painted windows up the outside (not behind the stage boards)
    const keepOut = BOARDS.map((b) => ({ w: b.w, t0: b.t - 9.5, t1: b.t + 9.5, y0: b.y - 6, y1: b.y + 6 }));
    for (let k = 1; k < 4; k++) for (let w = 0; w < 4; w++) keepOut.push({ w, t0: -27, t1: 27, y0: START_Y[8 * k] - 2, y1: START_Y[8 * k] + 14 });
    const litRnd = rngFrom(4242);
    for (let w = 0; w < 4; w++) {
        const o = wallOut(w), face = o < 0 ? (w === 0 ? -A : -A) : A;
        for (const t of [-38, -13, 13, 38]) for (let y = LOBBY_H + 12; y + 18 < ROOF_Y - 8; y += 30) {
            const win = { t0: t - 5.5, t1: t + 5.5, y0: y, y1: y + 18 };
            if (keepOut.some((k) => k.w === w && k.t1 > win.t0 && k.t0 < win.t1 && k.y1 > win.y0 && k.y0 < win.y1)) continue;
            const bi = y < START_Y[8] ? 0 : y < START_Y[16] ? 1 : y < START_Y[24] ? 2 : 3, band = BANDS[BAND_NAMES[bi]];
            const pane = wallBox(w, win.t0, win.t1, face + o * 0.02 - 0.1, face + o * 0.02 + 0.1, win.y0, win.y1);
            if (litRnd() < 0.14 + bi * 0.07) addBoxFast(Z, basicVC(), false, pane.sx, pane.sy, pane.sz, pane.x, pane.y, pane.z, 0, litRnd() < 0.5 ? 0xffe2a0 : 0xb8f2ff, false, null, [0.62, 1.1]);
            else addBoxFast(Z, smoothVC(), false, pane.sx, pane.sy, pane.sz, pane.x, pane.y, pane.z, 0, 0x2a3a8a, false, null, [0.55, 1.35]);
            const fr = (t0, t1, ya, ybb) => { const b = wallBox(w, t0, t1, face - 0.1, face + o * 0.45, ya, ybb); addBoxFast(Z, studVCMaterial(), false, Math.abs(b.sx), b.sy, Math.abs(b.sz), b.x, b.y, b.z, 8, band.light); };
            fr(win.t0 - 0.7, win.t1 + 0.7, win.y0 - 0.7, win.y0);
            fr(win.t0 - 0.7, win.t1 + 0.7, win.y1, win.y1 + 0.7);
            fr(win.t0 - 0.7, win.t0, win.y0, win.y1);
            fr(win.t1, win.t1 + 0.7, win.y0, win.y1);
            fr(win.t0, win.t1, (win.y0 + win.y1) / 2 - 0.2, (win.y0 + win.y1) / 2 + 0.2);
        }
    }
    // the lobby's windows: a glass pane in the middle of the wall, a white frame round it
    for (const win of WINDOWS) {
        const [n0, n1] = wallN(win.w), nm = (n0 + n1) / 2;
        const g = wallBox(win.w, win.t0, win.t1, nm - 0.05, nm + 0.05, win.y0, win.y1);
        plainBox(Z, g.sx, g.sy, g.sz, g.x, g.y, g.z, glassMaterial());
        solidBox(g.x, g.y, g.z, Math.max(g.sx, 2), g.sy, Math.max(g.sz, 2), { zone: -1, mat: 'glass' });
        const fr = (t0, t1, ya, yb2) => { const b = wallBox(win.w, t0, t1, n0 - 0.3, n1 + 0.3, ya, yb2); addBoxFast(Z, studVCMaterial(), false, b.sx, b.sy, b.sz, b.x, b.y, b.z, 8, BANDS.green.light); };
        fr(win.t0 - 0.6, win.t1 + 0.6, win.y0 - 0.6, win.y0 + 0.15);
        fr(win.t0 - 0.6, win.t1 + 0.6, win.y1 - 0.15, win.y1 + 0.6);
        fr(win.t0 - 0.6, win.t0 + 0.15, win.y0, win.y1);
        fr(win.t1 - 0.15, win.t1 + 0.6, win.y0, win.y1);
        fr(win.t0, win.t1, (win.y0 + win.y1) / 2 - 0.15, (win.y0 + win.y1) / 2 + 0.15);
    }
    // doorway frames: slim posts and a lintel in the wall's darker shade, a glowing line round the inside
    for (const o of OPENINGS) {
        const [n0, n1] = wallN(o.w), band = BANDS[o.y0 > ROOF_Y - 4 ? 'purple' : 'green'], top = Math.min(o.y1, ROOF_Y + 4);
        const fr = (t0, t1, ya, yb2) => { const b = wallBox(o.w, t0, t1, n0 - 0.22, n1 + 0.22, ya, yb2); addBoxFast(Z, studVCMaterial(), false, b.sx, b.sy, b.sz, b.x, b.y, b.z, 8, band.dark, false, null, [0.75, 1.05]); };
        const glow = (t0, t1, ya, yb2) => { const b = wallBox(o.w, t0, t1, n0 - 0.26, n1 + 0.26, ya, yb2); plainBox(Z, b.sx, b.sy, b.sz, b.x, b.y, b.z, rainbowNeon()); };
        const lintel = o.y1 - o.y0 < 30 && o.y1 < ROOF_Y;
        if (lintel) { fr(o.t0 - 0.7, o.t1 + 0.7, o.y1, o.y1 + 0.7); glow(o.t0, o.t1, o.y1, o.y1 + 0.18); }
        if (o.t0 > -A + 0.5) { fr(o.t0 - 0.7, o.t0, o.y0, top); glow(o.t0, o.t0 + 0.18, o.y0, lintel ? o.y1 : top); }
        fr(o.t1, o.t1 + 0.7, o.y0, top); glow(o.t1 - 0.18, o.t1, o.y0, lintel ? o.y1 : top);
    }
    // the lobby's floor and ceiling, and the roof (with the troll pit cut out)
    addBoxFast(Z, studVCMaterial(), false, IN * 2, 2, IN * 2, 0, -1, 0, 8, 0x52eeb0);
    solidBox(0, -1, 0, IN * 2, 2, IN * 2, { zone: -1, mat: 'floor', floor: true });
    addBoxFast(Z, studVCMaterial(), false, IN * 2, 2, IN * 2, 0, LOBBY_H - 1, 0, 8, BANDS.green.dark);
    solidBox(0, LOBBY_H - 1, 0, IN * 2, 2, IN * 2, { zone: -1, mat: 'stud' });
    const holes = HOLES.map((h) => ({ a0: h.x0, a1: h.x1, b0: h.z0, b1: h.z1 }));
    for (const r of subtractRect(-IN, IN, -IN, IN, holes)) {
        const sx = r.a1 - r.a0, sz = r.b1 - r.b0, x = (r.a0 + r.a1) / 2, z = (r.b0 + r.b1) / 2;
        addBoxFast(Z, studVCMaterial(), false, sx, 2, sz, x, ROOF_Y - 1, z, 8, BANDS.purple.floor);
        solidBox(x, ROOF_Y - 1, z, sx, 2, sz, { zone: N - 1, mat: 'stud', floor: true });
    }
    // the rock the tower stands on, hanging over the ocean
    hangingRocks(Z, -A, A, -A, A, 10, 11, 12);
    addBoxFast(Z, rockMaterial(), false, A * 2, 6, A * 2, 0, -5, 0, 8);
    // the lobby's ceiling panels
    for (const px of [-36, -12, 12, 36]) for (const pz of [-36, -12, 12, 36]) {
        for (const [sx, sz, dx, dz] of [[14, 1.2, 0, -6.4], [14, 1.2, 0, 6.4], [1.2, 11.6, -6.4, 0], [1.2, 11.6, 6.4, 0]]) addBoxFast(-1, studVCMaterial(), false, sx, 0.5, sz, px + dx, LOBBY_H - 2.25, pz + dz, 8, BANDS.green.dark);
    }
    // the tower's name over the terrace, and the way up
    bigTitle(Z, 'TROLL EASY TOWER', 64, new V3(0, 38, -A - 0.4), new V3(0, 38, -200), ['#fff6a0', '#ffc828', '#ff8a1a'], '#3a1a00');
    bigTitle(Z, 'CLIMB TO THE TOP! ⬆', 40, new V3(-A - 0.4, 30, -30), new V3(-200, 30, -30), ['#ffffff', '#c8ffe8'], '#0a4a2a');
}
function hangingRocks(zone, x0, x1, z0, z1, n, seed, top) {
    const rnd = rngFrom(seed);
    for (let k = 0; k < n; k++) {
        const r = Math.min(8 + rnd() * 14, (x1 - x0) / 2 - 1, (z1 - z0) / 2 - 1), h = 18 + rnd() * 40;
        const g = new T.ConeGeometry(r, h, 7);
        g.rotateX(Math.PI);
        g.translate(x0 + r + rnd() * (x1 - x0 - 2 * r), -(top || 2) - h / 2 + 1, z0 + r + rnd() * (z1 - z0 - 2 * r));
        addGeo(zone, worldUV(g, 8), rockMaterial(), false);
    }
}

// ----- signs and boards -----
function bigTitle(zone, text, w, pos, look, colors, stroke) {
    const map = sharedTex('title|' + text + '|' + colors + '|' + stroke, () => {
        const cv = document.createElement('canvas'); cv.width = 1024; cv.height = 220;
        const x = cv.getContext('2d');
        const px = fitFont(x, text, 1024 - 56, 150, 800, 'Montserrat, Fredoka, sans-serif', 0.16);
        x.textAlign = 'center'; x.textBaseline = 'middle';
        x.lineJoin = 'round'; x.lineWidth = px * 0.15; x.strokeStyle = stroke || '#1a1a3a'; x.strokeText(text, 512, 112);
        const g = x.createLinearGradient(0, 40, 0, 180);
        colors.forEach((c, i) => g.addColorStop(i / Math.max(1, colors.length - 1), c));
        x.fillStyle = g; x.fillText(text, 512, 112);
        return cv;
    });
    const m = new T.Mesh(new T.PlaneGeometry(w, w * 220 / 1024), new T.MeshBasicMaterial({ map, transparent: true, depthWrite: false, toneMapped: false, side: T.DoubleSide, forceSinglePass: true }));
    m.position.copy(pos); m.lookAt(look);
    m.renderOrder = 2;
    zoneGroup(zone).add(m);
    return m;
}
// A painted board in a rounded frame (the frame is baked into o.bake's batches)
function board(zone, draw, key, w, h, pos, look, o) {
    o = o || {};
    const W = o.W || 1024;
    const map = sharedTex('board|' + key, () => { const cv = document.createElement('canvas'); cv.width = W; cv.height = Math.round(W * h / w); draw(cv.getContext('2d'), cv.width, cv.height); return cv; });
    const grp = new T.Group(); grp.position.copy(pos); grp.lookAt(look); zoneGroup(zone).add(grp);
    const frame = new T.Mesh(new RoundedBoxGeometry(w + 1, h + 1, 0.6, 2, 0.3), mat(o.frame ?? C.green)); grp.add(frame);
    const face = new T.Mesh(new T.PlaneGeometry(w, h), new T.MeshBasicMaterial({ map, toneMapped: false, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -2 })); face.position.z = 0.36; grp.add(face);
    bakeMesh(o.bake ?? zone, frame, true);
    return grp;
}
function txt(x, text, cx, cy, maxW, px, fill, stroke, weight) {
    const p = fitFont(x, text, maxW, px, weight || 800, 'Fredoka, "Arial Rounded MT Bold", sans-serif', 0.22);
    x.textAlign = 'center'; x.textBaseline = 'middle'; x.lineJoin = 'round';
    if (stroke) { x.lineWidth = p * 0.2; x.strokeStyle = stroke; x.strokeText(text, cx, cy); }
    x.fillStyle = fill; x.fillText(text, cx, cy);
    return p;
}
// A wooden troll sign on a post (the course's "WALK INTO IT", "BANANA TRAP!" ...)
function trollSign(zone, e, bake) {
    const lines = e.lines;
    const g = new T.Group(); g.position.set(e.x, e.y, e.z); g.rotation.y = e.yaw; zoneGroup(zone).add(g);
    const post = new T.Mesh(new T.BoxGeometry(0.5, 4.2, 0.5), mat(0x7a4a24)); post.position.y = 2.1; g.add(post); bakeMesh(bake ?? zone, post, true);
    const w = 6.4, h = 3.2;
    const map = sharedTex('sign|' + lines.join('|'), () => {
        const cv = document.createElement('canvas'); cv.width = 512; cv.height = 256; const x = cv.getContext('2d');
        x.fillStyle = '#c88a4a'; x.fillRect(0, 0, 512, 256);
        x.fillStyle = '#a86a32'; for (let k = 0; k < 4; k++) x.fillRect(0, k * 64 + 60, 512, 4);
        x.strokeStyle = '#5a3414'; x.lineWidth = 14; x.strokeRect(7, 7, 498, 242);
        lines.forEach((l, i) => txt(x, l, 256, lines.length === 1 ? 128 : 84 + i * 92, 460, i === 0 ? 70 : 52, i === 0 ? '#ffffff' : '#fff2a0', '#3a1e08'));
        return cv;
    });
    const face = new T.Mesh(new T.PlaneGeometry(w, h), new T.MeshLambertMaterial({ map }));
    face.position.set(0, 5.4, 0.3); g.add(face);
    const back = new T.Mesh(new T.BoxGeometry(w + 0.3, h + 0.3, 0.45), mat(0x8a5a2a)); back.position.set(0, 5.4, 0); g.add(back); bakeMesh(bake ?? zone, back, true);
}

// =====================================================================================
// The lobby: the tower's ground floor (mint studs), the white path and the red arrows out to the
// terrace, the gear pads, the chest, the boards, the VIP room, the Ghost Slap cage, the Fire Punch
// stand, and the terrace outside with the glove stands, the troll pad and the start of the climb
// =====================================================================================
const boardCanvases = {};
export const chestState = { lid: null, ready: true, label: null, labelKey: '', left: '' };
export const vipState = { door: null, open: false, label: null, labelKey: '', chestReady: false, chestLabel: null, chestKey: '' };
export const cageState = { gate: null, label: null, labelKey: '', open: false };
export const fireState = { label: null, labelKey: '' };
// Big red floor arrows: one mesh per zone; they pulse one after another (in their vertex colours)
const arrowSets = new Map();
function floorArrow(zone, x, y, z, rot, size) {
    const g = new T.PlaneGeometry(size || 9, size || 9);
    // (well clear of the path under it: no flicker where they meet)
    g.rotateZ(rot); g.rotateX(-Math.PI / 2); g.translate(x, y + 0.24, z);
    if (!arrowSets.has(zone)) arrowSets.set(zone, []);
    arrowSets.get(zone).push(g);
}
let arrowMat = null;
function buildArrows() {
    arrowMat = arrowMat || new T.MeshBasicMaterial({ map: arrowTex(), transparent: true, depthWrite: false, toneMapped: false, vertexColors: true, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4 });
    for (const [zone, list] of arrowSets) {
        const geo = mergeGeometries(list.map((g) => painted(g, 0xffffff)));
        const m = new T.Mesh(geo, arrowMat); m.renderOrder = 1; zoneGroup(zone).add(m);
        const col = geo.attributes.color, per = list[0].attributes.position.count;
        tickers.push((dt, t) => {
            if (!m.parent.visible) return;
            for (let i = 0; i < list.length; i++) {
                const k = 0.72 + (0.5 + 0.5 * Math.sin(t * 4 - i * 0.9)) * 0.5;
                for (let v = 0; v < per; v++) col.setXYZ(i * per + v, k, k, k);
            }
            col.needsUpdate = true;
        });
    }
}
// the white path with green borders (like the reference), a solid strip you walk on
function whitePath(Z, x0, x1, z0, z1) {
    studBox(Z, x1 - x0, 0.14, z1 - z0, (x0 + x1) / 2, 0.07, (z0 + z1) / 2, C.white, { mat: 'floor' });
    for (const [sx, sz, x, z] of [[x1 - x0 + 1.2, 0.6, (x0 + x1) / 2, z0 - 0.3], [x1 - x0 + 1.2, 0.6, (x0 + x1) / 2, z1 + 0.3], [0.6, z1 - z0, x0 - 0.3, (z0 + z1) / 2], [0.6, z1 - z0, x1 + 0.3, (z0 + z1) / 2]]) {
        addBoxFast(Z, studVCMaterial(), false, sx, 0.2, sz, x, 0.1, z, 8, C.dmint);
    }
}
function buildLobby() {
    const Z = -1;
    whitePath(Z, -5, 5, -A, 30);
    // the spawn: a white pad with a big star (the reference)
    const starShape = (R, r) => { const s = new T.Shape(); for (let k = 0; k < 10; k++) { const a = Math.PI / 2 + k * Math.PI / 5, q = k % 2 ? r : R; if (k) s.lineTo(Math.cos(a) * q, Math.sin(a) * q); else s.moveTo(Math.cos(a) * q, Math.sin(a) * q); } s.closePath(); return s; };
    const decal = (color, k) => new T.MeshBasicMaterial({ color, toneMapped: false, polygonOffset: true, polygonOffsetFactor: -2 * k, polygonOffsetUnits: -4 * k });
    const star2 = new T.Mesh(new T.ShapeGeometry(starShape(7, 3)), decal(0x1a1a24, 1));
    star2.rotation.x = -Math.PI / 2; star2.position.set(SPAWN.x, 0.2, SPAWN.z); zoneGroup(Z).add(star2);
    const star = new T.Mesh(new T.ShapeGeometry(starShape(5.9, 2.4)), decal(0xffffff, 2));
    star.rotation.x = -Math.PI / 2; star.position.set(SPAWN.x, 0.24, SPAWN.z); zoneGroup(Z).add(star);
    // big red arrows out to the terrace and along to the start, pulsing one after another
    [[0, 0], [0, -16], [0, -32], [0, -48]].forEach(([x, z]) => floorArrow(Z, x, 0, z, arrowRot(0, -1)));
    [[-12, -61], [-26, -61], [-40, -61], [-54, -61]].forEach(([x, z]) => floorArrow(Z, x, 0, z, arrowRot(-1, 0), 7));
    trollSignAt(Z, 9, 0, -46, Math.PI, ['THE CLIMB', 'IS OUTSIDE! ⬇']);
    bigTitle(Z, 'FOLLOW THE ARROWS!', 26, new V3(0, 28, -IN + 0.5), new V3(0, 28, 0), ['#ffffff', '#c8ffe8'], '#0a4a2a');
    // the troll face mural and the title over the gear pads (north wall)
    const mural = new T.Mesh(new T.PlaneGeometry(12, 12), new T.MeshBasicMaterial({ map: trollFaceTex(), transparent: true, toneMapped: false }));
    mural.position.set(-40, 17, IN - 0.1); mural.rotation.y = Math.PI; zoneGroup(Z).add(mural);
    bigTitle(Z, 'TROLL EASY TOWER', 36, new V3(0, 25, IN - 0.15), new V3(0, 25, 0), ['#fff6a0', '#ffc828', '#ff8a1a'], '#3a1a00');
    // the troll face on the ceiling looks down at you
    const face = new T.Mesh(new T.PlaneGeometry(16, 16), new T.MeshBasicMaterial({ map: trollFaceTex(), transparent: true, toneMapped: false, depthWrite: false }));
    face.rotation.x = Math.PI / 2; face.position.set(0, LOBBY_H - 2.6, 0); zoneGroup(Z).add(face);
    // the codes board on the north wall
    board(Z, (x, W, H) => {
        const g = x.createLinearGradient(0, 0, 0, H); g.addColorStop(0, '#3ad890'); g.addColorStop(1, '#1a8a5a');
        x.fillStyle = g; x.fillRect(0, 0, W, H);
        txt(x, '🎟️ FREE CODES', W / 2, H * 0.2, W * 0.9, H * 0.2, '#fff6a0', '#0a3a1a');
        txt(x, 'TROLL · SLAP · EASY', W / 2, H * 0.5, W * 0.9, H * 0.16, '#ffffff', '#0a3a1a');
        txt(x, 'Redeem in ⚙️ Settings', W / 2, H * 0.78, W * 0.86, H * 0.12, '#c8ffe8', '#0a3a1a', 700);
    }, 'codes', 12, 6.5, new V3(-44, 4.8, IN - 0.5), new V3(-44, 4.8, 0), { frame: C.white });
    buildGearPads();
    buildChest();
    buildBoards();
    buildVip();
    buildCage();
    buildFireStand();
    buildTrollPad();
    buildTerrace();
}
function trollSignAt(zone, x, y, z, yaw, lines) { trollSign(zone, { x, y, z, yaw, lines }); }

// ----- GAMEPASS: the gear on pads along the north wall -----
const gearPads = [];
function gearPad(id, x, y, z, zone, scale, padColor) {
    const def = gearById[id] || gloveById[id];
    const pc = padColor ?? def.color;
    const grp = new T.Group(); grp.position.set(x, y, z); zoneGroup(zone).add(grp);
    const ped = new T.Mesh(new T.CylinderGeometry(3.2, 3.2, 0.3, 40), mat(pc, { emissive: pc, ei: 0.25 }));
    ped.position.y = 0.15; grp.add(ped); bakeMesh(zone, ped, false);
    const glow = new T.Sprite(new T.SpriteMaterial({ map: softTex(), color: def.color, transparent: true, opacity: 0.4, depthWrite: false, blending: T.AdditiveBlending }));
    glow.scale.set(8, 8, 1); glow.position.y = 3.6; grp.add(glow);
    const model = anim(gearModel(id)); model.position.y = 3.8; model.scale.multiplyScalar(scale || 1); grp.add(model);
    model.traverse((o) => { o.castShadow = false; });
    const pass = passForTool(id);
    const label = propLabel(billboard(padLines(def, false, false, pass), 6.5, 512, new V3(0, 8.2, 0), grp), x, z, 6);
    const pad = { id, grp, model, label, owned: null, zone, x, y, z, pass };
    gearPads.push(pad);
    triggers.push({ min: new V3(x - 2.6, y, z - 2.6), max: new V3(x + 2.6, y + 5, z + 2.6), zone, enter: () => actions.toolPad(id) });
    prompts.push({ pos: new V3(x, y, z), r: 5, zone, label: () => (S.gear[id] ? (S.tool === id ? 'Put away ' : 'Equip ') + def.name : 'Buy ' + def.name), act: () => actions.toolPad(id, true) });
    tickers.push((dt, t) => {
        if (!grp.parent.visible) return;
        model.rotation.y = t * 1.2 + x;
        model.position.y = 3.8 + Math.sin(t * 2 + z) * 0.35;
    });
}
const padLines = (def, owned, on, pass) => [
    { t: def.name, c: '#ffffff', s: '#1a1a3a', px: 56 },
    owned ? { t: on ? '✔ EQUIPPED' : '✔ OWNED', c: '#9aff7a', s: '#1a3a1a', px: 46 } : { t: '🏆 ' + fmt(PASSES[pass] ? PASSES[pass].price : 0), c: '#9aff7a', s: '#1a3a1a', px: 46 },
];
export function refreshGearPads() {
    for (const p of gearPads) {
        const owned = !!S.gear[p.id], on = S.tool === p.id;
        const key = owned + '|' + on;
        if (p.owned === key) continue;
        p.owned = key;
        p.label.userData.set(padLines(gearById[p.id] || gloveById[p.id], owned, on, p.pass));
    }
    for (const s of gloveStands) {
        const owned = !!S.gear[s.id], on = S.tool === s.id;
        const key = owned + '|' + on + '|' + (s.id === 'fire' ? fireUnlocked() : 0);
        if (s.owned === key) continue;
        s.owned = key;
        s.label.userData.set(standLines(gloveById[s.id], owned, on));
    }
}
function buildGearPads() {
    const pads = [0xffd028, 0x2ad8ff, 0xff3a4a, 0x3a8aff, 0x9aa0b0];
    GEAR_PADS.forEach((g, i) => gearPad(g.id, g.x, 0.15, g.z, -1, 1, pads[i]));
    prompts.push({ pos: new V3(23, 1, 44), r: 6, zone: -1, label: () => '🛒 Open the Shop', act: () => actions.openStore() });
}

// ----- the rainbow chest (free Wins every few minutes) -----
function chestModel(gold) {
    const g = new T.Group();
    const wood = mat(gold ? 0xffc828 : 0xff4a6a), band = mat(gold ? 0xffffff : 0xffd028), dark = mat(0x4a240c);
    const body = new T.Mesh(new T.BoxGeometry(6, 3.2, 4), wood); body.position.y = 1.6; body.castShadow = true; g.add(body);
    if (!gold) {
        // rainbow stripes like the reference's chest
        RAINBOW_C.slice(0, 6).forEach((c, i) => { const s = new T.Mesh(new T.BoxGeometry(1.0, 3.25, 4.05), mat(c)); s.position.set(-2.5 + i * 1.0, 1.6, 0); g.add(s); });
    }
    for (const sx of [-2.6, 2.6]) { const b = new T.Mesh(new T.BoxGeometry(0.4, 3.3, 4.1), band); b.position.set(sx, 1.6, 0); g.add(b); }
    const lid = new T.Group(); lid.position.set(0, 3.2, -2); g.add(lid);
    const lidBox = new T.Mesh(new T.CylinderGeometry(2, 2, 6, 16, 1, false, 0, Math.PI), wood); lidBox.rotation.z = Math.PI / 2; lidBox.position.set(0, 0, 2); lidBox.castShadow = true; lid.add(lidBox);
    for (const sx of [-2.6, 2.6]) { const b = new T.Mesh(new T.CylinderGeometry(2.05, 2.05, 0.4, 16, 1, false, 0, Math.PI), band); b.rotation.z = Math.PI / 2; b.position.set(sx, 0, 2); lid.add(b); }
    const lock = new T.Mesh(new T.BoxGeometry(1, 1.2, 0.4), band); lock.position.set(0, 2.6, 2.1); g.add(lock);
    const hole = new T.Mesh(new T.BoxGeometry(0.25, 0.5, 0.1), dark); hole.position.set(0, 2.5, 2.33); g.add(hole);
    const gm = new T.Mesh(new T.CylinderGeometry(2.6, 2.8, 0.6, 16), goldMaterial()); gm.scale.z = 0.7; gm.position.y = 3.0; g.add(gm);
    const glow = new T.Sprite(new T.SpriteMaterial({ map: softTex(), color: 0xffd028, transparent: true, opacity: 0.55, depthWrite: false, blending: T.AdditiveBlending }));
    glow.scale.set(9, 9, 1); glow.position.y = 4; g.add(glow);
    lid.traverse((o) => { if (o.isMesh) { o.userData.keep = true; o.receiveShadow = true; } });
    mergeChildren(g);
    return { g, lid, glow };
}
function buildChest() {
    const Z = -1, x = CHEST.x, z = CHEST.z;
    roundStud(Z, 11, 0.8, 9, x, 0.4, z, C.white, { r: 0.3, cast: false });
    const { g, lid, glow } = chestModel(false);
    g.position.set(x, 0.8, z); g.rotation.y = -Math.PI / 2 - 0.3; zoneGroup(Z).add(g);
    chestState.lid = anim(lid); anim(g);
    chestState.label = propLabel(billboard(chestLines(true), 10, 512, new V3(x, 10, z), zoneGroup(Z)), x, z, 7);
    solidBox(x, 2.5, z, 5, 5, 6.5, { zone: Z, mat: 'wood' });
    triggers.push({ min: new V3(x - 5, 0, z - 5.5), max: new V3(x + 5, 6, z + 5.5), zone: Z, enter: () => actions.chest() });
    prompts.push({ pos: new V3(x - 3, 1, z), r: 6.5, zone: Z, label: () => (chestState.ready ? '💰 Open the chest' : 'Chest refills in ' + chestState.left), act: () => actions.chest() });
    tickers.push((dt, t) => {
        if (!g.parent.visible) return;
        const open = chestState.ready ? 0.35 + Math.sin(t * 2.4) * 0.12 : 0;
        lid.rotation.x += (-open - lid.rotation.x) * Math.min(1, dt * 6);
        glow.material.opacity = chestState.ready ? 0.45 + Math.sin(t * 3) * 0.15 : 0;
    });
}
const chestLines = (ready, left) => [
    { t: '🌈 RAINBOW CHEST', g: ['#fff6a0', '#ffc828'], s: '#5a2a00', px: 52 },
    ready ? { t: 'FREE ' + CFG.chestWins + ' Wins! Step on it!', c: '#9aff7a', s: '#0a3a0a', px: 36 } : { t: 'Refills in ' + left, c: '#ffffff', s: '#1a1a3a', px: 36 },
];
// Countdowns on the lobby's labels: in minutes until the last minute and a half (each change redraws
// a label's canvas), and only while the lobby is drawn
const soon = (secs) => (secs > 90 ? Math.ceil(secs / 60) + ' min' : clock(secs));
export function updateChest(now) {
    const near = zoneGroup(-1).visible;
    const leftMs = CFG.chestMinutes * 60000 - (now - (S.bonusAt || 0));
    chestState.ready = leftMs <= 0;
    chestState.left = clock(leftMs / 1000);
    const key = chestState.ready ? 'ready' : Math.ceil(leftMs / 60000) + ' min';
    if (near && chestState.label && key !== chestState.labelKey) { chestState.labelKey = key; chestState.label.userData.set(chestLines(chestState.ready, key)); }
    // the VIP room: its door opens after enough playtime; its golden chest refills
    const playLeft = CFG.vipMinutes * 60 - (S.playtime || 0) - (Date.now() - S.profileAt) / 1000;
    vipState.open = playLeft <= 0;
    const vk = vipState.open ? 'open' : soon(playLeft);
    if (near && vipState.label && vk !== vipState.labelKey) {
        vipState.labelKey = vk;
        vipState.label.userData.set([{ t: '👑 TELEPORT VIP', g: ['#fff6a0', '#ffc828'], s: '#3a2000', px: 52 }, vipState.open ? { t: 'OPEN! Come on in', c: '#9aff7a', s: '#0a3a0a', px: 40 } : { t: 'Unlocks in ' + vk + ' of play', c: '#ffffff', s: '#1a1a3a', px: 38 }]);
    }
    if (vipState.door) { const want = vipState.open ? 1 : 0; vipState.door.userData.k += (want - vipState.door.userData.k) * 0.08; vipState.door.position.y = 6 + vipState.door.userData.k * 11.5; vipState.solid.off = vipState.open; }
    const vipLeft = CFG.vipChestMinutes * 60000 - (now - (S.vipAt || 0));
    vipState.chestReady = vipLeft <= 0;
    const ck = vipState.chestReady ? 'ready' : Math.ceil(vipLeft / 60000) + ' min';
    if (near && vipState.chestLabel && ck !== vipState.chestKey) { vipState.chestKey = ck; vipState.chestLabel.userData.set([{ t: '👑 VIP CHEST', g: ['#fff6a0', '#ffc828'], s: '#3a2000', px: 52 }, vipState.chestReady ? { t: '+' + CFG.vipWins + ' Wins! Step on it!', c: '#9aff7a', s: '#0a3a0a', px: 38 } : { t: 'Refills in ' + ck, c: '#ffffff', s: '#1a1a3a', px: 38 }]); }
    // the Ghost Slap cage: the gate opens for a little while every few minutes
    const gate = ghostGate(now);
    cageState.open = gate.open;
    const gk = (gate.open ? 'o' : 'c') + soon(gate.left) + (S.gear.ghost ? 'own' : '');
    if (near && cageState.label && gk !== cageState.labelKey) {
        cageState.labelKey = gk;
        cageState.label.userData.set([{ t: '👻 GHOST SLAP', g: ['#ffffff', '#c8b8ff'], s: '#1a0a3a', px: 52 }, S.gear.ghost ? { t: '✔ YOU HAVE IT', c: '#9aff7a', s: '#0a3a0a', px: 38 } : gate.open ? { t: 'GATE OPEN! ' + soon(gate.left) + ' left!', c: '#9aff7a', s: '#0a3a0a', px: 38 } : { t: 'Locked inside! Gate opens in ' + soon(gate.left), c: '#ffffff', s: '#1a1a3a', px: 34 }]);
    }
    if (cageState.gate) { const want = gate.open ? 1 : 0; cageState.gate.userData.k += (want - cageState.gate.userData.k) * 0.1; cageState.gate.position.y = 3.2 + cageState.gate.userData.k * 6.2; cageState.solid.off = gate.open; }
    // the Fire Punch stand: free after enough playtime
    const fireLeft = CFG.fireMinutes * 60 - (S.playtime || 0) - (Date.now() - S.profileAt) / 1000;
    const fk = S.gear.fire ? 'own' : fireLeft <= 0 ? 'free' : soon(fireLeft);
    if (near && fireState.label && fk !== fireState.labelKey) {
        fireState.labelKey = fk;
        fireState.label.userData.set([{ t: '🔥 FIRE PUNCH', g: ['#fff2a0', '#ff8a1a'], s: '#3a0a00', px: 52 }, S.gear.fire ? { t: '✔ UNLOCKED', c: '#9aff7a', s: '#0a3a0a', px: 38 } : fireLeft <= 0 ? { t: 'FREE! Step on the pad', c: '#9aff7a', s: '#0a3a0a', px: 38 } : { t: 'Unlocks in ' + fk + ' of play', c: '#ffffff', s: '#1a1a3a', px: 36 }]);
    }
}
const fireUnlocked = () => CFG.fireMinutes * 60 - (S.playtime || 0) - (Date.now() - S.profileAt) / 1000 <= 0;

// ----- the leaderboards on the east wall: Top Winners and Top Slappers -----
const LEADERS = [['climbs', 'Top Winners', -12, '🏆'], ['slaps', 'Top Slappers', 7, '🖐️']];
function buildBoards() {
    const Z = -1, x = IN - 1;
    for (const [key, title, z] of LEADERS) {
        const frame = new T.Mesh(new RoundedBoxGeometry(1.4, 22, 17, 3, 0.7), mat(0xffd028)); frame.position.set(x, 13, z);
        zoneGroup(Z).add(frame); bakeMesh(Z, frame, true);
        const cv = document.createElement('canvas'); cv.width = 512; cv.height = 640;
        const tex = texFrom(cv);
        const sc = new T.Mesh(new T.PlaneGeometry(15.4, 19.25), new T.MeshBasicMaterial({ map: tex, toneMapped: false }));
        sc.position.set(x - 0.8, 13, z); sc.rotation.y = -Math.PI / 2;
        zoneGroup(Z).add(sc);
        solidBox(x, 12, z, 1.4, 24, 17, { zone: Z, mat: 'stud' });
        boardCanvases[key] = { cv, tex, title };
        drawBoard(key, []);
    }
}
function drawBoard(key, rows) {
    const b = boardCanvases[key];
    if (!b) return;
    const x = b.cv.getContext('2d'), W = 512;
    x.fillStyle = '#16183a'; x.fillRect(0, 0, W, 640);
    const g = x.createLinearGradient(0, 0, 0, 80); g.addColorStop(0, '#ffe24a'); g.addColorStop(1, '#ffb81c');
    x.fillStyle = g; x.fillRect(0, 0, W, 80);
    x.textAlign = 'center'; x.textBaseline = 'middle';
    const tpx = fitFont(x, b.title, W - 48, 46, 700, 'Fredoka, sans-serif', 0.18);
    x.lineWidth = tpx * 0.16; x.strokeStyle = '#5a3a00'; x.lineJoin = 'round'; x.strokeText(b.title, W / 2, 42); x.fillStyle = '#ffffff'; x.fillText(b.title, W / 2, 42);
    x.font = '700 22px Fredoka, sans-serif'; x.fillStyle = '#9aa6ff'; x.textAlign = 'left'; x.fillText('#', 28, 102); x.fillText('Player', 96, 102); x.textAlign = 'right'; x.fillText(key === 'slaps' ? 'Slaps' : 'Wins', W - 30, 102);
    for (let i = 0; i < 10; i++) {
        const y = 140 + i * 49, r = rows[i];
        x.fillStyle = i % 2 ? '#20234a' : '#2a2e5a'; x.fillRect(16, y - 22, W - 32, 44);
        x.textAlign = 'left'; x.font = '700 28px Fredoka, sans-serif';
        x.fillStyle = i === 0 ? '#ffd028' : i === 1 ? '#c8d0e0' : i === 2 ? '#e8905a' : '#8a94c8';
        x.fillText(String(i + 1), 28, y);
        if (!r) continue;
        x.fillStyle = '#ffffff'; x.font = '600 26px Fredoka, sans-serif';
        let n = r.n; while (x.measureText(n).width > 250 && n.length > 3) n = n.slice(0, -1);
        x.fillText(n, 96, y);
        x.textAlign = 'right'; x.fillStyle = '#7dff9a';
        x.fillText(fmt(r.v), W - 30, y);
    }
    b.tex.needsUpdate = true;
}
const boardKeys = {};
export function renderBoards(m) {
    for (const [key] of LEADERS) {
        const rows = (m && m[key]) || [], k = JSON.stringify(rows);
        if (boardKeys[key] === k) continue;
        boardKeys[key] = k;
        drawBoard(key, rows);
    }
}

// ----- the VIP room (north-east corner): its door opens after some playtime -----
function buildVip() {
    const Z = -1, { x0, x1, z0, z1 } = VIP, H = 14, d = VIP.door, dc = (d.x0 + d.x1) / 2;
    // walls: west (x0), south (z0, with the door)
    studBox(Z, 1.2, H, z1 - z0, x0, H / 2, (z0 + z1) / 2, C.dmint);
    studBox(Z, d.x0 - x0, H, 1.2, (x0 + d.x0) / 2, H / 2, z0, C.dmint);
    studBox(Z, x1 - d.x1, H, 1.2, (d.x1 + x1) / 2, H / 2, z0, C.dmint);
    studBox(Z, d.x1 - d.x0, H - 12, 1.2, dc, 12 + (H - 12) / 2, z0, C.dmint);
    // the golden door slides up when it opens
    const door = new T.Mesh(new T.BoxGeometry(d.x1 - d.x0, 12, 0.8), mat(0xffc828, { emissive: 0xffa800, ei: 0.25 }));
    door.position.set(dc, 6, z0); door.userData.k = 0; zoneGroup(Z).add(anim(door));
    vipState.door = door;
    vipState.solid = solidBox(dc, 6, z0, d.x1 - d.x0, 12, 1.2, { zone: Z, mat: 'stud' });
    vipState.label = propLabel(billboard([{ t: '👑 TELEPORT VIP', c: '#ffd028', s: '#3a2000', px: 52 }], 10, 512, new V3(dc, 15.5, z0 - 1.5), zoneGroup(Z)), dc, z0 - 3, 4);
    // a gold carpet and the golden chest inside
    addBoxFast(Z, studVCMaterial(), false, x1 - x0 - 2, 0.12, z1 - z0 - 2, (x0 + x1) / 2, 0.06, (z0 + z1) / 2, 8, 0xffd028);
    const { g, lid, glow } = chestModel(true);
    const c = VIP.chest;
    g.position.set(c.x, 0, c.z); g.rotation.y = Math.PI + 0.4; zoneGroup(Z).add(anim(g));
    solidBox(c.x, 2.5, c.z, 6, 5, 6, { zone: Z, mat: 'wood' });
    vipState.chestLabel = propLabel(billboard([{ t: '👑 VIP CHEST', c: '#ffd028', s: '#3a2000', px: 52 }], 9, 512, new V3(c.x, 9.5, c.z), zoneGroup(Z)), c.x, c.z, 6);
    triggers.push({ min: new V3(c.x - 5, 0, c.z - 5), max: new V3(c.x + 5, 6, c.z + 5), zone: Z, enter: () => actions.vipChest() });
    tickers.push((dt, t) => { if (!g.parent.visible) return; lid.rotation.x = vipState.chestReady ? -0.35 - Math.sin(t * 2.4) * 0.12 : 0; glow.material.opacity = vipState.chestReady ? 0.5 + Math.sin(t * 3) * 0.15 : 0.05; });
    bigTitle(Z, 'VIP', 7, new V3((x0 + d.x0) / 2, 8.5, z0 - 0.7), new V3((x0 + d.x0) / 2, 8.5, z0 - 40), ['#fff6a0', '#ffc828'], '#3a2000');
}

// ----- the Ghost Slap cage: grey bars round the glove, a gate that opens every few minutes -----
function buildCage() {
    const Z = -1, { x, z } = CAGE, R = 4;
    roundStud(Z, 10, 0.8, 10, x, 0.4, z, 0x6a6e7a, { r: 0.3, cast: false });
    const bars = new T.Group(); bars.position.set(x, 0.8, z); zoneGroup(Z).add(bars);
    for (let k = -3; k <= 3; k++) for (const side of [0, 1, 2]) {
        const b = new T.Mesh(new T.CylinderGeometry(0.16, 0.16, 7, 8), mat(0x4a4e5a));
        const t = k * 1.2;
        if (side === 0) b.position.set(t, 3.5, R); else if (side === 1) b.position.set(-R, 3.5, t); else b.position.set(R, 3.5, t);
        bars.add(b);
    }
    const roof = new T.Mesh(new T.BoxGeometry(R * 2 + 0.6, 0.6, R * 2 + 0.6), mat(0x4a4e5a)); roof.position.y = 7.2; bars.add(roof);
    mergeChildren(bars);
    for (const [sx, sz, dx, dz] of [[R * 2, 1, 0, R], [1, R * 2, -R, 0], [1, R * 2, R, 0]]) solidBox(x + dx, 4.4, z + dz, sx, 7.2, sz, { zone: Z, mat: 'stud' });
    // the gate (south side) slides up while it's open
    const gate = new T.Group(); gate.position.set(x, 3.2, z - R); gate.userData.k = 0; zoneGroup(Z).add(anim(gate));
    for (let k = -3; k <= 3; k++) { const b = new T.Mesh(new T.CylinderGeometry(0.16, 0.16, 6.4, 8), mat(0x6a3aff, { emissive: 0x6a3aff, ei: 0.4 })); b.position.x = k * 1.2; gate.add(b); }
    mergeChildren(gate);
    cageState.gate = gate;
    cageState.solid = solidBox(x, 4.4, z - R, R * 2, 7.2, 1, { zone: Z, mat: 'stud' });
    const glove = anim(gloveMesh('ghost', 1.3)); glove.position.set(x, 2.6, z); zoneGroup(Z).add(glove);
    const glow = new T.Sprite(new T.SpriteMaterial({ map: softTex(), color: 0xb8a8ff, transparent: true, opacity: 0.6, depthWrite: false, blending: T.AdditiveBlending }));
    glow.scale.set(8, 8, 1); glow.position.set(x, 4, z); zoneGroup(Z).add(glow);
    cageState.label = propLabel(billboard([{ t: '👻 GHOST SLAP', c: '#ffffff', s: '#1a0a3a', px: 52 }], 11, 512, new V3(x, 9.8, z), zoneGroup(Z)), x, z, 5);
    triggers.push({ min: new V3(x - R + 1, 0, z - R + 1), max: new V3(x + R - 1, 6, z + R - 1), zone: Z, enter: () => actions.ghostCage() });
    tickers.push((dt, t) => { if (!glove.parent.visible) return; glove.rotation.y = t * 1.3; glove.position.y = 2.6 + Math.sin(t * 2) * 0.4; glow.material.opacity = 0.45 + Math.sin(t * 3) * 0.15; });
}
// ----- the Fire Punch stand: the glove in a glass case, free after playing a while -----
function buildFireStand() {
    const Z = -1, { x, z } = FIRE_STAND;
    roundStud(Z, 8, 1.6, 8, x, 0.8, z, 0x3a2a2a, { r: 0.4 });
    const glove = anim(gloveMesh('fire', 1.3)); glove.position.set(x, 2.4, z); zoneGroup(Z).add(glove);
    const glass = new T.Mesh(new T.CylinderGeometry(3, 3, 6.5, 24, 1, true), glassMaterial()); glass.position.set(x, 4.85, z); zoneGroup(Z).add(glass);
    const glow = new T.Sprite(new T.SpriteMaterial({ map: softTex(), color: 0xff7a1a, transparent: true, opacity: 0.6, depthWrite: false, blending: T.AdditiveBlending }));
    glow.scale.set(9, 9, 1); glow.position.set(x, 4.2, z); zoneGroup(Z).add(glow);
    fireState.label = propLabel(billboard([{ t: '🔥 FIRE PUNCH', c: '#ffb04a', s: '#3a0a00', px: 52 }], 11, 512, new V3(x, 9.8, z), zoneGroup(Z)), x, z, 5);
    solidBox(x, 4, z, 6, 8, 6, { zone: Z, mat: 'glass' });
    triggers.push({ min: new V3(x - 5, 0, z - 5), max: new V3(x + 5, 6, z + 5), zone: Z, enter: () => actions.fireStand() });
    prompts.push({ pos: new V3(x, 1, z - 4), r: 6, zone: Z, label: () => (S.gear.fire ? (S.tool === 'fire' ? 'Put away Fire Punch' : 'Equip Fire Punch') : fireUnlocked() ? '🔥 Take the Fire Punch (free!)' : '🔥 Buy Fire Punch now'), act: () => actions.fireStand(true) });
    tickers.push((dt, t) => { if (!glove.parent.visible) return; glove.rotation.y = -t * 1.1; glove.position.y = 2.6 + Math.sin(t * 2.3) * 0.35; glow.material.opacity = 0.45 + Math.sin(t * 5) * 0.12; });
}
// ----- TROLL: the "FREE SPEED COIL" pad on the terrace (it launches you into the sky) -----
function buildTrollPad() {
    const Z = -1, { x, z } = TROLL_PAD;
    roundStud(Z, 6, 1.2, 6, x, 0.6, z, C.yellow, { r: 0.35, cast: false, mat: 'stud' });
    addBoxFast(Z, studVCMaterial(), false, 6.4, 0.6, 6.4, x, 0.3, z, 8, 0x2a2e3a);
    const coil = anim(gearModel('speedCoil')); coil.position.set(x, 4.4, z); zoneGroup(Z).add(coil);
    propLabel(billboard([{ t: 'GET SPEED COIL FAST!!!', g: ['#ffffff', '#fff2a0'], s: '#2a1a00', px: 50 }, { t: 'Press E', c: '#ff4a5a', s: '#3a0010', px: 54 }], 11, 512, new V3(x, 9.6, z), zoneGroup(Z), true), x, z, 3);
    prompts.push({ pos: new V3(x, 1, z), r: 5, zone: Z, label: () => 'Get the FREE Speed Coil', act: () => actions.trollPad() });
    tickers.push((dt, t) => { if (!coil.parent.visible) return; coil.rotation.y = t * 2; coil.position.y = 4.4 + Math.sin(t * 3) * 0.3; });
}

// ----- the terrace over the ocean: the slap glove stands, a glass fence, a strolling giant -----
const gloveStands = [];
const standLines = (def, owned, on) => {
    const p = PASSES[passForTool(def.id)];
    const sub = owned ? { t: on ? '✔ EQUIPPED' : '✔ OWNED (equip)', c: '#9aff7a', s: '#0a3a0a', px: 38 }
        : def.id === 'fire' && fireUnlocked() ? { t: 'FREE! Take it', c: '#9aff7a', s: '#0a3a0a', px: 38 }
            : { t: '🏆 ' + fmt(p ? p.price : 0) + ' Wins', c: '#9aff7a', s: '#0a3a0a', px: 40 };
    return [{ t: def.name, c: '#ffffff', s: '#1a1a3a', px: 56 }, sub];
};
function buildTerrace() {
    const Z = -1, T0 = TERRACE, cz = (T0.z0 + T0.z1) / 2;
    // the floor: mint studs with the white paths, on a floating rock
    addBoxFast(Z, studVCMaterial(), false, T0.x1 - T0.x0, 2, T0.z1 - T0.z0, 0, -1, cz, 8, 0x52eeb0);
    solidBox(0, -1, cz, T0.x1 - T0.x0, 2, T0.z1 - T0.z0, { zone: Z, mat: 'floor' });
    addBoxFast(-2, rockMaterial(), false, T0.x1 - T0.x0, 5, T0.z1 - T0.z0, 0, -4.5, cz, 8);
    hangingRocks(-2, T0.x0, T0.x1, T0.z0, T0.z1, 7, 21, 7);
    whitePath(Z, -5, 5, -96, -A);
    whitePath(Z, -64, -5, -64, -58);
    whitePath(Z, -42, 42, -97, -91);
    // the glass fence round the edge (open where the climb starts, in the north-west corner)
    const fence = (x0, z0, x1, z1) => {
        const alongX = Math.abs(x1 - x0) > Math.abs(z1 - z0), len = alongX ? Math.abs(x1 - x0) : Math.abs(z1 - z0), fx = (x0 + x1) / 2, fz = (z0 + z1) / 2;
        const panel = new T.PlaneGeometry(len, 4);
        const pu = panel.attributes.uv; for (let i = 0; i < pu.count; i++) pu.setXY(i, pu.getX(i) * len / 4, pu.getY(i));
        if (!alongX) panel.rotateY(Math.PI / 2);
        panel.translate(fx, 2.4, fz);
        addGeo(Z, panel, latticeMaterial(), false);
        addBoxFast(Z, mat(0xffffff), false, alongX ? len : 0.5, 0.5, alongX ? 0.5 : len, fx, 4.6, fz, 0);
        const posts = Math.max(1, Math.round(len / 10));
        for (let k = 0; k <= posts; k++) { const f = k / posts; addBoxFast(Z, mat(0xffffff), false, 0.6, 4.8, 0.6, x0 + (x1 - x0) * f, 2.4, z0 + (z1 - z0) * f, 0); }
        solidBox(fx, 4, fz, alongX ? len : 1, 8, alongX ? 1 : len, { zone: Z, mat: 'glass' });
    };
    const e = 0.5;
    fence(T0.x0 + e, T0.z0 + e, T0.x1 - e, T0.z0 + e);
    fence(T0.x0 + e, T0.z0 + e, T0.x0 + e, T0.z1 - e);
    fence(T0.x1 - e, T0.z0 + e, T0.x1 - e, T0.z1 - e);
    fence(T0.x0 + e, T0.z1 - e, -72.3, T0.z1 - e);
    fence(-63.7, T0.z1 - e, -A, T0.z1 - e);
    fence(A, T0.z1 - e, T0.x1 - e, T0.z1 - e);
    bigTitle(Z, 'SLAP GLOVES', 30, new V3(0, 19, -110), new V3(0, 19, 0), ['#ffffff', '#ffd8f8', '#ff8ad8'], '#3a0a3a');
    bigTitle(Z, 'Win Wins, unlock new slaps!', 30, new V3(0, 15.2, -110), new V3(0, 15.2, 0), ['#ffffff', '#c8ffe8'], '#0a3a1a');
    trollSignAt(Z, -78, 0, -61, Math.PI / 2, ['STAGE 1 ⬆', 'CLIMB THE TOWER!']);
    // the glove stands
    for (const st of GLOVE_STANDS) {
        const def = gloveById[st.id];
        const { x, z } = st;
        const ring = new T.Mesh(new T.CylinderGeometry(3, 3, 0.25, 36), mat(def.color, { emissive: def.rainbow ? 0xff5ad8 : def.color, ei: 0.45 }));
        ring.position.set(x, 0.12, z); zoneGroup(Z).add(ring); bakeMesh(Z, ring, false);
        const ringIn = new T.Mesh(new T.CylinderGeometry(2.3, 2.3, 0.27, 36), mat(0xffffff)); ringIn.position.set(x, 0.13, z); zoneGroup(Z).add(ringIn); bakeMesh(Z, ringIn, false);
        // the black stand and the giant glove on it
        addGeo(Z, cylGeo(0.35, 0.45, 5.4, x, 2.7, z - 3.4, 10), mat(0x22242c), true);
        addGeo(Z, cylGeo(1.4, 1.6, 0.4, x, 0.2, z - 3.4, 16), mat(0x22242c), true);
        solids.push({ shape: 'cyl', cx: x, cz: z - 3.4, r: 0.6, min: new V3(x - 0.6, 0, z - 4), max: new V3(x + 0.6, 5.4, z - 2.8), zone: Z, mat: 'stud' });
        const g = anim(gloveMesh(st.id, 1.6 * (def.scale ? 1.1 : 1))); g.position.set(x, 5.8, z - 3.4); zoneGroup(Z).add(g);
        const label = propLabel(billboard(standLines(def, false, false), 7.5, 512, new V3(x, 12.4, z - 3.4), zoneGroup(Z)), x, z, 4.5);
        const s = { id: st.id, label, owned: null, g, x, z };
        gloveStands.push(s);
        triggers.push({ min: new V3(x - 2.4, 0, z - 2.4), max: new V3(x + 2.4, 5, z + 2.4), zone: Z, enter: () => actions.toolPad(st.id) });
        prompts.push({ pos: new V3(x, 1, z), r: 4.5, zone: Z, label: () => (S.gear[st.id] ? (S.tool === st.id ? 'Put away ' : 'Equip ') + def.name : 'Get ' + def.name), act: () => actions.toolPad(st.id, true) });
        tickers.push((dt, t) => { if (!g.parent.visible) return; g.rotation.y = Math.sin(t * 0.9 + x) * 0.6; g.position.y = 5.8 + Math.sin(t * 1.8 + x) * 0.3; });
    }
}

// =====================================================================================
// The course
// =====================================================================================
export const movers = [];
export const vanishers = [];
export const timeds = [];
export const spinners = [];
export const sweepers = [];
export const slappers = [];
export const punches = [];
export const lasers = [];
export const bouncers = [];
export const domes = [];
export const dolls = [];
export const giants = [];
export const cpPads = [];
export const coinState = { collected: new Set() };
const killMats = [];
let convT = null;
function killMaterial() {
    if (!killMats.length) killMats.push({ base: new T.Color(0xffffff), m: new T.MeshBasicMaterial({ color: 0xffffff, map: killTex(), toneMapped: false }) });
    return killMats[0].m;
}
// The purple hands of the slap traps (the reference's indigo glove), one material for all
const TRAP_GLOVE = 0x5a3aff;
function trapGlove(scale) {
    const m = new T.Mesh(gloveGeometry(TRAP_GLOVE, { cuff: 0xb8a8ff }), gloveMaterial());
    m.scale.setScalar(scale); m.castShadow = true;
    return m;
}
function buildCourse() {
    for (const e of COURSE) {
        const zone = e.zone, SZ = staticZone(zone);
        switch (e.t) {
            case 'block': {
                if (e.ice && e.color === 'ice') {
                    const g = roundGeo(e.sx, e.sy, e.sz, 0.35); g.translate(e.x, e.y, e.z);
                    addGeo(SZ, worldUV(g, 6), iceMaterial(), true);
                    solidBox(e.x, e.y, e.z, e.sx, e.sy, e.sz, { zone, mat: 'ice', ice: true });
                } else roundStud(SZ, e.sx, e.sy, e.sz, e.x, e.y, e.z, colorOf(e.color, zone), { r: 0.35, solidZone: zone, mat: e.mat || 'stud', shade: SHADE, extra: e.ice ? { ice: true } : undefined });
                break;
            }
            case 'fake': {
                // looks exactly like the real thing; falling through it trolls you
                if (e.key) buildKey(e, SZ, false);
                else { const g = roundGeo(e.sx, e.sy, e.sz, 0.35); g.translate(e.x, e.y, e.z); addGeo(SZ, worldUV(g, 8), studVCMaterial(), true, colorOf(e.color, zone), SHADE); }
                triggers.push({ min: new V3(e.x - e.sx / 2, e.y - e.sy / 2 - 1, e.z - e.sz / 2), max: new V3(e.x + e.sx / 2, e.y + e.sy / 2 + 0.6, e.z + e.sz / 2), zone, enter: () => actions.trolled('fake') });
                break;
            }
            case 'key': buildKey(e, SZ, true); break;
            case 'ghost': {
                plainBox(SZ, e.sx, e.sy, e.sz, e.x, e.y, e.z, ghostMaterial());
                solidBox(e.x, e.y, e.z, e.sx, e.sy, e.sz, { zone, mat: 'glass', ghost: true });
                break;
            }
            case 'vanish': buildVanish(e); break;
            case 'timed': buildTimed(e); break;
            case 'kill': {
                addBoxFast(SZ, killMaterial(), false, e.sx, e.sy, e.sz, e.x, e.y, e.z, 2);
                solidBox(e.x, e.y, e.z, e.sx, e.sy, e.sz, { zone, mat: 'stud', kill: true });
                triggers.push({ min: new V3(e.x - e.sx / 2 - 0.1, e.y - e.sy / 2, e.z - e.sz / 2 - 0.1), max: new V3(e.x + e.sx / 2 + 0.1, e.y + e.sy / 2 + 0.2, e.z + e.sz / 2 + 0.1), zone, enter: () => actions.killBrick() });
                break;
            }
            case 'truss': {
                addBoxFast(SZ, trussMaterial(), true, e.sx, e.sy, e.sz, e.x, e.y, e.z, 4);
                solidBox(e.x, e.y, e.z, e.sx, e.sy, e.sz, { zone, mat: 'truss', climb: true });
                break;
            }
            case 'mover': buildMover(e); break;
            case 'conveyor': {
                // the chevrons point the way the belt carries you (u runs along the push)
                const alongPx = Math.abs(e.px) > Math.abs(e.pz), sgn = Math.sign(alongPx ? e.px : e.pz);
                const wid = alongPx ? e.sz : e.sx;
                addBoxFast(SZ, conveyorMaterial(), true, e.sx, e.sy, e.sz, e.x, e.y, e.z, 0, undefined, false, (f, ix, iy) => {
                    if (f !== 2) return [ix * 0.25, iy * 0.25];
                    // top face: corners in world space -> (along, across) in tiles of 4 studs
                    const wx = (ix - 0.5) * e.sx, wz = ((1 - iy) - 0.5) * e.sz;
                    const along = (alongPx ? wx : -wz) * sgn, across = alongPx ? wz : wx;
                    return [along / 4, across / 4 + 0.5];
                });
                for (const s of [-1, 1]) addBoxFast(SZ, studVCMaterial(), true, alongPx ? e.sx + 0.4 : 0.5, e.sy + 0.3, alongPx ? 0.5 : e.sz + 0.4, e.x + (alongPx ? 0 : s * (wid / 2 + 0.25)), e.y + 0.05, e.z + (alongPx ? s * (wid / 2 + 0.25) : 0), 8, 0xffd028);
                solidBox(e.x, e.y, e.z, e.sx, e.sy, e.sz, { zone, mat: 'stud', conv: { x: e.px * spd(zone), z: e.pz * spd(zone) } });
                convT = conveyorTex();
                break;
            }
            case 'bounce': buildBounce(e); break;
            case 'dome': buildDome(e); break;
            case 'spinner': buildSpinner(e); break;
            case 'sweeper': buildSweeper(e); break;
            case 'slapper': buildSlapper(e); break;
            case 'punch': buildPunch(e); break;
            case 'laser': buildLaser(e); break;
            case 'sign': trollSign(zone, e, SZ); break;
            case 'banana': {
                const g = new T.TorusGeometry(0.85, 0.3, 6, 12, Math.PI * 0.95); g.rotateX(Math.PI / 2); g.rotateY(e.yaw); g.translate(e.x, e.y + 0.3, e.z);
                addGeo(SZ, g, smoothVC(), true, 0xffd23a);
                break;
            }
            case 'plank': buildPlank(e); break;
            case 'island': buildIsland(e); break;
            case 'land': buildLanding(e); break;
            case 'cp': buildCheckpoint(e); break;
            case 'skipPad': buildSkipPad(e); break;
            case 'bait': buildBait(e); break;
            case 'trollPit': buildTrollPit(e); break;
            case 'rainbow': {
                const c = RAINBOW_C[e.k % RAINBOW_C.length];
                addBoxFast(-2, rainbowTileMat(), true, e.s, 0.8, e.s, e.x, e.y - 0.4, e.z, 0, c);
                addBoxFast(-2, studVCMaterial(), true, e.s + 0.5, 0.4, e.s + 0.5, e.x, e.y - 1, e.z, 8, 0xffffff);
                solidBox(e.x, e.y - 0.6, e.z, e.s, 1.2, e.s, { zone, mat: 'neon' });
                break;
            }
            default: break;
        }
    }
    buildCoins();
    buildBeams();
    for (const d of DOLLS) buildDoll(d);
    for (const g of GIANTS) buildGiant(g);
}
let rainbowTileM = null;
const rainbowTileMat = () => rainbowTileM || (rainbowTileM = new T.MeshBasicMaterial({ vertexColors: true, toneMapped: false }));

// keyboard keys: a mint keycap with its letter (from one atlas) on top
function buildKey(e, vz, solid) {
    const cell = keyCell(e.letter), cu = (cell % 8) / 8, cv = 1 - (Math.floor(cell / 8) + 1) / 8;
    // the letter's top points the way you walk (dx, dz); its right is (-dz, dx)
    const dx = e.dx ?? 0, dz = e.dz ?? 1, rx = -dz, rz = dx;
    const w = Math.abs(rx) * e.sx + Math.abs(rz) * e.sz, h = Math.abs(dx) * e.sx + Math.abs(dz) * e.sz;
    addBoxFast(vz, keyMaterial(), true, e.sx, e.sy, e.sz, e.x, e.y, e.z, 0, undefined, false, (f, ix, iy) => {
        if (f !== 2) return [cu + 0.02 / 8, cv + 0.02 / 8];
        const lx = (ix - 0.5) * e.sx, lz = (iy - 0.5) * e.sz;
        const lu = (lx * rx + lz * rz) / w + 0.5, lv = (lx * dx + lz * dz) / h + 0.5;
        return [cu + (0.06 + lu * 0.88) / 8, cv + (0.06 + lv * 0.88) / 8];
    });
    addBoxFast(vz, studVCMaterial(), true, e.sx + 0.5, 0.6, e.sz + 0.5, e.x, e.y - e.sy / 2 - 0.3, e.z, 8, 0x1e8a5a);
    if (solid) solidBox(e.x, e.y, e.z, e.sx, e.sy, e.sz, { zone: e.zone, mat: 'key' });
}
// Corner landings: a thick studded slab in the band's light colour, a glowing trim, a floating rock
// under it
function buildLanding(e) {
    const SZ = staticZone(e.zone), band = BANDS[bandOf(e.kind === 'roof' ? N - 1 : e.i)];
    const color = e.kind === 'roof' ? 0xffffff : e.kind === 'band' || e.kind === 'lap' ? band.trim : band.light;
    roundStud(SZ, e.sx, 2.4, e.sz, e.x, e.top - 1.2, e.z, color, { r: 0.5, solidZone: e.zone, shade: [0.62, 1], extra: { landing: true } });
    const nm = neon(band.trim, 1.2), hx = e.sx / 2, hz = e.sz / 2;
    for (const [dx, dz, sx, sz] of [[0, -hz, e.sx + 0.3, 0.3], [0, hz, e.sx + 0.3, 0.3], [-hx, 0, 0.3, e.sz], [hx, 0, 0.3, e.sz]]) plainBox(SZ, sx, 0.3, sz, e.x + dx, e.top - 0.25, e.z + dz, nm);
    const g = new T.ConeGeometry(Math.min(e.sx, e.sz) * 0.42, 11, 7); g.rotateX(Math.PI); g.translate(e.x, e.top - 2.4 - 5.5, e.z);
    addGeo(SZ, worldUV(g, 8), rockMaterial(), false);
    if (e.kind !== 'roof' && e.i < N) stageArch(e, band, SZ);
}
// The stage's arch: two studded posts and a beam over the way out, lit along its underside
function stageArch(e, band, SZ) {
    const f = stageFrame(e.i), top = e.top, H = 10;
    for (const v of [-7.4, 7.4]) {
        const x = e.x + f.OX(7.4, v), z = e.z + f.OZ(7.4, v);
        addBoxFast(SZ, studVCMaterial(), true, 1.2, H, 1.2, x, top + H / 2, z, 8, band.dark, false, null, [0.6, 1.05]);
        addBoxFast(SZ, studVCMaterial(), true, 1.6, 0.8, 1.6, x, top + 0.4, z, 8, 0xffffff);
        addBoxFast(SZ, studVCMaterial(), true, 1.6, 0.8, 1.6, x, top + H - 0.4, z, 8, 0xffffff);
        solidBox(x, top + H / 2, z, 1.2, H, 1.2, { zone: e.zone, mat: 'stud' });
    }
    const bx = e.x + f.OX(7.4, 0), bz = e.z + f.OZ(7.4, 0), span = 16.4;
    addBoxFast(SZ, studVCMaterial(), true, f.SX(1.4, span), 1.4, f.SZ(1.4, span), bx, top + H + 0.7, bz, 8, band.trim, false, null, [0.75, 1.1]);
    addBoxFast(SZ, rainbowNeon(), false, f.SX(0.5, span - 1.4), 0.25, f.SZ(0.5, span - 1.4), bx, top + H - 0.1, bz, 0);
    // a row of bulbs along the beam
    for (let k = -3; k <= 3; k++) addBoxFast(SZ, basicVC(), false, 0.5, 0.5, 0.5, bx + f.OX(0, k * 2.2), top + H + 1.65, bz + f.OZ(0, k * 2.2), 0, k % 2 ? 0xffe27a : 0xffffff);
}
function buildPlank(e) {
    const SZ = staticZone(e.zone);
    // planks run across the bridge: the texture's planks lie along the texture's v
    const alongX = e.sx > e.sz;
    const len = alongX ? e.sx : e.sz;
    addBoxFast(SZ, plankMaterial(), true, e.sx, e.sy, e.sz, e.x, e.y, e.z, 0, undefined, false, (f, ix, iy) => {
        const a = (f === 2 || f === 3) ? (alongX ? ix : (1 - iy)) : ix;
        return [a * len / 8, (f === 2 || f === 3) ? (alongX ? (1 - iy) : ix) * 0.75 : iy * 0.2];
    });
    solidBox(e.x, e.y, e.z, e.sx, e.sy, e.sz, { zone: e.zone, mat: 'wood' });
    // rope rails: grey posts and ropes along both sides
    const wid = alongX ? e.sz : e.sx, top = e.y + e.sy / 2;
    for (const s of [-1, 1]) {
        const ox = alongX ? 0 : s * (wid / 2 - 0.2), oz = alongX ? s * (wid / 2 - 0.2) : 0;
        const n = Math.max(1, Math.round(len / 5));
        for (let k = 0; k <= n; k++) {
            const t = -len / 2 + len * k / n;
            const px = e.x + ox + (alongX ? t : 0), pz = e.z + oz + (alongX ? 0 : t);
            addBoxFast(SZ, studVCMaterial(), true, 0.4, 2.6, 0.4, px, top + 1.3, pz, 8, 0x7a7e8a);
        }
        const rope = new T.CylinderGeometry(0.09, 0.09, len, 5);
        if (alongX) rope.rotateZ(Math.PI / 2); else rope.rotateX(Math.PI / 2);
        rope.translate(e.x + ox, top + 2.4, e.z + oz);
        addGeo(SZ, rope, mat(0xc8a070), false);
    }
}
function buildIsland(e) {
    const SZ = staticZone(e.zone);
    roundStud(SZ, e.sx, e.sy, e.sz, e.x, e.y, e.z, C.green, { r: 0.8, solidZone: e.zone, mat: 'stud', shade: [0.7, 1] });
    addBoxFast(SZ, rockMaterial(), false, e.sx - 1, 5, e.sz - 1, e.x, e.y - e.sy / 2 - 2.5, e.z, 8);
    hangingRocks(SZ, e.x - e.sx / 2, e.x + e.sx / 2, e.z - e.sz / 2, e.z + e.sz / 2, 6, 61 + e.zone, -(e.y - e.sy / 2 - 5));
    // round trees on it
    const top = e.y + e.sy / 2, rnd = rngFrom(17 + e.zone);
    for (let k = 0; k < 4; k++) {
        const tx = e.x + (rnd() - 0.5) * (e.sx - 8), tz = e.z + (rnd() < 0.5 ? -1 : 1) * (e.sz / 2 - 3);
        addGeo(SZ, cylGeo(0.5, 0.7, 5, tx, top + 2.5, tz, 8), mat(0x8a5a2a), true);
        const leaf = new T.IcosahedronGeometry(3, 1); leaf.translate(tx, top + 6.2, tz);
        addGeo(SZ, leaf, mat(0x2ad85a), true);
    }
}
// Vanishing slabs: red studs that shake, blink and drop away, then come back
function buildVanish(e) {
    const m = new T.Mesh(painted(worldUV(roundGeo(e.sx, e.sy, e.sz, 0.3), 8), C.red), studVCMaterial());
    m.position.set(e.x, e.y, e.z); m.castShadow = true; m.receiveShadow = true;
    zoneGroup(e.zone).add(anim(m));
    const s = solidBox(e.x, e.y, e.z, e.sx, e.sy, e.sz, { zone: e.zone, mat: 'stud', vanish: true, state: 0, t: 0, mesh: m, home: m.position.clone(), fuse: e.fuse || 0.6 });
    vanishers.push(s);
}
export function touchVanish(s) { if (s.state === 0) { s.state = 1; s.t = s.t0 = s.fuse / Math.sqrt(spd(s.zone)); } }
// Blinking blocks: cyan with a white rim, on and off on the shared clock (they flash before going)
const timedGeo = new Map();
function buildTimed(e) {
    const key = e.sx + 'x' + e.sz;
    let g = timedGeo.get(key);
    if (!g) {
        const body = painted(worldUV(roundGeo(e.sx, e.sy, e.sz, 0.3), 8), C.cyan);
        const rim = painted(worldUV(new T.BoxGeometry(e.sx + 0.2, 0.3, e.sz + 0.2).translate(0, e.sy / 2 - 0.1, 0).toNonIndexed(), 8), 0xffffff);
        g = mergeGeometries([body.index ? body.toNonIndexed() : body, rim]);
        timedGeo.set(key, g);
    }
    const m = new T.Mesh(g, studVCMaterial());
    m.position.set(e.x, e.y, e.z); m.castShadow = true; m.receiveShadow = true;
    zoneGroup(e.zone).add(anim(m));
    const s = solidBox(e.x, e.y, e.z, e.sx, e.sy, e.sz, { zone: e.zone, mat: 'neon', timed: true });
    timeds.push({ e, s, m });
}
export function timedState(e, t) {
    const per = e.period / spd(e.zone), k = ((t / per + e.phase) % 1 + 1) % 1;
    return { on: k < e.on, warn: k < e.on && (e.on - k) * per < 0.7 };
}
function buildMover(e) {
    const g = painted(worldUV(roundGeo(e.sx, e.sy, e.sz, 0.3), 8), e.color === 'ice' ? C.ice : colorOf(e.color, e.zone));
    // a red rim underneath (the reference's moving plates)
    const rim = painted(worldUV(new T.BoxGeometry(e.sx + 0.3, 0.35, e.sz + 0.3).translate(0, -e.sy / 2 + 0.2, 0).toNonIndexed(), 8), C.red);
    const mesh = new T.Mesh(mergeGeometries([g.index ? g.toNonIndexed() : g, rim]), studVCMaterial());
    mesh.position.set(e.x, e.y, e.z); mesh.castShadow = true; mesh.receiveShadow = true;
    zoneGroup(e.zone).add(anim(mesh));
    const s = solidBox(e.x, e.y, e.z, e.sx, e.sy, e.sz, { zone: e.zone, mat: e.color === 'ice' ? 'ice' : 'plate', ice: e.color === 'ice', mover: true, delta: new V3(), e, mesh });
    movers.push(s);
}
// Trampolines; a "spring" one sits in a glass tube, open on the side you come from
function buildBounce(e) {
    const SZ = staticZone(e.zone);
    const g = new T.Group(); g.position.set(e.x, e.top, e.z); zoneGroup(e.zone).add(g);
    const disc = new T.Mesh(new T.CylinderGeometry(e.r, e.r, 0.5, 28), mat(e.tube ? 0xff3a4a : 0xff5ad8, { emissive: e.tube ? 0xff2a2a : 0xff3ab8, ei: 0.4 }));
    disc.position.y = -0.25; g.add(anim(disc));
    const ring = new T.TorusGeometry(e.r, 0.34, 8, 28); ring.rotateX(Math.PI / 2); ring.translate(e.x, e.top - 0.05, e.z);
    addGeo(SZ, ring, mat(0xffffff), true);
    if (e.tube) {
        const gap = Math.atan2(-(e.dx ?? 0), -(e.dz ?? 1));
        const tube = new T.CylinderGeometry(e.r + 0.6, e.r + 0.6, 7, 28, 1, true, gap + Math.PI * 0.28, Math.PI * 1.44);
        tube.translate(e.x, e.top + 3.5, e.z);
        addGeo(SZ, tube, glassMaterial(), false);
        const top = new T.TorusGeometry(e.r + 0.6, 0.16, 6, 28); top.rotateX(Math.PI / 2); top.translate(e.x, e.top + 7, e.z);
        addGeo(SZ, top, neon(0xff4a5a, 1.2), false);
        for (const dy of [-0.2, -0.45]) { const c = new T.TorusGeometry(e.r * 0.75, 0.13, 6, 20); c.rotateX(Math.PI / 2); c.translate(e.x, e.top + dy, e.z); addGeo(SZ, c, mat(0xc81a2a), false); }
    }
    const arrow = billboard([{ t: '⬆', c: '#ffe0f8', s: '#a8186a', px: 90 }], 2.4, 128, new V3(0, 2.2, 0), g, true);
    arrow.material.opacity = 0.9; anim(arrow);
    const s = { shape: 'cyl', cx: e.x, cz: e.z, r: e.r, min: new V3(e.x - e.r, e.top - 0.5, e.z - e.r), max: new V3(e.x + e.r, e.top, e.z + e.r), zone: e.zone, mat: 'bounce', bounce: e.v, disc, jig: 0 };
    solids.push(s); bouncers.push(s);
    tickers.push((dt, t) => {
        if (!g.parent.visible) return;
        s.jig *= Math.exp(-dt * 5);
        const k = Math.sin(t * 30) * s.jig;
        disc.scale.set(1 + k * 0.08, 1 - k * 0.5, 1 + k * 0.08);
        arrow.position.y = 2.2 + Math.sin(t * 3 + e.x) * 0.4;
    });
}
export function jiggle(s) { s.jig = 1; }
// Squishy pink balls on short stands (stand on top; they squash a bit)
const domeGeo = new T.SphereGeometry(1, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2);
function buildDome(e) {
    const m = new T.Mesh(domeGeo, mat(colorOf(e.color, e.zone), { emissive: 0xff3ad8, ei: 0.18 }));
    m.position.set(e.x, e.y0, e.z); m.scale.set(e.r, e.h, e.r); m.castShadow = true; m.receiveShadow = true;
    zoneGroup(e.zone).add(anim(m));
    addGeo(staticZone(e.zone), cylGeo(e.r * 0.9, e.r * 0.6, 1.6, e.x, e.y0 - 0.8, e.z, 20), mat(0xffffff), true);
    const s = { shape: 'dome', cx: e.x, cz: e.z, y0: e.y0, r: e.r, h: e.h, min: new V3(e.x - e.r, e.y0 - 1.2, e.z - e.r), max: new V3(e.x + e.r, e.y0 + e.h, e.z + e.r), zone: e.zone, mat: 'bounce', squish: 0, sqv: 0, press: 0, mesh: m };
    solids.push(s); domes.push(s);
}
export function pressDome(s) { s.press = 0.12; }
function buildSpinner(e) {
    const g = new T.Group(); g.position.set(e.x, e.top, e.z); zoneGroup(e.zone).add(anim(g));
    const geo = worldUV(new T.CylinderGeometry(e.r, e.r * 0.96, 1.4, 32), 8);
    const n = geo.attributes.position.count, a = new Float32Array(n * 3), c = new T.Color(BANDS[bandOf(e.zone)].light);
    const p = geo.attributes.position;
    for (let i = 0; i < n; i++) {
        // a white stripe across the disc, so you see it turn
        const cc = Math.abs(p.getX(i)) < e.r * 0.18 && p.getY(i) > 0.6 ? white3 : c;
        a[i * 3] = cc.r; a[i * 3 + 1] = cc.g; a[i * 3 + 2] = cc.b;
    }
    geo.setAttribute('color', new T.BufferAttribute(a, 3));
    const disc = new T.Mesh(geo, studVCMaterial());
    disc.position.y = -0.7; disc.castShadow = true; disc.receiveShadow = true; g.add(disc);
    // the motor hub underneath
    addGeo(staticZone(e.zone), cylGeo(0.9, 0.35, 2.6, e.x, e.top - 2.7, e.z, 12), mat(0x9aa2b4), false);
    const s = { shape: 'cyl', cx: e.x, cz: e.z, r: e.r, min: new V3(e.x - e.r, e.top - 1.4, e.z - e.r), max: new V3(e.x + e.r, e.top, e.z + e.r), zone: e.zone, mat: 'stud', spin: e.speed * spd(e.zone), g };
    solids.push(s); spinners.push(s);
}
function buildSweeper(e) {
    const g = new T.Group(); g.position.set(e.x, e.y, e.z); zoneGroup(e.zone).add(anim(g));
    addGeo(staticZone(e.zone), cylGeo(0.7, 0.9, 2.4, e.x, e.y + 1.2, e.z, 16), smoothVC(), true, C.white);
    const coat = new T.CapsuleGeometry(0.5, e.len * 2 - 1, 4, 10);
    const p = coat.attributes.position, col = new Float32Array(p.count * 3), red = new T.Color(C.red), wh = new T.Color(0xffffff);
    for (let i = 0; i < p.count; i++) { const c = Math.floor((p.getY(i) + e.len) / 1.2) % 2 ? red : wh; col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b; }
    coat.setAttribute('color', new T.BufferAttribute(col, 3));
    coat.rotateZ(Math.PI / 2);
    const bar = new T.Mesh(coat, smoothVC()); bar.position.y = 1.6; bar.castShadow = true; g.add(bar);
    sweepers.push({ cx: e.x, cz: e.z, y: e.y + 1.6, len: e.len, speed: e.speed * Math.sqrt(spd(e.zone)), phase: e.phase, zone: e.zone, bar, g });
    solids.push({ shape: 'cyl', cx: e.x, cz: e.z, r: 0.9, min: new V3(e.x - 0.9, e.y, e.z - 0.9), max: new V3(e.x + 0.9, e.y + 2.4, e.z + 0.9), zone: e.zone, mat: 'stud' });
}
export const sweeperAngle = (w, t) => w.speed * t + w.phase;
// Slap traps: a giant purple glove on an arm, turning round a post
function buildSlapper(e) {
    const g = new T.Group(); g.position.set(e.x, e.y, e.z); zoneGroup(e.zone).add(anim(g));
    addGeo(staticZone(e.zone), cylGeo(0.6, 0.8, 2.6, e.x, e.y + 1.3, e.z, 14), smoothVC(), true, 0x2a2e3a);
    solids.push({ shape: 'cyl', cx: e.x, cz: e.z, r: 0.8, min: new V3(e.x - 0.8, e.y, e.z - 0.8), max: new V3(e.x + 0.8, e.y + 2.6, e.z + 0.8), zone: e.zone, mat: 'stud' });
    const armLen = e.len - 1.4;
    const arm = new T.Mesh(new T.BoxGeometry(armLen, 0.5, 0.5), mat(0xd8dce8));
    arm.position.set(armLen / 2, 1.6, 0); arm.castShadow = true; g.add(arm);
    // the glove at the end, palm facing the way it swats
    const glove = trapGlove(1.25);
    glove.rotation.set(e.speed < 0 ? Math.PI : 0, 0, -Math.PI / 2);
    glove.position.set(e.len - 1.2, 1.6, 0);
    g.add(glove);
    slappers.push({ ...e, g, giant: false, hitR: 2.1, y: e.y + 1.6, speed: e.speed * Math.sqrt(spd(e.zone)) });
}
// Where a slap trap's arm points now (radians in the x/z plane) and which way it's turning
export function slapperAngle(s, t) {
    if (s.mode === 'swing') return { a: s.base + s.amp * Math.sin(s.speed * t + s.phase), w: s.amp * s.speed * Math.cos(s.speed * t + s.phase) };
    return { a: s.speed * t + s.phase, w: s.speed };
}
// Punching gloves: out of the wall in a flash, hold, pull back. ext: how far out (studs)
function buildPunch(e) {
    const g = new T.Group(); g.position.set(e.x, e.y, e.z); g.rotation.y = Math.atan2(e.dx, e.dz); zoneGroup(e.zone).add(anim(g));
    const glove = trapGlove(1.35);
    glove.position.set(0, -1.5, 0.6);
    g.add(glove);
    const arm = new T.Mesh(new T.BoxGeometry(0.8, 0.8, 1), mat(0xd8dce8)); arm.position.set(0, 0, -0.5); g.add(arm);
    // a dark hole in the wall where it comes out, with a red warning ring
    const hole = new T.Mesh(new T.CircleGeometry(2, 20), mat(0x14141c));
    hole.position.set(e.x + e.dx * 0.06, e.y, e.z + e.dz * 0.06); hole.rotation.y = Math.atan2(e.dx, e.dz);
    zoneGroup(e.zone).add(hole); bakeMesh(staticZone(e.zone), hole, false);
    const rim = new T.Mesh(new T.RingGeometry(2, 2.5, 20), neon(0xff4a5a, 1.1));
    rim.position.set(e.x + e.dx * 0.08, e.y, e.z + e.dz * 0.08); rim.rotation.y = Math.atan2(e.dx, e.dz);
    zoneGroup(e.zone).add(rim); bakeMesh(staticZone(e.zone), rim, false);
    punches.push({ ...e, g, arm, period: e.period / spd(e.zone) });
}
// rest in the wall, shoot out, hold, pull back (only shooting out and holding knock you)
export function punchExt(p, t) {
    const k = ((t / p.period + p.phase) % 1 + 1) % 1;
    if (k < 0.6) return { ext: 0, hot: false };
    if (k < 0.65) return { ext: p.reach * (k - 0.6) / 0.05, hot: true };
    if (k < 0.76) return { ext: p.reach, hot: true };
    if (k < 0.88) return { ext: p.reach * (1 - (k - 0.76) / 0.12), hot: false };
    return { ext: 0, hot: false };
}
// Laser bars: a glowing red beam between two posts, bobbing up and down
const LASER_LO = 0.9, LASER_HI = 6.4;
function buildLaser(e) {
    const SZ = staticZone(e.zone), h = e.len / 2;
    const ox = e.alongX ? h : 0, oz = e.alongX ? 0 : h;
    for (const s of [-1, 1]) {
        const px = e.x + ox * s, pz = e.z + oz * s;
        addBoxFast(SZ, studVCMaterial(), true, 0.8, 7.6, 0.8, px, e.top + 3.8, pz, 8, 0x3a3e4a, false, null, [0.6, 1]);
        addBoxFast(SZ, neon(0xff3a3a, 1.2), false, 0.9, 0.5, 0.9, px, e.top + 7.85, pz, 0);
        solidBox(px, e.top + 3.8, pz, 0.8, 7.6, 0.8, { zone: e.zone, mat: 'stud' });
    }
    const len = e.len - 0.8;
    const bar = new T.Mesh(new T.BoxGeometry(e.alongX ? len : 0.32, 0.32, e.alongX ? 0.32 : len), neon(0xff2a2a, 1.6));
    const glow = new T.Mesh(new T.BoxGeometry(e.alongX ? len : 0.9, 0.9, e.alongX ? 0.9 : len), laserGlowMat());
    const g = new T.Group(); g.add(bar, glow); g.position.set(e.x, e.top + LASER_LO, e.z); zoneGroup(e.zone).add(anim(g));
    lasers.push({ ...e, g });
}
let laserGlowM = null;
const laserGlowMat = () => laserGlowM || (laserGlowM = new T.MeshBasicMaterial({ color: 0xff3a3a, transparent: true, opacity: 0.28, depthWrite: false, blending: T.AdditiveBlending, toneMapped: false }));
export function laserY(l, t) {
    const per = l.period / spd(l.zone);
    return l.top + LASER_LO + (LASER_HI - LASER_LO) * (0.5 - 0.5 * Math.cos((t / per + l.phase) * Math.PI * 2));
}
// TROLL: a "FREE SKIP!" button on the edge of a landing: it throws you off the tower
function buildBait(e) {
    const SZ = staticZone(e.zone);
    roundStud(SZ, 3.6, 0.8, 3.6, e.x, e.y + 0.4, e.z, C.yellow, { r: 0.25, solidZone: e.zone, extra: { cp: true } });
    addGeo(SZ, cylGeo(1.1, 1.2, 0.6, e.x, e.y + 1.1, e.z, 20), mat(0xff3a4a, { emissive: 0xff2a2a, ei: 0.35 }), true);
    propLabel(billboard([{ t: '⏩ FREE SKIP!', g: ['#fff6a0', '#ffc828'], s: '#3a2000', px: 60 }, { t: 'Step on the button', c: '#ffffff', s: '#1a1a3a', px: 40 }], 5.6, 512, new V3(e.x, e.y + 4.6, e.z), zoneGroup(e.zone), true), e.x, e.z, 2.5);
    triggers.push({ min: new V3(e.x - 1.8, e.y, e.z - 1.8), max: new V3(e.x + 1.8, e.y + 3, e.z + 1.8), zone: e.zone, enter: () => actions.bait(e) });
}
// Checkpoints: a yellow pad (green once reached) with a ring and a chequered flag, a STAGE board
// on the tower wall behind it
const cpRingGeo = new T.TorusGeometry(5.4, 0.16, 8, 64);
const cpRingMats = [new T.MeshBasicMaterial({ color: 0xffd028, toneMapped: false }), new T.MeshBasicMaterial({ color: 0x46ff5a, toneMapped: false })];
tickers.push((dt, t) => {
    const pulse = 1.1 + Math.sin(t * 3) * 0.25;
    cpRingMats[0].color.set(0xffd028).multiplyScalar(pulse); cpRingMats[1].color.set(0x46ff5a).multiplyScalar(pulse);
});
const flagGeoBase = (() => { const g = new T.PlaneGeometry(3.4, 2.2, 10, 4); g.translate(1.7, 0, 0); return g; })();
function buildCheckpoint(e) {
    const Z = e.i, SZ = staticZone(e.i), s = STAGES[e.i], band = BANDS[s.band], f = stageFrame(e.i);
    const pad = new T.Mesh(new RoundedBoxGeometry(8, 0.5, 8, 2, 0.2), cpPadMaterial(false));
    pad.position.set(e.x, e.y + 0.25, e.z); pad.rotation.y = e.yaw; pad.receiveShadow = true;
    zoneGroup(Z).add(pad);
    solidBox(e.x, e.y + 0.25, e.z, 8, 0.5, 8, { zone: Z, mat: 'stud', cp: true });
    const ring = new T.Mesh(cpRingGeo, cpRingMats[0]);
    ring.rotation.x = Math.PI / 2; ring.position.set(e.x, e.y + 0.6, e.z); anim(ring);
    zoneGroup(Z).add(ring);
    const flagGeo = flagGeoBase.clone();
    const flag = new T.Mesh(flagGeo, flagMaterial(false));
    flag.castShadow = true;
    const fx = e.x + f.OX(-3.5, 3.5), fz = e.z + f.OZ(-3.5, 3.5);
    const pole = new T.Mesh(new T.CylinderGeometry(0.14, 0.16, 9, 8), mat(0xf4f6fa));
    pole.position.set(fx, e.y + 4.5, fz); zoneGroup(Z).add(pole); bakeMesh(SZ, pole, true);
    const knob = new T.Mesh(new T.SphereGeometry(0.35, 12, 8), goldMaterial()); knob.position.set(fx, e.y + 9.1, fz); zoneGroup(Z).add(knob); bakeMesh(SZ, knob, false);
    flag.position.set(fx, e.y + 7.8, fz); flag.rotation.y = e.yaw - Math.PI / 2;
    zoneGroup(Z).add(flag);
    // the stage board on the tower wall
    const b = BOARDS[e.i];
    board(Z, (x, W, H) => {
        const g = x.createLinearGradient(0, 0, 0, H); g.addColorStop(0, css(band.wall)); g.addColorStop(1, css(band.dark));
        x.fillStyle = g; x.fillRect(0, 0, W, H);
        txt(x, 'STAGE ' + (e.i + 1), W / 2, H * 0.3, W * 0.86, H * 0.36, '#ffffff', '#0a0a1a');
        txt(x, s.ic + ' ' + s.name, W / 2, H * 0.64, W * 0.92, H * 0.2, '#fff6a0', '#0a0a1a');
        const d = { EASY: '#46e85a', MEDIUM: '#ffc828', HARD: '#ff8a2a', EXTREME: '#ff3a4a', INSANE: '#c84aff' }[s.diff];
        x.fillStyle = d; x.fillRect(W * 0.34, H * 0.83, W * 0.32, H * 0.13);
        txt(x, s.diff, W / 2, H * 0.895, W * 0.3, H * 0.1, '#ffffff', '#0a0a1a', 800);
    }, 'stage-' + e.i, 15, 7, new V3(b.x, b.y, b.z), new V3(b.x + b.nx * 10, b.y, b.z + b.nz * 10), { frame: 0xffffff, bake: SZ, W: 512 });
    const base = Float32Array.from(flagGeo.attributes.position.array);
    cpPads[e.i] = { pad, lit: false, ring, flag };
    let acc = 0;
    tickers.push((dt, t) => {
        if (!flag.parent.visible) return;
        acc += dt;
        if (acc > 1 / 30) {
            acc = 0;
            const p = flagGeo.attributes.position;
            for (let i = 0; i < p.count; i++) {
                const x = base[i * 3], k = x / 3.4;
                p.array[i * 3 + 2] = Math.sin(x * 1.9 - t * 5 + e.i) * 0.32 * k + Math.sin(base[i * 3 + 1] * 2 + t * 3) * 0.06 * k;
            }
            p.needsUpdate = true;
            flagGeo.computeVertexNormals();
        }
    });
    triggers.push({ min: new V3(e.x - 4.5, e.y - 1, e.z - 4.5), max: new V3(e.x + 4.5, e.y + 8, e.z + 4.5), zone: Z, enter: () => actions.checkpoint(e.i) });
}
export function lightCheckpoint(i, on) {
    const c = cpPads[i];
    if (!c || c.lit === on) return;
    c.lit = on;
    c.ring.material = cpRingMats[on ? 1 : 0];
    c.pad.material = cpPadMaterial(on);
    c.flag.material = flagMaterial(on);
}
// Beams of light over every checkpoint (one mesh for all): green for the ones you've reached, the
// next one bright and pulsing, the rest faint
let beamMat = null;
function buildBeams() {
    const pos = [], uv = [], ids = [], idx = [], seg = 14, H = 44, R = 3.6;
    CHECKPOINTS.forEach((cp, i) => {
        const base = pos.length / 3;
        for (let k = 0; k <= seg; k++) {
            const a = k / seg * Math.PI * 2, x = cp.x + Math.cos(a) * R, z = cp.z + Math.sin(a) * R;
            pos.push(x, cp.y + 0.4, z, x, cp.y + 0.4 + H, z); uv.push(k / seg, 0, k / seg, 1); ids.push(i, i);
        }
        for (let k = 0; k < seg; k++) { const a = base + k * 2; idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3); }
    });
    const g = new T.BufferGeometry();
    g.setAttribute('position', new T.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new T.Float32BufferAttribute(uv, 2));
    g.setAttribute('aIdx', new T.Float32BufferAttribute(ids, 1));
    g.setIndex(idx);
    beamMat = new T.ShaderMaterial({
        transparent: true, depthWrite: false, blending: T.AdditiveBlending, side: T.DoubleSide, forceSinglePass: true,
        uniforms: { uReached: { value: -1 }, uTime: { value: 0 } },
        vertexShader: 'attribute float aIdx; varying vec2 vUv; varying float vIdx; void main(){ vUv = uv; vIdx = aIdx; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
        fragmentShader: `uniform float uReached; uniform float uTime; varying vec2 vUv; varying float vIdx;
            void main(){
                float lit = step(vIdx, uReached + 0.5), next = 1.0 - step(0.5, abs(vIdx - uReached - 1.0));
                vec3 c = mix(vec3(1.0, 0.84, 0.3), vec3(0.35, 1.0, 0.5), lit);
                float a = pow(1.0 - vUv.y, 1.7) * (0.12 + lit * 0.06 + next * (0.3 + 0.12 * sin(uTime * 4.0)));
                gl_FragColor = vec4(c * a, a);
            }`,
    });
    const m = new T.Mesh(g, beamMat);
    m.frustumCulled = false; m.renderOrder = 3;
    zoneGroup(-2).add(m);
}
// Skip Stage pads: a yellow block with the reference's "Skip Obby" prompt
function buildSkipPad(e) {
    const Z = e.zone;
    roundStud(staticZone(Z), 5, 1, 5, e.x, e.y + 0.5, e.z, C.yellow, { r: 0.3, mat: 'stud', solidZone: Z, extra: { cp: true } });
    addBoxFast(staticZone(Z), studVCMaterial(), false, 5.6, 0.5, 5.6, e.x, e.y + 0.25, e.z, 8, 0x2a2e3a);
    propLabel(billboard([{ t: '⏩ SKIP STAGE', g: ['#fff6a0', '#ffc828'], s: '#3a2000', px: 56 }], 6, 512, new V3(e.x, e.y + 4, e.z), zoneGroup(Z), true), e.x, e.z, 3);
    prompts.push({ pos: new V3(e.x, e.y + 1, e.z), r: 4.5, zone: Z, label: () => 'Skip this stage', act: () => actions.skipPad(e.i) });
}
// TROLL: the shiny WIN pad where you step onto the roof is a trapdoor into a pit
function buildTrollPit(e) {
    const Z = e.zone, y = e.y, d = e.depth;
    // the pit walls and floor (a bounce pad at the bottom throws you back out)
    for (const [sx, sz, dx, dz] of [[e.sx + 1, 1, 0, -e.sz / 2 - 0.5], [e.sx + 1, 1, 0, e.sz / 2 + 0.5], [1, e.sz, -e.sx / 2 - 0.5, 0], [1, e.sz, e.sx / 2 + 0.5, 0]]) studBox(Z, sx, d, sz, e.x + dx, y - d / 2, e.z + dz, C.dblue);
    studBox(Z, e.sx, 1, e.sz, e.x, y - d - 0.5, e.z, C.dblue);
    const face = new T.Mesh(new T.PlaneGeometry(e.sx - 1, e.sz - 1), new T.MeshBasicMaterial({ map: trollFaceTex(), transparent: true, toneMapped: false }));
    face.rotation.x = -Math.PI / 2; face.position.set(e.x, y - d + 0.1, e.z); zoneGroup(Z).add(face);
    buildBounce({ x: e.x, z: e.z, top: y - d + 0.5, r: 2.2, v: Math.sqrt(2 * CFG.grav * 13), zone: Z });
    // the fake pad: a glowing rainbow WIN pad that isn't there
    const padTex = rainbowTex().clone(); padTex.needsUpdate = true;
    const pad = new T.Mesh(new T.BoxGeometry(e.sx, 0.4, e.sz), new T.MeshBasicMaterial({ map: padTex, toneMapped: false }));
    pad.position.set(e.x, y + 0.2, e.z); zoneGroup(Z).add(anim(pad));
    const win = anim(billboard([{ t: '🏆 WIN! 🏆', g: ['#fff6b0', '#ffc828'], s: '#7a3a00', px: 90 }, { t: 'Step here to win!', c: '#ffffff', s: '#1a1a3a', px: 40 }], 9, 512, new V3(e.x, y + 6, e.z), zoneGroup(Z), true));
    triggers.push({ min: new V3(e.x - e.sx / 2, y - d, e.z - e.sz / 2), max: new V3(e.x + e.sx / 2, y + 0.3, e.z + e.sz / 2), zone: Z, enter: () => actions.trolled('pit') });
    tickers.push((dt, t) => { if (!pad.parent.visible) return; padTex.offset.x = (t * 0.25) % 1; win.position.y = y + 6 + Math.sin(t * 1.8) * 0.5; });
}

// ----- troll coins: one instanced mesh for all of them, spinning in the vertex shader -----
const coinTime = { value: 0 };
let coinMesh = null, coinKey = -1;
const m4 = new T.Matrix4(), q0 = new T.Quaternion(), v0 = new V3(), s0 = new V3();
function buildCoins() {
    const geo = new T.CylinderGeometry(1, 1, 0.3, 20); geo.rotateX(Math.PI / 2);
    const cm = coinMaterial().clone();
    cm.onBeforeCompile = (sh) => {
        sh.uniforms.uTime = coinTime;
        sh.vertexShader = 'uniform float uTime;\n' + sh.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
            float gid = float(gl_InstanceID), ga = uTime * 2.6 + gid, gc = cos(ga), gs = sin(ga);
            transformed = vec3(gc * transformed.x + gs * transformed.z, transformed.y + sin(uTime * 2.0 + gid) * 0.3, gc * transformed.z - gs * transformed.x);`);
    };
    cm.customProgramCacheKey = () => 'coin-spin';
    coinMesh = new T.InstancedMesh(geo, cm, COINS.length);
    coinMesh.frustumCulled = false;
    coinMesh.castShadow = false;
    scene.add(coinMesh);
    placeCoins();
}
function placeCoins() {
    COINS.forEach((c, i) => coinMesh.setMatrixAt(i, m4.compose(v0.set(c.x, c.y, c.z), q0.identity(), s0.setScalar(coinState.collected.has(c.i) ? 0.0001 : 1))));
    coinMesh.instanceMatrix.needsUpdate = true;
    coinKey = coinState.collected.size;
}

// A blocky rig as one vertex-coloured mesh per moving part (body, head, each arm and leg)
function bakeRig(rig) {
    const u = rig.userData;
    for (const part of [rig, u.head, ...u.legs, ...u.arms]) {
        const kids = part.children.filter((o) => o.isMesh);
        if (kids.length < 2) continue;
        const geos = kids.map((m) => { m.updateMatrix(); const g = m.geometry.clone().applyMatrix4(m.matrix); return painted(g.index ? g.toNonIndexed() : g, m.material.color); });
        for (const m of kids) part.remove(m);
        const mesh = new T.Mesh(mergeGeometries(geos), smoothVC());
        mesh.castShadow = true; mesh.receiveShadow = true;
        part.add(mesh);
    }
    return rig;
}
// ----- red light / green light: the giant guard on the island -----
const DOLL_SIGNS = {
    green: [{ t: '🟢 GREEN LIGHT', c: '#7dff6b', s: '#0a3a0a', px: 64 }],
    warn: [{ t: '🟡 GET READY...', c: '#ffe24a', s: '#3a2a00', px: 64 }],
    red: [{ t: '🔴 RED LIGHT!', c: '#ff5a5a', s: '#3a0000', px: 64 }],
};
function buildDoll(d) {
    const g = new T.Group(); g.position.set(d.x, d.y, d.z); g.rotation.y = d.yaw; zoneGroup(d.zone).add(anim(g));
    const S_ = 4.2;
    const body = bakeRig(buildRig({ shirt: 0xff7a2a, shorts: 0xffd028, socks: 0xffffff, hair: 0x2a1a10, skin: 0xffd8b0 }));
    body.scale.setScalar(S_); g.add(body);
    // the head turns: a troll face on the front, a traffic light on top
    const headPivot = body.userData.head;
    const face = new T.Mesh(new T.PlaneGeometry(1.15, 1.15), new T.MeshBasicMaterial({ map: trollFaceTex(), transparent: true, toneMapped: false }));
    face.position.set(0, 4.62, 0.67); headPivot.add(face);
    const light = new T.Group(); light.position.set(0, 5.6, 0); headPivot.add(light);
    const box = new T.Mesh(new T.BoxGeometry(0.7, 1.7, 0.5), mat(0x22242c)); box.position.y = 0.7; light.add(box);
    const lamps = [0xff3a3a, 0xffd028, 0x46ff5a].map((c, k) => { const l = new T.Mesh(new T.SphereGeometry(0.22, 12, 8), new T.MeshBasicMaterial({ color: c, toneMapped: false })); l.position.set(0, 1.25 - k * 0.55, 0.27); light.add(l); return l; });
    const eyes = [-0.26, 0.26].map((sx) => { const e = new T.Mesh(new T.SphereGeometry(0.12, 10, 8), new T.MeshBasicMaterial({ color: 0xff2a2a, toneMapped: false })); e.position.set(sx, 4.74, 0.7); headPivot.add(e); return e; });
    body.traverse((o) => { if (o.isMesh) o.castShadow = true; });
    const sign = billboard(DOLL_SIGNS.green, 14, 512, new V3(0, 30, 0), g, true);
    sign.userData.keepFar = true;
    // the three signs are drawn once and swapped (no canvas redrawn while you play)
    sign.userData.tex = Object.fromEntries(Object.entries(DOLL_SIGNS).map(([k, lines]) => [k, sharedTex('bb|512|' + JSON.stringify(lines), () => textCanvas(lines, 512))]));
    dolls.push({ ...d, g, body, head: headPivot, lamps, eyes, sign, state: '', yawHead: Math.PI });
}
export function dollState(d, t) {
    const per = d.period / spd(d.zone), k = ((t / per) % 1 + 1) % 1 * per;
    const green = d.green / spd(d.zone), warn = d.warn / spd(d.zone);
    if (k < green) return { s: 'green', left: green - k };
    if (k < green + warn) return { s: 'warn', left: green + warn - k };
    return { s: 'red', left: per - k, since: k - green - warn };
}
// ----- giants: a huge blocky walker striding back and forth -----
function buildGiant(gd) {
    const g = new T.Group(); zoneGroup(gd.zone).add(anim(g));
    const body = bakeRig(buildRig({ shirt: 0x7ab8ff, shorts: 0x5a8ae8, socks: 0xffffff, hair: 0x5a3a1a, skin: 0xf2c9a0 }));
    body.scale.setScalar(gd.scale); g.add(body);
    body.traverse((o) => { if (o.isMesh) o.castShadow = true; });
    g.position.set(gd.ax, gd.y, gd.az);
    giants.push({ ...gd, g, body, len: Math.hypot(gd.bx - gd.ax, gd.bz - gd.az) });
}
// Where a giant is now and where its feet are (x, z, the foot's lift, its box half sizes)
// (the feet follow animRig's legs: a leg swings 0.6 rad either way round the hip, 1.9 rig studs long)
export function giantState(gd, t) {
    const per = gd.period / spd(Math.max(0, gd.zone)), k = ((t / per) % 1 + 1) % 1;
    const fwd = k < 0.5, f = fwd ? k * 2 : 2 - k * 2;
    const x = gd.ax + (gd.bx - gd.ax) * f, z = gd.az + (gd.bz - gd.az) * f;
    const dx = (gd.bx - gd.ax) / gd.len * (fwd ? 1 : -1), dz = (gd.bz - gd.az) / gd.len * (fwd ? 1 : -1);
    const stepLen = 2 * 1.9 * gd.scale * Math.sin(0.6), phase = (k * 2 * gd.len) / stepLen * Math.PI;
    const sw = Math.sin(0.6 * Math.sin(phase)) * 1.9 * gd.scale;
    // left foot (rig x -0.5) swings back while the right one swings forward; the rig's +x is (dz, -dx)
    const feet = [[-0.5, -sw], [0.5, sw]].map(([sx, fo]) => ({ x: x + dx * fo + dz * sx * gd.scale, z: z + dz * fo - dx * sx * gd.scale }));
    return { x, z, dx, dz, yaw: Math.atan2(dx, dz), phase, feet, hx: 0.55 * gd.scale, hz: 0.65 * gd.scale, top: 2 * gd.scale };
}

// =====================================================================================
// The roof, the rainbow path and the victory platform
// =====================================================================================
function buildRoof() {
    const Z = N - 1, y = ROOF_Y;
    bigTitle(-2, 'CAN YOU REACH THE TOP?', 40, new V3(0, y + 12, -IN + 0.3), new V3(0, y + 12, 0), ['#ffffff', '#e0c8ff'], '#2a0a5a');
    // a giant slap hand on the roof (like the reference's cover picture)
    const hand = anim(trapGlove(4.5)); hand.position.set(28, y + 1, -26); hand.rotation.set(0, -0.6, 0.15); zoneGroup(Z).add(hand);
    tickers.push((dt, t) => { if (hand.parent.visible) hand.rotation.z = 0.15 + Math.sin(t * 1.4) * 0.12; });
    trollSignAt(Z, -46, y, -26, Math.PI, ['THE WAY OUT', 'IS NORTH ⬆']);
    floorArrow(Z, -26, y, -18, arrowRot(1, 1), 7);
    floorArrow(Z, -14, y, -2, arrowRot(1, 1.4), 7);
    floorArrow(Z, -4, y, 16, arrowRot(0, 1), 7);
    floorArrow(Z, 0, y, 34, arrowRot(0, 1), 7);
    buildSearchlights();
}
function buildFinish() {
    const Z = N - 1, F = FINISH;
    roundStud(-2, F.x1 - F.x0, 3, F.z1 - F.z0, F.x, F.y - 1.5, F.z, C.yellow, { r: 0.6, solidZone: Z, cast: true, shade: [0.7, 1] });
    addBoxFast(-2, rockMaterial(), false, F.x1 - F.x0 - 1, 5, F.z1 - F.z0 - 1, F.x, F.y - 5.5, F.z, 8);
    hangingRocks(-2, F.x0, F.x1, F.z0, F.z1, 5, 777, -(F.y - 8));
    // the WIN pad
    const g = new T.Group(); g.position.set(F.x, F.y, F.z); zoneGroup(Z).add(g);
    const padTex = rainbowTex().clone(); padTex.needsUpdate = true;
    const pad = new T.Mesh(new T.CylinderGeometry(F.pad, F.pad, 0.4, 48), new T.MeshBasicMaterial({ map: padTex, toneMapped: false }));
    pad.position.y = 0.2; g.add(pad);
    solids.push({ shape: 'cyl', cx: F.x, cz: F.z, r: F.pad, min: new V3(F.x - F.pad, F.y, F.z - F.pad), max: new V3(F.x + F.pad, F.y + 0.4, F.z + F.pad), zone: Z, mat: 'neon' });
    const beam = new T.Mesh(new T.CylinderGeometry(F.pad, F.pad, 40, 32, 1, true), new T.ShaderMaterial({
        transparent: true, depthWrite: false, blending: T.AdditiveBlending, side: T.DoubleSide, forceSinglePass: true,
        uniforms: { uTime: { value: 0 } },
        vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
        fragmentShader: `uniform float uTime; varying vec2 vUv;
            vec3 hue(float h){ return clamp(abs(mod(h*6.0+vec3(0.0,4.0,2.0),6.0)-3.0)-1.0,0.0,1.0); }
            void main(){ float a = (1.0 - vUv.y) * 0.5 * (0.7 + 0.3 * sin(vUv.y * 20.0 - uTime * 4.0)); gl_FragColor = vec4(hue(vUv.x + uTime * 0.1) * 1.2, a); }`,
    }));
    beam.position.y = 20; g.add(beam);
    const win = anim(billboard([{ t: '🏆 WIN! 🏆', g: ['#fff6b0', '#ffc828'], s: '#7a3a00', px: 90 }, { t: 'The REAL one this time!', c: '#ffffff', s: '#1a1a3a', px: 40 }], 13, 512, new V3(0, 9, 0), g));
    triggers.push({ min: new V3(F.x - F.pad + 0.6, F.y - 0.5, F.z - F.pad + 0.6), max: new V3(F.x + F.pad - 0.6, F.y + 6, F.z + F.pad - 0.6), zone: Z, enter: () => actions.finish() });
    // a chequered arch over the way in, a podium, a giant trophy, the title
    const az = F.z0 + 3;
    for (const sx of [-9, 9]) roundStud(-2, 2.4, 14, 2.4, sx, F.y + 7, az, 0xffffff, { r: 0.4, solidZone: Z });
    addBoxFast(-2, checkerMaterial(), true, 20.4, 3, 2.4, 0, F.y + 15.5, az, 0, undefined, false, (f, ix, iy) => [ix * 8, iy]);
    const pz = F.z + 10;
    roundStud(-2, 8, 5, 6, 0, F.y + 2.5, pz, C.gold, { r: 0.5, solidZone: Z });
    roundStud(-2, 8, 3.4, 6, -8, F.y + 1.7, pz, 0xc8d0dc, { r: 0.5, solidZone: Z });
    roundStud(-2, 8, 2.2, 6, 8, F.y + 1.1, pz, 0xd8884a, { r: 0.5, solidZone: Z });
    const tr = anim(trophy()); tr.position.set(0, F.y + 5, pz); tr.scale.setScalar(1.8); zoneGroup(Z).add(tr);
    bigTitle(-2, 'YOU BEAT THE TROLL TOWER!', 44, new V3(0, F.y + 26, F.z1 - 2), new V3(0, F.y + 26, F.z0 - 60), ['#fff6a0', '#ffc828', '#ff8a1a'], '#5a2a00');
    // balloons round the edge
    const rnd = rngFrom(42), NB = 12;
    const bm = new T.InstancedMesh(new T.SphereGeometry(1.5, 14, 10), new T.MeshLambertMaterial({ color: 0xffffff }), NB);
    for (let k = 0; k < NB; k++) {
        const side = k % 2 ? 1 : -1, z = F.z0 + 4 + (k >> 1) * 5;
        bm.setColorAt(k, new T.Color(RAINBOW_C[k % RAINBOW_C.length]));
        bm.setMatrixAt(k, m4.compose(v0.set(side * (F.x1 - 1.5), F.y + 7 + rnd() * 3, z), q0.identity(), s0.set(1, 1.2, 1)));
    }
    zoneGroup(Z).add(bm);
    tickers.push((dt, t) => {
        if (!g.parent.visible) return;
        padTex.offset.x = (t * 0.25) % 1;
        beam.material.uniforms.uTime.value = t;
        win.position.y = 9 + Math.sin(t * 1.5) * 0.5;
        tr.rotation.y = t * 0.5;
    });
}
const searchlights = [];
function buildSearchlights() {
    const geo = new T.CylinderGeometry(26, 1.2, 240, 24, 1, true); geo.translate(0, 120, 0);
    const m = new T.ShaderMaterial({
        transparent: true, depthWrite: false, blending: T.AdditiveBlending, side: T.DoubleSide, forceSinglePass: true,
        uniforms: { uColor: { value: new T.Color(0xfff2c8) } },
        vertexShader: 'varying float vY; void main(){ vY = position.y / 240.0; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
        fragmentShader: 'uniform vec3 uColor; varying float vY; void main(){ float a = pow(1.0 - vY, 2.2) * 0.13; gl_FragColor = vec4(uColor * a, a); }',
    });
    // on top of the rim at three corners and the middle of the south side (the south-west corner is the way in)
    [[0, -A + 1, 0.2], [A - 1, -A + 1, 1.8], [A - 1, A - 1, 3.4], [-A + 1, A - 1, 5]].forEach(([x, z, ph], k) => {
        const g = new T.Group(); g.position.set(x, ROOF_Y + 6, z); zoneGroup(-2).add(anim(g));
        const beam = new T.Mesh(geo, k % 2 ? m.clone() : m); beam.frustumCulled = false;
        if (k % 2) beam.material.uniforms.uColor.value.set(0xc8f0ff);
        g.add(beam);
        addGeo(-2, cylGeo(1.3, 1.6, 2, x, ROOF_Y + 5, z, 14), mat(0x2a2e3a), false);
        searchlights.push({ g, ph });
    });
}
// Balloons drifting round the tower in every colour (one draw call; they bob in the vertex shader)
const balloonTime = { value: 0 };
function buildBalloons() {
    const body = new T.SphereGeometry(1, 16, 12); body.scale(1, 1.18, 1);
    const knot = new T.ConeGeometry(0.22, 0.4, 8); knot.rotateX(Math.PI); knot.translate(0, -1.25, 0);
    const string = new T.CylinderGeometry(0.04, 0.04, 4, 4); string.translate(0, -3.4, 0);
    const geo = mergeGeometries([body, knot, string].map((g) => (g.index ? g.toNonIndexed() : g)));
    const m = new T.MeshLambertMaterial({ color: 0xffffff, emissive: 0x222222 });
    m.onBeforeCompile = (sh) => {
        sh.uniforms.uTime = balloonTime;
        sh.vertexShader = 'uniform float uTime;\n' + sh.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
            float bid = float(gl_InstanceID);
            transformed.y += sin(uTime * 0.7 + bid * 1.7) * 0.9;
            transformed.x += sin(uTime * 0.5 + bid) * 0.25 * (position.y + 1.2);`);
    };
    m.customProgramCacheKey = () => 'balloon-bob';
    const NB = 64, rnd = rngFrom(777), mesh = new T.InstancedMesh(geo, m, NB);
    const cols = [0xff4a6e, 0xffd028, 0x46ec50, 0x3ad8ff, 0xc45aff, 0xff8a2a, 0xffffff, 0xff6ae8];
    for (let k = 0; k < NB; k++) {
        const a = k / NB * Math.PI * 2 * 3.1 + rnd() * 0.3, r = 135 + rnd() * 70, sc = 2.6 + rnd() * 2;
        mesh.setMatrixAt(k, m4.compose(v0.set(Math.cos(a) * r, 12 + rnd() * (ROOF_Y + 20), Math.sin(a) * r), q0.identity(), s0.setScalar(sc)));
        mesh.setColorAt(k, new T.Color(cols[k % cols.length]));
    }
    mesh.frustumCulled = false; mesh.castShadow = false;
    scene.add(mesh);
}
function trophy() {
    const tr = new T.Group();
    const gm = goldMaterial();
    const cup = new T.Mesh(new T.CylinderGeometry(2.2, 1.0, 3.2, 24, 1, true), gm); cup.position.y = 4.4; tr.add(cup);
    const inner = new T.Mesh(new T.CylinderGeometry(2.1, 0.95, 3.1, 24, 1, true), mat(0xd89a10, { side: true })); inner.position.y = 4.42; tr.add(inner);
    const stem = new T.Mesh(new T.CylinderGeometry(0.35, 0.5, 1.6, 12), gm); stem.position.y = 2.0; tr.add(stem);
    const foot = new T.Mesh(new T.CylinderGeometry(1.4, 1.6, 0.6, 20), gm); foot.position.y = 1.0; tr.add(foot);
    for (const sx of [-1, 1]) { const h = new T.Mesh(new T.TorusGeometry(0.9, 0.22, 8, 16, Math.PI), gm); h.position.set(sx * 2.1, 4.6, 0); h.rotation.z = sx > 0 ? -Math.PI / 2 : Math.PI / 2; tr.add(h); }
    tr.traverse((o) => { if (o.isMesh) o.castShadow = true; });
    mergeChildren(tr);
    return tr;
}

// =====================================================================================
// Decor: little floating islands far round the tower, and clouds drifting by (one draw call:
// camera-facing quads moved by the shader)
// =====================================================================================
function buildSkyIslands() {
    const rnd = rngFrom(909), Z = -2;
    for (let k = 0; k < 22; k++) {
        const a = k / 22 * Math.PI * 2 + rnd() * 0.2, r = 190 + rnd() * 150;
        const x = Math.cos(a) * r, z = Math.sin(a) * r, y = 10 + rnd() * (ROOF_Y + 30), s = 8 + rnd() * 12;
        const top = new T.CylinderGeometry(s, s * 0.92, 2.4, 9); top.translate(x, y, z);
        addGeo(Z, worldUV(top, 8), studVCMaterial(), false, [0x4cf07a, 0xff6ae8, 0x6a8cff, 0xffd028, 0x3ee6a2][k % 5], [0.7, 1.05]);
        const rock = new T.ConeGeometry(s * 0.85, s * 1.6, 8); rock.rotateX(Math.PI); rock.translate(x, y - 1.2 - s * 0.8, z);
        addGeo(Z, worldUV(rock, 8), rockMaterial(), false);
    }
}
let lowDecor = false, cloudMat = null;
export function setDecorLow(on) {
    if (lowDecor === !!on) return;
    lowDecor = !!on;
    if (cloudMat) cloudMat.uniforms.uLow.value = lowDecor ? 1 : 0;
}
function buildDecor() {
    const rnd = rngFrom(5), NC = 52;
    const pos = [], uv = [], center = [], info = [], low = [], idx = [];
    for (let k = 0; k < NC; k++) {
        const a = rnd() * Math.PI * 2, r = 130 + rnd() * 320;
        const x = Math.cos(a) * r, z = Math.sin(a) * r, y = -60 + rnd() * (ROOF_Y + 140);
        const sz = 80 + rnd() * 120, spd2 = 1.5 + rnd() * 3, b = k * 4;
        for (const [cx, cy] of [[-0.5, -0.5], [0.5, -0.5], [0.5, 0.5], [-0.5, 0.5]]) {
            pos.push(cx, cy, 0); uv.push(cx + 0.5, cy + 0.5); center.push(x, y, z); info.push(sz, sz / 2, spd2); low.push(k % 2);
        }
        idx.push(b, b + 1, b + 2, b, b + 2, b + 3);
    }
    const g = new T.BufferGeometry();
    g.setAttribute('position', new T.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new T.Float32BufferAttribute(uv, 2));
    g.setAttribute('aCenter', new T.Float32BufferAttribute(center, 3));
    g.setAttribute('aInfo', new T.Float32BufferAttribute(info, 3));
    g.setAttribute('aLow', new T.Float32BufferAttribute(low, 1));
    g.setIndex(idx);
    cloudMat = new T.ShaderMaterial({
        transparent: true, depthWrite: false,
        uniforms: { uMap: { value: cloudSpriteTex() }, uTime: { value: 0 }, uLow: { value: 0 } },
        vertexShader: `attribute vec3 aCenter; attribute vec3 aInfo; attribute float aLow; uniform float uTime; uniform float uLow; varying vec2 vUv;
            void main() {
                vUv = uv;
                // each cloud drifts slowly round the tower
                float a = uTime * aInfo.z * 0.0012;
                vec3 c = vec3(aCenter.x * cos(a) - aCenter.z * sin(a), aCenter.y, aCenter.x * sin(a) + aCenter.z * cos(a));
                vec4 mv = viewMatrix * vec4(c, 1.0); mv.xy += position.xy * aInfo.xy;
                gl_Position = projectionMatrix * mv;
                if (uLow > 0.5 && aLow > 0.5) gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
            }`,
        fragmentShader: `uniform sampler2D uMap; varying vec2 vUv;
            void main() { vec4 c = texture2D(uMap, vUv); if (c.a < 0.01) discard; gl_FragColor = vec4(c.rgb, c.a * 0.9);
                #include <colorspace_fragment>
            }`,
    });
    const clouds = new T.Mesh(g, cloudMat);
    clouds.frustumCulled = false; clouds.renderOrder = -5;
    scene.add(clouds);
}

// =====================================================================================
// Per-frame world animation (before the player moves)
// =====================================================================================
const prevPos = new V3();
export function updateWorld(dt, t, stage, me) {
    const st = serverT();
    coinTime.value = t;
    if (coinMesh && coinState.collected.size !== coinKey) placeCoins();
    const s0_ = Math.max(0, stage ?? 0);
    const near = (z) => z < 0 || Math.abs(z - s0_) <= 2;
    // movers: positions from the shared server clock so every player sees the same thing
    for (const s of movers) {
        if (!near(s.zone)) continue;
        prevPos.copy(s.min);
        const e = s.e, k = Math.sin((st * spd(s.zone) / e.period + e.phase) * Math.PI * 2);
        const x = e.x + e.ax * k, y = e.y + e.ay * k, z = e.z + e.az * k;
        s.min.set(x - e.sx / 2, y - e.sy / 2, z - e.sz / 2);
        s.max.set(x + e.sx / 2, y + e.sy / 2, z + e.sz / 2);
        s.mesh.position.set(x, y, z);
        s.delta.subVectors(s.min, prevPos);
    }
    // vanishing slabs: shake, blink, gone for a while, then back
    for (const s of vanishers) {
        if (s.state === 1) {
            s.t -= dt;
            s.mesh.position.set(s.home.x + (Math.random() - 0.5) * 0.3, s.home.y + (Math.random() - 0.5) * 0.1, s.home.z + (Math.random() - 0.5) * 0.3);
            s.mesh.visible = s.t > s.t0 * 0.35 || Math.floor(s.t * 24) % 2 === 0;
            if (s.t <= 0) { s.state = 2; s.t = 2.6; s.off = true; s.mesh.visible = false; }
        } else if (s.state === 2) {
            s.t -= dt;
            if (s.t <= 0) { s.state = 3; s.t = 0.35; s.off = false; s.mesh.visible = true; s.mesh.position.copy(s.home); }
        } else if (s.state === 3) {
            s.t -= dt;
            const k = 1 - Math.max(0, s.t / 0.35);
            s.mesh.scale.setScalar(0.4 + 0.6 * k);
            if (s.t <= 0) { s.state = 0; s.mesh.scale.setScalar(1); }
        }
    }
    // blinking blocks
    for (const b of timeds) {
        if (!near(b.e.zone)) continue;
        const ts = timedState(b.e, st);
        b.s.off = !ts.on;
        b.m.visible = ts.on && !(ts.warn && Math.floor(st * 12) % 2 === 0);
    }
    for (const s of spinners) if (near(s.zone)) s.g.rotation.y = -s.spin * st;
    for (const w of sweepers) if (near(w.zone)) w.g.rotation.y = -sweeperAngle(w, st);
    for (const s of slappers) {
        if (!near(s.zone)) continue;
        // three's rotation.y turns +x toward -z: the arm (along +x) points at angle a when ry = -a
        s.g.rotation.y = -slapperAngle(s, st).a;
    }
    for (const p of punches) {
        if (!near(p.zone)) continue;
        const { ext } = punchExt(p, st);
        p.g.position.set(p.x + p.dx * ext, p.y, p.z + p.dz * ext);
        p.arm.scale.z = Math.max(0.01, ext + 1); p.arm.position.z = -(ext + 1) / 2;
    }
    for (const l of lasers) if (near(l.zone)) l.g.position.y = laserY(l, st);
    // squishy balls squash while pressed and wobble back
    for (const s of domes) {
        const target = s.press > 0 ? 1 : 0;
        s.press -= dt;
        if (!target && Math.abs(s.squish) < 0.002 && Math.abs(s.sqv) < 0.01) continue;
        s.sqv += (target - s.squish) * 260 * dt;
        s.sqv *= Math.exp(-11 * dt);
        s.squish += s.sqv * dt;
        s.mesh.scale.set(s.r * (1 + 0.07 * s.squish), s.h * (1 - 0.2 * s.squish), s.r * (1 + 0.07 * s.squish));
    }
    // the doll: head away on green, turning on yellow, staring with red eyes on red
    for (const d of dolls) {
        if (Math.abs(d.zone - s0_) > 3) continue;
        const ds = dollState(d, st);
        const want = ds.s === 'green' ? Math.PI : 0;
        d.yawHead += (want - d.yawHead) * Math.min(1, dt * (ds.s === 'warn' ? 6 : 10));
        d.head.rotation.y = d.yawHead;
        d.lamps.forEach((l, k) => { l.visible = (ds.s === 'red' && k === 0) || (ds.s === 'warn' && k === 1) || (ds.s === 'green' && k === 2); });
        d.eyes.forEach((e) => { e.visible = ds.s === 'red'; e.scale.setScalar(1 + Math.sin(t * 20) * 0.2); });
        if (ds.s !== d.state) {
            d.state = ds.s;
            d.sign.material.map = d.sign.userData.tex[ds.s];
            if (actions.dollChange) actions.dollChange(d, ds.s);
        }
        animRig(d.body, Math.sin(t * 1.5) * 0.15, 0.4);
    }
    // giants stride along their line (the far ones keep walking, but their legs rest)
    for (const gd of giants) {
        const gs = giantState(gd, st);
        gd.g.position.set(gs.x, gd.y, gs.z);
        gd.g.rotation.y = gs.yaw;
        if (gd.zone < 0 ? s0_ <= 1 : Math.abs(gd.zone - s0_) <= 3) animRig(gd.body, gs.phase, 0.6);
        gd.state = gs;
    }
    const pulse = 0.75 + 0.5 * (0.5 + 0.5 * Math.sin(t * 7));
    for (const k of killMats) k.m.color.copy(k.base).multiplyScalar(pulse);
    if (convT) convT.offset.x = (-t * 0.6) % 1;
    if (beamMat) { beamMat.uniforms.uTime.value = t; beamMat.uniforms.uReached.value = S.stage ?? -1; }
    if (me) for (const l of spriteLOD) { const d2 = (l.x - me.x) ** 2 + (l.z - me.z) ** 2 + ((l.y - me.y) * 0.6) ** 2; l.sp.visible = d2 > l.near2 && d2 < l.far2; }
    if (cloudMat) cloudMat.uniforms.uTime.value = t;
    neonTime.value = t; balloonTime.value = t;
    for (const l of searchlights) l.g.rotation.set(0.42 + Math.sin(t * 0.21 + l.ph) * 0.18, t * 0.25 + l.ph, 0, 'YXZ');
}

// =====================================================================================
// Built in slices with a pause between them (pause() returns a promise), so the page stays
// responsive and the server connection that runs alongside keeps moving.
// =====================================================================================
export async function buildWorld(pause) {
    pause = pause || (() => Promise.resolve());
    buildShell();
    await pause();
    buildLobby();
    await pause();
    buildCourse();
    await pause();
    buildRoof();
    buildFinish();
    buildSkyIslands();
    buildBalloons();
    buildDecor();
    buildArrows();
    flushGeo();
    freezeStatic();
    cullZones(-1);
}
// The look of where you are: the sky mood and the floating particles
export function moodOf(stage, y) {
    if (y > ROOF_Y - 4) return { mood: 'warm', amb: { color: 0xffe08a, dir: 0.4 } };
    if (stage == null || stage < 0) return { mood: 'day', amb: { color: 0xffffff, dir: 0.5 } };
    const b = BANDS[bandOf(stage)];
    return { mood: b.mood, amb: { color: b.light, dir: 0.5 } };
}

// Gets every shader and texture onto the GPU while the loading screen shows, without freezing the
// page: the shaders compile in the background (compileAsync), the depth shaders the sun's shadow
// pass draws with included, then the textures upload and a GPU fence says when they're done. The
// stand-ins made here are kept, so their shaders stay alive.
const SHADOW_SIDE = { [T.FrontSide]: T.BackSide, [T.BackSide]: T.FrontSide, [T.DoubleSide]: T.DoubleSide };
const warmKeep = [];
export async function warmUp(renderer, camera, pause) {
    const vis = [];
    scene.traverse((o) => { if (o !== scene && !o.visible) { vis.push(o); o.visible = true; } });
    try { await renderer.compileAsync(scene, camera); } catch (e) { renderer.compile(scene, camera); }
    if (renderer.shadowMap.enabled) {
        const kinds = new Map();
        scene.traverse((o) => {
            if (!o.isMesh || !o.castShadow) return;
            for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
                const side = m.shadowSide ?? SHADOW_SIDE[m.side];
                const key = [o.isSkinnedMesh, o.isInstancedMesh, !!(o.isInstancedMesh && o.instanceColor), !!m.map, side, m.alphaTest > 0].join();
                if (kinds.has(key)) continue;
                const d = new T.MeshDepthMaterial({ side, map: m.map, alphaMap: m.alphaMap, alphaTest: m.alphaTest });
                let p;
                if (o.isSkinnedMesh) { p = new T.SkinnedMesh(o.geometry, d); p.bind(o.skeleton, o.bindMatrix); }
                else if (o.isInstancedMesh) { p = new T.InstancedMesh(o.geometry, d, 1); if (o.instanceColor) p.setColorAt(0, new T.Color(1, 1, 1)); }
                else p = new T.Mesh(o.geometry, d);
                kinds.set(key, p);
            }
        });
        const stand = new T.Group();
        for (const p of kinds.values()) stand.add(p);
        const rt = new T.WebGLRenderTarget(1, 1);
        const prev = renderer.getRenderTarget(), fog = scene.fog;
        let ready = null;
        renderer.setRenderTarget(rt);
        scene.fog = null;
        try { ready = renderer.compileAsync(stand, camera, scene); } catch (e) { /* compiles on first use */ }
        scene.fog = fog;
        renderer.setRenderTarget(prev);
        if (ready) { try { await ready; } catch (e) { /* compiles on first use */ } }
        rt.dispose();
        warmKeep.push(stand);
        try { renderer.compile(new T.Group(), camera, scene); } catch (e) { /* next frame */ }
    }
    for (const o of vis) o.visible = false;
    const texs = new Set();
    scene.traverse((o) => {
        const ms = o.material ? (Array.isArray(o.material) ? o.material : [o.material]) : [];
        for (const m of ms) {
            for (const k of ['map', 'normalMap', 'emissiveMap', 'alphaMap']) if (m[k]) texs.add(m[k]);
            if (m.uniforms) for (const k in m.uniforms) { const v = m.uniforms[k] && m.uniforms[k].value; if (v && v.isTexture) texs.add(v); }
        }
    });
    let n = 0;
    for (const t of texs) {
        renderer.initTexture(t);
        if (++n % 16 === 0) await pause();
    }
    const gl = renderer.getContext();
    if (gl.fenceSync) {
        const sync = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
        gl.flush();
        const t0 = performance.now();
        while (gl.clientWaitSync(sync, 0, 0) === gl.TIMEOUT_EXPIRED && performance.now() - t0 < 8000) await new Promise((r) => setTimeout(r, 15));
        gl.deleteSync(sync);
    }
    cullZones(-1);
}
export { textCanvas, bearTrap, stageAt };
