// The Troll Easy Tower layout as plain data, shared by the client (which builds meshes and
// colliders from it) and the server (which checks checkpoints, coins and the top against it).
//
// The tower is a giant studded block 112 x 112 studs (outer walls at x, z = ±56) floating over the
// ocean. The lobby is its ground floor; the terrace outside its south wall holds the slap gloves.
// The course spirals up the OUTSIDE of the tower in the open sky, like the reference: one wall per
// stage from corner to corner, 32 stages, eight laps (two per colour band), a landing with the
// checkpoint at every corner. Every stage is built from obstacle modules (white
// sky stairs, hops, red drop slabs, truss towers up to floating boxes, springs, slap hands, punching
// walls, fake and invisible blocks, keyboards, spinners, lasers...) sized by the stage's
// difficulty. The last stage ends at the roof (where a fake WIN pad is a trapdoor), and the rainbow
// path leads out to the real WIN pad. Fall off the course and you're back at your checkpoint.
//
// Path coordinates per wall ("side"): u along the wall from one corner landing to the next (0..136),
// v sideways, positive toward the tower (its wall face is at v = +12); outside is open sky.
// Coordinates are studs; y is the top of what you stand on.
import { CFG, STAGES, rngFrom } from './config.js';

export const A = 56, WT = 2, IN = A - WT;      // outer half size, wall thickness, inner face
export const LANE = A + 12;                    // the course runs 12 studs out from the walls
export const LOBBY_H = 34;                     // the lobby's ceiling
const K = [[-LANE, -LANE], [-LANE, LANE], [LANE, LANE], [LANE, -LANE]];
export const stageSide = (i) => i % 4;
const mod4 = (s) => ((s % 4) + 4) % 4;
const lerp = (a, b, k) => a + (b - a) * k;
const clampN = (v, a, b) => Math.max(a, Math.min(b, v));

export const COURSE = [];      // every element: { t, zone, side, ... } (see the builders below)
export const CHECKPOINTS = []; // { i, x, y, z, yaw }: the start pad of stage i (y = its top)
export const COINS = [];       // { i, x, y, z, zone }: troll coins, +1 Win each
export const OPENINGS = [];    // { w, t0, t1, y0, y1 }: doorways in wall w (0 W, 1 N, 2 E, 3 S), t along the wall
export const HOLES = [];       // { x0, x1, z0, z1 }: holes in the roof
export const DOLLS = [];       // red light / green light: { zone, x, y, z, yaw, box, reset, period }
export const GIANTS = [];      // giants walking a line: { zone, ax, az, bx, bz, y, period, scale, kill }
export const START_Y = [];     // the height of every stage's start (START_Y[32]: the roof)
export const STAGE_BOX = [];   // the space each stage owns (fall out of all of them and you're out)
export const BOARDS = [];      // the STAGE boards on the tower wall: { i, w, t, y, x, z, nx, nz }
let coinN = 0;

export function frame(s) {
    s = mod4(s);
    const a = K[s], b = K[(s + 1) % 4];
    const dx = Math.sign(b[0] - a[0]), dz = Math.sign(b[1] - a[1]);
    const mx = (a[0] + b[0]) / 2, mz = (a[1] + b[1]) / 2;
    const nx = mx === 0 ? 0 : -Math.sign(mx), nz = mz === 0 ? 0 : -Math.sign(mz);
    const alongX = dx !== 0;
    return {
        s, dx, dz, nx, nz, alongX,
        X: (u, v) => a[0] + dx * u + nx * v, Z: (u, v) => a[1] + dz * u + nz * v,
        SX: (lu, lv) => (alongX ? lu : lv), SZ: (lu, lv) => (alongX ? lv : lu),
        OX: (du, dv) => dx * du + nx * dv, OZ: (du, dv) => dz * du + nz * dv,
        // the wall's own axis: x on the north and south walls, z on the west and east walls
        T: (u) => (alongX ? a[0] + dx * u : a[1] + dz * u),
        yaw: Math.atan2(dx, dz),
    };
}
export const stageFrame = (i) => frame(stageSide(i));
// the wall a side runs along: 0 west, 1 north, 2 east, 3 south (the same numbering as frame())
// An axis-aligned box in world space from a u/v rectangle
function uvBox(f, u0, u1, v0, v1) {
    const xa = f.X(u0, v0), xb = f.X(u1, v1), za = f.Z(u0, v0), zb = f.Z(u1, v1);
    return { x0: Math.min(xa, xb), x1: Math.max(xa, xb), z0: Math.min(za, zb), z1: Math.max(za, zb) };
}

