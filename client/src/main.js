import { Client } from '@colyseus/sdk';
import {
    T, V3, $, canvas, scene, camera, sun, renderer, solids, triggers, prompts, tickers,
    billboard, buildRig, animRig, airPose, climbPose, holdPose, floatText, updateEffects, lerpAngle, updateSky, setMood, SUN_DIRECTION, mat,
} from './engine.js';
import { S, actions, net } from './state.js';
import { initAudio, resumeAudio, audioDebug, startMusic, sfx, step as surfStep, setVolume, audioSuspended, loopSound, setMusicIntensity } from './audio.js';
import * as BX from './bloxity.js';
import { createAvatar, loadBase, packAvatar, unpackAvatar } from './avatar.js';
import { pad, pollGamepad, rumble, onGamepadConnection } from './gamepad.js';
import {
    render, updateFx, dust, sparkleColumn, ring, fireworks, setQuality, getQuality, autoQualityAllowed, makeTrail, splash,
    coinBurst, nukeFx, zapFx, poofFx, confetti, updateAmbient, setSpeedLines, fxWarmGroup, fxShowAll,
    slapBurst, fireFx, tornadoFx, bigSplash, auraFx,
} from './fx.js';
import {
    buildWorld, warmUp, SPAWN, SPAWN_YAW, renderBoards, updateWorld, cullZones, refreshGearPads, lightCheckpoint, coinState,
    setDecorLow, moodOf, updateChest, chestState, vipState, cageState, movers, touchVanish, jiggle, pressDome,
    sweepers, sweeperAngle, slappers, slapperAngle, punches, punchExt, dolls, dollState, giants, bearTrap, lasers, laserY, timeds,
} from './world.js';
import { heldModel, carpet as carpetModel, waveCarpet, gloveMesh } from './gear.js';
import { trollFaceUrl } from './materials.js';
import {
    updateHud, toast, showStageTitle, showWin, showOof, flash, teleportFx, showOops, hideOops, showToolPop, renderHotbar, hotbarTools,
    renderProgress, animateCounters, bumpCoins, openDailyOnJoin, refreshModal, refreshDaily, openModal, notEnough, showStageClear,
    promptEl, promptTxtEl, codeResult, buy, closeTop, anyPopup, cheer, showRevive, hideRevive, reviveOpen, trolledPopup, jumpscare,
    setBlind, comicPop, setSprintMeter,
} from './ui.js';
import {
    CFG, STAGES, KITS, SKINS, trailById, gloveById, gearById, isGlove, passForTool, fmt, clamp, cleanFx, revivePrice,
} from '../../shared/config.js';
import { CHECKPOINTS, COINS, FINISH, checkpointSpot, stageAt, ROOF_Y, COURSE, START_Y, stageFrame } from '../../shared/tower.js';

// =====================================================================================
// Local player
// =====================================================================================
const HW = 1, PH = 5, STEP = 1.25, PIVOT = 2.6;
const P = {
    pos: SPAWN.clone(), vel: new V3(), kv: new V3(), hv: new V3(), onGround: false, ground: null, facing: SPAWN_YAW, moving: false,
    animPhase: 0, airTime: 0, peakY: 0, stage: -1, lastStepN: 0, squash: 1, squashV: 0, climbing: null, climbT: 0,
    flying: false, lastSlap: -9, lastZap: -9, slapAnim: 0, jumpPress: -9, coyote: 0, onIce: false, jumps: 0,
    sprint: 1, sprinting: false, trapHit: -9, frozenT: 0, bubbleT: 0, spookT: 0, boostT: 0, trappedT: 0, fireT: 0, tornadoT: 0,
    safe: null, safeT: 0, caughtT: -9, deathT: -9,
};
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
let shake = 0;
function addShake(a) { if (!reduceMotion) shake = Math.min(1.2, shake + a); }
let rig = null, headLabel, nameLabelText = '';

// The sparkly forcefield bubble you get for a moment after spawning (and, tinted blue, the Bubble
// Slap's bubble)
const bubbleShader = (c1, c2) => new T.ShaderMaterial({
    transparent: true, depthWrite: false, blending: T.AdditiveBlending,
    uniforms: { uTime: { value: 0 }, uA: { value: 1 } },
    vertexShader: `varying vec3 vN; varying vec3 vV; varying vec3 vP;
        void main(){ vec4 w = modelMatrix * vec4(position, 1.0); vN = normalize(mat3(modelMatrix) * normal); vV = normalize(cameraPosition - w.xyz); vP = position; gl_Position = projectionMatrix * viewMatrix * w; }`,
    fragmentShader: `uniform float uTime; uniform float uA; varying vec3 vN; varying vec3 vV; varying vec3 vP;
        float h(vec3 p){ return fract(sin(dot(p, vec3(12.9898, 78.233, 37.719))) * 43758.5453); }
        void main(){
            float f = pow(1.0 - abs(dot(normalize(vN), vV)), 2.2);
            vec3 q = floor(vP * 5.0 + vec3(0.0, uTime * 2.0, 0.0));
            float sp = step(0.93, h(q)) * (0.5 + 0.5 * sin(uTime * 9.0 + h(q + 1.7) * 30.0));
            vec3 c = mix(vec3(${c1}), vec3(${c2}), 0.5 + 0.5 * sin(uTime * 2.0 + vP.y));
            gl_FragColor = vec4(c, (f * 0.7 + sp * 0.5 + 0.06) * uA);
        }`,
});
const shieldMat = bubbleShader('0.55, 0.85, 1.0', '0.75, 1.0, 0.85');
const bubbleMat = bubbleShader('0.35, 0.75, 1.0', '0.85, 0.95, 1.0');
const shieldGeo = new T.SphereGeometry(3.6, 28, 18);
const iceMat = mat(0xbff0ff, { opacity: 0.55, emissive: 0x2a8ac8, ei: 0.5 });
const iceGeo = new T.BoxGeometry(3.6, 6.2, 3.6);
tickers.push((dt, t) => { shieldMat.uniforms.uTime.value = t; bubbleMat.uniforms.uTime.value = t; });
function setShield(g, secs) {
    const u = g.userData;
    if (!u.shield) { u.shield = new T.Mesh(shieldGeo, shieldMat); u.shield.position.y = 2.6; u.shield.renderOrder = 7; g.add(u.shield); }
    u.shieldT = secs;
    u.shield.visible = secs > 0;
}
function tickShield(g, dt) {
    const u = g.userData;
    if (!u.shield || u.shieldT <= 0) return;
    u.shieldT -= dt;
    u.shield.visible = u.shieldT > 0;
    u.shield.scale.setScalar(1 + Math.sin(performance.now() / 160) * 0.03);
}
const shielded = () => rig && rig.userData.shieldT > 0;
// Status looks other players see too: bubble, ice block, fire (letters in the player's `st`)
function setStatusLook(g, st, dt, t) {
    const u = g.userData;
    const bub = st.includes('b'), ice = st.includes('f'), fire = st.includes('x');
    if (bub && !u.bubble) { u.bubble = new T.Mesh(shieldGeo, bubbleMat); u.bubble.position.y = 2.6; u.bubble.renderOrder = 7; g.add(u.bubble); }
    if (u.bubble) { u.bubble.visible = bub; if (bub) u.bubble.scale.setScalar(1.05 + Math.sin(t * 6) * 0.05); }
    if (ice && !u.ice) { u.ice = new T.Mesh(iceGeo, iceMat); u.ice.position.y = 2.9; u.ice.renderOrder = 6; g.add(u.ice); }
    if (u.ice) u.ice.visible = ice;
    if (fire && g.visible) fireFx(g.position, dt);
}

// ----- a character: rig (feet, yaw) -> pivot (hips) -> body (blocky or Bloxity) + tool -----
function buildCharacter(kit, skin) {
    const g = new T.Group();
    const pivot = new T.Group(); pivot.position.y = PIVOT; g.add(pivot);
    const k = KITS[kit % KITS.length];
    const body = buildRig({ ...k, skin: SKINS[skin % SKINS.length] });
    body.position.y = -PIVOT;
    pivot.add(body);
    g.userData = { pivot, body, baseBody: body, tool: '', held: null, carpet: null, trail: null, trailId: '', fxScale: 1, spinA: 0 };
    return g;
}
// The tool in the right hand (gloves sit on the hand, ready to slap); the carpet under the feet
const HOLD = new V3(1.45, 3.25, 1.45);
function setTool(g, id) {
    const u = g.userData;
    if (u.tool === (id || '')) return;
    u.tool = id || '';
    for (const k of ['held', 'carpet']) if (u[k]) { u[k].parent && u[k].parent.remove(u[k]); u[k] = null; }
    if (!id) return;
    if (id === 'carpet') { u.carpet = carpetModel(0.95); u.carpet.position.y = 0.25; u.carpet.visible = false; g.add(u.carpet); return; }
    const h = heldModel(id);
    if (h) { h.position.copy(HOLD); u.body.add(h); u.held = h; }
}
// The slap swing: the glove sweeps from the right across the front and back (k: 0..1)
function swingHeld(u, k) {
    if (!u.held) return;
    const s = Math.sin(k * Math.PI);
    u.held.position.set(HOLD.x - s * 2.4, HOLD.y + s * 0.3, HOLD.z + s * 1.1);
    u.held.rotation.set(0, -s * 1.4, s * 0.3);
}
// With a Bloxity avatar the tool goes in its actual right hand (its arms aren't where the blocky rig's are)
const handTmp = new V3();
function followHand(u) {
    if (!u.held || !u.blox) return;
    const b = u.blox.bones['ArmR2_leaf'] || u.blox.bones.ArmR2;
    if (!b) return;
    b.getWorldPosition(handTmp);
    u.body.worldToLocal(handTmp);
    u.held.position.copy(handTmp);
}
function setTrail(g, id) {
    const u = g.userData;
    const d = trailById[id] || trailById.starter;
    if (!u.trail) u.trail = makeTrail(d.color);
    if (u.trailId !== d.id) {
        u.trailId = d.id;
        u.trail.setColor(d.color, d.rainbow);
        u.trail.width = d.id === 'starter' ? 0.5 : 0.8;
    }
}
// Admin commands: Giant / Tiny (size), Spin, Sparkles, Rainbow aura. Everyone sees them.
function applyFx(g, fx, dt) {
    const u = g.userData;
    const want = fx.includes('g') ? 1.8 : fx.includes('t') ? 0.55 : 1;
    u.fxScale += (want - u.fxScale) * Math.min(1, dt * 6);
    u.spinA = fx.includes('p') ? (u.spinA + dt * 10) % (Math.PI * 2) : 0;
    if ((fx.includes('s') || fx.includes('r')) && g.visible) auraFx(g.position, fx.includes('r'), dt);
}

// ----- Bloxity avatars: replace the blocky body's meshes, keep the pivot, tools and labels -----
function dressRig(group, avatar) {
    const u = group.userData, body = u.baseBody;
    body.children.forEach((c) => { if (c !== u.held) c.visible = false; });
    body.add(avatar.root);
    u.blox = avatar;
}
let localAvatar = null, localAvatarReq = 0;
async function setupLocalAvatar() {
    const req = ++localAvatarReq;
    const a = await createAvatar(BX.currentAvatar(), BX.getSkinTextureUrl());
    if (!a) return;
    if (req !== localAvatarReq || !rig) { a.dispose(); return; }
    if (localAvatar) localAvatar.dispose();
    localAvatar = a;
    dressRig(rig, a);
}
function syncMyAvatar() {
    const av = BX.currentAvatar();
    if (localAvatar && av) { localAvatar.setProportions(av.proportions); localAvatar.setEquipped(av, BX.getSkinTextureUrl()); }
    net.send('avatar', { av: packAvatar(av) });
}
async function playEmoteOn(avatar, id) {
    if (!avatar) return;
    const cat = await BX.loadEmotes();
    const e = cat.get(id);
    if (e && e.clip) avatar.playEmote(e.clip);
}
function chatBubble(group, text) {
    if (!group) return;
    if (group.userData.bubbleLbl) { group.remove(group.userData.bubbleLbl); group.userData.bubbleLbl.material.map.dispose(); }
    const b = billboard([{ t: '💬 ' + text, c: '#ffffff', s: '#1a1a3a', px: 44 }], 9, 1024, new V3(0, 10, 0), group);
    group.userData.bubbleLbl = b;
    setTimeout(() => { if (group.userData.bubbleLbl === b) { group.remove(b); b.material.map.dispose(); group.userData.bubbleLbl = null; } }, 5000);
}
const nameLines = (name, admin) => (admin ? [{ t: '🛡️ ADMIN', c: '#ffd028', s: '#3a2000', px: 40 }, { t: name || ' ', c: '#ffffff', s: '#1a1a3a', px: 60 }] : [{ t: name || ' ', c: '#ffffff', s: '#1a1a3a', px: 60 }]);

function buildPlayer(kit, skin) {
    if (rig) { scene.remove(rig); if (rig.userData.trail) rig.userData.trail.dispose(); }
    rig = buildCharacter(kit, skin);
    scene.add(rig);
    nameLabelText = '';
    headLabel = billboard(nameLines(S.name), 6.5, 512, new V3(0, 7.8, 0), rig);
    // like Roblox, you don't see your own name tag (it would sit over every sign you look at)
    headLabel.visible = false;
    rig.position.copy(P.pos);
    localAvatar = null;
    setupLocalAvatar();
}

