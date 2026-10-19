// Tool models: the slap gloves (a cartoon hand with a cuff, one merged mesh with the colours in its
// vertices, a rainbow for the Mega Punch), the Laser Gun, the coils, the flying carpet and the bear
// trap. The same models stand on the lobby stands, ride in your hand, lie under your feet (the
// carpet) or swing from the giant slap traps. Matte plastic with a little glow.
import { T, matte, mergeChildren } from './engine.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { carpetTex } from './materials.js';
import { gloveById } from '../../shared/config.js';

const mats = new Map();
const gm = (key, make) => { if (!mats.has(key)) mats.set(key, make()); return mats.get(key); };
const plastic = (color, glow) => gm('p' + color + '|' + (glow || 0), () => matte({ color, emissive: color, emissiveIntensity: glow ?? 0.25 }));
// one shared vertex-colour material for every glove
export const gloveMaterial = () => gm('glove', () => matte({ vertexColors: true, emissive: 0x222222, emissiveIntensity: 0.6 }));

// ----- the glove -----
// A right hand, palm facing +z, fingers up (+y), about 3 studs tall, centred on the wrist
const tmpC = new T.Color();
function painted(geo, color) {
    const p = geo.attributes.position, a = new Float32Array(p.count * 3);
    for (let i = 0; i < p.count; i++) {
        const c = typeof color === 'function' ? color(p.getX(i), p.getY(i), p.getZ(i)) : tmpC.set(color);
        a[i * 3] = c.r; a[i * 3 + 1] = c.g; a[i * 3 + 2] = c.b;
    }
    geo.setAttribute('color', new T.BufferAttribute(a, 3));
    for (const k of Object.keys(geo.attributes)) if (!['position', 'normal', 'color'].includes(k)) geo.deleteAttribute(k);
    return geo.index ? geo.toNonIndexed() : geo;
}
const gloveGeos = new Map();
export function gloveGeometry(color, opts) {
    opts = opts || {};
    const key = color + '|' + (opts.rainbow ? 1 : 0) + '|' + (opts.cuff ?? '');
    if (gloveGeos.has(key)) return gloveGeos.get(key);
    const base = new T.Color(color), shade = base.clone().multiplyScalar(0.78), cuffC = new T.Color(opts.cuff ?? 0xffffff);
    const hue = (y) => tmpC.setHSL(((y + 0.6) / 3.4) % 1, 0.9, 0.58);
    const col = opts.rainbow ? (x, y) => hue(y) : base;
    const parts = [];
    // the palm: a squashed, rounded block
    const palm = new T.SphereGeometry(1, 16, 12); palm.scale(0.95, 1.05, 0.45); palm.translate(0, 0.95, 0);
    parts.push(painted(palm, col));
    // four fingers, slightly fanned
    [[-0.66, 1.0, 0.16], [-0.22, 1.18, 0.05], [0.24, 1.12, -0.05], [0.66, 0.92, -0.18]].forEach(([x, len, tilt]) => {
        const f = new T.CapsuleGeometry(0.25, len, 4, 10);
        f.rotateZ(tilt); f.translate(x - Math.sin(tilt) * len * 0.5, 1.78 + len * 0.5 * Math.cos(tilt), 0);
        parts.push(painted(f, col));
    });
    // the thumb, out to the side
    const th = new T.CapsuleGeometry(0.27, 0.8, 4, 10); th.rotateZ(1.0); th.translate(-1.15, 0.95, 0.1);
    parts.push(painted(th, opts.rainbow ? col : shade));
    // the cuff at the wrist
    const cuff = new T.CylinderGeometry(0.78, 0.72, 0.55, 18); cuff.scale(1.05, 1, 0.62); cuff.translate(0, -0.05, 0);
    parts.push(painted(cuff, cuffC));
    const g = mergeGeometries(parts);
    g.computeVertexNormals();
    gloveGeos.set(key, g);
    return g;
}
export function gloveMesh(id, scale) {
    const d = gloveById[id] || gloveById.slap;
    const m = new T.Mesh(gloveGeometry(d.color, { rainbow: d.rainbow, cuff: d.id === 'shadow' ? 0x9a8aff : d.id === 'slap' || d.id === 'big' ? 0xd8dce8 : 0xffffff }), gloveMaterial());
    m.scale.setScalar(scale || 1);
    m.castShadow = true;
    return m;
}