// ----- the builders for one stage, in its wall's u / v frame (tops are absolute heights) -----
function builder(i, f) {
    const zone = i;
    const push = (o) => { o.zone = zone; o.side = f.s; COURSE.push(o); return o; };
    const box = (t, u, v, lu, lv, top, h, extra) => push({ t, x: f.X(u, v), y: top - h / 2, z: f.Z(u, v), sx: f.SX(lu, lv), sy: h, sz: f.SZ(lu, lv), ...extra });
    return {
        f, zone,
        // a studded block; color: a palette name (band = the stage's colour, white, green, grey...)
        block: (u, v, lu, lv, top, h, color, extra) => box('block', u, v, lu, lv, top, h ?? 1.6, { color: color || 'band', ...(extra || {}) }),
        // TROLL: looks exactly like a block, but you fall right through it
        fake: (u, v, lu, lv, top, h, color) => box('fake', u, v, lu, lv, top, h ?? 1.6, { color: color || 'band' }),
        // an invisible block (a faint shimmer gives it away)
        ghost: (u, v, lu, lv, top) => box('ghost', u, v, lu, lv, top, 1),
        // slippery
        ice: (u, v, lu, lv, top, h, color) => box('block', u, v, lu, lv, top, h ?? 1.4, { color: color || 'ice', ice: true, mat: 'ice' }),
        // a red slab that shakes and drops away a moment after you touch it, then comes back
        vanish: (u, v, lu, lv, top, fuse) => box('vanish', u, v, lu, lv, top, 1.2, { fuse: fuse || 0.6 }),
        // a block that blinks on and off (on for `on` of every `period` seconds; it flashes first)
        timed: (u, v, lu, lv, top, period, phase, on) => box('timed', u, v, lu, lv, top, 1.2, { period, phase, on }),
        // a glowing kill brick: touch it and you're back at the checkpoint
        kill: (u, v, lu, lv, top, h) => box('kill', u, v, lu, lv, top, h ?? 0.8),
        truss: (u, v, lu, lv, bottom, top) => push({ t: 'truss', x: f.X(u, v), y: (bottom + top) / 2, z: f.Z(u, v), sx: f.SX(lu, lv), sy: top - bottom, sz: f.SZ(lu, lv) }),
        // a moving platform: du / dv / dy how far it swings each way, period in seconds
        mover: (u, v, lu, lv, top, du, dv, dy, period, phase, color) => push({
            t: 'mover', x: f.X(u, v), y: top - 0.75, z: f.Z(u, v), sx: f.SX(lu, lv), sy: 1.5, sz: f.SZ(lu, lv),
            ax: f.OX(du, dv), ay: dy, az: f.OZ(du, dv), period, phase: phase || 0, color: color || 'grey',
        }),
        // a belt that carries you along (du, dv) at `speed` studs a second
        conveyor: (u, v, lu, lv, top, du, dv, speed) => box('conveyor', u, v, lu, lv, top, 1.4, { px: f.OX(du, dv) * speed, pz: f.OZ(du, dv) * speed }),
        // a trampoline: throws you `apex` studs up (tube: a red spring in a glass tube, open toward -u)
        bounce: (u, v, r, top, apex, tube) => push({ t: 'bounce', x: f.X(u, v), z: f.Z(u, v), top, r, v: Math.sqrt(2 * CFG.grav * apex), tube: !!tube, dx: f.dx, dz: f.dz }),
        // a squishy pink ball half sunk in its stand (stand on the top)
        dome: (u, v, r, top, color) => push({ t: 'dome', x: f.X(u, v), z: f.Z(u, v), y0: top - r * 0.85, r, h: r * 0.85, color: color || 'pink' }),
        spinner: (u, v, r, top, speed) => push({ t: 'spinner', x: f.X(u, v), z: f.Z(u, v), top, r, speed }),
        sweeper: (u, v, len, top, speed, phase) => push({ t: 'sweeper', x: f.X(u, v), z: f.Z(u, v), y: top, len, speed, phase: phase || 0 }),
        // a giant slap hand on an arm turning round a post
        slapper: (u, v, top, len, speed, phase) => push({ t: 'slapper', x: f.X(u, v), z: f.Z(u, v), y: top, len, speed, phase: phase || 0, mode: 'spin', amp: 0, base: 0 }),
        // a glove punching OUT of the tower wall, across the walkway and off into the sky
        punch: (u, top, reach, period, phase) => push({ t: 'punch', x: f.X(u, 12), y: top + 2.2, z: f.Z(u, 12), dx: -f.nx, dz: -f.nz, reach, period, phase: phase || 0, alongX: f.alongX }),
        // a red laser bar across the walkway bobbing up and down: under it when it's up, over it when it's down
        laser: (u, v, len, top, period, phase) => push({ t: 'laser', x: f.X(u, v), z: f.Z(u, v), top, len, alongX: !f.alongX, period, phase: phase || 0 }),
        // a keyboard key with a letter on top (fake keys drop you)
        key: (u, v, top, letter, fake) => box(fake ? 'fake' : 'key', u, v, 4, 3.6, top, 1.6, { letter, color: 'key', key: true, dx: f.dx, dz: f.dz }),
        // a troll sign on a post: text lines, facing back down the path (or out to the sky)
        sign: (u, v, top, lines, face) => push({ t: 'sign', x: f.X(u, v), y: top, z: f.Z(u, v), lines, yaw: face === 'out' ? Math.atan2(-f.nx, -f.nz) : Math.atan2(-f.dx, -f.dz) }),
        // a banana peel (decor on the banana slabs)
        banana: (u, v, top) => push({ t: 'banana', x: f.X(u, v), y: top, z: f.Z(u, v), yaw: (u * 1.7 + v) % 6.28 }),
        coin: (u, v, top) => { const o = { i: coinN++, x: f.X(u, v), y: top, z: f.Z(u, v), zone }; COINS.push(o); push({ t: 'coin', ...o }); },
        // a wooden plank bridge running along v (from v0 to v1 at u, w wide) or along u
        planks: (u, v0, v1, top, w) => box('plank', u, (v0 + v1) / 2, w || 6, Math.abs(v1 - v0), top, 1.2, { color: 'wood', mat: 'wood' }),
        planksU: (u0, u1, v, top, w) => box('plank', (u0 + u1) / 2, v, Math.abs(u1 - u0), w || 6, top, 1.2, { color: 'wood', mat: 'wood' }),
        // a floating island in the sky
        island: (u0, u1, v0, v1, top) => box('island', (u0 + u1) / 2, (v0 + v1) / 2, Math.abs(u1 - u0), Math.abs(v1 - v0), top, 3, { color: 'green' }),
        box: uvBox.bind(null, f),
    };
}