// =====================================================================================
// Collision: boxes, plus round shapes (trampolines, spinners, squishy balls) with their own tests
// =====================================================================================
let nearBoxes = [], nearRound = [], nearTriggers = triggers, nearPrompts = prompts, nearZoneKey = null;
function refreshNear(stage) {
    if (stage === nearZoneKey) return;
    nearZoneKey = stage;
    const zs = new Set([stage - 1, stage, stage + 1]);
    const ok = (o) => o.zone === undefined || o.zone === -2 || (o.zone === -1 ? stage <= 0 : zs.has(o.zone));
    const list = solids.filter(ok);
    nearBoxes = list.filter((s) => !s.shape);
    nearRound = list.filter((s) => s.shape);
    nearTriggers = triggers.filter(ok);
    nearPrompts = prompts.filter(ok);
    cullZones(stage);
}
const overlaps = (c, x, y, z) => !c.off && c.max.x > x - HW && c.min.x < x + HW && c.max.y > y && c.min.y < y + PH && c.max.z > z - HW && c.min.z < z + HW;
function freeAt(x, y, z) {
    for (const c of nearBoxes) if (overlaps(c, x, y, z)) return false;
    return true;
}
function moveAxis(axis, d) {
    if (d === 0) return;
    const p = P.pos;
    p[axis] += d;
    for (const c of nearBoxes) {
        if (!overlaps(c, p.x, p.y, p.z)) continue;
        if (axis === 'y') {
            // land on top only when coming down onto it (or a step's height into it): stuck deep inside a
            // wall, you're never popped up to its top
            if (d < 0) { if (c.max.y - p.y > Math.max(STEP, -d + 0.05)) continue; p.y = c.max.y; P.vel.y = Math.max(0, P.vel.y); P.onGround = true; P.ground = c; }
            else { if (p.y + PH - c.min.y > d + 0.05) continue; p.y = c.min.y - PH - 1e-4; if (P.vel.y > 0) P.vel.y = 0; }
        } else {
            const rise = c.max.y - p.y;
            if (rise > 0 && rise <= STEP && (P.onGround || P.vel.y <= 0) && !c.climb && freeAt(p.x, c.max.y + 0.01, p.z)) { p.y = c.max.y + 0.001; continue; }
            if (d > 0) p[axis] = c.min[axis] - HW - 1e-4; else p[axis] = c.max[axis] + HW + 1e-4;
        }
    }
}
// Top of a round shape under (x, z), for feet with a little footprint; null if not over it
function surfaceY(s, x, z) {
    const d = Math.hypot(x - s.cx, z - s.cz);
    if (s.shape === 'cyl') return d <= s.r + 0.55 ? s.max.y : null;
    const dd = Math.max(0, d - 0.9);
    if (dd >= s.r) return null;
    return s.y0 + s.h * (1 - 0.2 * (s.squish || 0)) * Math.sqrt(1 - (dd / s.r) ** 2);
}
function resolveRound() {
    const p = P.pos;
    for (const s of nearRound) {
        if (s.off) continue;
        if (p.x + HW < s.min.x || p.x - HW > s.max.x || p.z + HW < s.min.z || p.z - HW > s.max.z) continue;
        if (p.y > s.max.y + 0.01 || p.y + PH < s.min.y) continue;
        const top = surfaceY(s, p.x, p.z);
        if (top === null || p.y >= top - 0.001) continue;
        const pen = top - p.y;
        if (pen <= (s.shape === 'dome' ? 1.6 : STEP) || (P.vel.y <= 0 && pen < 2.2)) {
            p.y = top; P.vel.y = Math.max(0, P.vel.y); P.onGround = true; P.ground = s;
            continue;
        }
        if (P.vel.y > 0 && p.y + PH - P.vel.y * 0.02 <= s.min.y + 0.5) { p.y = s.min.y - PH - 0.01; P.vel.y = 0; continue; }
        const dx = p.x - s.cx, dz = p.z - s.cz, d = Math.hypot(dx, dz) || 0.001;
        let R = s.r + HW * 0.8;
        if (s.shape === 'dome') {
            const h = s.h * (1 - 0.2 * (s.squish || 0)), k = clamp((p.y - s.y0) / h, 0, 1);
            R = s.r * Math.sqrt(1 - k * k) + 0.95;
        }
        if (d < R) { p.x = s.cx + dx / d * R; p.z = s.cz + dz / d * R; }
    }
}
// Snap down onto ground just below (walking down steps and balls)
function groundProbe(maxDrop) {
    const p = P.pos;
    let best = -Infinity, bs = null;
    for (const c of nearBoxes) {
        if (c.off || c.climb) continue;
        if (c.max.x <= p.x - HW || c.min.x >= p.x + HW || c.max.z <= p.z - HW || c.min.z >= p.z + HW) continue;
        if (c.max.y <= p.y + 0.01 && c.max.y >= p.y - maxDrop && c.max.y > best) { best = c.max.y; bs = c; }
    }
    for (const s of nearRound) {
        if (s.off) continue;
        const top = surfaceY(s, p.x, p.z);
        if (top !== null && top <= p.y + 0.01 && top >= p.y - maxDrop && top > best) { best = top; bs = s; }
    }
    if (bs) { p.y = best; P.onGround = true; P.ground = bs; P.vel.y = Math.max(0, P.vel.y); }
    return !!bs;
}
// Moving platforms that moved into the player lift them out (or push them aside)
function depenetrate() {
    const p = P.pos;
    for (const c of nearBoxes) {
        if (!c.mover || !overlaps(c, p.x, p.y, p.z)) continue;
        if (p.y >= c.max.y - 1.6) { p.y = c.max.y + 0.001; P.vel.y = Math.max(0, P.vel.y); P.onGround = true; P.ground = c; continue; }
        const dxp = c.max.x - (p.x - HW), dxn = (p.x + HW) - c.min.x, dzp = c.max.z - (p.z - HW), dzn = (p.z + HW) - c.min.z;
        const m = Math.min(dxp, dxn, dzp, dzn);
        if (m === dxp) p.x += dxp; else if (m === dxn) p.x -= dxn; else if (m === dzp) p.z += dzp; else p.z -= dzn;
    }
}
function trussTouching() {
    const p = P.pos, e = 0.4;
    for (const c of nearBoxes) {
        if (!c.climb) continue;
        if (c.max.x > p.x - HW - e && c.min.x < p.x + HW + e && c.max.z > p.z - HW - e && c.min.z < p.z + HW + e && c.max.y > p.y + 0.2 && c.min.y < p.y + PH) return c;
    }
    return null;
}
const overlapsBox = (t, p) => t.max.x > p.x - HW && t.min.x < p.x + HW && t.max.y > p.y && t.min.y < p.y + PH && t.max.z > p.z - HW && t.min.z < p.z + HW;

// ----- gear stats -----
const tool = () => S.tool || '';
function walkSpeed() {
    let w = CFG.walk;
    if (tool() === 'speedCoil') w *= CFG.speedCoil;
    if (P.sprinting) w *= CFG.sprint;
    if (P.boostT > 0) w *= 1.5;
    if (P.spookT > 0) w *= 0.5;
    return qaWalk || w;
}
const gravity = () => CFG.grav * (tool() === 'gravityCoil' ? CFG.gravityCoil : 1);
const jumpV = () => CFG.jumpV;

function teleport(pos, yaw, fx) {
    P.pos.copy(pos); P.vel.set(0, 0, 0); P.kv.set(0, 0, 0); P.hv.set(0, 0, 0);
    P.facing = yaw || 0; cam.yaw = (yaw || 0) + Math.PI;
    P.climbing = null; P.peakY = pos.y; P.airTime = 0; P.bubbleT = 0; P.tornadoT = 0; P.lastGroundY = pos.y;
    if (rig && rig.userData.trail) rig.userData.trail.reset();
    P.stage = stageAt(pos.x, pos.y, pos.z) ?? -1;
    refreshNear(P.stage);
    for (const t of nearTriggers) t.inside = overlapsBox(t, pos);
    sendMove(true);
    if (fx) { teleportFx(); sfx('teleport'); }
}
function teleportLobby() {
    teleport(SPAWN, SPAWN_YAW, true);
    net.send('lobby');
    if (rig) { setShield(rig, CFG.spawnShield); sfx('shield'); }
}
actions.teleportLobby = () => { hideOops(); hideRevive(); teleportLobby(); };
actions.teleportCheckpoint = () => {
    if (!checkpointSpot(S.stage)) { teleportLobby(); return; }
    net.send('tp', { i: S.stage });
};
actions.teleportTo = (i) => {
    if (!checkpointSpot(i) || (i !== S.stage && i >= (S.maxStage || 0))) return;
    net.send('tp', { i });
};
// Back to your own checkpoint, or the spawn without one
function respawn(fx) {
    const spot = checkpointSpot(S.stage);
    if (spot) teleport(new V3(spot.x, spot.y, spot.z), spot.yaw, fx !== false);
    else { teleport(SPAWN, SPAWN_YAW, fx !== false); net.send('lobby'); }
    if (rig) setShield(rig, CFG.spawnShield);
}

// =====================================================================================
// "Would you like to go back?": after a fall or a death on a stage, a few seconds to pay a few
// Wins and be put back exactly where you were
// =====================================================================================
let reviveTo = null;
const safeCopy = () => (P.safe && S.stage >= 0 && P.safe.stage === S.stage ? { pos: P.safe.pos.clone(), yaw: P.safe.yaw, stage: P.safe.stage } : null);
function offerRevive(spot) {
    spot = spot || safeCopy();
    if (!spot || spot.stage !== S.stage) return;
    reviveTo = spot;
    showRevive(revivePrice(S.stage), CFG.reviveSecs);
}
actions.revive = () => {
    if (!reviveTo) return;
    net.send('revive', { i: S.stage });
};
// A death: back to the checkpoint, with the revive card
function die(why) {
    if (clockT - P.deathT < 0.8) return;
    P.deathT = clockT;
    if (why === 'lava' || why === 'acid' || why === 'kill' || why === 'squash') { flash(why === 'acid' ? '#7ae8ff' : '#ff3a2a', 500); sfx('oops'); addShake(0.7); rumble(0.7, 250); }
    if (why === 'lava') { splash(P.pos, 0xff6a1a, 22, 1.4); toast('🌋 Lava! Back to your checkpoint', '#ff8a5a'); }
    else if (why === 'acid') { splash(P.pos, 0x9ae8ff, 22, 1.4); toast('🥶 Freezing water! Back to your checkpoint', '#9ae8ff'); }
    else if (why === 'kill') { splash(P.pos, 0xff3a4a, 18, 1.3); toast('💥 Kill brick! Back to your checkpoint', '#ff6a7a'); }
    else if (why === 'ocean') { bigSplash(P.pos); sfx('splash'); toast('🌊 SPLASH! Back to your checkpoint', '#7ad0ff'); }
    else if (why === 'fell') { sfx('oops'); addShake(0.35); toast('😵 You fell! Back to your checkpoint', '#ffd28a'); }
    else if (why === 'laser') { flash('#ff2a2a', 450); sfx('zapped'); addShake(0.6); rumble(0.6, 220); splash(P.pos, 0xff3a3a, 18, 1.3); toast('🔴 Zapped by a laser! Back to your checkpoint', '#ff6a6a'); }
    else if (why === 'squash') { dust(P.pos, 16, 1.6); toast('🦶 SQUASHED by the giant!', '#ffb04a'); }
    showOof();
    net.send('fell');
    const spot = safeCopy();
    respawn(true);
    // the start of the stage is right here anyway: only offer it when it saves a real climb
    if (spot && spot.pos.distanceTo(P.pos) > 12) setTimeout(() => offerRevive(spot), 450);
}

