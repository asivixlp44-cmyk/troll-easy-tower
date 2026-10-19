// Game data shared by the client and the Colyseus server.
// Troll Easy Tower: climb twelve "easy" stages up a giant studded tower over the ocean. Every
// stage is full of trolls (fake blocks, invisible paths, slap hands, a fake WIN pad...). Slap other
// players off the course with gloves; every checkpoint pays Wins and the top pays a big pile.
// There are no in-app purchases: gloves, gear, Nuke Server, trolls and skips all cost Wins.

export const CFG = {
    // Roblox defaults: jump power 50, gravity 196.2 (a jump rises about 6.4 studs)
    grav: 196.2,
    jumpV: 50,
    walk: 18,
    maxPlayers: 24,
    climb: 14,                // truss climbing speed
    // Sprint (the reference's Sprint button): faster for a few seconds, then it recharges
    sprint: 1.38,
    sprintSecs: 4,
    sprintRecharge: 3,
    // Wins: each new checkpoint of a climb pays the stage just cleared (STAGES[i - 1].wins), the
    // top pays finishWins, every troll coin +1 (all times the Wins multiplier)
    finishWins: 250,
    pickupWins: 1,
    // A climb must take at least this long for the top to pay
    minRunSecs: 180,
    boostMinutes: 15,
    // The rainbow chest in the lobby: free Wins every chestMinutes
    chestWins: 25,
    chestMinutes: 30,
    // The VIP room opens after vipMinutes of total playtime; its golden chest pays vipWins
    vipMinutes: 15,
    vipWins: 40,
    vipChestMinutes: 20,
    // The Ghost Slap cage: the gate opens for ghostOpenSecs every ghostCycleMinutes (server time)
    ghostCycleMinutes: 10,
    ghostOpenSecs: 75,
    // Fire Punch unlocks for free after this much total playtime (or buy it)
    fireMinutes: 30,
    friendBoost: 0.1,
    friendMax: 5,
    // Gear
    speedCoil: 1.45,
    gravityCoil: 0.55,
    carpetSpeed: 30,
    rayRange: 90,
    rayCooldown: 1.6,
    rayForce: 78,
    // Slaps: reach, cooldown, how hard (knockback studs/s) and how high
    slapRange: 7.5,
    slapCooldown: 0.9,
    slapForce: 52,
    slapUp: 30,
    bubbleSecs: 2.6,
    blindSecs: 3,
    spookSecs: 3,
    boostSecs: 3,
    nukeCooldown: 60,
    trollCooldown: 25,
    freezeSecs: 3.5,
    trapSecs: 3,
    trapLife: 90,
    spawnShield: 3,
    reviveSecs: 8,            // how long the "Would you like to go back?" card stays up
};