// ===================== the obstacle modules =====================
// Each takes the cursor s = { u: far edge of the last thing, top, v } and a length budget, adds its
// elements after a gap, and moves the cursor to its own far edge. Jump reach at walking speed is
// about 9 studs flat, 8 for a +2 rise (edge to edge, feet over the edge); every gap here leaves room
// to spare, and the QA bot plays them all.
const MODULES = {
    // white sky stairs (the reference's floating white steps); from midway some steps are missing
    steps(c, s, d, budget, rnd) {
        const w = lerp(8, 3.6, d), dep = 2.2, n = clampN(Math.floor((budget - 1.5) / dep), 3, 12);
        const gone = (k) => k < n - 1 && (d > 0.7 ? k % 2 === 1 : d > 0.35 && k % 3 === 2), u0 = s.u + 1.2;
        for (let k = 0; k < n; k++) {
            if (gone(k)) continue;
            c.block(u0 + k * dep + dep / 2, 0, dep, w, s.top + (k + 1), 1.2, 'white');
        }
        if (rnd() < 0.6) c.coin(u0 + (n - 1) * dep, 0, s.top + n + 2.6);
        s.u = u0 + n * dep; s.top += n; s.v = 0;
    },
    // blocks to hop across
    hops(c, s, d, budget, rnd) {
        const sz = lerp(5.6, 2.8, d), g = lerp(2.4, 5.9, d), r = lerp(0.5, 1.3, d), jit = lerp(1.2, 2.7, d);
        const n = Math.max(1, Math.floor(budget / (sz + g)));
        for (let k = 0; k < n; k++) {
            const u0 = s.u + g, v = (k % 2 ? 1 : -1) * jit * (0.6 + rnd() * 0.4), top = s.top + r;
            if (d > 0.55 && k % 3 === 1) c.vanish(u0 + sz / 2, v, sz, sz, top, lerp(0.75, 0.4, d));
            else c.block(u0 + sz / 2, v, sz, sz, top, 1.6, k % 3 === 2 ? 'white' : undefined);
            if (k === 1 && rnd() < 0.7) c.coin(u0 + sz / 2, v, top + 2.6);
            s.u = u0 + sz; s.top = top; s.v = v;
        }
    },
    // red slabs that drop away a moment after you touch them
    redSlabs(c, s, d, budget, rnd) {
        const sz = lerp(4.6, 2.8, d), g = lerp(2, 4.6, d), r = lerp(0.3, 1, d), jit = lerp(1, 2.6, d);
        const n = Math.max(1, Math.floor(budget / (sz + g)));
        for (let k = 0; k < n; k++) {
            const u0 = s.u + g, v = (k % 2 ? 1 : -1) * jit * (0.5 + rnd() * 0.5), top = s.top + r;
            c.vanish(u0 + sz / 2, v, sz, sz, top, lerp(0.75, 0.4, d));
            s.u = u0 + sz; s.top = top; s.v = v;
        }
    },
    // a truss up to a floating green box (the reference's truss towers)
    trussBox(c, s, d, budget) {
        const H = lerp(6, 12, d), B = lerp(8, 5.5, d), n = Math.max(1, Math.floor(budget / 17.5));
        for (let k = 0; k < n; k++) {
            const u0 = s.u + 2, base = s.top + 0.5;
            c.block(u0 + 3, 0, 6, 6, base, 2, 'white');
            c.truss(u0 + 6.75, 0, 1.5, 5, base, base + H);
            c.block(u0 + 7.5 + B / 2, 0, B, B, base + H, 2, 'green');
            if (d < 0.3 && k === 0) c.sign(u0 + 1.5, -4.5, base, ['WALK INTO IT', 'TO CLIMB ⬆']);
            if (k === 0) c.coin(u0 + 7.5 + B / 2, 1.5, base + H + 2.6);
            s.u = u0 + 7.5 + B; s.top = base + H; s.v = 0;
        }
    },
    // a long thin beam; from early on, kill bricks across it to jump
    beam(c, s, d, budget) {
        const w = lerp(3, 1.2, d), L = clampN(budget - 2, 10, 30), top = s.top + 0.5;
        c.block(s.u + 2 + L / 2, 0, L, w, top, 1.2, 'white');
        const kills = d > 0.15 ? Math.round(lerp(1, 4, clampN((d - 0.15) / 0.75, 0, 1)) * L / 20) : 0;
        for (let k = 0; k < kills; k++) c.kill(s.u + 2 + L * (k + 1) / (kills + 1), 0, 1.4, w + 0.3, top + 0.4);
        s.u += 2 + L; s.top = top; s.v = 0;
    },
    // a platform with a giant slap hand turning over it
    slapHand(c, s, d, budget, rnd) {
        const P = lerp(9, 6.4, d), g = lerp(2.4, 4, d), n = Math.max(1, Math.floor(budget / (P + g)));
        for (let k = 0; k < n; k++) {
            const sp = lerp(1.1, 2.7, d) * (rnd() < 0.5 ? -1 : 1), u = s.u + g + P / 2, top = s.top + 1;
            c.block(u, 0, P, P, top, 2, 'white');
            c.slapper(u, 0, top, 3.8, sp, rnd() * 6);
            if (k === 0) c.coin(u, 0, top + 5.4);
            s.u = u + P / 2; s.top = top; s.v = 0;
        }
    },
    // a walkway along the wall, gloves punching out of it to knock you off
    punchWall(c, s, d, budget, rnd) {
        const L = clampN(budget - 2, 14, 30), n = Math.max(2, Math.round(L / lerp(7, 5.5, d))), per = lerp(3, 1.9, d), top = s.top + 0.5;
        const u0 = s.u + 2;
        c.block(u0 + L / 2, 6.6, L, lerp(3.4, 2.6, d), top, 1.4, 'white');
        for (let k = 0; k < n; k++) c.punch(u0 + L * (k + 0.5) / n, top, 10.5, per, k / n + rnd() * 0.1);
        s.u = u0 + L; s.top = top; s.v = 6.6;
    },
    // a red spring in a glass tube throws you up to a higher block
    spring(c, s, d, budget) {
        const apex = lerp(11, 13.5, d), rise = lerp(6, 8.5, d), g = lerp(3.6, 5.8, d), T = lerp(6, 4.6, d), n = Math.max(1, Math.floor(budget / (15 + g)));
        for (let k = 0; k < n; k++) {
            const u0 = s.u + 2, base = s.top + 0.5;
            c.block(u0 + 3.5, 0, 7, 7, base, 2, 'white');
            c.bounce(u0 + 3.5, 0, 2.2, base + 0.5, apex, true);
            c.block(u0 + 7 + g + T / 2, 0, T, T, base + rise, 2);
            s.u = u0 + 7 + g + T; s.top = base + rise; s.v = 0;
        }
    },
    // pairs of identical blocks: one of each pair is fake
    fakePair(c, s, d, budget, rnd) {
        const sz = lerp(4.6, 3, d), g = lerp(2.4, 4.4, d), r = lerp(0.4, 1.1, d), lanes = d > 0.6 ? [-3, 0, 3] : [-2.8, 2.8];
        const n = Math.max(1, Math.floor(budget / (sz + g)));
        for (let k = 0; k < n; k++) {
            const u0 = s.u + g, real = lanes[Math.floor(rnd() * lanes.length)], top = s.top + r;
            for (const v of lanes) {
                if (v === real) c.block(u0 + sz / 2, v, sz, sz, top, 1.6);
                else c.fake(u0 + sz / 2, v, sz, sz, top, 1.6);
            }
            if (k === 0) c.coin(u0 + sz / 2, lanes.find((v) => v !== real), top + 2.6);
            s.u = u0 + sz; s.top = top; s.v = real;
        }
    },
    // an invisible bridge (look for the shimmer)
    ghost(c, s, d, budget) {
        const sz = lerp(4.6, 3, d), g = lerp(2.4, 4.4, d), r = lerp(0.5, 1.2, d);
        const n = Math.max(1, Math.floor(budget / (sz + g)));
        if (d < 0.5) c.sign(s.u - 1.5, -5, s.top, ['🚧 BRIDGE UNDER', 'CONSTRUCTION 🚧']);
        for (let k = 0; k < n; k++) {
            const u0 = s.u + g, v = (k % 2 ? 1 : -1) * 1.6, top = s.top + r;
            c.ghost(u0 + sz / 2, v, sz, sz, top);
            s.u = u0 + sz; s.top = top; s.v = v;
        }
    },
    // giant keyboard keys, two rows; on most columns one key is fake
    keys(c, s, d, budget, rnd) {
        const g = lerp(1.8, 3.4, d), r = lerp(0.5, 1, d), word = 'TROLLEASYTOWER?!', n = Math.max(1, Math.floor(budget / (4 + g)));
        const rows = d > 0.6 ? [-4, 0, 4] : [-2.1, 2.1];
        for (let k = 0; k < n; k++) {
            const u0 = s.u + g, top = s.top + r, real = d > 0.2 ? Math.floor(rnd() * rows.length) : -1;
            rows.forEach((v, row) => c.key(u0 + 2, v, top, word[(k * rows.length + row) % word.length], real >= 0 && row !== real));
            s.u = u0 + 4; s.top = top; s.v = real >= 0 ? rows[real] : 0;
        }
    },
    // spinning discs (they carry you round)
    spinners(c, s, d, budget, rnd) {
        const r = lerp(4, 2.9, d), g = lerp(2.8, 4.2, d), rise = lerp(0.6, 1.2, d);
        const n = Math.max(1, Math.floor(budget / (2 * r + g)));
        for (let k = 0; k < n; k++) {
            const u = s.u + g + r, top = s.top + rise;
            c.spinner(u, 0, r, top, lerp(0.9, 2.2, d) * (k % 2 ? -1 : 1) * (0.85 + rnd() * 0.3));
            s.u = u + r; s.top = top; s.v = 0;
        }
    },
    // grey plates sliding side to side, with small blocks between them
    movers(c, s, d, budget, rnd) {
        const sz = lerp(5, 3.6, d), swing = lerp(4, 6.5, d), per = lerp(4, 2.5, d), g = lerp(3, 4.2, d);
        const n = Math.max(1, Math.floor(budget / (sz + g)));
        for (let k = 0; k < n; k++) {
            const u0 = s.u + g, top = s.top + lerp(0.4, 0.8, d);
            if (k % 2 === 0) c.mover(u0 + sz / 2, 0, sz, sz, top, 0, swing, 0, per, rnd());
            else c.block(u0 + sz * 0.4, 0, sz * 0.8, sz * 0.8, top, 1.6, 'grey');
            s.u = u0 + (k % 2 === 0 ? sz : sz * 0.8); s.top = top; s.v = 0;
        }
    },
    // squishy pink balls
    pinkBalls(c, s, d, budget) {
        const r = lerp(3, 2.3, d), g = lerp(1.8, 3.4, d), rise = lerp(0.8, 1.4, d);
        const n = Math.max(1, Math.floor(budget / (2 * r + g)));
        for (let k = 0; k < n; k++) {
            const u = s.u + g + r, v = (k % 2 ? 1 : -1) * 1.5, top = s.top + rise;
            c.dome(u, v, r, top);
            s.u = u + r; s.top = top; s.v = v;
        }
    },
    // a belt dragging you back (or, higher up, sideways toward the edge)
    conveyor(c, s, d, budget) {
        const L = clampN(budget - 2, 10, 24), w = lerp(5, 3.4, d), sp = lerp(6, 10.5, d), top = s.top + 0.5;
        if (d > 0.5) c.conveyor(s.u + 2 + L / 2, 0, L, w, top, 0, -1, sp * 0.6);
        else c.conveyor(s.u + 2 + L / 2, 0, L, w, top, -1, 0, sp);
        s.u += 2 + L; s.top = top; s.v = 0;
    },
    // a platform with a bar sweeping round it (jump over it)
    sweeper(c, s, d, budget, rnd) {
        const L = 9, n = Math.max(1, Math.floor(budget / (L + 2.4)));
        for (let k = 0; k < n; k++) {
            const top = s.top + 0.8, u = s.u + 2.4 + L / 2;
            c.block(u, 0, L, lerp(7, 6, d), top, 1.6, 'white');
            c.sweeper(u, 0, 3.6, top, lerp(2, 3.5, d) * (k % 2 ? -1 : 1), rnd() * 6);
            s.u = u + L / 2; s.top = top; s.v = 0;
        }
    },
    // a long narrow staircase hugging the wall (the reference's wall stairs); gaps higher up
    wallStairs(c, s, d, budget) {
        const w = lerp(4.4, 2.6, d), dep = 1.7, n = clampN(Math.floor((budget - 2) / dep), 5, 18), v = 8.4;
        const gone = (k) => k < n - 1 && (d > 0.75 ? k % 2 === 1 : d > 0.35 && k % 3 === 2), u0 = s.u + 2;
        for (let k = 0; k < n; k++) {
            if (gone(k)) continue;
            c.block(u0 + k * dep + dep / 2, v, dep, w, s.top + (k + 1), 1.2, 'white');
        }
        s.u = u0 + n * dep; s.top += n; s.v = v;
    },
    // a slippery slab with banana peels on it
    bananas(c, s, d, budget) {
        const L = clampN(budget - 2, 10, 22), w = lerp(6, 3.8, d), top = s.top + 0.5, u0 = s.u + 2, nb = Math.round(L / 4.5);
        c.ice(u0 + L / 2, 0, L, w, top, 1.4, 'banana');
        if (d > 0.55 && L >= 14) c.laser(u0 + L / 2, 0, w + 1.6, top, lerp(3, 2.2, d), 0.25);
        for (let k = 0; k < nb; k++) c.banana(u0 + L * (k + 0.6) / (nb + 0.4), (k % 2 ? 1 : -1) * w * 0.25, top);
        if (d < 0.6) c.sign(u0 - 1, -w / 2 - 2, s.top, ['🍌 BANANA', 'TRAP!']);
        s.u = u0 + L; s.top = top; s.v = 0;
    },
    // blocks that blink on and off in turn (they flash before they go)
    timed(c, s, d, budget) {
        const sz = lerp(5, 3.4, d), g = lerp(2.2, 3.8, d), per = lerp(3.4, 2.1, d), on = lerp(0.62, 0.52, d);
        const n = Math.max(1, Math.floor(budget / (sz + g)));
        for (let k = 0; k < n; k++) {
            const u0 = s.u + g, top = s.top + 0.6, v = (k % 2 ? 1 : -1) * 1.4;
            c.timed(u0 + sz / 2, v, sz, sz, top, per, k * 0.4, on);
            s.u = u0 + sz; s.top = top; s.v = v;
        }
    },
    // a walkway with laser bars bobbing across it
    laser(c, s, d, budget, rnd) {
        // (room to land before the first bar and to stand between bars)
        const L = clampN(budget - 2, 12, 26), w = lerp(5, 4, d), top = s.top + 0.5, u0 = s.u + 2, n = Math.max(1, Math.floor((L - 11) / 5.5) + 1);
        c.block(u0 + L / 2, 0, L, w, top, 1.6, 'grey');
        for (let k = 0; k < n; k++) c.laser(u0 + 6.5 + k * 5.5, 0, w + 1.6, top, lerp(3, 1.9, d), k * 0.37 + rnd() * 0.1);
        s.u = u0 + L; s.top = top; s.v = 0;
    },
};
// how much of the stage each kind of module likes, the least it needs, the side it starts on
const WEIGHT = { steps: 1, hops: 1.1, redSlabs: 1, trussBox: 1.2, beam: 1, slapHand: 1, punchWall: 1.2, spring: 1.2, fakePair: 1, ghost: 1, keys: 1, spinners: 1, movers: 1.1, pinkBalls: 1, conveyor: 0.9, sweeper: 1, wallStairs: 1.2, bananas: 1, timed: 1, laser: 1, doll: 3, giant: 2 };
const MIN_LEN = { steps: 8, hops: 9, redSlabs: 7, trussBox: 17.5, beam: 12, slapHand: 11.5, punchWall: 16, spring: 20.5, fakePair: 7.5, ghost: 7, keys: 7.5, spinners: 11, movers: 8, pinkBalls: 8, conveyor: 12, sweeper: 11.5, wallStairs: 11, bananas: 12, timed: 7.5, laser: 14, doll: 54, giant: 42 };
const ENTRY_V = { punchWall: 6.6, wallStairs: 8.4 };
// small stepping blocks over to where the next module starts, if it's far to the side
function shiftTo(c, s, v, tol = 3.2) {
    while (Math.abs(s.v - v) > tol) {
        const nv = s.v + Math.sign(v - s.v) * Math.min(4, Math.abs(v - s.v) - 1);
        c.block(s.u + 2.2 + 2, nv, 4, 4, s.top + 0.3, 1.6, 'white');
        s.u += 6.2; s.top += 0.3; s.v = nv;
    }
}