// =====================================================================================
// Checkpoints, coins, the top, pads, chests, trolls
// =====================================================================================
actions.checkpoint = (i) => net.send('cp', { i });
let finishLock = 0;
actions.finish = () => {
    if (clockT - finishLock < 4) return;
    finishLock = clockT;
    net.send('win');
};
actions.chest = () => {
    if (chestState.ready) net.send('chest');
    else toast('🌈 The chest refills in ' + chestState.left, '#ffd028');
};
actions.vipChest = () => { if (vipState.chestReady) net.send('vipChest'); };
actions.ghostCage = () => { if (!S.gear.ghost && cageState.open) net.send('ghost'); };
actions.fireStand = (fromPrompt) => {
    if (S.gear.fire) { if (fromPrompt) actions.equip('fire'); return; }
    net.send('fire');
    if (fromPrompt) setTimeout(() => { if (!S.gear.fire) buy('pass', 'Fire'); }, 400);
};
actions.toolPad = (id, fromPrompt) => {
    if (S.gear[id]) { if (fromPrompt) actions.equip(id); else showToolPop(id); return; }
    if (id === 'fire') { actions.fireStand(fromPrompt); return; }
    if (fromPrompt) buy('pass', passForTool(id)); else showToolPop(id);
};
actions.skipPad = () => buy('product', 'Skip');
// Equip (or put away) a tool; buy it first if you don't own it
actions.equip = (id) => {
    if (!S.gear[id] && !(gloveById[id] && gloveById[id].free)) { const pass = passForTool(id); if (pass) buy('pass', pass); return; }
    const next = S.tool === id ? '' : id;
    S.tool = next;
    net.send('tool', { id: next });
    sfx('equip');
    renderHotbar(); refreshGearPads();
    if (next === 'carpet') toast('🧞 Fly: Space to rise, Shift to sink', '#ffd028');
    else if (next === 'laser') toast('🔫 Laser Gun: click a player to zap them!', '#2ad8ff');
    else if (next === 'bearTrap') toast('🪤 Bear Trap: click to drop it at your feet', '#c8d0e0');
    else if (isGlove(next)) toast('🖐️ ' + gloveById[next].name + ': click near a player to SLAP!', '#ffffff');
};
actions.adminFx = (id) => {
    if (!S.passes.Admin) { buy('pass', 'Admin'); return; }
    let fx = S.fx || '';
    fx = fx.includes(id) ? fx.replace(id, '') : fx + id;
    if (id === 'g') fx = fx.replace('t', '');
    if (id === 't') fx = fx.replace('g', '');
    S.fx = cleanFx(fx);
    net.send('fx', { fx: S.fx });
    sfx('admin');
};
actions.adminFireworks = () => { if (!S.passes.Admin) { buy('pass', 'Admin'); return; } net.send('fireworks'); };
// Kill bricks and deadly floors
actions.killBrick = () => { if (!P.flying && !qaNoHazards) die('kill'); };
actions.killFloor = (kind) => { if (!P.flying) die(kind); };
// TROLLED: a fake block, the fake WIN pad
let trollT = -9;
actions.trolled = (kind) => {
    if (kind === 'fake' && P.vel.y > 2) return;
    if (clockT - trollT < 2.5) return;
    trollT = clockT;
    trolledPopup(kind === 'pit' ? 'That WIN pad was FAKE! 🤣' : 'That block was FAKE! 🤣');
    sfx('laugh');
    net.send('trolled');
};
// "GET SPEED COIL FAST!!! Press E": a launch pad, of course
actions.trollPad = () => {
    if (clockT - trollT < 2) return;
    trollT = clockT;
    P.vel.y = 92; P.onGround = false; P.kv.set((Math.random() - 0.5) * 30, 0, (Math.random() - 0.5) * 30);
    sfx('boing'); sfx('laugh'); addShake(0.5);
    trolledPopup('No free coils here! 🤣');
    net.send('trolled');
};
// TROLL: "FREE SKIP!": a button that throws you off the tower
actions.bait = (e) => {
    if (clockT - trollT < 2 || P.flying) return;
    trollT = clockT;
    P.vel.y = 46; P.onGround = false; P.kv.set(e.dx * 58, 0, e.dz * 58);
    sfx('boing'); sfx('laugh'); addShake(0.5);
    trolledPopup('FREE SKIP? Nope! 🤣');
    net.send('trolled');
};
actions.dollChange = (d, s) => {
    if (Math.abs(d.zone - P.stage) > 1) return;
    if (s === 'red') sfx('redLight'); else if (s === 'green') sfx('greenLight');
};

function checkCoins() {
    const p = P.pos;
    for (const c of COINS) {
        if (coinState.collected.has(c.i) || Math.abs(c.zone - P.stage) > 1) continue;
        const dx = c.x - p.x, dy = c.y - (p.y + 2.5), dz = c.z - p.z;
        if (dx * dx + dy * dy + dz * dz < 4 * 4) {
            coinState.collected.add(c.i);
            coinBurst(new V3(c.x, c.y, c.z));
            sfx('coin');
            net.send('coin', { i: c.i });
        }
    }
}

// =====================================================================================
// Friend Boost
// =====================================================================================
let friendNames = [], friendsT = 3, friendSyncT = 5;
async function refreshFriends() {
    if (!BX.bloxity.ready || !BX.identity().loggedIn) return;
    const list = await BX.getFriends();
    friendNames = list.map((f) => f.displayName || f.username).filter(Boolean);
    syncFriends();
}
function syncFriends() {
    const room = net.room;
    if (!room || !room.state || !room.state.players || !friendNames.length) return;
    const here = [];
    room.state.players.forEach((p, id) => { if (id !== room.sessionId && friendNames.includes(p.name)) here.push(p.name); });
    net.send('friends', { names: here });
}

// =====================================================================================
// Other players
// =====================================================================================
const remotes = new Map();
let joinSynced = false;
class Remote {
    constructor(p) {
        this.rig = buildCharacter(p.kit, p.skin);
        this.rig.position.set(p.x, p.y, p.z);
        this.rig.rotation.y = p.ry;
        scene.add(this.rig);
        this.label = billboard(nameLines(p.name, p.admin), 6, 512, new V3(0, 7.8, 0), this.rig);
        this.labelKey = p.name + '|' + p.admin;
        this.av = null; this.blox = null; this.dead = false; this.phase = 0; this.vel = 0;
        this.lastX = p.x; this.lastZ = p.z; this.stepN = 0; this.swing = 0;
        this.setAvatar(p.av);
        if (Math.hypot(p.x - SPAWN.x, p.z - SPAWN.z) < 14 && p.y < 4) setShield(this.rig, CFG.spawnShield);
    }
    setAvatar(av) {
        this.av = av;
        const data = av ? unpackAvatar(av) : null;
        if (this.blox) { this.blox.setProportions(data && data.proportions); this.blox.setEquipped(data || {}); return; }
        if (this.loading) return;
        this.loading = true;
        createAvatar(data).then((a) => {
            this.loading = false;
            if (!a) return;
            if (this.dead) { a.dispose(); return; }
            this.blox = a;
            dressRig(this.rig, a);
            if (this.av !== av) this.setAvatar(this.av);
        });
    }
    update(p, dt, t) {
        const r = this.rig, u = r.userData;
        const k = 1 - Math.exp(-dt * 12);
        const far = (r.position.x - p.x) ** 2 + (r.position.z - p.z) ** 2 + (r.position.y - p.y) ** 2 > 900;
        if (far) {
            r.position.set(p.x, p.y, p.z); if (u.trail) u.trail.reset();
            if (Math.hypot(p.x - SPAWN.x, p.z - SPAWN.z) < 14 && p.y < 4) setShield(r, CFG.spawnShield);
        } else { r.position.x += (p.x - r.position.x) * k; r.position.y += (p.y - r.position.y) * k; r.position.z += (p.z - r.position.z) * k; }
        applyFx(r, p.fx || '', dt);
        r.rotation.y = lerpAngle(r.rotation.y, p.ry, k) + u.spinA;
        r.scale.setScalar(u.fxScale);
        if (p.av !== this.av) this.setAvatar(p.av);
        // players far up or down the tower aren't drawn or animated (busy servers stay smooth)
        const seen = camera.position.distanceToSquared(r.position) < 240 * 240;
        if (r.visible !== seen) { r.visible = seen; if (u.trail) u.trail.reset(); }
        if (!seen) { this.lastX = r.position.x; this.lastZ = r.position.z; setTool(r, p.tool); return; }
        const moved = Math.hypot(r.position.x - this.lastX, r.position.z - this.lastZ);
        this.vel += ((dt > 0 ? moved / dt : 0) - this.vel) * Math.min(1, dt * 6);
        this.lastX = r.position.x; this.lastZ = r.position.z;
        const air = p.anim === 2, climb = p.anim === 3, fly = p.anim === 4;
        const moving = p.anim === 1 && this.vel > 1;
        this.phase += dt * (moving ? Math.min(18, 4 + this.vel * 0.3) : climb ? 9 : 0);
        if (climb) climbPose(u.body, this.phase); else if (air) airPose(u.body); else if (moving) animRig(u.body, this.phase, 0.85); else animRig(u.body, 0, 0);
        if (u.tool && u.held && !climb) holdPose(u.body);
        if (this.swing > 0) this.swing = Math.max(0, this.swing - dt);
        swingHeld(u, this.swing > 0 ? 1 - this.swing / 0.28 : 0);
        if (this.blox) { this.blox.update(dt, { moving, air: air || fly, speed: this.vel, t, pose: climb ? 'climb' : undefined, hold: !!u.held, slap: this.swing > 0 ? 1 - this.swing / 0.28 : 0 }); followHand(u); }
        const stepN = Math.floor(this.phase / Math.PI);
        if (moving && stepN !== this.stepN && camera.position.distanceToSquared(r.position) < 900) {
            const s = groundUnder(r.position);
            if (s) stepQuiet(s.mat);
        }
        this.stepN = stepN;
        // a Bloxity avatar bobs and leans by itself (animator.js); this is for the blocky stand-in
        const own = !this.blox;
        u.pivot.position.y = PIVOT + (moving && own ? Math.abs(Math.sin(this.phase)) * 0.16 : 0);
        this.lean = (this.lean || 0) + ((moving && own ? 0.13 : fly ? 0.2 : 0) - (this.lean || 0)) * Math.min(1, dt * 8);
        u.pivot.rotation.set(this.lean, 0, 0);
        setTool(r, p.tool); setTrail(r, p.trail);
        if (u.carpet) { u.carpet.visible = fly; if (fly) waveCarpet(u.carpet, t, 1); }
        u.trail.update(trailAt(r), (moving || air || fly) && r.visible, dt, t);
        tickShield(r, dt);
        setStatusLook(r, p.st || '', dt, t);
        const key = p.name + '|' + p.admin;
        if (key !== this.labelKey) { this.labelKey = key; this.label.userData.set(nameLines(p.name, p.admin)); }
    }
    dispose() {
        this.dead = true;
        if (this.blox) this.blox.dispose();
        if (this.rig.userData.trail) this.rig.userData.trail.dispose();
        scene.remove(this.rig);
    }
}
const trailTmp = new V3();
function trailAt(r) { return trailTmp.set(r.position.x - Math.sin(r.rotation.y) * 0.9, r.position.y + 2.4, r.position.z - Math.cos(r.rotation.y) * 0.9); }
function groundUnder(pos) {
    for (const c of nearBoxes) if (!c.off && pos.x > c.min.x && pos.x < c.max.x && pos.z > c.min.z && pos.z < c.max.z && Math.abs(c.max.y - pos.y) < 0.6) return c;
    return null;
}
let quietT = 0;
function stepQuiet(m) { if (clockT - quietT < 0.06) return; quietT = clockT; surfStep(surfaceSound(m), false); }

const seenIds = new Set();
function syncRemotes(dt, t) {
    const room = net.room;
    if (!room || !room.state || !room.state.players) return;
    const seen = seenIds;
    seen.clear();
    room.state.players.forEach((p, id) => {
        if (id === room.sessionId) {
            S.name = p.name; S.friends = p.friends;
            if (!rig || rig.userData.kit !== p.kit) { buildPlayer(p.kit, p.skin); rig.userData.kit = p.kit; setShield(rig, CFG.spawnShield); }
            S.st = p.st || '';
            return;
        }
        seen.add(id);
        let r = remotes.get(id);
        if (!r) {
            r = new Remote(p); remotes.set(id, r);
            if (joinSynced) BX.playerJoined(p.name); else BX.playerInRoom(p.name);
        }
        r.update(p, dt, t);
    });
    for (const [id, r] of remotes) if (!seen.has(id)) { r.dispose(); remotes.delete(id); }
    joinSynced = true;
}

// ----- bear traps on the ground: { id, x, y, z, mesh, by } -----
const traps = new Map();
function addTrap(m) {
    if (traps.has(m.id)) return;
    const mesh = bearTrap(); mesh.position.set(m.x, m.y + 0.02, m.z); mesh.scale.setScalar(1.3); scene.add(mesh);
    traps.set(m.id, { ...m, mesh, open: true });
}
function removeTrap(id) { const t = traps.get(id); if (t) { scene.remove(t.mesh); traps.delete(id); } }
function checkTraps() {
    for (const t of traps.values()) {
        if (!t.open || t.by === (net.room && net.room.sessionId)) continue;
        if (Math.abs(P.pos.y - t.y) < 1.5 && Math.hypot(P.pos.x - t.x, P.pos.z - t.z) < 1.9) { t.open = false; net.send('trapStep', { id: t.id }); }
    }
}

// =====================================================================================
// Networking
// =====================================================================================
const BLOXITY_GAME_ID = import.meta.env.VITE_BLOXITY_GAME_ID || '';
const ON_BLOXITY_HOST = /\.play\.bloxity\.io$/.test(location.hostname);
const DEV_CHANNEL = /\.dev\.play\.bloxity\.io$/.test(location.hostname);
const SERVER_URL = import.meta.env.VITE_SERVER_URL
    || (ON_BLOXITY_HOST ? `https://${location.hostname.replace(/\.play\.bloxity\.io$/, '.host.bloxity.io')}`
        : BLOXITY_GAME_ID ? `https://${BLOXITY_GAME_ID}.host.bloxity.io`
        : import.meta.env.DEV ? `${location.protocol}//${location.hostname}:2627` : location.origin);