// ----- the stages -----
// The course spirals up the OUTSIDE of the tower, one wall per stage: 32 stages, eight laps, in four
// colour bands of eight (two laps each): mint green, magenta, blue, then purple at the top.
// plan: the obstacle modules the stage is built from, in order (shared/tower.js); wins: what the
// checkpoint at the START of the next stage pays (the last stage pays finishWins at the top);
// speed: how fast its moving parts go. Fall off the course and you're back at the checkpoint.
export const DIFFS = {
    EASY: { label: 'EASY', color: '#46e85a' },
    MEDIUM: { label: 'MEDIUM', color: '#ffc828' },
    HARD: { label: 'HARD', color: '#ff8a2a' },
    EXTREME: { label: 'EXTREME', color: '#ff3a4a' },
    INSANE: { label: 'INSANE', color: '#c84aff' },
};
export const BANDS = {
    green: { wall: 0x3ee6a2, dark: 0x22b47a, light: 0x9affd4, floor: 0x52eeb0, trim: 0x46ff9a, plat: 0x4cf07a, mood: 'day' },
    pink: { wall: 0xe44ce4, dark: 0xb02cb4, light: 0xffaaf4, floor: 0xf26ae8, trim: 0xff5ae6, plat: 0xff6ae8, mood: 'pink' },
    blue: { wall: 0x5a5cff, dark: 0x3434c8, light: 0xb4bcff, floor: 0x6c7cff, trim: 0x6a9aff, plat: 0x6a8cff, mood: 'dusk' },
    purple: { wall: 0x8a3ae8, dark: 0x5a1aa8, light: 0xd8b0ff, floor: 0x9a5aff, trim: 0xc87aff, plat: 0xb46aff, mood: 'violet' },
};
const STAGE_LIST = [
    // green: the easy-looking start
    ['Totally Easy Steps', 'Just some steps... what could go wrong?', '🪜', ['steps', 'hops', 'steps', 'hops']],
    ['Red Means Run', 'The red ones drop away. Keep moving!', '🟥', ['hops', 'redSlabs', 'steps', 'redSlabs']],
    ['Truss Me', 'Walk into a truss to climb it', '🧗', ['steps', 'trussBox', 'hops', 'trussBox']],
    ['Slap Happy', 'Giant hands LOVE to slap', '🖐️', ['hops', 'slapHand', 'fakePair', 'slapHand']],
    ['Boing!', 'Springs in glass tubes', '🌀', ['redSlabs', 'spring', 'hops', 'spring']],
    ['Tightrope', 'A long thin beam over nothing', '🪢', ['hops', 'beam', 'trussBox', 'beam']],
    ['Wall Punchers', 'Gloves punch out of the wall', '👊', ['fakePair', 'punchWall', 'steps', 'punchWall']],
    ['Banana Trap', 'Slippery bananas and slap hands', '🍌', ['slapHand', 'bananas', 'redSlabs', 'bananas']],
    // magenta
    ['Keyboard Warrior', 'Some keys are fake. Type carefully!', '⌨️', ['keys', 'hops', 'ghost', 'keys']],
    ['Bouncy Castle', 'Squishy balls and moving plates', '🎈', ['pinkBalls', 'movers', 'spring', 'pinkBalls']],
    ['Conveyor Chaos', 'Belts that drag you around', '🏭', ['conveyor', 'fakePair', 'slapHand', 'conveyor']],
    ['Red Light, Green Light', 'Only move on green!', '🚦', ['hops', 'doll', 'steps']],
    ['Now You See Me', 'Invisible blocks and punching walls', '👻', ['ghost', 'punchWall', 'redSlabs', 'ghost']],
    ['Spin Cycle', 'Spinning discs and fake keys', '💫', ['spinners', 'keys', 'trussBox', 'spinners']],
    ["Slip 'n' Slide", 'Bananas, plates and fakes', '🛝', ['bananas', 'movers', 'fakePair', 'bananas']],
    ['The Long Climb', 'A long staircase up the wall', '🏔️', ['wallStairs', 'slapHand', 'pinkBalls', 'wallStairs']],
    // blue
    ['Sweep Sweep', 'Jump the sweeping bars', '🧹', ['sweeper', 'redSlabs', 'timed', 'sweeper']],
    ['Laser Tag', 'Duck or jump the lasers', '🔴', ['laser', 'hops', 'spinners', 'laser']],
    ['Blink and You Fall', 'Blocks that blink on and off', '💡', ['timed', 'ghost', 'punchWall', 'timed']],
    ['Moving Day', 'Nothing stays still', '📦', ['movers', 'sweeper', 'wallStairs', 'movers']],
    ['Giant Trouble', "Don't get stomped!", '🦶', ['redSlabs', 'giant', 'hops']],
    ['Factory Floor', 'Belts, lasers and fakes', '⚙️', ['conveyor', 'laser', 'fakePair', 'conveyor']],
    ['Type and Fly', 'Keys, springs and slaps', '🚀', ['keys', 'spring', 'slapHand', 'keys']],
    ['Dizzy Heights', 'Spin, blink, drop', '😵', ['spinners', 'timed', 'redSlabs', 'spinners']],
    // purple: the troll king's floors
    ['Troll Factory', 'Lasers, punches and ghosts', '😈', ['laser', 'punchWall', 'ghost', 'laser']],
    ['Trust Issues', 'Which block is real?', '🤔', ['fakePair', 'sweeper', 'movers', 'fakePair']],
    ['Clockwork', 'Time every jump', '⏰', ['timed', 'spinners', 'wallStairs', 'timed']],
    ['Slippery Slaps', 'Bananas, lasers, slap hands', '🍌', ['bananas', 'laser', 'slapHand', 'bananas']],
    ['Invisible Elevator', 'Up through thin air', '🫥', ['ghost', 'movers', 'spring', 'redSlabs', 'ghost']],
    ['The Gauntlet', 'Punch, blink, fake', '🥊', ['punchWall', 'timed', 'fakePair', 'punchWall']],
    ['Almost There...', 'So close. So many trolls.', '🙃', ['laser', 'sweeper', 'spinners', 'redSlabs']],
    ['The Final Troll', 'Everything. All at once.', '👑', ['fakePair', 'ghost', 'slapHand', 'redSlabs', 'keys']],
];
const BAND_OF = ['green', 'pink', 'blue', 'purple'];
const diffName = (i) => (i < 4 ? 'EASY' : i < 10 ? 'MEDIUM' : i < 18 ? 'HARD' : i < 26 ? 'EXTREME' : 'INSANE');
export const STAGES = STAGE_LIST.map(([name, sub, ic, plan], i) => ({
    name, sub, ic, plan, diff: diffName(i), band: BAND_OF[i >> 3],
    // the checkpoint after this stage pays more the higher you are
    wins: i === STAGE_LIST.length - 1 ? 0 : Math.round(2 + i * 1.2 + i * i * 0.025),
    // how hard its obstacles are (0..1): smaller blocks, longer gaps, faster traps
    d: Math.min(1, 0.04 + 0.96 * Math.pow(i / (STAGE_LIST.length - 1), 0.9)),
    speed: +(1 + i * 0.035).toFixed(2),
}));