class Helix extends T.Curve {
    constructor(r, h, turns) { super(); this.r = r; this.h = h; this.turns = turns; }
    getPoint(t, out) { const a = t * Math.PI * 2 * this.turns; return (out || new T.Vector3()).set(Math.cos(a) * this.r, t * this.h - this.h / 2, Math.sin(a) * this.r); }
}
const helixGeo = new T.TubeGeometry(new Helix(0.95, 2.8, 5.5), 88, 0.18, 6, false);
function coil(color) {
    const g = new T.Group();
    const spring = new T.Mesh(helixGeo, plastic(color, 0.35)); spring.castShadow = true; g.add(spring);
    const cap = new T.Mesh(new T.CylinderGeometry(1.1, 1.1, 0.24, 24), plastic(0xf4f4ff, 0.1));
    cap.position.y = -1.48; g.add(cap);
    const cap2 = cap.clone(); cap2.position.y = 1.48; g.add(cap2);
    return g;
}
// The Laser Gun: a dark body with glowing cyan bands and tip
function laserGun() {
    const g = new T.Group();
    const teal = plastic(0x2ad8ff, 0.55), dark = plastic(0x22263a, 0.05), white = plastic(0xffffff, 0.2);
    const body = new T.Mesh(new T.CapsuleGeometry(0.55, 1.9, 6, 14), dark); body.rotation.x = Math.PI / 2; body.castShadow = true; g.add(body);
    for (const z of [-0.6, 0.1, 0.8]) { const band = new T.Mesh(new T.TorusGeometry(0.58, 0.12, 6, 20), teal); band.position.z = z; g.add(band); }
    const barrel = new T.Mesh(new T.CylinderGeometry(0.28, 0.36, 1.3, 14), white); barrel.rotation.x = Math.PI / 2; barrel.position.z = 1.75; g.add(barrel);
    const tip = new T.Mesh(new T.SphereGeometry(0.34, 14, 10), teal); tip.position.z = 2.45; g.add(tip);
    const fin = new T.Mesh(new T.BoxGeometry(0.12, 0.7, 1.1), teal); fin.position.set(0, 0.7, -0.2); g.add(fin);
    const grip = new T.Mesh(new T.BoxGeometry(0.5, 1.3, 0.6), dark); grip.position.set(0, -0.9, -0.55); grip.rotation.x = 0.3; g.add(grip);
    return g;
}
// The bear trap: a grey ring of jagged teeth on a plate
export function bearTrap() {
    const g = new T.Group();
    const steel = plastic(0x9aa0b0, 0.08), dark = plastic(0x4a4e5a, 0.04), red = plastic(0xff3a4a, 0.4);
    const plate = new T.Mesh(new T.CylinderGeometry(1.5, 1.6, 0.18, 24), dark); plate.position.y = 0.09; g.add(plate);
    const ring = new T.Mesh(new T.TorusGeometry(1.25, 0.13, 6, 24), steel); ring.rotation.x = Math.PI / 2; ring.position.y = 0.25; g.add(ring);
    for (let k = 0; k < 14; k++) {
        const a = k / 14 * Math.PI * 2;
        const t = new T.Mesh(new T.ConeGeometry(0.16, 0.6, 4), steel);
        t.position.set(Math.cos(a) * 1.22, 0.55, Math.sin(a) * 1.22); g.add(t);
    }
    const trig = new T.Mesh(new T.CylinderGeometry(0.42, 0.42, 0.14, 14), red); trig.position.y = 0.26; g.add(trig);
    return g;
}
export function carpet(scale) {
    const g = new T.Group();
    const geo = new T.PlaneGeometry(4.2, 6, 10, 14);
    geo.rotateX(-Math.PI / 2);
    const m = gm('carpet', () => matte({ map: carpetTex(), side: T.DoubleSide, emissive: 0xffffff, emissiveMap: carpetTex(), emissiveIntensity: 0.25 }));
    const cloth = new T.Mesh(geo, m); cloth.castShadow = true; g.add(cloth);
    g.userData.cloth = cloth;
    g.userData.base = Float32Array.from(geo.attributes.position.array);
    const tassel = plastic(0xffd028, 0.3);
    for (const [x, z] of [[-2.1, -3], [2.1, -3], [-2.1, 3], [2.1, 3]]) {
        const t = new T.Mesh(new T.ConeGeometry(0.22, 0.7, 8), tassel); t.position.set(x * 1.03, 0, z * 1.03); t.rotation.x = z > 0 ? Math.PI / 2 : -Math.PI / 2; g.add(t);
    }
    g.scale.setScalar(scale || 1);
    g.traverse((o) => { if (o.isMesh) o.receiveShadow = true; });
    return g;
}
// Ripple the carpet cloth like it's floating on the wind (at most 30 times a second)
export function waveCarpet(g, t, amt) {
    const cloth = g.userData.cloth, base = g.userData.base;
    if (!cloth || t - (g.userData.waveT || -1) < 1 / 30) return;
    g.userData.waveT = t;
    const p = cloth.geometry.attributes.position;
    for (let i = 0; i < p.count; i++) {
        const x = base[i * 3], z = base[i * 3 + 2];
        p.array[i * 3 + 1] = Math.sin(z * 1.3 + t * 6) * 0.14 * amt + Math.sin(x * 1.8 + t * 4) * 0.06 * amt;
    }
    p.needsUpdate = true;
    cloth.geometry.computeVertexNormals();
}

const BUILD = {
    speedCoil: () => coil(0xff3a4a),
    gravityCoil: () => coil(0x3a8aff),
    laser: () => laserGun(),
    bearTrap: () => bearTrap(),
    carpet: () => carpet(0.75),
};
// A tool model, about 3 studs tall, centred on its own origin
export function gearModel(id) {
    if (gloveById[id]) { const g = new T.Group(); const m = gloveMesh(id); m.position.y = -1.2; g.add(m); return g; }
    const f = BUILD[id];
    const g = f ? f() : new T.Group();
    if (id !== 'carpet') mergeChildren(g);
    g.traverse((o) => { if (o.isMesh) o.receiveShadow = true; });
    return g;
}
// A smaller copy to hold in the right hand. Gloves sit on the hand, palm forward, ready to slap
export function heldModel(id) {
    if (id === 'carpet') return null;
    const holder = new T.Group();
    if (gloveById[id]) {
        const d = gloveById[id];
        const m = gloveMesh(id, 0.62 * (d.scale || 1));
        m.rotation.set(-0.35, 0, -0.25);
        m.position.set(0, -0.35, 0.25);
        holder.add(m);
        holder.userData.glove = true;
        return holder;
    }
    const g = gearModel(id);
    if (id.endsWith('Coil')) { g.scale.setScalar(0.42); g.position.set(0, -0.2, 0.7); }
    else if (id === 'laser') { g.scale.setScalar(0.6); g.position.set(0, -0.15, 0.95); }
    else if (id === 'bearTrap') { g.scale.setScalar(0.55); g.position.set(0, -0.4, 0.8); g.rotation.x = -1.2; }
    holder.add(g);
    return holder;
}