async function serverEndpoint() {
    let url = SERVER_URL;
    if (BLOXITY_GAME_ID) {
        const r = await BX.resolveEndpoint(BLOXITY_GAME_ID, DEV_CHANNEL ? 'preview' : undefined);
        if (r && r.cold) $('#loading').textContent = 'Waking up a server…';
        url = (r && r.endpoint) || SERVER_URL;
    }
    if (!/^https?:/i.test(url)) return url;
    if (!(await serverUp(url))) {
        $('#loading').textContent = 'Waking up a server…';
        const until = Date.now() + 60000;
        while (Date.now() < until) {
            await new Promise((res) => setTimeout(res, 2000));
            if (await serverUp(url)) break;
        }
    }
    return url;
}
async function serverUp(url) {
    try {
        const ctl = new AbortController();
        const t = setTimeout(() => ctl.abort(), 4000);
        const r = await fetch(url.replace(/\/$/, '') + '/health', { signal: ctl.signal, cache: 'no-store' });
        clearTimeout(t);
        return r.ok;
    } catch (e) { return false; }
}
let lastMoveSent = 0, lastMoveKey = '';
function sendMove(force) {
    const now = performance.now();
    if (!force && now - lastMoveSent < 66) return;
    const a = P.flying ? 4 : P.climbing ? 3 : !P.onGround ? 2 : P.moving ? 1 : 0;
    const m = { x: +P.pos.x.toFixed(2), y: +P.pos.y.toFixed(2), z: +P.pos.z.toFixed(2), ry: +P.facing.toFixed(3), a };
    const key = m.x + ',' + m.y + ',' + m.z + ',' + m.ry + ',' + a;
    if (!force && key === lastMoveKey && now - lastMoveSent < 500) return;
    lastMoveKey = key; lastMoveSent = now;
    net.send('move', m);
}

function storageGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
function storageSet(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* private mode */ } }
function playerUid() {
    let uid = storageGet('tet_uid');
    if (!uid) {
        uid = (crypto.randomUUID ? crypto.randomUUID() : String(Math.random()).slice(2) + Date.now());
        storageSet('tet_uid', uid);
    }
    return uid;
}
const sessionOf = (id) => (net.room && id === net.room.sessionId ? rig : remotes.get(id) && remotes.get(id).rig);

let lastCoins = null, lastStage = -2;
async function connect(name, endpoint) {
    const client = new Client(endpoint || await serverEndpoint());
    const id = BX.identity();
    const room = await client.joinOrCreate('troll', {
        uid: playerUid(), name: name || id.name, token: id.token, av: packAvatar(BX.currentAvatar()),
        save: storageGet('tet_save') || '',
    });
    net.room = room;
    joinSynced = false;
    room.onMessage('hello', (m) => { net.offset = m.now - Date.now(); net.bloxity = !!m.bloxity; (m.traps || []).forEach(addTrap); });
    room.onMessage('authed', () => { net.bloxity = true; });
    room.onMessage('emote', (m) => { const r = remotes.get(m.s); if (r) playEmoteOn(r.blox, m.id); });
    room.onMessage('chat', (m) => {
        toast(m.name + ': ' + m.text, '#ffffff');
        chatBubble(sessionOf(m.s), m.text);
    });
    BX.updateRoom(room.roomId);
    BX.gameplayStart();
    room.onMessage('profile', (m) => {
        if (m.save) storageSet('tet_save', m.save);
        delete m.save;
        const first = lastCoins === null;
        Object.assign(S, m);
        S.profileAt = Date.now();
        if (!first && S.wins > lastCoins) bumpCoins();
        lastCoins = S.wins;
        if (S.stage !== lastStage) {
            for (let i = 0; i < CHECKPOINTS.length; i++) lightCheckpoint(i, i <= S.stage);
            if (lastStage === -2 && S.stage >= 0) setTimeout(() => showOops('Continue from Stage ' + (S.stage + 1) + ' (free), or climb from the bottom.', 'Welcome back!'), 2500);
            lastStage = S.stage;
        }
        refreshGearPads();
        renderHotbar();
        refreshModal(); refreshDaily();
        openDailyOnJoin();
    });
    room.onMessage('toast', (m) => toast(m.text, m.color));
    room.onMessage('announce', (m) => toast(m.text, m.color));
    room.onMessage('earn', (m) => {
        floatText('+' + fmt(m.n) + ' 🏆', '#ffd028', P.pos.clone().add(new V3(0, 6.5, 0)), 4.4);
        if (m.why === 'cp') {
            showStageClear(m.i, m.n);
            cheer();
            sfx('checkpoint'); rumble(0.4, 180);
            sparkleColumn(P.pos, 0xffd028);
            ring(P.pos, 0xffd028, 9, 0.7);
            confetti(P.pos);
            setTimeout(() => showStageTitle(m.i), 1900);
        } else if (m.why === 'chest' || m.why === 'vip') {
            sfx('bonus'); sparkleColumn(P.pos, 0xffd028); coinBurst(P.pos.clone().add(new V3(0, 3, 0)));
            toast((m.why === 'vip' ? '👑 VIP chest! +' : '🌈 Rainbow chest! +') + fmt(m.n) + ' Wins', '#ffd028');
        }
    });
    room.onMessage('broke', (m) => { notEnough(m); sfx('denied'); });
    room.onMessage('won', (m) => {
        showWin(m);
        sfx('win'); rumble(0.8, 600);
        fireworks(P.pos, 16, () => sfx('firework'));
        sparkleColumn(P.pos, 0xffd028);
        coinState.collected.clear();
        // rewards restart: back to the lobby for another climb
        setTimeout(() => { if (P.pos.y > ROOF_Y - 2) { teleportLobby(); toast('🔁 Rewards restart: climb the tower again!', '#7de8ff'); } }, 6500);
    });
    room.onMessage('tpTo', (m) => {
        const spot = checkpointSpot(m.i);
        if (!spot) return;
        hideOops(); hideRevive();
        teleport(new V3(spot.x, spot.y, spot.z), spot.yaw, true);
        if (rig) setShield(rig, CFG.spawnShield);
        showStageTitle(m.i);
    });
    room.onMessage('skipTo', (m) => {
        const spot = checkpointSpot(m.i);
        if (spot) { hideRevive(); teleport(new V3(spot.x, spot.y, spot.z), spot.yaw, true); showStageTitle(m.i); }
    });
    room.onMessage('revived', () => {
        hideRevive();
        if (!reviveTo) return;
        teleport(reviveTo.pos, reviveTo.yaw, true);
        if (rig) setShield(rig, 1.5);
        sparkleColumn(P.pos, 0x46ff8a);
        toast('💚 Revived! Right back where you were', '#7dff6b');
        reviveTo = null;
    });
    room.onMessage('codeResult', (m) => codeResult(m));
    room.onMessage('boards', renderBoards);
    room.onMessage('fx', (m) => {
        sparkleColumn(P.pos, m.kind === 'unlock' ? 0x46ff8a : 0xffd028);
        ring(P.pos, 0xffd028, 10, 0.8);
        confetti(P.pos);
        sfx('buy');
    });
    room.onMessage('fireworks', (m) => {
        const r = sessionOf(m.s);
        if (r && camera.position.distanceTo(r.position) < 160) fireworks(r.position, 12, () => sfx('firework'));
    });
    // ----- slaps -----
    room.onMessage('slapFx', (m) => {
        const r = sessionOf(m.s), tg = m.t && sessionOf(m.t);
        if (m.s !== room.sessionId) { const rr = remotes.get(m.s); if (rr) rr.swing = 0.28; }
        if (tg) {
            const d = gloveById[m.g] || gloveById.slap;
            slapBurst(tg.position, d.rainbow ? 0xff5ad8 : d.color === 0xffffff || d.color === 0xf2f2f6 ? 0xffe24a : d.color, (d.force || 1) * (m.dbl ? 1.6 : 1));
            if (camera.position.distanceTo(tg.position) < 80) { sfx(m.g === 'mega' || m.dbl ? 'bigSlap' : 'slap'); comicPop(tg.position, m.dbl ? 'DOUBLE SLAP!' : m.g === 'mega' ? 'MEGA PUNCH!' : 'SLAP!'); }
        } else if (r && m.s !== room.sessionId && camera.position.distanceTo(r.position) < 60) sfx('whoosh');
    });
    room.onMessage('slapped', (m) => {
        if (shielded() || P.frozenT > 0) return;
        const d = gloveById[m.g] || gloveById.slap, f = (d.force || 1) * (m.dbl ? 2 : 1);
        P.kv.set(m.dx * CFG.slapForce * f, 0, m.dz * CFG.slapForce * f);
        P.vel.y = CFG.slapUp * (0.75 + 0.25 * Math.min(2.5, f)); P.onGround = false; P.climbing = null;
        flash('#ffffff', 300); sfx('slapped'); addShake(0.4 + 0.25 * f); rumble(0.6, 220);
        if (d.bubble) { P.bubbleT = CFG.bubbleSecs; P.kv.multiplyScalar(0.25); P.vel.y = 6; }
        if (d.blind) setBlind(CFG.blindSecs);
        if (d.spook) { P.spookT = CFG.spookSecs; sfx('ghost'); }
        if (d.fire) { P.fireT = 2.2; P.vel.y += 22; }
        if (d.tornado) { P.tornadoT = 1.6; sfx('whoosh'); }
        toast('🖐️ ' + m.by + (m.dbl ? ' DOUBLE slapped you!' : m.g === 'mega' ? ' MEGA PUNCHED you!' : ' slapped you!'), '#ffd0f0');
    });
    room.onMessage('slapHit', (m) => { if (m.boost) { P.boostT = CFG.boostSecs; toast('⚡ Speed burst!', '#ff8a8a'); } });
    // ----- the Laser Gun -----
    room.onMessage('zapped', (m) => {
        if (shielded()) return;
        P.kv.set(m.dx * CFG.rayForce, 0, m.dz * CFG.rayForce);
        P.vel.y = 46; P.onGround = false; P.climbing = null;
        flash('#a8f4ff', 350); sfx('zapped'); addShake(0.6); rumble(0.7, 250);
        toast('🔫 ' + m.by + ' zapped you!', '#2ad8ff');
    });
    room.onMessage('zapFx', (m) => {
        if (m.s === room.sessionId) return;
        const r = remotes.get(m.s); if (r) r.swing = 0.28;
        const tgt = sessionOf(m.t);
        if (r && tgt) {
            zapFx(r.rig.localToWorld(new V3(1.5, 2.4, 2.4)), tgt.position.clone().add(new V3(0, 2.5, 0)));
            if (camera.position.distanceTo(r.rig.position) < 70) sfx('zap');
        }
    });
    // ----- Nuke Server, Fling All, Freeze All, the Troll Face -----
    room.onMessage('nuke', (m) => {
        flash('#fff6d0', 1400); nukeFx(P.pos); sfx('nuke'); addShake(1.2); rumble(1, 900);
        P.vel.y = 60; P.onGround = false; P.climbing = null;
        toast('☢️ ' + m.by + ' NUKED THE SERVER!', '#ffd028');
        setTimeout(() => respawn(true), 1300);
    });
    room.onMessage('nukeSent', () => { flash('#fff6d0', 900); sfx('nuke'); addShake(0.6); });
    room.onMessage('fling', (m) => {
        flash('#e8f4ff', 700); sfx('whoosh'); sfx('zapped'); addShake(0.9); rumble(0.9, 500);
        P.vel.y = 58; P.kv.set((Math.random() - 0.5) * 70, 0, (Math.random() - 0.5) * 70); P.onGround = false; P.climbing = null;
        toast('🌪️ ' + m.by + ' flung everyone!', '#7de8ff');
    });
    room.onMessage('freeze', (m) => {
        P.frozenT = CFG.freezeSecs; sfx('freeze'); flash('#c8f4ff', 600); addShake(0.3);
        toast('🧊 ' + m.by + ' froze everyone!', '#9ae8ff');
    });
    room.onMessage('jumpscare', (m) => { jumpscare(m.by); sfx('laugh'); sfx('scare'); addShake(0.5); });
    room.onMessage('trollSent', (m) => { sfx(m.kind === 'freeze' ? 'freeze' : m.kind === 'scare' ? 'laugh' : 'whoosh'); addShake(0.3); });
    // ----- bear traps -----
    room.onMessage('trap', (m) => addTrap(m));
    room.onMessage('trapGone', (m) => removeTrap(m.id));
    room.onMessage('trapped', (m) => {
        P.trappedT = CFG.trapSecs; P.kv.set(0, 0, 0); P.hv.set(0, 0, 0);
        sfx('trap'); flash('#ffffff', 250); addShake(0.5);
        toast('🪤 ' + m.by + '\'s bear trap got you!', '#c8d0e0');
    });
    room.onMessage('trapFx', (m) => { const t = traps.get(m.id); if (t) { sfx('trap'); dust(t.mesh.position, 8, 1); } });
    room.onLeave((code, reason) => {
        console.warn('[net] left room', code, reason || '');
        net.room = null;
        if (code !== 1000) $('#offline').hidden = false;
    });
    return room;
}

// =====================================================================================
// Camera & input
// =====================================================================================
const cam = { yaw: SPAWN_YAW + Math.PI, pitch: 0.3, dist: 20, target: new V3() };
let camSens = 1;
const keys = {};
const touchMove = { x: 0, y: 0 };
let touchJump = false, touchDown = false, running = false, sprintToggle = false;