// ----- tools: slap gloves and gear (one in your hand at a time; the hotbar shows what you own) -----
// Gloves slap players near you (click / E / tap). force: knockback x; range: reach in studs.
export const GLOVES = [
    { id: 'slap', name: 'Default Slap', desc: 'A good old slap', color: 0xf2f2f6, force: 1, free: true },
    { id: 'luck', name: 'Luck Slap', desc: '40% chance of a double-power slap', color: 0x46e84a, force: 1, luck: 0.4 },
    { id: 'bubble', name: 'Bubble Slap', desc: 'Traps them in a floating bubble', color: 0x4ad8ff, force: 0.55, bubble: true },
    { id: 'light', name: 'Light Slap', desc: 'Every hit gives you a burst of speed', color: 0xff3a4a, force: 1.05, boost: true },
    { id: 'shadow', name: 'Shadow Slap', desc: 'Blinds them for a few seconds', color: 0x3a2a7a, force: 1, blind: true },
    { id: 'tornado', name: 'Tornado Slap', desc: 'Summons a tornado that spins them sky high', color: 0xe8ecff, force: 0.45, tornado: true },
    { id: 'ghost', name: 'Ghost Slap', desc: 'Free from the cage when its gate opens! Spooks them slow', color: 0xb8a8ff, force: 0.9, spook: true, cage: true },
    { id: 'fire', name: 'Fire Punch', desc: 'Sets them on fire and launches them up', color: 0xff7a1a, force: 1.25, fire: true },
    { id: 'big', name: 'Big Slap', desc: 'A HUGE glove: longer reach, harder slap', color: 0xffffff, force: 1.6, range: 11, scale: 1.8 },
    { id: 'mega', name: 'Mega Punch', desc: 'The most powerful punch in the tower', color: 0xff5ad8, force: 2.6, range: 8.5, cooldown: 2, rainbow: true },
];
export const gloveById = Object.fromEntries(GLOVES.map((d) => [d.id, d]));
export const GEAR = [
    { id: 'carpet', name: 'Fly', desc: 'A magic carpet: Space to rise, Shift to sink', ic: '🧞', color: 0xffd028 },
    { id: 'laser', name: 'Laser Gun', desc: 'Zap players and fling them away', ic: '🔫', color: 0x2ad8ff },
    { id: 'speedCoil', name: 'Speed Coil', desc: 'Run 45% faster', ic: '🌀', color: 0xff3a4a },
    { id: 'gravityCoil', name: 'Gravity Coil', desc: 'Floaty, high jumps', ic: '🪐', color: 0x3a8aff },
    { id: 'bearTrap', name: 'Bear Trap', desc: 'Drop a trap: whoever steps in is stuck!', ic: '🪤', color: 0x9aa0b0 },
];
export const gearById = Object.fromEntries(GEAR.map((d) => [d.id, d]));
export const isGlove = (id) => !!gloveById[id];
export const TOOLS = [...GLOVES.map((g) => g.id), ...GEAR.map((g) => g.id)];