// ===================== the special stages =====================
// Red light, green light: plank bridges out to an island in the sky where the guard keeps watch
MODULES.doll = (c, s, d, budget) => {
    const u0 = s.u + 1.5, top = s.top, f = c.f, L = clampN(budget - 4, 50, 64), uEnd = u0 + L;
    c.block(u0 + 4, 0, 6, 8, top + 0.5, 1.6, 'green');
    c.planks(u0 + 4, -4, -14, top + 0.8, 5);
    c.planks(u0 + 4, -16.5, -26, top + 1.1, 5);
    c.island(u0 + 1, uEnd - 1, -48, -26, top + 1.5);
    c.planks(uEnd - 4, -26, -16.5, top + 2, 5);
    c.planks(uEnd - 4, -14, -4, top + 2.5, 5);
    c.block(uEnd - 4, 0, 6, 8, top + 3, 1.6, 'green');
    c.coin((u0 + uEnd) / 2 - 10, -36, top + 4.1);
    c.coin((u0 + uEnd) / 2 + 10, -36, top + 4.1);
    c.sign(u0 + 4, 5, top + 0.5, ['🚦 GREEN = GO', '🔴 RED = FREEZE!']);
    const b = c.box(u0 - 1, uEnd + 1, -52, -3);
    DOLLS.push({
        zone: c.zone, x: f.X((u0 + uEnd) / 2, -45), y: top + 1.5, z: f.Z((u0 + uEnd) / 2, -45), yaw: Math.atan2(f.OX(0, 1), f.OZ(0, 1)),
        box: { x0: b.x0, x1: b.x1, z0: b.z0, z1: b.z1, y0: top - 4, y1: top + 26 },
        reset: { x: f.X(u0 + 4, 0), y: top + 0.6, z: f.Z(u0 + 4, 0), yaw: Math.atan2(-f.nx, -f.nz) },
        // green for most of the cycle, a short warning, then red
        period: 6.6, green: 3.6, warn: 0.6,
    });
    s.u = uEnd - 1; s.top = top + 3; s.v = 0;
};
// a narrow sky path across a giant's road while he strides up and down it (his feet squash you)
MODULES.giant = (c, s) => {
    const u0 = s.u + 1, top = s.top, f = c.f, R = 9, mid = u0 + 12 + R, uEnd = mid + R + 11.5;
    c.block(u0 + 3, 0, 5, 7, top + 0.5, 1.6);
    c.planks(u0 + 3, -3.5, -14.5, top + 1, 3);
    c.planksU(u0 + 1.5, mid - R, -16, top + 1, 3);
    // the giant's road, out into the sky
    c.block(mid, -28, R * 2, 48, top + 1, 1.6, 'grey', { road: true });
    c.planksU(mid + R, uEnd - 1.5, -16, top + 1.5, 3);
    c.planks(uEnd - 3, -17.5, -3.5, top + 2, 3);
    c.block(uEnd - 3, 0, 5, 7, top + 2.5, 1.6);
    c.coin(mid, -40, top + 3.6);
    c.sign(u0 + 3, 4.5, top + 0.5, ['⚠️ GIANT', 'CROSSING ⚠️']);
    GIANTS.push({ zone: c.zone, ax: f.X(mid, -46), az: f.Z(mid, -46), bx: f.X(mid, -7), bz: f.Z(mid, -7), y: top + 1, period: 10, scale: 8, kill: true });
    s.u = uEnd - 0.5; s.top = top + 2.5; s.v = 0;
};