function pressJump() { P.jumpPress = clockT; }
addEventListener('keydown', (e) => {
    if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT')) { if (e.key === 'Enter') e.target.blur(); return; }
    if (e.code === 'Space' && !e.repeat && running) pressJump();
    keys[e.code] = true;
    if (e.code === 'Space' || e.code.startsWith('Arrow')) e.preventDefault();
    if (e.code === 'KeyE' && running) { if (activePrompt) usePrompt(); else useTool(true); }
    if (e.code === 'KeyF' && running) useTool(true);
    if (running && /^Digit[1-9]$/.test(e.code)) { const g = hotbarTools()[+e.code.slice(5) - 1]; if (g) actions.equip(g); }
    if (e.code === 'Escape') {
        if (closeTop()) return;
        if (running && BX.isEmbedded()) BX.showPortalMenu();
    }
});
addEventListener('keyup', (e) => { keys[e.code] = false; });
addEventListener('blur', () => { for (const k in keys) keys[k] = false; });
canvas.addEventListener('contextmenu', (e) => e.preventDefault());

const drags = new Map();
canvas.addEventListener('pointerdown', (e) => { canvas.setPointerCapture(e.pointerId); drags.set(e.pointerId, { x: e.clientX, y: e.clientY, x0: e.clientX, y0: e.clientY, t0: performance.now() }); canvas.focus(); });
canvas.addEventListener('pointermove', (e) => {
    const d = drags.get(e.pointerId);
    if (!d) return;
    const k = (e.pointerType === 'touch' ? 0.008 : 0.005) * camSens;
    cam.yaw -= (e.clientX - d.x) * k;
    cam.pitch = clamp(cam.pitch + (e.clientY - d.y) * k, -0.6, 1.35);
    d.x = e.clientX; d.y = e.clientY;
});
const endDrag = (e) => {
    const d = drags.get(e.pointerId);
    drags.delete(e.pointerId);
    // a tap / click without dragging uses the tool at that spot
    if (d && e.type === 'pointerup' && Math.hypot(e.clientX - d.x0, e.clientY - d.y0) < 7 && performance.now() - d.t0 < 350 && running) useTool(false, e.clientX, e.clientY);
};
canvas.addEventListener('pointerup', endDrag);
canvas.addEventListener('pointercancel', endDrag);
canvas.addEventListener('wheel', (e) => { cam.dist = clamp(cam.dist + Math.sign(e.deltaY) * 2.5, 6, 60); e.preventDefault(); }, { passive: false });

const isTouch = matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window;
if (isTouch) document.body.classList.add('touch');
(function joystick() {
    const stick = $('#stick'), knob = $('#knob');
    let id = null;
    const set = (e) => {
        const r = stick.getBoundingClientRect();
        let dx = e.clientX - (r.left + r.width / 2), dy = e.clientY - (r.top + r.height / 2);
        const max = r.width / 2, l = Math.hypot(dx, dy);
        if (l > max) { dx *= max / l; dy *= max / l; }
        knob.style.transform = `translate(${dx}px, ${dy}px)`;
        touchMove.x = dx / max; touchMove.y = dy / max;
    };
    stick.addEventListener('pointerdown', (e) => { id = e.pointerId; stick.setPointerCapture(id); set(e); });
    stick.addEventListener('pointermove', (e) => { if (e.pointerId === id) set(e); });
    const end = (e) => { if (e.pointerId !== id) return; id = null; knob.style.transform = ''; touchMove.x = touchMove.y = 0; };
    stick.addEventListener('pointerup', end); stick.addEventListener('pointercancel', end);
    const hold = (el, on, off) => {
        el.addEventListener('pointerdown', (e) => { e.preventDefault(); on(); });
        el.addEventListener('pointerup', off); el.addEventListener('pointercancel', off); el.addEventListener('pointerleave', off);
    };
    hold($('#jumpBtn'), () => { touchJump = true; pressJump(); }, () => { touchJump = false; });
    hold($('#downBtn'), () => { touchDown = true; }, () => { touchDown = false; });
    $('#useBtn').addEventListener('pointerdown', (e) => { e.preventDefault(); useTool(true); });
})();
actions.toggleSprint = () => { sprintToggle = !sprintToggle; sfx('click'); };

// Ray against the boxes near the player (camera collision)
const AXES = ['x', 'y', 'z'];
function rayHit(o, d, maxT) {
    let best = maxT;
    for (const c of nearBoxes) {
        if (c.off || c.mat === 'glass' || c.climb || c.mover || c.vanish || c.timed || (c.max.x - c.min.x < 1.5 && c.max.z - c.min.z < 1.5)) continue;
        let t0 = 0, t1 = best, miss = false;
        for (const a of AXES) {
            if (Math.abs(d[a]) < 1e-9) { if (o[a] < c.min[a] || o[a] > c.max[a]) { miss = true; break; } continue; }
            let ta = (c.min[a] - o[a]) / d[a], tb = (c.max[a] - o[a]) / d[a];
            if (ta > tb) { const q = ta; ta = tb; tb = q; }
            t0 = Math.max(t0, ta); t1 = Math.min(t1, tb);
            if (t0 > t1) { miss = true; break; }
        }
        if (!miss && t0 > 0 && t0 < best) best = t0;
    }
    return best;
}

// ----- tools: slap gloves (players near you), the Laser Gun (click a player), the Bear Trap -----
const ray = new T.Raycaster(), ndc = new T.Vector2();
function useTool(center, sx, sy) {
    const id = tool();
    if (!rig || !id || P.frozenT > 0 || P.bubbleT > 0) return;
    if (isGlove(id)) { slap(id); return; }
    if (id === 'bearTrap') {
        if (clockT - P.lastZap < 3 || !P.onGround) return;
        P.lastZap = clockT;
        net.send('trap', { x: +P.pos.x.toFixed(2), y: +P.pos.y.toFixed(2), z: +P.pos.z.toFixed(2) });
        sfx('equip');
        return;
    }
    if (id !== 'laser') return;
    if (clockT - P.lastZap < CFG.rayCooldown) return;
    P.lastZap = clockT;
    const x = center || sx === undefined ? innerWidth / 2 : sx, y = center || sy === undefined ? innerHeight / 2 : sy;
    ndc.set((x / innerWidth) * 2 - 1, -(y / innerHeight) * 2 + 1);
    ray.setFromCamera(ndc, camera);
    let best = null, bd = Infinity;
    const c = new V3();
    for (const [rid, r] of remotes) {
        c.copy(r.rig.position).setY(r.rig.position.y + 2.5);
        if (c.clone().sub(ray.ray.origin).dot(ray.ray.direction) < 0) continue;
        const range = c.distanceTo(P.pos);
        if (range > CFG.rayRange) continue;
        const miss = ray.ray.distanceToPoint(c);
        if (miss < 2.8 + range * 0.035 && miss < bd) { bd = miss; best = rid; }
    }
    P.slapAnim = 0.28;
    sfx('zap');
    const from = rig.localToWorld(new V3(1.5, 2.4, 2.4));
    if (best) {
        zapFx(from, remotes.get(best).rig.position.clone().add(new V3(0, 2.5, 0)));
        net.send('ray', { t: best });
    } else zapFx(from, ray.ray.at(45, new V3()));
}
function slap(id) {
    const g = gloveById[id];
    const cd = (g.cooldown || CFG.slapCooldown) * (S.passes.SpeedSlap ? 0.5 : 1);
    if (clockT - P.lastSlap < cd) return;
    P.lastSlap = clockT; P.slapAnim = 0.28;
    sfx('whoosh');
    // the closest player in front of you within reach (a wide cone)
    const range = g.range || CFG.slapRange;
    let best = '', bd = Infinity;
    const fx = Math.sin(P.facing), fz = Math.cos(P.facing);
    for (const [rid, r] of remotes) {
        const dx = r.rig.position.x - P.pos.x, dz = r.rig.position.z - P.pos.z, dy = r.rig.position.y - P.pos.y, d = Math.hypot(dx, dz);
        if (d > range || Math.abs(dy) > 6 || (d > 2.5 && (dx * fx + dz * fz) / d < 0.15)) continue;
        if (d < bd) { bd = d; best = rid; }
    }
    // face the one you slap
    if (best) { const r = remotes.get(best).rig; P.facing = Math.atan2(r.position.x - P.pos.x, r.position.z - P.pos.z); }
    net.send('slap', { t: best });
}

// The sun's shadow camera follows you in steps of one shadow-map texel (in the light's own frame),
// so the shadows of everything that stands still stay put instead of crawling as you move
const LZ = SUN_DIRECTION.clone().normalize(), LX = new V3(0, 1, 0).cross(LZ).normalize(), LY = LZ.clone().cross(LX), snapV = new V3();
function snapShadow(p) {
    const c = sun.shadow.camera, texel = (c.right - c.left) / sun.shadow.mapSize.x;
    const a = Math.round(p.dot(LX) / texel) * texel, b = Math.round(p.dot(LY) / texel) * texel;
    snapV.copy(LX).multiplyScalar(a).addScaledVector(LY, b).addScaledVector(LZ, p.dot(LZ));
    sun.target.position.copy(snapV);
    sun.position.copy(snapV).addScaledVector(LZ, 160);
}
const camDir = new V3(), camGoal = new V3(), camPos = new V3();
let camD = 20;
let baseFov = camera.fov;
function updateCamera(dt) {
    const t = performance.now() / 1000;
    cam.target.lerp(camGoal.set(P.pos.x, P.pos.y + 5, P.pos.z), 1 - Math.exp(-dt * 16));
    const cp = Math.cos(cam.pitch);
    camDir.set(Math.sin(cam.yaw) * cp, Math.sin(cam.pitch), Math.cos(cam.yaw) * cp);
    const camWant = Math.max(2.5, rayHit(cam.target, camDir, cam.dist) - 0.8);
    camD = camWant < camD ? camWant : camD + (camWant - camD) * (1 - Math.exp(-dt * 3.5));
    camPos.copy(cam.target).addScaledVector(camDir, camD);
    camera.position.copy(camPos);
    camera.lookAt(cam.target);
    if (shake > 0.001) {
        const s = shake * shake * 0.9;
        camera.position.x += (Math.random() * 2 - 1) * s;
        camera.position.y += (Math.random() * 2 - 1) * s;
        shake = Math.max(0, shake - dt * 2.2);
    }
    const fovBase = innerWidth < innerHeight ? 85 : 70;
    const fast = tool() === 'speedCoil' || P.sprinting || P.boostT > 0;
    const want = fovBase + (P.flying && P.moving ? 5 : 0) + (fast && P.moving ? 4 : 0);
    baseFov += (want - baseFov) * Math.min(1, dt * 5);
    if (Math.abs(camera.fov - baseFov) > 0.01) { camera.fov = baseFov; camera.updateProjectionMatrix(); }
    snapShadow(P.pos);
    const m = moodOf(P.stage, P.pos.y);
    setMood(m.mood);
    // the music fills out as you climb: the lobby, then each colour band
    setMusicIntensity(P.stage < 0 ? 0 : P.pos.y > ROOF_Y - 4 ? 3 : 1 + Math.min(2, P.stage >> 3));
    updateSky(camera.position, t, dt);
    updateAmbient(camera.position, t, m.amb);
}

// Proximity prompts
let activePrompt = null, promptX = -1, promptY = -1;
const projV = new V3();
function updatePrompt() {
    let best = null, bd = Infinity;
    for (const p of nearPrompts) {
        const d = p.pos.distanceTo(P.pos);
        if (d < p.r && d < bd) { bd = d; best = p; }
    }
    activePrompt = best;
    if (!best || anyPopup()) { promptEl.hidden = true; return; }
    projV.copy(best.pos).setY(best.pos.y + 2).project(camera);
    if (projV.z > 1) { promptEl.hidden = true; return; }
    promptEl.hidden = false;
    const px = Math.round((projV.x + 1) / 2 * innerWidth), py = Math.round((1 - projV.y) / 2 * innerHeight);
    if (px !== promptX || py !== promptY) { promptX = px; promptY = py; promptEl.style.transform = `translate(${px}px, ${py}px) translate(-50%, -110%)`; }
    const txt = best.label();
    if (promptTxtEl.textContent !== txt) promptTxtEl.textContent = txt;
}
function usePrompt() { if (activePrompt) activePrompt.act(); }
promptEl.addEventListener('click', usePrompt);

// Controller: popups first, then gameplay
let padJumpWas = false;
function padButtons() {
    if (pad.jump && !padJumpWas && running) pressJump();
    padJumpWas = pad.jump;
    const p = pad.pressed;
    if (!p.size) return;
    if (p.has('B') && closeTop()) return;
    if (!running) return;
    if (p.has('X')) { if (activePrompt) usePrompt(); else useTool(true); }
    if (p.has('Y')) openModal('store');
    if (p.has('LB') || p.has('RB')) {
        const list = hotbarTools();
        if (list.length) {
            const i = list.indexOf(S.tool);
            const n = list[((i < 0 ? (p.has('RB') ? -1 : 0) : i) + (p.has('RB') ? 1 : -1) + list.length) % list.length];
            actions.equip(n);
        }
    }
    if (p.has('BACK')) openModal('teleport');
    if (p.has('START')) openModal('config');
    if (p.has('UP')) cam.dist = clamp(cam.dist - 4, 6, 60);
    if (p.has('DOWN')) cam.dist = clamp(cam.dist + 4, 6, 60);
}
onGamepadConnection((g, on) => { if (running) toast(on ? '🎮 Controller connected' : '🎮 Controller disconnected', on ? '#7dff6b' : '#ffb51c'); });