// ----- the Wins shop -----
// Passes are owned forever; products can be bought again. Every price is in Wins.
export const PASSES = {
    Luck: { name: 'Luck Slap', price: 25, ic: '🍀', desc: '40% chance of a double-power slap', tool: 'luck' },
    Bubble: { name: 'Bubble Slap', price: 80, ic: '🫧', desc: 'Traps them in a floating bubble', tool: 'bubble' },
    Light: { name: 'Light Slap', price: 200, ic: '⚡', desc: 'Every hit gives you a burst of speed', tool: 'light' },
    Shadow: { name: 'Shadow Slap', price: 450, ic: '🌑', desc: 'Blinds them for a few seconds', tool: 'shadow' },
    Tornado: { name: 'Tornado Slap', price: 900, ic: '🌪️', desc: 'Summons a tornado that spins them sky high', tool: 'tornado' },
    Fire: { name: 'Fire Punch', price: 1200, ic: '🔥', desc: 'Free after ' + CFG.fireMinutes + ' minutes of play, or buy it now', tool: 'fire' },
    BigSlap: { name: 'Big Slap', price: 1500, ic: '🖐️', desc: 'A HUGE glove: longer reach, harder slap', tool: 'big' },
    MegaPunch: { name: 'Mega Punch', price: 3000, ic: '👊', desc: 'The most powerful punch in the tower', tool: 'mega' },
    SpeedCoil: { name: 'Speed Coil', price: 75, ic: '🌀', desc: 'Run 45% faster', tool: 'speedCoil' },
    BearTrap: { name: 'Bear Trap', price: 150, ic: '🪤', desc: 'Drop a trap: whoever steps in is stuck!', tool: 'bearTrap' },
    GravityCoil: { name: 'Gravity Coil', price: 250, ic: '🪐', desc: 'Floaty, high jumps', tool: 'gravityCoil' },
    Laser: { name: 'Laser Gun', price: 600, ic: '🔫', desc: 'Zap players and fling them away', tool: 'laser' },
    Fly: { name: 'Fly', price: 7000, ic: '🧞', desc: 'A magic carpet: fly anywhere (Space up, Shift down)', tool: 'carpet' },
    SpeedSlap: { name: 'x2 Speed Slap', price: 500, ic: '💨', desc: 'Slap twice as often' },
    DoubleJump: { name: 'x2 Jump', price: 1200, ic: '🦘', desc: 'Jump again in mid-air' },
    Admin: { name: 'Admin', price: 2500, ic: '🛡️', desc: 'Admin commands: Giant, Tiny, Spin, Sparkles, Rainbow, Fireworks' },
    DoubleWins: { name: 'x2 Wins', price: 4000, ic: '🏆', desc: 'Double Wins forever' },
};
export const PRODUCTS = {
    Skip: { name: 'Skip Stage', price: 15, ic: '⏩', desc: 'Teleport to the next checkpoint' },
    SkipFinal: { name: 'Skip To Final', price: 700, ic: '🏁', desc: 'Teleport straight to the final stage' },
    Nuke: { name: 'Nuke Server', price: 300, ic: '☢️', desc: 'Nuke everyone else back to their checkpoint!' },
    FlingAll: { name: 'Fling All', price: 200, ic: '🌪️', desc: 'Fling everyone else into the air!' },
    FreezeAll: { name: 'Freeze All', price: 250, ic: '🧊', desc: 'Freeze everyone else in ice for a few seconds' },
    Jumpscare: { name: 'Troll Face', price: 60, ic: '😈', desc: 'A giant troll face pops up on everyone\'s screen!' },
    WinsBoost: { name: 'x2 Wins Boost', price: 150, ic: '⏱️', desc: 'Double Wins for 15 minutes' },
};
// The Troll menu (the reference's troll face button)
export const TROLL_MENU = ['FlingAll', 'FreezeAll', 'Jumpscare'];
// Skipping costs more the further you are: five times what the stage you skip pays
export const skipPrice = (stage) => Math.max(15, 5 * ((STAGES[Math.max(0, stage ?? -1)] || {}).wins || 3));
// Skip To Final is cheaper the closer you already are
export const skipFinalPrice = (stage) => Math.max(150, Math.round(PRODUCTS.SkipFinal.price * (1 - Math.max(0, (stage ?? -1) + 1) / STAGES.length)));
// Revive ("Would you like to go back?"): back to where you fell from, for a few Wins
export const revivePrice = (stage) => Math.max(3, Math.round(3 + Math.max(0, stage ?? 0) * 1.5));
// Teleports: your own checkpoint is free; back to another stage you've reached costs a little
export const tpPrice = (i, own) => (own ? 0 : Math.max(10, Math.round(((STAGES[Math.max(0, i - 1)] || {}).wins || 3) * 4)));
export const priceOf = (kind, key, p) => (kind === 'product' && key === 'Skip' ? skipPrice(p ? p.stage : -1)
    : kind === 'product' && key === 'SkipFinal' ? skipFinalPrice(p ? p.stage : -1)
    : ((kind === 'pass' ? PASSES : PRODUCTS)[key] || {}).price);