// ===================== the 32 stages =====================
// the landing a stage starts on, in its corner
function landingBox(i) {
    return { f: stageFrame(i), u0: -8, u1: 8, v0: -8, v1: 8, uc: 0 };
}
function pushLanding(i, top, zone, kind) {
    const { f, u0, u1, v0, v1 } = landingBox(i), b = uvBox(f, u0, u1, v0, v1);
    COURSE.push({ t: 'land', i, x: (b.x0 + b.x1) / 2, z: (b.z0 + b.z1) / 2, sx: b.x1 - b.x0, sz: b.z1 - b.z0, top, zone, side: f.s, kind: kind || 'mid' });
}
const N = STAGES.length;
START_Y[0] = 0;
for (let i = 0; i < N; i++) {
    const st = STAGES[i], f = stageFrame(i), c = builder(i, f), rnd = rngFrom(7001 + i * 977);
    const first = COURSE.length;
    const y0 = START_Y[i];
    // the start: the checkpoint pad on its landing (Stage 1 starts from the terrace)
    if (i > 0) pushLanding(i, y0, i, i % 8 === 0 ? 'band' : i % 4 === 0 ? 'lap' : 'corner');
    const lb = landingBox(i);
    // (Stage 1's pad sits right in front of the first steps: every way onto the course crosses it)
    const padU = i === 0 ? 10 : lb.uc;
    const cp = { i, x: f.X(padU, 0), y: y0, z: f.Z(padU, 0), yaw: f.yaw };
    CHECKPOINTS.push(cp);
    COURSE.push({ t: 'cp', ...cp, zone: i, side: f.s });
    // a Skip Stage pad next to every checkpoint (not on the last stage)
    if (i < N - 1) {
        const su = i === 0 ? 0 : 4.5, sv = i === 0 ? 7 : -5.5;
        COURSE.push({ t: 'skipPad', i, x: f.X(su, sv), y: y0, z: f.Z(su, sv), zone: i, side: f.s });
    }
    // the STAGE board on the wall behind the start
    // (clear of the corner pillar)
    const bu = 24;
    BOARDS.push({ i, w: f.s, x: f.X(bu, 11.9), y: y0 + 10, z: f.Z(bu, 11.9), nx: -f.nx, nz: -f.nz, t: f.T(bu) });
    const uStart = i === 0 ? 14 : 8, uEnd = 128;
    const s = { u: uStart, top: y0, v: 0 };
    // share the wall between the stage's modules by weight (each gets at least its minimum)
    // (the side-stepping blocks into and out of the wall-side modules take room too)
    const plan = st.plan, room = uEnd - uStart - 5 - plan.filter((m) => ENTRY_V[m]).length * 12;
    const wsum = plan.reduce((a, m) => a + WEIGHT[m], 0);
    plan.forEach((m, k) => {
        shiftTo(c, s, ENTRY_V[m] ?? 0);
        const last = k === plan.length - 1, left = uEnd - 5 - s.u - (last && ENTRY_V[m] > 6 ? 6.2 : 0);
        if (left < MIN_LEN[m]) { console.warn('[tower] stage', i + 1, 'has no room for', m); return; }
        const want = last ? left : room * WEIGHT[m] / wsum;
        MODULES[m](c, s, st.d, Math.max(MIN_LEN[m], Math.min(left, want)), rnd);
    });
    // over to the next landing (it's wide: only the wall stairs need a step back out), filler hops
    // if the gap is long, then a small step up
    shiftTo(c, s, 0, 6);
    const maxG = lerp(4.5, 5.6, st.d);
    while (uEnd - s.u > maxG + 0.5) {
        const r = uEnd - s.u, far = r > 4 + maxG * 1.6, sz = far ? 4 : Math.min(4, r - 2), u0 = s.u + (far ? maxG * 0.8 : (r - sz) / 2);
        c.block(u0 + sz / 2, 0, sz, 4, s.top + 0.5, 1.6, 'white');
        s.u = u0 + sz; s.top += 0.5; s.v = 0;
    }
    if (s.u > uEnd + 0.01) console.warn('[tower] stage', i + 1, 'runs past its landing by', (s.u - uEnd).toFixed(1));
    START_Y[i + 1] = +(s.top + lerp(0.6, 1.1, st.d)).toFixed(2);
    // the space this stage owns, from its start to the next landing
    let x0 = 1e9, x1 = -1e9, z0 = 1e9, z1 = -1e9, top = -1e9;
    for (let k = first; k < COURSE.length; k++) {
        const e = COURSE[k];
        const hx = (e.sx || (e.r || 1) * 2) / 2, hz = (e.sz || (e.r || 1) * 2) / 2;
        x0 = Math.min(x0, e.x - hx); x1 = Math.max(x1, e.x + hx); z0 = Math.min(z0, e.z - hz); z1 = Math.max(z1, e.z + hz);
        top = Math.max(top, e.top ?? (e.t === 'dome' ? e.y0 + e.h : e.y + (e.sy || 0) / 2));
    }
    const nb = landingBox(i + 1), b = uvBox(nb.f, nb.u0, nb.u1, nb.v0, nb.v1);
    x0 = Math.min(x0, b.x0); x1 = Math.max(x1, b.x1); z0 = Math.min(z0, b.z0); z1 = Math.max(z1, b.z1);
    STAGE_BOX.push({ i, x0: x0 - 6, x1: x1 + 6, z0: z0 - 6, z1: z1 + 6, y0: y0 - 12, y1: Math.max(top, START_Y[i + 1]) + 34 });
}
// TROLL: "FREE SKIP!" buttons on a few landings' outer edges: they throw you off the tower
for (const i of [5, 13, 21, 29]) {
    const f = stageFrame(i);
    COURSE.push({ t: 'bait', i, x: f.X(-5, -6.2), y: START_Y[i], z: f.Z(-5, -6.2), dx: -f.nx, dz: -f.nz, zone: i, side: f.s });
}