// =====================================================================================
// Main update
// =====================================================================================
const botInput = { f: 0, r: 0, jump: false, down: false, sprint: false };
let qaWalk = 0;
let clockT = 0, hudT = 0;
const tmpF = new V3(), tmpR = new V3(), mv = new V3();
function surfaceSound(m) {
    return { wood: 'wood', stud: 'stud', wall: 'stud', floor: 'stud', plate: 'plate', truss: 'truss', bounce: 'bounce', ice: 'ice', key: 'keys', glass: 'tile', neon: 'neon', ghost: 'glass' }[m] || 'stud';
}
function footStep(g) {
    surfStep(surfaceSound(g.mat), false);
    if (g.ice && Math.random() < 0.3) dust(P.pos, 2, 0.6, 0xe8f8ff);
}
function land(g, hard) {
    surfStep(surfaceSound(g.mat), true);
    dust(P.pos, hard ? 10 : 5, hard ? 1.3 : 0.9);
    if (hard) ring(P.pos, 0xffffff, 4, 0.35);
    P.squashV -= hard ? 8 : 4;
}
// Is this a good spot to come back to with Revive? (standing still-ish on the course itself)
const safeGround = (g) => g && !g.off && !g.mover && !g.vanish && !g.timed && !g.conv && !g.bounce && !g.spin && !g.floor && !g.kill && !g.cp && !g.landing && g.shape !== 'dome' && !g.climb;

function update(dt) {
    clockT += dt;
    const t = clockT;
    let f = botInput.f, r = botInput.r;
    if (keys.KeyW || keys.ArrowUp) f += 1;
    if (keys.KeyS || keys.ArrowDown) f -= 1;
    if (keys.KeyD || keys.ArrowRight) r += 1;
    if (keys.KeyA || keys.ArrowLeft) r -= 1;
    f -= touchMove.y + pad.ly; r += touchMove.x + pad.lx;
    cam.yaw -= pad.rx * 2.8 * dt;
    cam.pitch = clamp(cam.pitch + pad.ry * 1.8 * dt, -0.6, 1.35);
    tmpF.set(-Math.sin(cam.yaw), 0, -Math.cos(cam.yaw));
    tmpR.set(Math.cos(cam.yaw), 0, -Math.sin(cam.yaw));
    mv.set(0, 0, 0).addScaledVector(tmpF, f).addScaledVector(tmpR, r);
    if (mv.lengthSq() > 1) mv.normalize();
    if (anyPopup() && !isTouch) mv.set(0, 0, 0);
    // frozen solid, stuck in a trap, floating in a bubble: no walking
    if (P.frozenT > 0 || P.trappedT > 0 || P.bubbleT > 0) mv.set(0, 0, 0);
    P.moving = mv.lengthSq() > 0.01;
    const jumpHeld = keys.Space || touchJump || pad.jump || botInput.jump;
    const shiftHeld = keys.ShiftLeft || keys.ShiftRight;
    const downHeld = shiftHeld || keys.KeyQ || keys.KeyC || touchDown || botInput.down;

    // the world moves first, so riders are carried and hits line up
    updateWorld(dt, t, P.stage, P.pos);

    const id = tool();
    P.flying = id === 'carpet';
    // Sprint: Shift (or the Sprint button) for a few seconds, then it recharges
    const wantSprint = !P.flying && P.moving && (shiftHeld || sprintToggle || pad.sprint || botInput.sprint);
    P.sprinting = wantSprint && P.sprint > 0.02;
    P.sprint = clamp(P.sprint + (P.sprinting ? -dt / CFG.sprintSecs : dt / CFG.sprintRecharge), 0, 1);
    for (const k of ['frozenT', 'trappedT', 'bubbleT', 'spookT', 'boostT', 'fireT', 'tornadoT']) if (P[k] > 0) P[k] = Math.max(0, P[k] - dt);
    const ws = P.flying ? CFG.carpetSpeed : walkSpeed();
    const g = gravity();
    // carried by moving platforms and spinners, pushed by belts
    if (P.onGround && P.ground) {
        if (P.ground.mover) P.pos.add(P.ground.delta);
        if (P.ground.spin) {
            const a = -P.ground.spin * dt, dx = P.pos.x - P.ground.cx, dz = P.pos.z - P.ground.cz;
            const c = Math.cos(a), s = Math.sin(a);
            P.pos.x = P.ground.cx + dx * c + dz * s; P.pos.z = P.ground.cz - dx * s + dz * c;
            P.facing += a; cam.yaw += a;
        }
        if (P.ground.conv) { moveAxis('x', P.ground.conv.x * dt); moveAxis('z', P.ground.conv.z * dt); }
    }
    depenetrate();

    // ----- vertical: jump, double jump, climb, fly, float -----
    const truss = !P.flying && P.frozenT <= 0 ? trussTouching() : null;
    if (truss) {
        const cx = clamp(P.pos.x, truss.min.x, truss.max.x) - P.pos.x, cz = clamp(P.pos.z, truss.min.z, truss.max.z) - P.pos.z;
        const l = Math.hypot(cx, cz) || 1;
        const into = mv.lengthSq() > 0.01 ? (mv.x * cx + mv.z * cz) / l / Math.sqrt(mv.lengthSq()) : 0;
        if (into > 0.25 || (P.climbing && into > -0.4 && !P.onGround)) {
            if (!P.climbing) P.climbT = 0;
            P.climbing = truss;
        } else P.climbing = null;
    } else P.climbing = null;
    const pressed = t - P.jumpPress < 0.2;
    if (P.onGround) { P.coyote = 0.1; P.jumps = 0; } else P.coyote -= dt;
    if (P.flying) {
        const vy = jumpHeld ? CFG.carpetSpeed * 0.75 : downHeld ? -CFG.carpetSpeed * 0.75 : 0;
        P.vel.y += (vy - P.vel.y) * Math.min(1, dt * 6);
    } else if (P.bubbleT > 0) {
        // floating up inside a bubble
        P.vel.y += (7 - P.vel.y) * Math.min(1, dt * 4);
        if (P.bubbleT <= dt * 1.01) { sfx('pop'); splash(P.pos.clone().setY(P.pos.y + 2.6), 0x9ae0ff, 12, 1); }
    } else if (P.climbing) {
        P.climbT += dt;
        P.vel.y = P.moving ? CFG.climb : 0;
        if (pressed) { P.vel.y = jumpV() * 0.85; P.climbing = null; P.jumpPress = -9; sfx('jump'); }
    } else {
        if (pressed && P.frozenT <= 0 && P.trappedT <= 0 && (P.onGround || P.coyote > 0)) {
            P.vel.y = jumpV(); P.onGround = false; P.coyote = 0; P.jumpPress = -9; P.ground = null;
            sfx('jump'); P.squashV += 5;
        } else if (pressed && !P.onGround && P.coyote <= 0 && S.passes.DoubleJump && P.jumps < 1 && P.frozenT <= 0) {
            // x2 Jump: a second jump in mid-air
            P.jumps++; P.vel.y = jumpV() * 0.92; P.jumpPress = -9;
            sfx('jump2'); ring(P.pos, 0x9affd8, 4, 0.35); dust(P.pos, 6, 0.8, 0xffffff);
        }
        if (P.tornadoT > 0) {
            // spun round and up by a tornado, flung out at the end
            const a = t * 14;
            P.kv.set(Math.cos(a) * 14, 0, Math.sin(a) * 14);
            P.vel.y = Math.max(P.vel.y, 26);
            tornadoFx(P.pos, t, dt);
            if (P.tornadoT <= dt * 1.01) { P.kv.set(Math.cos(a) * 60, 0, Math.sin(a) * 60); P.vel.y = 40; }
        } else P.vel.y -= g * dt;
    }
    loopSound('carpet', P.flying ? (P.moving || Math.abs(P.vel.y) > 1 ? 1 : 0.6) : 0);

    // ----- horizontal: instant on most things, slippery on ice, knockback on top -----
    const tx = mv.x * ws, tz = mv.z * ws;
    const ice = P.ground && P.ground.ice;
    if (ice || (P.onIce && !P.onGround)) {
        const k = 1 - Math.exp(-dt * (P.onGround ? 3.4 : 2.4));
        P.hv.x += (tx - P.hv.x) * k; P.hv.z += (tz - P.hv.z) * k;
    } else P.hv.set(tx, 0, tz);
    if (P.onGround) P.onIce = !!ice;
    const vx = P.hv.x + P.kv.x, vz = P.hv.z + P.kv.z;
    P.kv.multiplyScalar(Math.exp(-dt * (P.onGround ? 9 : 1.6)));
    if (P.trappedT > 0) { P.hv.set(0, 0, 0); P.kv.set(0, 0, 0); }

    const dist = Math.max(Math.abs(vx), Math.abs(vz), Math.abs(P.vel.y)) * dt;
    const n = Math.max(1, Math.ceil(dist / 0.5));
    const sdt = dt / n;
    const wasGround = P.ground, wasOn = P.onGround;
    P.onGround = false; P.ground = null;
    let vy = P.flying || P.climbing || P.bubbleT > 0 ? P.vel.y : P.vel.y + 0.5 * g * dt;
    for (let i = 0; i < n; i++) {
        if (P.trappedT <= 0) { moveAxis('x', vx * sdt); moveAxis('z', vz * sdt); }
        const before = P.vel.y;
        moveAxis('y', vy * sdt);
        if (P.vel.y !== before) vy = P.vel.y;
        resolveRound();
    }
    if (!P.onGround && wasOn && P.vel.y <= 0 && !P.flying && !P.climbing && !(wasGround && wasGround.bounce)) groundProbe(0.7);
    else if (!P.onGround && P.vel.y <= 0 && !P.flying && !P.climbing) groundProbe(0.05);

    // ----- landing, bouncing, surfaces -----
    if (P.onGround) {
        const gr = P.ground;
        if (gr && gr.bounce && !P.flying) {
            P.vel.y = gr.bounce; P.onGround = false; P.ground = null;
            sfx('boing');
            jiggle(gr);
            splash(P.pos, 0xff8ad8, 12, 1.2);
            addShake(0.2); P.squashV -= 6; P.airTime = 0.01; P.peakY = P.pos.y;
        } else {
            if (P.airTime > 0.25 && gr) land(gr, P.airTime > 0.8);
            // a long fall: the revive card (back to where you fell from, for a few Wins)
            const fell = P.peakY - P.pos.y;
            if (fell > 9 && !P.flying && P.safe && P.safe.stage === S.stage && P.safe.pos.y - P.pos.y > 7 && !reviveOpen()) {
                sfx('oops'); addShake(0.4);
                net.send('fell');
                offerRevive();
            }
            P.airTime = 0; P.peakY = P.pos.y;
        }
        P.lastGroundY = P.pos.y;
    } else {
        P.airTime += dt;
        P.peakY = Math.max(P.peakY, P.pos.y);
    }
    if (P.flying || P.climbing || P.bubbleT > 0) { P.airTime = 0; P.peakY = P.pos.y; }
    const gr = P.onGround ? P.ground : null;
    if (gr && gr.shape === 'dome') pressDome(gr);
    if (gr && gr.vanish) touchVanish(gr);
    // remember the last good spot on the course for Revive
    P.safeT -= dt;
    if (gr && P.safeT <= 0 && safeGround(gr) && P.stage === S.stage && S.stage >= 0 && P.pos.y > START_Y[S.stage] + 1) {
        P.safeT = 0.25;
        if (!P.safe) P.safe = { pos: new V3(), yaw: 0, stage: -1 };
        P.safe.pos.copy(P.pos); P.safe.yaw = P.facing; P.safe.stage = S.stage;
    }

    // facing
    if (P.moving && mv.lengthSq() > 0.01 && !P.climbing) P.facing = lerpAngle(P.facing, Math.atan2(mv.x, mv.z), 1 - Math.exp(-dt * 14));
    else if (P.climbing) {
        const c = P.climbing, cx = clamp(P.pos.x, c.min.x, c.max.x) - P.pos.x, cz = clamp(P.pos.z, c.min.z, c.max.z) - P.pos.z;
        if (Math.hypot(cx, cz) > 0.01) P.facing = lerpAngle(P.facing, Math.atan2(cx, cz), 1 - Math.exp(-dt * 10));
    }

    // ----- where you are -----
    const here = stageAt(P.pos.x, P.pos.y, P.pos.z);
    if (here !== null && here !== P.stage) {
        // (later stages get their title after the STAGE CLEAR banner)
        if (here === 0 && P.stage < 0 && P.onGround && (S.stage ?? -1) < 0) showStageTitle(0);
        P.stage = here;
    }
    refreshNear(P.stage);
    // off the course and dropping: back to the checkpoint (into the ocean from low down)
    if (P.flying || P.onGround || P.climbing) P.lastGroundY = P.pos.y;
    if (!P.flying && here === null && P.pos.y < (P.lastGroundY ?? 0) - 8) die(P.pos.y < 30 ? 'ocean' : 'fell');
    else if (!P.flying && P.pos.y < -60) die('ocean');
    // ----- hazards -----
    const st = net.now() / 1000;
    hazards(t, st, dt);
    for (const tr of nearTriggers) {
        const inside = overlapsBox(tr, P.pos);
        if (inside && !tr.inside && tr.enter) tr.enter();
        tr.inside = inside;
    }
    checkCoins();
    checkTraps();
    // fireworks over the victory platform while you're up top
    if (P.pos.y > ROOF_Y + 3 && clockT > fwT) { fwT = clockT + 2.6 + Math.random() * 1.5; fireworks(new V3(FINISH.x + (Math.random() - 0.5) * 36, FINISH.y + 1, FINISH.z + (Math.random() - 0.5) * 24), 3, () => sfx('firework')); }

    if (S.name && headLabel) {
        const key = S.name + '|' + !!S.passes.Admin;
        if (key !== nameLabelText) { nameLabelText = key; headLabel.userData.set(nameLines(S.name, S.passes.Admin)); }
    }
    updateEffects(dt);
    updateFx(dt);
    for (const fn of tickers) fn(dt, t);

    syncRemotes(dt, t);
    friendsT -= dt; friendSyncT -= dt;
    if (friendsT <= 0) { friendsT = 30; friendSyncT = 5; refreshFriends(); }
    else if (friendSyncT <= 0) { friendSyncT = 5; syncFriends(); }

    // ----- the local character -----
    if (rig) {
        const u = rig.userData;
        applyFx(rig, S.fx || '', dt);
        rig.position.copy(P.pos);
        rig.rotation.y = P.facing + u.spinA;
        const hs = P.moving ? ws : 0;
        P.animPhase += dt * (P.onGround ? Math.min(18, 4 + hs * 0.3) : P.climbing && P.vel.y > 0 ? 9 : 0);
        if (P.climbing) climbPose(u.body, P.animPhase);
        else if (P.flying) { animRig(u.body, 0, 0); u.body.userData.legs[0].rotation.set(-0.9, 0, 0); u.body.userData.legs[1].rotation.set(-0.9, 0, 0); }
        else if (!P.onGround) airPose(u.body);
        else if (P.moving) animRig(u.body, P.animPhase, 0.85);
        else animRig(u.body, 0, 0);
        if (u.held && !P.climbing) holdPose(u.body);
        if (P.slapAnim > 0) P.slapAnim = Math.max(0, P.slapAnim - dt);
        const slapK = P.slapAnim > 0 ? 1 - P.slapAnim / 0.28 : 0;
        swingHeld(u, slapK);
        if (localAvatar) { localAvatar.update(dt, { moving: P.moving && P.onGround, air: !P.onGround && !P.climbing, vy: P.climbing ? 0 : P.vel.y, speed: hs, t, pose: P.climbing ? 'climb' : undefined, hold: !!u.held, slap: slapK }); followHand(u); }
        setTool(rig, id); setTrail(rig, S.trail);
        if (u.carpet) { u.carpet.visible = P.flying; waveCarpet(u.carpet, t, P.moving ? 1.4 : 0.8); }
        u.trail.update(trailAt(rig), (P.moving || !P.onGround), dt, t);
        const stepN = Math.floor(P.animPhase / Math.PI);
        if (P.onGround && P.moving && stepN !== P.lastStepN && P.ground) footStep(P.ground);
        if (P.climbing && stepN !== P.lastStepN && P.vel.y > 0) surfStep('truss', false);
        P.lastStepN = stepN;
        // the Bloxity avatar bobs, leans and lands by itself (animator.js): the whole-body bob, lean,
        // roll and squash below are for the blocky stand-in only
        const own = !localAvatar;
        const runBob = own && P.onGround && P.moving && !P.climbing ? Math.abs(Math.sin(P.animPhase)) * 0.18 : 0;
        u.pivot.position.y = PIVOT + runBob;
        const leanTo = P.climbing ? 0 : P.flying ? (P.moving ? 0.28 : 0) : !own ? 0 : P.onGround && P.moving ? Math.min(0.2, ws * 0.007) : !P.onGround ? -0.06 : 0;
        P.lean = (P.lean || 0) + (leanTo - (P.lean || 0)) * Math.min(1, dt * 9);
        let turn = P.facing - (P.prevFacing ?? P.facing);
        turn = Math.atan2(Math.sin(turn), Math.cos(turn));
        P.prevFacing = P.facing;
        const rollTo = clamp(-turn / Math.max(dt, 1e-3) * 0.045, -0.22, 0.22) * (P.moving && own ? 1 : 0);
        P.roll = (P.roll || 0) + (rollTo - (P.roll || 0)) * Math.min(1, dt * 7);
        u.pivot.rotation.set(P.lean, 0, P.roll);
        P.squashV += (1 - P.squash) * 180 * dt;
        P.squashV *= Math.exp(-12 * dt);
        P.squash = clamp(P.squash + P.squashV * dt, 0.72, 1.28);
        const sc = u.fxScale, sq = own ? P.squash : 1;
        rig.scale.set(sc / Math.sqrt(sq), sc * sq, sc / Math.sqrt(sq));
        tickShield(rig, dt);
        // my own status looks: a bubble, an ice block, flames
        setStatusLook(rig, (P.bubbleT > 0 ? 'b' : '') + (P.frozenT > 0 ? 'f' : '') + (P.fireT > 0 ? 'x' : ''), dt, t);
    }
    const fastNow = Math.hypot(P.hv.x + P.kv.x, P.hv.z + P.kv.z);
    setSpeedLines(!reduceMotion && fastNow > 25 && P.moving ? Math.min(0.7, (fastNow - 25) * 0.05 + 0.25) : 0, dt);
    const toolKey = id + '|' + anyPopup();
    if (toolKey !== lastToolKey) {
        lastToolKey = toolKey;
        $('#crosshair').hidden = !(id === 'laser' && !isTouch && !anyPopup());
        $('#useBtn').hidden = !(isTouch && (id === 'laser' || isGlove(id) || id === 'bearTrap'));
        $('#useBtn').textContent = id === 'laser' ? '🔫' : id === 'bearTrap' ? '🪤' : '🖐️';
        $('#downBtn').hidden = !(isTouch && id === 'carpet');
    }
    setSprintMeter(P.sprint, P.sprinting, sprintToggle);

    sendMove(false);
    updatePrompt();
    animateCounters(dt);
    hudT -= dt;
    if (hudT <= 0) {
        hudT = 0.1;
        const now = net.now();
        updateHud(); renderHotbar(); setDecorLow(getQuality() === 'low');
        updateChest(now);
        renderProgress(S.stage, P.pos.y);
    }
}
let lastToolKey = '', fwT = 0;