export const passForTool = (toolId) => Object.keys(PASSES).find((k) => PASSES[k].tool === toolId);

// ----- Admin commands (cosmetic; everyone sees them). Letters are what the server syncs. -----
export const ADMIN = [
    { id: 'g', name: 'Giant', ic: '🦖', desc: 'Grow huge', group: 'size' },
    { id: 't', name: 'Tiny', ic: '🐜', desc: 'Shrink down', group: 'size' },
    { id: 'p', name: 'Spin', ic: '🌀', desc: 'Spin like a top' },
    { id: 's', name: 'Sparkles', ic: '✨', desc: 'Sparkle wherever you go' },
    { id: 'r', name: 'Rainbow', ic: '🌈', desc: 'A rainbow aura' },
];
export const cleanFx = (s) => {
    let out = '';
    for (const a of ADMIN) if (String(s || '').includes(a.id) && !(a.group && ADMIN.some((b) => b.group === a.group && out.includes(b.id)))) out += a.id;
    return out;
};

// ----- trails (Wins) -----
export const TRAILS = [
    { id: 'starter', name: 'Sparkle', price: 0, color: 0xf0f6ff },
    { id: 'mint', name: 'Mint', price: 40, color: 0x3ef0a8 },
    { id: 'bubblegum', name: 'Bubblegum', price: 120, color: 0xff6ae0 },
    { id: 'sun', name: 'Sunshine', price: 350, color: 0xffd028 },
    { id: 'ocean', name: 'Ocean', price: 900, color: 0x3ab0ff },
    { id: 'flame', name: 'Flame', price: 2000, color: 0xff6a1a },
    { id: 'galaxy', name: 'Galaxy', price: 5000, color: 0x8a5aff },
    { id: 'rainbow', name: 'Rainbow', price: 12000, color: 0xff5ad8, rainbow: true },
];
export const trailById = Object.fromEntries(TRAILS.map((d) => [d.id, d]));