// ----- the roof: the last landing is the south-west corner, a bridge across onto the roof -----
export const ROOF_Y = START_Y[N];
pushLanding(N, ROOF_Y, N - 1, 'roof');
COURSE.push({ t: 'block', x: -56, y: ROOF_Y - 1.1, z: -56, sx: 12, sy: 2, sz: 12, color: 'white', zone: N - 1, side: 0 });
OPENINGS.push({ w: 0, t0: -A, t1: -46, y0: ROOF_Y - 0.5, y1: ROOF_Y + 9, zone: N - 1 });
OPENINGS.push({ w: 3, t0: -A, t1: -46, y0: ROOF_Y - 0.5, y1: ROOF_Y + 9, zone: N - 1 });
export const ROOF = { y: ROOF_Y, rim: 4 };
// TROLL: a shiny WIN pad right where you step onto the roof is a trapdoor into a troll pit
{
    const p = { x0: -42, x1: -32, z0: -42, z1: -32 };
    COURSE.push({ t: 'trollPit', x: (p.x0 + p.x1) / 2, z: (p.z0 + p.z1) / 2, sx: p.x1 - p.x0, sz: p.z1 - p.z0, y: ROOF_Y, depth: 7, zone: N - 1 });
    HOLES.push(p);
}
// the rim opens to the north, where the rainbow path runs out into the sky to the victory platform
OPENINGS.push({ w: 1, t0: -6, t1: 6, y0: ROOF_Y - 0.5, y1: ROOF_Y + 9, zone: N - 1 });
export const RAINBOW = [];
for (let k = 0; k < 11; k++) RAINBOW.push({ k, x: [0, 2.5, 0, -2.5][k % 4], y: ROOF_Y + 0.6 + k * 0.55, z: A + 6 + k * 7 });
for (const r of RAINBOW) COURSE.push({ t: 'rainbow', ...r, s: 5, zone: N - 1 });
export const FINISH = { x: 0, y: ROOF_Y + 7, z: RAINBOW[RAINBOW.length - 1].z + 20.5, pad: 6, half: 20 };
FINISH.x0 = -FINISH.half; FINISH.x1 = FINISH.half; FINISH.z0 = FINISH.z - 16; FINISH.z1 = FINISH.z + 16;
STAGE_BOX.push({ i: N - 1, x0: -80, x1: 64, z0: -80, z1: FINISH.z1 + 10, y0: ROOF_Y - 12, y1: FINISH.y + 60, roof: true });