// The traps that knock you about: slap hands, punching gloves, sweepers, the doll, the giants
function knock(kx, kz, up, sound) {
    P.kv.set(kx, 0, kz); P.vel.y = up; P.onGround = false; P.climbing = null; P.trapHit = clockT;
    sfx(sound || 'slapped'); addShake(0.45); rumble(0.5, 180);
    slapBurst(P.pos, 0xb8a8ff, 0.8);
}
let qaNoHazards = false;
function hazards(t, st, dt) {
    if (P.flying || qaNoHazards) return;
    const p = P.pos, ready = t - P.trapHit > 0.5;
    for (const s of slappers) {
        if (!ready || Math.abs(s.zone - P.stage) > 1) continue;
        if (p.y > s.y + 2.4 || p.y + PH < s.y - 1.4) continue;
        const { a, w } = slapperAngle(s, st);
        const dx = Math.cos(a), dz = Math.sin(a);
        const px = p.x - s.x, pz = p.z - s.z;
        const proj = clamp(px * dx + pz * dz, 0, s.len);
        const ex = px - dx * proj, ez = pz - dz * proj, d = Math.hypot(ex, ez);
        const hitR = proj > s.len - s.hitR * 1.6 ? s.hitR : 0.7;
        if (d < hitR + HW * 0.8) {
            const sg = Math.sign(w) || 1, f = s.giant ? 62 : 46;
            knock(-dz * sg * f + ex * 4, dx * sg * f + ez * 4, s.giant ? 34 : 26);
            comicPop(p, 'SLAP!');
        }
    }
    for (const q of punches) {
        if (!ready || Math.abs(q.zone - P.stage) > 1) continue;
        const { ext, hot } = punchExt(q, st);
        if (ext < 1.2 || !hot) continue;
        const gx = q.x + q.dx * (ext + 0.6), gz = q.z + q.dz * (ext + 0.6);
        const rx = p.x - gx, rz = p.z - gz;
        const along = rx * q.dx + rz * q.dz, across = Math.abs(-rx * q.dz + rz * q.dx);
        if (along > -ext - 1 && along < 1.8 + HW && across < 1.6 + HW * 0.8 && p.y < q.y + 2.6 && p.y + PH > q.y - 2.6) {
            knock(q.dx * 52, q.dz * 52, 24);
            comicPop(p, 'PUNCH!');
        }
    }
    // laser bars: touch one and you're out
    for (const l of lasers) {
        if (Math.abs(l.zone - P.stage) > 1) continue;
        const by = laserY(l, st);
        if (p.y > by + 0.2 || p.y + PH < by - 0.2) continue;
        const ax = l.alongX ? l.len / 2 : 0.2 + HW, az = l.alongX ? 0.2 + HW : l.len / 2;
        if (Math.abs(p.x - l.x) < ax && Math.abs(p.z - l.z) < az) { die('laser'); return; }
    }
    for (const w of sweepers) {
        if (Math.abs(w.zone - P.stage) > 1 || t - P.trapHit < 0.5) continue;
        if (p.y > w.y + 0.6 || p.y + PH < w.y - 0.6) continue;
        const a = sweeperAngle(w, st), dx = Math.cos(a), dz = Math.sin(a);
        const px = p.x - w.cx, pz = p.z - w.cz;
        const proj = clamp(px * dx + pz * dz, -w.len, w.len);
        const ex = px - dx * proj, ez = pz - dz * proj;
        if (Math.hypot(ex, ez) < 0.6 + HW * 0.9) {
            const sgn = Math.sign(proj * w.speed) || 1;
            knock(-dz * sgn * 34 + ex * 6, dx * sgn * 34 + ez * 6, 24, 'bonk');
        }
    }
    // red light, green light: move on red and the guard zaps you back to the bridge
    for (const d of dolls) {
        if (Math.abs(d.zone - P.stage) > 1) continue;
        const b = d.box;
        if (p.x < b.x0 || p.x > b.x1 || p.z < b.z0 || p.z > b.z1 || p.y < b.y0 || p.y > b.y1) continue;
        const ds = dollState(d, st);
        const speed = Math.hypot(P.hv.x, P.hv.z);
        if (ds.s === 'red' && ds.since > 0.25 && t - P.caughtT > 2 && (speed > 2 || (!P.onGround && Math.abs(P.vel.y) > 4))) {
            P.caughtT = t;
            const eye = d.g.localToWorld(new V3(0, 4.72 * 4.2, 3));
            zapFx(eye, P.pos.clone().add(new V3(0, 2.5, 0)));
            flash('#ff2a2a', 600); sfx('zapped'); sfx('alarm'); addShake(0.7); rumble(0.8, 300);
            toast('🚨 You moved on RED LIGHT!', '#ff6a6a');
            setTimeout(() => { teleport(new V3(d.reset.x, d.reset.y, d.reset.z), d.reset.yaw, true); if (rig) setShield(rig, 1.2); }, 350);
        }
    }
    // giants: their feet send you flying (or flat, on the sky path)
    for (const gd of giants) {
        if (!gd.state || (gd.zone >= 0 && Math.abs(gd.zone - P.stage) > 1) || (gd.zone < 0 && P.stage >= 0) || t - P.trapHit < 0.6) continue;
        const gs = gd.state;
        if (p.y > gd.y + gs.top || p.y + PH < gd.y) continue;
        for (const ft of gs.feet) {
            const rx = p.x - ft.x, rz = p.z - ft.z;
            const along = Math.abs(rx * gs.dx + rz * gs.dz), side = Math.abs(rx * gs.dz - rz * gs.dx);
            if (along < gs.hz + HW && side < gs.hx + HW) {
                if (gd.kill) { P.trapHit = t; die('squash'); }
                else { knock(gs.dx * 60 + rx * 2, gs.dz * 60 + rz * 2, 48, 'bonk'); comicPop(p, 'KICKED!'); toast('🦶 The giant kicked you!', '#ffb04a'); }
                break;
            }
        }
    }
}