// ----- playtime gifts (minutes played this session) -----
export const GIFTS = [
    { min: 2, wins: 10 }, { min: 5, wins: 15 }, { min: 10, wins: 25 }, { min: 15, boost: true },
    { min: 20, wins: 50 }, { min: 30, wins: 75 }, { min: 45, wins: 120 }, { min: 60, wins: 200 },
];
// ----- daily rewards (7-day streak) -----
export const DAILY = [
    { wins: 15 }, { wins: 25 }, { wins: 40 }, { boost: true }, { wins: 75 }, { wins: 120 }, { wins: 300, glove: 'bubble' },
];
export const dayKey = (ms) => new Date(ms).toISOString().slice(0, 10);
export function dailyStatus(d, now) {
    const today = dayKey(now), yest = dayKey(now - 86400000);
    if (!d || !d.last) return { can: true, day: 0, streak: 0 };
    if (d.last === today) return { can: false, day: d.streak % 7, streak: d.streak };
    const streak = d.last === yest ? d.streak : 0;
    return { can: true, day: streak % 7, streak };
}
export const rewardText = (r) => [
    r.wins ? '+' + fmt(r.wins) + ' Wins' : '',
    r.boost ? '15 min x2 Wins' : '',
    r.glove ? 'the ' + gloveById[r.glove].name : '',
].filter(Boolean).join(' + ');

export const CODES = {
    TROLL: { wins: 50 },
    SLAP: { wins: 75 },
    EASY: { wins: 30 },
    LEGION: { wins: 100 },
    RELEASE: { boost: true },
};

// The Ghost Slap cage: open during the first ghostOpenSecs of every cycle (server clock)
export function ghostGate(now) {
    const cyc = CFG.ghostCycleMinutes * 60000, t = now % cyc, open = CFG.ghostOpenSecs * 1000;
    return t < open ? { open: true, left: (open - t) / 1000 } : { open: false, left: (cyc - t) / 1000 };
}

// Wins multiplier: x2 Wins pass, x2 boost, Friend Boost
export function winsMult(p, now, friends) {
    let m = 1;
    if (p.passes && p.passes.DoubleWins) m *= 2;
    if ((p.boostUntil || 0) > now) m *= 2;
    m *= 1 + CFG.friendBoost * Math.min(CFG.friendMax, friends || 0);
    return m;
}

// Player outfits for the blocky fallback body (cycle by join order); the reference's default
// black suit first
export const KITS = [
    { shirt: 0x1c1c22, shorts: 0x24242c, socks: 0x1c1c22, hair: 0x8a4a1a },
    { shirt: 0x3ac8ff, shorts: 0x2a2a4a, socks: 0xffffff, hair: 0xffd028 },
    { shirt: 0xff7ab0, shorts: 0x3a3a5a, socks: 0xffffff, hair: 0x3a2618 },
    { shirt: 0x6aff5a, shorts: 0x2a3a2a, socks: 0xffffff, hair: 0x3a2618 },
    { shirt: 0xffd028, shorts: 0x3a2a1a, socks: 0xffffff, hair: 0xb8541c },
    { shirt: 0xc45aff, shorts: 0x2a1a3a, socks: 0xffffff, hair: 0xff8ad8 },
];
export const SKINS = [0xf2c9a0, 0xe1af87, 0xc88c5f, 0x8c5a3c, 0xf0c8a0];

// ----- formatting -----
export function fmt(v) {
    v = Math.floor(v || 0);
    if (v < 1000) return String(v);
    const u = ['', 'K', 'M', 'B', 'T', 'Qa', 'Qi'];
    let i = 0, x = v;
    while (x >= 1000 && i < u.length - 1) { x /= 1000; i++; }
    return (x >= 100 ? Math.floor(x) : Math.floor(x * 10) / 10) + u[i];
}
export const fmtComma = (v) => Math.floor(v || 0).toLocaleString('en-US');
export function clock(s) {
    s = Math.max(0, Math.floor(s));
    const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = s % 60;
    return (h ? h + ':' + String(m).padStart(2, '0') : String(m)) + ':' + String(x).padStart(2, '0');
}
export function playtimeText(s) {
    s = Math.floor(s || 0);
    if (s < 3600) return Math.floor(s / 60) + 'm';
    if (s < 86400) return Math.floor(s / 3600) + 'h ' + Math.floor((s % 3600) / 60) + 'm';
    return Math.floor(s / 86400) + 'd ' + Math.floor((s % 86400) / 3600) + 'h';
}
export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
export function rngFrom(seed) {
    let s = (seed >>> 0) || 1;
    return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
}