// ===================== the lobby (ground floor) and the terrace =====================
export const LOBBY = { spawn: { x: 0, y: 0, z: 14 }, yaw: Math.PI };
// the south wall opens wide onto the terrace over the ocean
export const TERRACE = { x0: -82, x1: 82, z0: -132, z1: -A, open: { t0: -26, t1: 26, y1: 24 } };
OPENINGS.push({ w: 3, t0: TERRACE.open.t0, t1: TERRACE.open.t1, y0: 0, y1: TERRACE.open.y1, zone: -1 });
// glove stands along the terrace (walk onto the ring to buy or equip)
export const GLOVE_STANDS = ['luck', 'bubble', 'light', 'shadow', 'tornado', 'fire', 'big', 'mega'].map((id, k) => ({ id, x: -35 + k * 10, y: 0, z: -100 }));
export const CHEST = { x: 40, y: 0, z: -36 };
// the VIP room in the north-east corner: its south wall has the door
export const VIP = { x0: 30, x1: IN, z0: 30, z1: IN, door: { x0: 38, x1: 46 }, chest: { x: 43, y: 0, z: 44 } };
export const CAGE = { x: -32, y: 0, z: -32 };
export const FIRE_STAND = { x: -34, y: 0, z: 2 };
export const TROLL_PAD = { x: 58, y: 0, z: -72 };
export const GEAR_PADS = ['carpet', 'laser', 'speedCoil', 'gravityCoil', 'bearTrap'].map((id, k) => ({ id, x: -30 + k * 11, y: 0, z: 44 }));
// a giant strolls along the far side of the terrace (and kicks whoever gets in the way)
GIANTS.push({ zone: -1, ax: -60, az: -122, bx: 60, bz: -122, y: 0, period: 18, scale: 7, kill: false });
// glass windows round the lobby
export const WINDOWS = [];
for (let w = 0; w < 4; w++) for (const t of [-38, 38]) {
    const win = { w, t0: t - 7, t1: t + 7, y0: 9, y1: 21 };
    if (!OPENINGS.some((o) => o.w === w && o.t1 > win.t0 - 2 && o.t0 < win.t1 + 2 && o.y1 > win.y0 && o.y0 < win.y1)) WINDOWS.push(win);
}