// =====================================================================================
// Boot
// =====================================================================================
let frameErrors = 0;
let lastFrame = 0, loadingSignaled = false, fpsAcc = 0, fpsFrames = 0, showFps = false;
const fpsWatch = { t: 0, low: 0 };
function watchFps(fps) {
    if (!running || document.hidden || !autoQualityAllowed()) return;
    fpsWatch.t += 0.5;
    if (fpsWatch.t < 2) return;
    fpsWatch.low = fps < 40 ? fpsWatch.low + 0.5 : 0;
    if (fpsWatch.low < 2.5) return;
    fpsWatch.low = 0;
    const next = { high: 'medium', medium: 'low' }[getQuality()];
    if (!next) return;
    setQuality(next, true);
    toast('⚙️ Graphics set to ' + (next === 'medium' ? 'Medium' : 'Low') + ' for smoother play', '#7de8ff');
}
function frame(now) {
    const dt = Math.min(0.05, (now - (lastFrame || now)) / 1000);
    fpsAcc += (now - (lastFrame || now)) / 1000; fpsFrames++;
    if (fpsAcc >= 0.5) { if (showFps) $('#fps').textContent = Math.round(fpsFrames / fpsAcc) + ' FPS'; watchFps(fpsFrames / fpsAcc); fpsAcc = 0; fpsFrames = 0; }
    lastFrame = now;
    if (!loadingSignaled) { loadingSignaled = true; BX.triggerAllSettings(); }
    pollGamepad();
    padButtons();
    // one bad frame (an odd avatar part, say) must never stop the game: log it and carry on
    if (running) {
        try { update(dt); updateCamera(dt); render(); } catch (e) {
            if (frameErrors++ < 5) console.error('[frame]', e);
        }
    }
    requestAnimationFrame(frame);
}

let joining = false, joinTask = null, worldReady = null;
async function joinServer() {
    const endpointTask = serverEndpoint();
    endpointTask.catch(() => {});
    await waitForLogin(400);
    const saved = (storageGet('tet_name') || '').slice(0, 20);
    for (let attempt = 0; ; attempt++) {
        try { return await connect(BX.identity().loggedIn ? '' : saved, attempt === 0 ? await endpointTask : null); } catch (e) {
            if (attempt >= 4) throw e;
            console.warn('[join] attempt', attempt + 1, 'failed:', e && e.message);
            $('#loading').textContent = 'Waking up a server…';
            await new Promise((res) => setTimeout(res, 2000 * (attempt + 1)));
        }
    }
}
async function play() {
    if (joining || running) return;
    joining = true;
    const err = $('#connectErr'), retry = $('#playBtn');
    err.hidden = true; retry.hidden = true;
    $('#loading').hidden = false;
    if (!joinTask) joinTask = joinServer();
    initAudio();
    try {
        await worldReady;
        $('#loading').textContent = 'Joining…';
        BX.loadingStep('Joining a server…');
        const room = await joinTask;
        const me = room.state.players && room.state.players.get(room.sessionId);
        S.name = me ? me.name : S.name;
    } catch (e) {
        joinTask = null;
        console.error(e);
        joining = false;
        $('#loading').hidden = true;
        err.hidden = false;
        err.textContent = 'Could not reach the game server. Check your connection and try again.';
        retry.hidden = false;
        BX.loadingEnd();
        return;
    }
    joining = false;
    running = true;
    S.joinedAt = Date.now();
    startMusic();
    $('#start').hidden = true;
    $('#hud').hidden = false;
    $('#touch').hidden = !isTouch;
    if (!rig) buildPlayer(0, 0);
    teleport(SPAWN, SPAWN_YAW);
    setShield(rig, CFG.spawnShield);
    cam.target.set(P.pos.x, P.pos.y + 5, P.pos.z);
    showTips();
    toast('🏁 Welcome to the TROLL EASY TOWER! Follow the red arrows ⬆', '#ffffff');
    setTimeout(() => { if (audioSuspended()) toast('🔊 Click or tap anywhere for the music!', '#7de8ff'); }, 3500);
    canvas.focus();
    BX.loadingEnd();
}
function waitForLogin(ms) {
    if (!BX.bloxity.ready || BX.identity().loggedIn) return Promise.resolve();
    return new Promise((res) => {
        const t0 = performance.now();
        (function check() { if (BX.identity().loggedIn || performance.now() - t0 > ms) res(); else setTimeout(check, 100); })();
    });
}
function showTips() {
    const el = $('#tips');
    const k = (key, what) => `<span><kbd>${key}</kbd>${what}</span>`;
    el.innerHTML = isTouch
        ? '<span>Joystick to move · JUMP · 🖐️ to slap · drag to look · walk into trusses to climb</span>'
        : pad.connected
            ? k('L', 'Move') + k('A', 'Jump') + k('X', 'Slap / Use') + k('LB/RB', 'Tools') + k('R', 'Camera')
            : k('WASD', 'Move') + k('Space', 'Jump') + k('Shift', 'Sprint') + k('Click / E', 'Slap') + k('1-9', 'Tools') + k('Drag', 'Camera');
    el.hidden = false; el.style.opacity = 1;
    setTimeout(() => { el.style.opacity = 0; }, 10000);
    setTimeout(() => { el.hidden = true; }, 10900);
}
function unlockAudioOnGesture() {
    const unlock = () => {
        resumeAudio();
        if (!audioSuspended()) for (const ev of ['pointerdown', 'pointerup', 'keydown', 'touchstart', 'touchend', 'click']) removeEventListener(ev, unlock, true);
    };
    for (const ev of ['pointerdown', 'pointerup', 'keydown', 'touchstart', 'touchend', 'click']) addEventListener(ev, unlock, true);
}
function wirePortalSettings() {
    const embedded = (fn) => (v) => { if (BX.isEmbedded()) fn(v); };
    const pct = (v) => { const n = parseFloat(String(v)); if (!isFinite(n)) return undefined; return clamp(n > 1 ? n / 100 : n, 0, 1); };
    BX.listenSetting('master_volume', embedded((v) => { const p = pct(v); if (p !== undefined) setVolume('master', p); }));
    BX.listenSetting('music_volume', embedded((v) => { const p = pct(v); if (p !== undefined) setVolume('music', p); }));
    BX.listenSetting('graphics_quality', embedded((v) => setQuality(v === 'Low' ? 'low' : v === 'Medium' ? 'medium' : 'high', true)));
    BX.listenSetting('camera_sensitivity', embedded((v) => { camSens = clamp(parseFloat(v) || 1, 0.1, 5); }));
    BX.listenSetting('show_fps', (v) => { showFps = v === 'true'; $('#fps').hidden = !showFps; });
}
function wirePortalEvents() {
    BX.onPortalEvent((event, data) => {
        if (event === 'respawn_request') { if (running) respawn(true); }
        else if (event === 'chat_message_sent' && data) net.send('chat', { text: String(data) });
        else if (event === 'play_emote' && data) { playEmoteOn(localAvatar, String(data)); net.send('emote', { id: String(data) }); }
    });
    BX.onAvatarChanged(() => syncMyAvatar());
    BX.onProportionsChanged(() => syncMyAvatar());
}

// ----- build the world and warm up the GPU while the loading screen is up -----
const pause = () => new Promise((r) => setTimeout(r, 0));
async function prepareWorld() {
    const step = (t) => { $('#loading').textContent = t; BX.loadingStep(t); };
    step('Loading fonts…');
    try { await Promise.race([Promise.all([document.fonts.load('700 40px Fredoka'), document.fonts.load('800 40px Montserrat')]), new Promise((r) => setTimeout(r, 2500))]); } catch (e) { /* fallback font */ }
    step('Building the tower…');
    await buildWorld(pause);
    refreshNear(-1);
    step('Preparing graphics…');
    camera.position.set(SPAWN.x, 12, SPAWN.z - 20); camera.lookAt(SPAWN.x, 4, SPAWN.z + 10); camera.updateMatrixWorld();
    // stand-ins for the warm-up: the player model, the bubbles, the ice block, every tool in hand,
    // a carpet, a trap and one of each effect. Never disposed (that keeps their shaders alive).
    const extras = [fxWarmGroup()];
    for (const m of [shieldMat, bubbleMat]) { const b = new T.Mesh(shieldGeo, m); b.position.copy(SPAWN); extras.push(b); }
    const ic = new T.Mesh(iceGeo, iceMat); ic.position.copy(SPAWN); extras.push(ic);
    const cp = carpetModel(0.95); cp.position.copy(SPAWN); extras.push(cp);
    const bt = bearTrap(); bt.position.copy(SPAWN); extras.push(bt);
    const blocky = buildRig({ ...KITS[0], skin: SKINS[0] }); blocky.position.copy(SPAWN); extras.push(blocky);
    for (const gid of ['slap', 'mega', 'laser', 'speedCoil', 'bearTrap']) { const h = heldModel(gid); if (h) { h.position.copy(SPAWN); extras.push(h); } }
    const gm = gloveMesh('luck'); gm.position.copy(SPAWN); extras.push(gm);
    try {
        const base = await Promise.race([loadBase(), new Promise((r) => setTimeout(r, 4000))]);
        const a = base ? await createAvatar(null) : null;
        if (a) {
            a.root.position.copy(SPAWN);
            a.update(1 / 60, { t: 0 });
            extras.push(a.root, avatarVariants(a.root));
        }
    } catch (e) { /* the player model's shaders compile when it first shows instead */ }
    for (const o of extras) scene.add(o);
    fxShowAll(true);
    await warmUp(renderer, camera, pause);
    render();
    fxShowAll(false);
    for (const o of extras) scene.remove(o);
    console.info('[prewarm] ready,', renderer.info.programs.length, 'shaders');
}
function avatarVariants(root) {
    const tex = new T.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1);
    tex.needsUpdate = true;
    const g = new T.Group();
    g.position.copy(SPAWN);
    let sk = null;
    root.traverse((c) => { if (!sk && c.isSkinnedMesh) sk = c; });
    if (sk) {
        const s = new T.SkinnedMesh(sk.geometry, new T.MeshLambertMaterial({ map: tex }));
        s.bind(sk.skeleton, sk.bindMatrix);
        s.castShadow = true;
        g.add(s);
    }
    const m = new T.Mesh(new T.BoxGeometry(0.1, 0.1, 0.1), new T.MeshLambertMaterial({ map: tex }));
    m.castShadow = true;
    g.add(m);
    return g;
}
async function boot() {
    BX.initBloxity();
    document.documentElement.style.setProperty('--troll', `url("${trollFaceUrl()}")`);
    joinTask = joinServer();
    joinTask.catch(() => {});
    loadBase().catch(() => {});
    worldReady = prepareWorld();
    wirePortalSettings();
    wirePortalEvents();
    BX.onIdentity((id) => {
        if (net.room && id.loggedIn && id.token && !net.bloxity) net.send('auth', { token: id.token });
        if (net.room) { setupLocalAvatar(); syncMyAvatar(); }
    });
    addEventListener('pagehide', () => { try { if (net.room) net.room.leave(true); } catch (e) { /* closing anyway */ } });
    $('#playBtn').addEventListener('click', play);
    $('#reconnectBtn').addEventListener('click', () => location.reload());
    unlockAudioOnGesture();
    requestAnimationFrame(frame);
    play();
}
boot();

// Dev-only hooks for automated QA runs (stripped from production builds)
if (import.meta.env.DEV || import.meta.env.VITE_QA) {
    window.__qa = {
        audio: () => audioDebug(), input: (o) => Object.assign(botInput, o), jump: () => pressJump(), solids, cam, P, S, scene, camera, net, renderer: () => renderer,
        teleport: (x, y, z, yaw) => teleport(new V3(x, y, z), yaw || 0),
        walk: (n) => { qaWalk = n; }, near: () => nearBoxes.length + nearRound.length, quality: (q) => setQuality(q),
        sim: (secs, f, jumpEvery) => { for (let i = 0; i < Math.round(secs * 60); i++) { if (jumpEvery && i % jumpEvery === 0) pressJump(); botInput.f = f || 0; update(1 / 60); } botInput.f = 0; return window.__qa.state(); },
        walkTo: (x, z, secs) => {
            for (let i = 0; i < Math.round((secs || 4) * 60); i++) {
                const dx = x - P.pos.x, dz = z - P.pos.z;
                if (Math.hypot(dx, dz) < 0.8) break;
                cam.yaw = Math.atan2(dx, dz) + Math.PI;
                botInput.f = 1; update(1 / 60);
            }
            botInput.f = 0;
            return window.__qa.state();
        },
        look: (yaw, pitch, dist) => { cam.yaw = yaw; cam.pitch = pitch; cam.dist = dist; },
        face: (yaw) => { cam.yaw = yaw + Math.PI; P.facing = yaw; },
        state: () => ({ x: +P.pos.x.toFixed(2), y: +P.pos.y.toFixed(2), z: +P.pos.z.toFixed(2), onGround: P.onGround, ground: P.ground && P.ground.mat, vy: +P.vel.y.toFixed(2), stage: P.stage, cp: S.stage, wins: S.wins, climbs: S.climbs, climbing: !!P.climbing, tool: S.tool }),
        tool: (id) => { S.gear[id] = true; actions.equip(id); },
        frame: () => { updateCamera(1 / 60); render(); },
        // pin the shared clock (ms) so moving parts follow the simulation; null = real time
        clock: (ms) => { net.fixedNow = ms; },
        // n frames at 60 fps, the pinned clock moving along with them
        step: (n) => { for (let i = 0; i < n; i++) { if (net.fixedNow !== null) net.fixedNow += 1000 / 60; update(1 / 60); } return window.__qa.state(); },
        noHazards: (on) => { qaNoHazards = !!on; },
        course: { COURSE, CHECKPOINTS, START_Y, frame: stageFrame },
        movers, timeds, lasers, solids, ground: () => P.ground, press: () => pressJump(), bot: botInput,
        avatar: () => setupLocalAvatar(), rig: () => rig,
    };
}