// Where you stand when sent to checkpoint i (0-based; -1 = the lobby)
export function checkpointSpot(i) {
    const cp = CHECKPOINTS[i];
    return cp ? { x: cp.x, y: cp.y + 0.6, z: cp.z, yaw: cp.yaw } : null;
}
export const inTower = (x, z) => Math.abs(x) < A && Math.abs(z) < A;
const inBox = (b, x, y, z) => x > b.x0 && x < b.x1 && z > b.z0 && z < b.z1 && y > b.y0 && y < b.y1;
const LOBBY_BOX = { x0: -A, x1: A, z0: -A - 1, z1: A, y0: -6, y1: LOBBY_H };
const TERRACE_BOX = { x0: TERRACE.x0, x1: TERRACE.x1, z0: TERRACE.z0, z1: TERRACE.z1 + 2, y0: -8, y1: 30 };
// Which stage a position belongs to: -1 the lobby and the terrace, else the stage that owns the
// spot (the highest one where they overlap), or null: out of everything (you fell off)
export function stageAt(x, y, z) {
    for (let k = STAGE_BOX.length - 1; k >= 0; k--) { const b = STAGE_BOX[k]; if (b.i > 0 && inBox(b, x, y, z)) return b.i; }
    if (inBox(LOBBY_BOX, x, y, z) || inBox(TERRACE_BOX, x, y, z)) return -1;
    if (inBox(STAGE_BOX[0], x, y, z)) return 0;
    return null;
}
// Bounds for the server's sanity clamps
export const WORLD = { x0: -320, x1: 320, z0: -320, z1: FINISH.z1 + 160, y0: -160, y1: FINISH.y + 160 };
