// HUD and panels, laid out like the reference: Nuke Server and Skip To Final along the top (with
// the stage bar and your Wins under them), Fly / Mega Punch / Laser Gun / Admin on the left, Big
// Slap and the Troll face on the right, the round x2 Speed Slap / x2 Jump / Sprint buttons, the
// menu icons top right (the top left stays free for the Bloxity overlay), the hotbar, the
// "Would you like to go back?" revive card, the TROLLED! popup and every panel.
import { $, V3, floatText } from './engine.js';
import { S, actions, net } from './state.js';
import { sfx, setMusicDuck, getVolumes, setVolume } from './audio.js';
import * as BX from './bloxity.js';
import { getQuality, setQuality } from './fx.js';
import {
    CFG, STAGES, DIFFS, BANDS, TRAILS, GLOVES, gloveById, GEAR, gearById, TOOLS, isGlove, PASSES, PRODUCTS, TROLL_MENU, ADMIN,
    priceOf, tpPrice, skipFinalPrice, passForTool, GIFTS, DAILY, dailyStatus, rewardText, fmt, fmtComma, clock, playtimeText,
} from '../../shared/config.js';
import { CHECKPOINTS, ROOF_Y } from '../../shared/tower.js';

const C = (n) => '<span class="cup">🏆</span>' + fmt(n);
function setHtml(node, html) { if (node && node.innerHTML !== html) node.innerHTML = html; }
function setText(node, t) { if (node && node.textContent !== t) node.textContent = t; }
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const promptEl = $('#promptBtn'), promptTxtEl = $('#promptTxt');

// Every button clicks
document.addEventListener('click', (e) => { const b = e.target.closest && e.target.closest('button'); if (b) sfx(b.classList.contains('g-green') ? 'clickBuy' : 'click'); }, true);

// =====================================================================================
// Glove icons: a cartoon hand drawn once per glove into a small picture (hotbar, cards, popups)
// =====================================================================================
const iconCache = new Map();
const hex = (c) => '#' + c.toString(16).padStart(6, '0');
export function gloveIcon(id) {
    if (iconCache.has(id)) return iconCache.get(id);
    const d = gloveById[id] || gloveById.slap;
    const N = 128, cv = document.createElement('canvas'); cv.width = cv.height = N;
    const x = cv.getContext('2d');
    let fill = hex(d.color);
    if (d.rainbow) { const g = x.createLinearGradient(0, 20, 0, 110); ['#ff3c5a', '#ffb51c', '#ffe83a', '#46ec50', '#28c8ff', '#8a5aff'].forEach((c, i, a) => g.addColorStop(i / (a.length - 1), c)); fill = g; }
    x.translate(N / 2, N / 2 + 6); x.rotate(-0.25);
    const shape = () => {
        x.beginPath();
        // fingers
        for (const [fx, len, a] of [[-24, 34, -0.18], [-8, 42, -0.05], [8, 40, 0.06], [23, 32, 0.2]]) {
            x.save(); x.translate(fx, -10); x.rotate(a); x.roundRect(-7.5, -len, 15, len + 14, 7.5); x.restore();
        }
        // thumb
        x.save(); x.translate(-30, 8); x.rotate(-0.9); x.roundRect(-7.5, -30, 15, 34, 7.5); x.restore();
        // palm
        x.roundRect(-30, -14, 60, 46, 18);
    };
    x.lineJoin = 'round';
    shape(); x.lineWidth = 9; x.strokeStyle = '#12204a'; x.stroke();
    shape(); x.fillStyle = fill; x.fill();
    // shine, cuff
    x.fillStyle = 'rgba(255,255,255,0.35)'; x.beginPath(); x.roundRect(-22, -8, 16, 26, 8); x.fill();
    x.fillStyle = '#12204a'; x.beginPath(); x.roundRect(-27, 30, 54, 18, 6); x.fill();
    x.fillStyle = d.id === 'shadow' ? '#9a8aff' : '#ffffff'; x.beginPath(); x.roundRect(-24, 32, 48, 13, 5); x.fill();
    const url = cv.toDataURL('image/png');
    iconCache.set(id, url);
    return url;
}
// An icon for any tool: a glove picture or the gear's emoji
export const toolIcon = (id) => (isGlove(id) ? `<img src="${gloveIcon(id)}" alt="">` : (gearById[id] ? gearById[id].ic : '❔'));
const toolDef = (id) => gloveById[id] || gearById[id];

// ----- Wins counter (counts up smoothly) -----
let shownCoins = 0, shownText = -1;
export function animateCounters(dt) {
    if (Math.abs(shownCoins - S.wins) < 0.5) shownCoins = S.wins;
    else shownCoins += (S.wins - shownCoins) * Math.min(1, dt * 8);
    const n = Math.round(shownCoins);
    if (n !== shownText) { shownText = n; setText($('#coinVal'), fmtComma(n)); }
}
export function bumpCoins() { const p = $('#coinBar'); p.classList.remove('bump'); void p.offsetWidth; p.classList.add('bump'); }

// ----- HUD refresh (10x a second) -----
const sessionSecs = () => (S.sessionSecs || 0) + (Date.now() - S.profileAt) / 1000;
export function updateHud() {
    const now = net.now();
    const secs = sessionSecs();
    const next = GIFTS.findIndex((g, k) => !S.giftClaimed[k]);
    const ready = GIFTS.some((g, k) => !S.giftClaimed[k] && secs >= g.min * 60);
    $('#giftBadge').hidden = !ready;
    setText($('#giftLb'), ready ? 'READY' : next < 0 ? 'DONE' : Math.max(1, Math.ceil((GIFTS[next].min * 60 - secs) / 60)) + 'm');
    $('#dailyBadge').hidden = !dailyStatus(S.daily, now).can;
    $('#boostTag').hidden = !((S.boostUntil || 0) > now || (S.passes && S.passes.DoubleWins));
    setText($('#friendBoost'), 'Friend Boost: ' + Math.round(Math.min(CFG.friendMax, S.friends || 0) * CFG.friendBoost * 100) + '%');
    setHtml($('#skipFinalPrice'), (S.stage ?? -1) >= STAGES.length - 1 ? 'FINAL STAGE!' : '🏆 ' + fmt(skipFinalPrice(S.stage)));
    // the buttons light up while their tool is in your hand
    for (const [sel, id] of [['#btnFly', 'carpet'], ['#btnMega', 'mega'], ['#btnLaser', 'laser']]) $(sel).classList.toggle('on', S.tool === id);
    $('#btnAdmin').classList.toggle('on', !!S.fx);
    for (const [sel, key] of [['#btnSpeedSlap', 'SpeedSlap'], ['#btnDoubleJump', 'DoubleJump']]) {
        const own = !!(S.passes && S.passes[key]);
        $(sel).classList.toggle('own', own);
        $(sel + ' .coin').hidden = own;
    }
}

// ----- the stage bar: "Stage 3/12", in the colour of the floor you're on -----
let progKey = '';
export function renderProgress(stage, y) {
    const top = y > ROOF_Y - 3;
    const n = Math.max(0, (stage ?? -1) + 1);
    const key = n + '|' + top;
    if (key === progKey) return;
    progKey = key;
    setText($('#stageText'), top ? '🏆 THE TOP!' : n ? 'Stage ' + n + '/' + STAGES.length : 'Lobby');
    $('#stageFill').style.width = Math.max(6, (top ? 1 : n / STAGES.length) * 100) + '%';
    const band = n ? BANDS[STAGES[Math.min(STAGES.length, n) - 1].band] : BANDS.green;
    $('#stageFill').style.background = `linear-gradient(${hex(band.light)}, ${hex(band.wall)})`;
}

// ----- toasts, banners, cheers -----
export function toast(text, color) {
    const d = document.createElement('div');
    d.className = 'toast o';
    d.style.color = color || '#fff';
    d.textContent = text;
    const box = $('#toasts');
    box.appendChild(d);
    while (box.children.length > 4) box.firstChild.remove();
    setTimeout(() => d.remove(), 2900);
}
let titleTimer;
export function showStageTitle(i) {
    const s = STAGES[i];
    if (!s) return;
    setText($('#stageName'), s.ic + ' Stage ' + (i + 1) + ': ' + s.name);
    const d = DIFFS[s.diff];
    setHtml($('#stageSub'), `<span class="diff" style="background:${d.color}">${d.label}</span> ${esc(s.sub)}${s.wins ? ' · <span class="cup">🏆</span>+' + s.wins : ' · <span class="cup">🏆</span>+' + CFG.finishWins + ' at the top'}`);
    const t = $('#stageTitle');
    t.style.opacity = 1;
    clearTimeout(titleTimer);
    titleTimer = setTimeout(() => { t.style.opacity = 0; }, 2800);
}
export function showWin(m) {
    setText($('#winSub'), '+' + fmt(m.wins) + ' Wins · win #' + m.climbs + ' · ' + clock(m.secs) + (m.best && m.best === m.secs ? ' (new best!)' : '') + (m.short ? ' · skipped' : ''));
    $('#winBanner').hidden = false;
    setTimeout(() => { $('#winBanner').hidden = true; }, 4600);
}
let clearTimer;
// Checkpoint i reached: stage i (1-based) cleared
export function showStageClear(i, n) {
    const next = STAGES[i];
    setText($('#clearT'), 'STAGE ' + i + ' CLEAR!');
    const d = next && DIFFS[next.diff];
    setHtml($('#clearS'), '<span class="cup">🏆</span>+' + fmt(n) + ' Wins' + (d ? ' · next: <span class="diff" style="background:' + d.color + '">' + d.label + '</span>' : ''));
    const b = $('#clearBanner');
    b.hidden = false; b.classList.remove('go'); void b.offsetWidth; b.classList.add('go');
    clearTimeout(clearTimer);
    clearTimer = setTimeout(() => { b.hidden = true; }, 1900);
}
const CHEERS = ['💪 Too easy!', '😎 Not trolled this time!', '🔥 Unstoppable!', '⭐ Keep climbing!', '🧠 Big brain moves!', '🚀 Nothing can stop you!'];
let cheerN = 0, cheerTimer;
export function cheer() {
    const el = $('#cheer');
    setText(el, CHEERS[cheerN++ % CHEERS.length]);
    el.hidden = false; el.classList.remove('go'); void el.offsetWidth; el.classList.add('go');
    clearTimeout(cheerTimer);
    cheerTimer = setTimeout(() => { el.hidden = true; }, 2600);
}
export function showOof() { const o = $('#oof'); o.hidden = false; setTimeout(() => { o.hidden = true; }, 900); }
export function flash(color, ms) {
    const f = $('#flash');
    f.style.transition = 'none'; f.style.background = color || '#fff'; f.style.opacity = 0.9;
    requestAnimationFrame(() => { f.style.transition = 'opacity ' + ((ms || 600) / 1000) + 's ease'; f.style.opacity = 0; });
}
export function teleportFx() { const t = $('#tpFx'); t.classList.remove('go'); void t.offsetWidth; t.classList.add('go'); }
// A comic word popping up in the world ("SLAP!", "PUNCH!")
const COMIC = ['#ffe24a', '#ff6ad8', '#6affc8', '#ffffff'];
let comicN = 0;
export function comicPop(pos, text) { floatText(text, COMIC[comicN++ % COMIC.length], new V3(pos.x, pos.y + 7.5, pos.z), text.length > 7 ? 9.5 : 7.5, true); }
// TROLLED!
let trollTimer;
export function trolledPopup(sub) {
    const el = $('#trolled');
    setText($('#trolledS'), sub || '');
    el.hidden = false; el.classList.remove('go'); void el.offsetWidth; el.classList.add('go');
    clearTimeout(trollTimer);
    trollTimer = setTimeout(() => { el.hidden = true; }, 2200);
}
let scareTimer;
export function jumpscare(by) {
    const el = $('#scare');
    setText($('#scareBy'), '😈 ' + by + ' trolled everyone!');
    el.hidden = false;
    const f = el.querySelector('.face'); f.style.animation = 'none'; void f.offsetWidth; f.style.animation = '';
    clearTimeout(scareTimer);
    scareTimer = setTimeout(() => { el.hidden = true; }, 2400);
}
// Shadow Slap: everything goes dark for a few seconds
let blindTimer;
export function setBlind(secs) {
    $('#blind').classList.add('on');
    clearTimeout(blindTimer);
    blindTimer = setTimeout(() => $('#blind').classList.remove('on'), secs * 1000);
}
// The Sprint button's stamina ring (only touched when it changes)
let sprintKey = '';
export function setSprintMeter(k, on, toggled) {
    const key = Math.round(k * 40) + '|' + (on || toggled);
    if (key === sprintKey) return;
    sprintKey = key;
    const b = $('#sprintBtn');
    b.style.setProperty('--p', k.toFixed(3));
    b.classList.toggle('on', !!(on || toggled));
}

// ----- "Would you like to go back?" -----
let reviveTimer = null, reviveUntil = 0, reviveSecs = 8;
export function showRevive(price, secs) {
    reviveSecs = secs; reviveUntil = Date.now() + secs * 1000;
    setHtml($('#revivePrice'), '🏆 ' + fmt(price));
    $('#revive').hidden = false;
    const el = $('#revive'); el.style.animation = 'none'; void el.offsetWidth; el.style.animation = '';
    clearInterval(reviveTimer);
    reviveTimer = setInterval(() => {
        const k = Math.max(0, (reviveUntil - Date.now()) / (reviveSecs * 1000));
        $('#reviveFill').style.width = (k * 100) + '%';
        if (k <= 0) hideRevive();
    }, 100);
}
export function hideRevive() { $('#revive').hidden = true; clearInterval(reviveTimer); }
export const reviveOpen = () => !$('#revive').hidden;
$('#reviveBtn').addEventListener('click', () => actions.revive());

// ----- the welcome-back card: continue from your checkpoint (free) -----
let oopsTimer = null, oopsUntil = 0;
export function showOops(text, title) {
    if (S.stage < 0) return;
    setText($('#oopsTitle'), title || 'Welcome back!');
    setText($('#oopsText'), text || 'Continue from your checkpoint.');
    setText($('#oopsTp'), 'Teleport (Free)');
    $('#gearPop').hidden = true;
    $('#oops').hidden = false;
    oopsUntil = Date.now() + 15000;
    clearInterval(oopsTimer);
    oopsTimer = setInterval(() => {
        const k = Math.max(0, (oopsUntil - Date.now()) / 15000);
        $('#oopsTimer').style.width = (k * 100) + '%';
        if (k <= 0) hideOops();
    }, 100);
}
export function hideOops() { $('#oops').hidden = true; clearInterval(oopsTimer); }
$('#oopsTp').addEventListener('click', () => { hideOops(); actions.teleportCheckpoint(); });
$('#oopsClose').addEventListener('click', hideOops);

// ----- a stand / pad popup: buy or equip that tool -----
let gearPopId = null, gearPopTimer;
export function showToolPop(id) {
    const g = toolDef(id), pass = PASSES[passForTool(id)];
    if (!g) return;
    gearPopId = id;
    hideOops();
    setHtml($('#gpIc'), toolIcon(id)); setText($('#gpName'), g.name); setText($('#gpDesc'), g.desc + '.');
    setHtml($('#gpBuy'), S.gear[id] ? (S.tool === id ? 'Put away' : 'Equip') : pass ? C(pass.price) : 'Get');
    $('#gearPop').hidden = false;
    clearTimeout(gearPopTimer);
    gearPopTimer = setTimeout(() => { $('#gearPop').hidden = true; }, 7000);
}
$('#gpBuy').addEventListener('click', () => {
    $('#gearPop').hidden = true;
    if (!gearPopId) return;
    if (S.gear[gearPopId]) actions.equip(gearPopId); else actions.toolPad(gearPopId, true);
});
$('#gpClose').addEventListener('click', () => { $('#gearPop').hidden = true; });

// ----- hotbar (the tools you own; the Default Slap always) -----
let hotKey = '';
export const hotbarTools = () => TOOLS.filter((id) => S.gear[id] || (gloveById[id] && gloveById[id].free));
export function renderHotbar() {
    const owned = hotbarTools();
    const key = owned.join(',') + '|' + S.tool;
    if (key === hotKey) return;
    hotKey = key;
    const bar = $('#hotbar');
    bar.innerHTML = '';
    owned.forEach((id, i) => {
        const b = document.createElement('button');
        b.className = 'slot' + (S.tool === id ? ' on' : '');
        b.innerHTML = `<span class="n o1">${i + 1}</span>${toolIcon(id)}`;
        b.title = toolDef(id).name + (i < 9 ? ' (' + (i + 1) + ')' : '');
        b.addEventListener('click', () => actions.equip(id));
        bar.appendChild(b);
    });
}

// =====================================================================================
// Purchases: everything costs Wins. A confirm shows the price; the server checks it and takes
// the Wins.
// =====================================================================================
let pendingBuy = null;
export function buy(kind, key) {
    const item = kind === 'pass' ? PASSES[key] : PRODUCTS[key];
    if (!item) return;
    if (kind === 'pass' && S.passes[key]) { toast(item.name + ' already owned!', '#6fe0ff'); if (item.tool) actions.equip(item.tool); return; }
    pendingBuy = { kind, key };
    const price = priceOf(kind, key, S);
    const short = price - (S.wins || 0);
    setHtml($('#confirmIc'), item.tool ? toolIcon(item.tool) : item.ic || '🛒');
    setText($('#confirmTitle'), item.name);
    setText($('#confirmText'), item.desc || '');
    setHtml($('#confirmCost'), C(price) + ' Wins');
    const yes = $('#confirmYes');
    yes.disabled = short > 0;
    setText(yes, short > 0 ? 'Need ' + fmt(short) + ' more' : 'Buy');
    setText($('#confirmNote'), short > 0 ? 'Climb the tower to earn Wins: every checkpoint pays more the higher you go!' : 'You have ' + fmtComma(S.wins) + ' Wins');
    $('#confirm').hidden = false;
    setMusicDuck(true);
}
export function notEnough(m) { toast('Not enough Wins! You need ' + fmt(m.need) + ' more for ' + m.name, '#ff5a7a'); }
function closeConfirm() { $('#confirm').hidden = true; pendingBuy = null; if (!modalOpen()) setMusicDuck(false); }
$('#confirmYes').addEventListener('click', () => { const p = pendingBuy; closeConfirm(); if (p) net.send('buy', p); });
$('#confirmNo').addEventListener('click', closeConfirm);
$('#confirmClose').addEventListener('click', closeConfirm);

// =====================================================================================
// Panels
// =====================================================================================
let modalKind = null, modalTab = null;
export function openModal(kind, tab) { modalKind = kind; modalTab = tab || null; renderModal(); $('#modal').hidden = false; setMusicDuck(true); }
export function closeModal() { $('#modal').hidden = true; modalKind = null; setMusicDuck(false); }
export function refreshModal() { if (!$('#modal').hidden) renderModal(); }
export const modalOpen = () => !$('#modal').hidden;
$('#modalClose').addEventListener('click', closeModal);
$('#modal').addEventListener('pointerdown', (e) => { if (e.target.id === 'modal') closeModal(); });

function el(tag, cls, html) { const d = document.createElement(tag); if (cls) d.className = cls; if (html !== undefined) d.innerHTML = html; return d; }
function sec(body, text) { body.appendChild(el('div', 'sec o1', esc(text))); }
function note(body, text) { body.appendChild(el('p', 'note o1', text)); }
function card(o) {
    const d = el('div', 'card' + (o.cls ? ' ' + o.cls : ''));
    d.innerHTML = `<div class="ic">${o.ic}</div><div class="nm o1">${esc(o.name)}</div>${o.desc ? `<div class="ds o1">${esc(o.desc)}</div>` : ''}`;
    if (o.btn) {
        const b = el('button', 'btn ' + (o.btnCls || 'g-green') + ' o1', o.btn);
        b.disabled = !!o.disabled;
        b.addEventListener('click', o.onClick);
        d.appendChild(b);
    }
    return d;
}
function tabs(list) {
    const t = $('#modalTabs');
    t.innerHTML = '';
    if (!list) return;
    for (const [id, label] of list) {
        const b = el('button', 'btn g-blue o1' + (modalTab === id ? ' on' : ''), label);
        b.addEventListener('click', () => { modalTab = id; renderModal(); });
        t.appendChild(b);
    }
}
function renderModal() {
    const body = $('#modalBody');
    const scroll = body.scrollTop;
    body.innerHTML = '';
    const titles = { store: 'SHOP!', trails: 'TRAILS', config: 'SETTINGS', gifts: 'GIFTS', invite: 'INVITE', teleport: 'TELEPORT', admin: 'ADMIN', troll: 'TROLL!' };
    setText($('#modalTitle'), titles[modalKind] || '');
    tabs(null);
    ({ store: renderStore, trails: renderTrails, config: renderConfig, gifts: renderGifts, invite: renderInvite, teleport: renderTeleport, admin: renderAdmin, troll: renderTroll }[modalKind] || (() => {}))(body);
    body.scrollTop = scroll;
}

// ----- Shop -----
function toolCard(id, cls) {
    const d = toolDef(id), key = passForTool(id), p = PASSES[key];
    const own = !!S.gear[id] || (gloveById[id] && gloveById[id].free);
    const special = id === 'ghost';
    return card({
        ic: toolIcon(id), name: d.name, desc: d.desc, cls: (cls || '') + (own ? ' own' : ''),
        btn: own ? (S.tool === id ? 'Equipped' : 'Equip') : special ? 'In the cage' : C(p.price), btnCls: own ? 'g-blue' : special ? 'g-grey' : S.wins >= p.price ? 'g-green' : 'g-grey',
        disabled: (special && !own), onClick: () => (own ? actions.equip(id) : buy('pass', key)),
    });
}
function passCard(key, cls) {
    const p = PASSES[key], own = !!S.passes[key];
    return card({ ic: p.ic, name: p.name, desc: p.desc, cls: (cls || '') + (own ? ' own' : ''), btn: own ? (key === 'Admin' ? 'Open' : 'Owned') : C(p.price), btnCls: own ? 'g-blue' : S.wins >= p.price ? 'g-green' : 'g-grey', disabled: own && key !== 'Admin', onClick: () => (own && key === 'Admin' ? openModal('admin') : buy('pass', key)) });
}
function prodCard(key, cls) {
    const p = PRODUCTS[key];
    const price = priceOf('product', key, S);
    return card({ ic: p.ic, name: p.name, desc: p.desc, cls, btn: C(price), btnCls: S.wins >= price ? 'g-green' : 'g-grey', onClick: () => buy('product', key) });
}
function renderStore(body) {
    tabs([['gloves', '🖐️ Gloves'], ['gear', '🧞 Gear'], ['boosts', '⏱️ Boosts & Skips'], ['trolls', '😈 Trolls']]);
    const tab = modalTab || 'gloves';
    const g = el('div', 'grid');
    if (tab === 'gloves') for (const d of GLOVES) g.appendChild(toolCard(d.id, d.id === 'mega' ? 'gold' : d.id === 'big' ? 'hot' : ''));
    else if (tab === 'gear') for (const d of GEAR) g.appendChild(toolCard(d.id, d.id === 'carpet' ? 'gold' : ''));
    else if (tab === 'boosts') {
        for (const k of ['DoubleWins', 'DoubleJump', 'SpeedSlap', 'Admin']) g.appendChild(passCard(k, k === 'DoubleWins' ? 'hot' : ''));
        g.appendChild(prodCard('WinsBoost')); g.appendChild(prodCard('Skip')); g.appendChild(prodCard('SkipFinal'));
    } else { g.appendChild(prodCard('Nuke', 'danger')); for (const k of TROLL_MENU) g.appendChild(prodCard(k, 'troll')); }
    body.appendChild(g);
    note(body, 'Everything is bought with Wins. Earn them at every checkpoint (more the higher you climb), from troll coins and at the top!');
}
// ----- the Troll menu -----
function renderTroll(body) {
    note(body, 'Troll everyone else in the server! Each troll recharges for a little while.');
    const g = el('div', 'grid');
    for (const k of TROLL_MENU) g.appendChild(prodCard(k, 'troll'));
    g.appendChild(prodCard('Nuke', 'danger'));
    body.appendChild(g);
}
// ----- Admin -----
function renderAdmin(body) {
    if (!S.passes.Admin) {
        note(body, 'Admin gives you commands everyone in the server can see: grow Giant, shrink Tiny, Spin, Sparkles, a Rainbow aura and Fireworks!');
        const g = el('div', 'grid'); g.appendChild(passCard('Admin', 'gold')); body.appendChild(g);
        return;
    }
    const g = el('div', 'grid');
    for (const a of ADMIN) {
        const on = (S.fx || '').includes(a.id);
        g.appendChild(card({ ic: a.ic, name: a.name, desc: a.desc, cls: on ? 'own' : '', btn: on ? 'ON' : 'OFF', btnCls: on ? 'g-green' : 'g-grey', onClick: () => { actions.adminFx(a.id); setTimeout(renderModal, 60); } }));
    }
    g.appendChild(card({ ic: '🎆', name: 'Fireworks', desc: 'A firework show where you stand', btn: 'Launch!', btnCls: 'g-rainbow', onClick: () => actions.adminFireworks() }));
    body.appendChild(g);
}

// ----- Trails -----
function renderTrails(body) {
    const g = el('div', 'grid');
    for (const t of TRAILS) {
        const own = !!S.trails[t.id], on = S.trail === t.id;
        const h = hex(t.color);
        const sw = `<span style="display:inline-block;width:3.6rem;height:1.2rem;border-radius:1rem;border:3px solid #12204a;background:${t.rainbow ? 'linear-gradient(90deg,#ff3c5a,#ffb51c,#46ec50,#28c8ff,#8a5aff)' : h};box-shadow:0 0 0.8rem ${h}"></span>`;
        g.appendChild(card({
            ic: sw, name: t.name, desc: t.price ? '' : 'Free', cls: on ? 'own' : '',
            btn: on ? 'Equipped' : own ? 'Equip' : C(t.price), btnCls: own ? 'g-blue' : 'g-green',
            disabled: on || (!own && S.wins < t.price),
            onClick: () => net.send('trail', { id: t.id }),
        }));
    }
    body.appendChild(g);
}

// ----- Teleport -----
function renderTeleport(body) {
    const g = el('div', 'grid');
    g.appendChild(card({ ic: '🏠', name: 'Lobby', desc: 'Back to the start', btn: 'Free', onClick: () => { closeModal(); actions.teleportLobby(); } }));
    if (S.stage >= 0) g.appendChild(card({ ic: '🚩', name: 'My checkpoint', desc: 'Stage ' + (S.stage + 1), btn: 'Free', onClick: () => { closeModal(); actions.teleportCheckpoint(); } }));
    if ((S.stage ?? -1) < CHECKPOINTS.length - 1) g.appendChild(prodCard('Skip', 'hot'));
    g.appendChild(prodCard('SkipFinal'));
    body.appendChild(g);
    sec(body, 'Stages you have reached');
    const r = el('div', 'grid');
    CHECKPOINTS.forEach((cp, i) => {
        const ok = i < (S.maxStage || 0) || i === S.stage, s = STAGES[i], own = i === S.stage, price = tpPrice(i, own);
        r.appendChild(card({ ic: ok ? s.ic : '🔒', name: 'Stage ' + (i + 1), desc: s.name, btn: ok ? (price ? C(price) : 'Free') : 'Not reached', btnCls: ok && S.wins >= price ? 'g-green' : 'g-grey', disabled: !ok, onClick: () => { closeModal(); actions.teleportTo(i); } }));
    });
    body.appendChild(r);
    note(body, 'Your own checkpoint is always free. Going back to another stage you reached costs a little, and a climb that skips ahead pays a quarter at the top.');
}

// ----- Settings -----
function slider(body, ic, label, kind) {
    const r = el('div', 'row');
    r.innerHTML = `<span class="ic">${ic}</span><span class="tx" style="flex:0 0 9rem"><b class="o1">${label}</b></span>`;
    const s = el('input');
    s.type = 'range'; s.min = 0; s.max = 100; s.value = Math.round((getVolumes()[kind] ?? 1) * 100);
    s.setAttribute('aria-label', label);
    s.addEventListener('input', () => setVolume(kind, s.value / 100));
    r.appendChild(s);
    body.appendChild(r);
}
function renderConfig(body) {
    sec(body, 'Sound');
    slider(body, '🎵', 'Music', 'music');
    slider(body, '👣', 'Footsteps', 'asmr');
    slider(body, '🔔', 'Effects', 'sfx');
    sec(body, 'Graphics');
    const q = el('div', 'row');
    q.innerHTML = '<span class="ic">✨</span><span class="tx"><b class="o1">Quality</b><small class="o1">Low is smoothest on older PCs and phones</small></span>';
    for (const [k, n] of [['low', 'Low'], ['medium', 'Medium'], ['high', 'High']]) {
        const b = el('button', 'btn ' + (getQuality() === k ? 'g-green' : 'g-grey') + ' o1', n);
        b.addEventListener('click', () => { setQuality(k); renderModal(); });
        q.appendChild(b);
    }
    body.appendChild(q);
    sec(body, 'Codes');
    const c = el('div', 'row');
    c.innerHTML = '<span class="ic">🎟️</span>';
    const inp = el('input', 'input'); inp.placeholder = 'Enter a code'; inp.maxLength = 24;
    const go = el('button', 'btn g-green o1', 'Redeem');
    go.addEventListener('click', () => { if (inp.value.trim()) net.send('code', { code: inp.value.trim() }); });
    inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') go.click(); e.stopPropagation(); });
    c.appendChild(inp); c.appendChild(go);
    body.appendChild(c);
    const stats = el('div', 'row');
    stats.innerHTML = `<span class="ic">📊</span><span class="tx"><b class="o1">Tower wins ${fmt(S.climbs)} · Best ${S.best ? clock(S.best) : '—'} · Slaps ${fmt(S.slaps)}</b><small class="o1">Playtime ${playtimeText(S.playtime)} · Wins earned ${fmt(S.totalWins)} · Trolled ${fmt(S.trolled)} times</small></span>`;
    body.appendChild(stats);
}
export function codeResult(m) { toast(m.ok ? '🎟️ ' + m.text : m.text, m.ok ? '#7dff6b' : '#ff5a7a'); }

// ----- Gifts (playtime) -----
function renderGifts(body) {
    note(body, 'Keep playing to unlock gifts! (' + Math.floor(sessionSecs() / 60) + ' min played this session)');
    const g = el('div', 'grid');
    const secs = sessionSecs();
    GIFTS.forEach((gift, k) => {
        const claimed = !!S.giftClaimed[k], ready = secs >= gift.min * 60;
        const left = Math.max(0, gift.min * 60 - secs);
        g.appendChild(card({
            ic: gift.boost ? '⏱️' : '🎁', name: rewardText(gift), desc: gift.min + ' min',
            cls: claimed ? 'own' : ready ? 'hot' : '', btn: claimed ? 'Claimed' : ready ? 'CLAIM' : clock(left), btnCls: ready && !claimed ? 'g-green' : 'g-grey',
            disabled: claimed || !ready, onClick: () => net.send('gift', { k }),
        }));
    });
    body.appendChild(g);
}

// ----- Invite -----
function renderInvite(body) {
    note(body, 'Play with friends (and slap them)! Friend Boost gives +' + Math.round(CFG.friendBoost * 100) + '% Wins for every Bloxity friend in your server (up to +' + Math.round(CFG.friendBoost * CFG.friendMax * 100) + '%).');
    const r = el('div', 'row');
    r.innerHTML = '<span class="ic">🔗</span><span class="tx"><b class="o1">Invite link</b><small class="o1">Send it to a friend</small></span>';
    const b = el('button', 'btn g-green o1', 'Copy');
    b.addEventListener('click', async () => {
        const link = BX.getInviteLink() || location.href;
        try { await navigator.clipboard.writeText(link); toast('Invite link copied!', '#7dff6b'); } catch (e) { toast(link, '#ffffff'); }
    });
    r.appendChild(b);
    body.appendChild(r);
    const list = el('div', 'grid');
    body.appendChild(list);
    if (BX.bloxity.ready && BX.identity().loggedIn) {
        BX.getFriends().then((fr) => {
            if (!fr.length) { list.appendChild(el('p', 'note o1', 'No Bloxity friends yet.')); return; }
            for (const f of fr.slice(0, 24)) {
                const nm = f.displayName || f.username || 'Friend';
                list.appendChild(card({ ic: '🙂', name: nm, btn: 'Invite', onClick: async () => { const ok = await BX.inviteFriend(f._id || f.id); toast(ok ? 'Invited ' + nm + '!' : 'Could not invite ' + nm, ok ? '#7dff6b' : '#ff5a7a'); } }));
            }
        });
    } else note(body, 'Log in to Bloxity to invite your friends directly.');
}

// =====================================================================================
// Daily rewards
// =====================================================================================
export function openDailyOnJoin() {
    if (dailyStatus(S.daily, net.now()).can && !openDailyOnJoin.done) { openDailyOnJoin.done = true; setTimeout(openDaily, 1500); }
}
function openDaily() { renderDaily(); $('#daily').hidden = false; setMusicDuck(true); }
function renderDaily() {
    const st = dailyStatus(S.daily, net.now());
    const cards = $('#dailyCards');
    cards.innerHTML = '';
    DAILY.forEach((r, i) => {
        const done = i < st.day || (!st.can && i === st.day);
        const now = st.can && i === st.day;
        const d = el('div', 'dcard o1' + (done ? ' done' : '') + (now ? ' now' : ''));
        d.innerHTML = `<span class="d">Day ${i + 1}</span><span class="i">${r.glove ? `<img src="${gloveIcon(r.glove)}" alt="" style="width:1.8rem;height:1.8rem">` : r.boost ? '⏱️' : '🏆'}</span><span>${esc(rewardText(r))}</span>`;
        cards.appendChild(d);
    });
    $('#dailyClaim').disabled = !st.can;
    setText($('#dailyLeft'), st.can ? 'Your daily reward is ready!' : 'Come back tomorrow for Day ' + ((st.streak % 7) + 1) + '!');
}
$('#dailyClaim').addEventListener('click', () => { net.send('daily'); setTimeout(renderDaily, 300); });
$('#dailyClose').addEventListener('click', () => { $('#daily').hidden = true; setMusicDuck(false); });
export const refreshDaily = () => { if (!$('#daily').hidden) renderDaily(); };

// =====================================================================================
// HUD buttons
// =====================================================================================
// A tool button: equip / put away if you own it, otherwise offer it
const toolBtn = (id) => () => (S.gear[id] ? actions.equip(id) : buy('pass', passForTool(id)));
$('#btnNuke').addEventListener('click', () => buy('product', 'Nuke'));
$('#btnSkipFinal').addEventListener('click', () => { if ((S.stage ?? -1) >= STAGES.length - 1) { toast('You\'re already on the final stage!', '#6fe0ff'); return; } buy('product', 'SkipFinal'); });
$('#coinPlus').addEventListener('click', () => openModal('store', 'boosts'));
$('#btnFly').addEventListener('click', toolBtn('carpet'));
$('#btnMega').addEventListener('click', toolBtn('mega'));
$('#btnLaser').addEventListener('click', toolBtn('laser'));
$('#btnAdmin').addEventListener('click', () => openModal('admin'));
$('#btnBigSlap').addEventListener('click', toolBtn('big'));
$('#btnTroll').addEventListener('click', () => openModal('troll'));
$('#btnSpeedSlap').addEventListener('click', () => (S.passes.SpeedSlap ? toast('💨 x2 Speed Slap is on forever!', '#9aff7a') : buy('pass', 'SpeedSlap')));
$('#btnDoubleJump').addEventListener('click', () => (S.passes.DoubleJump ? toast('🦘 x2 Jump: press jump again in mid-air!', '#9aff7a') : buy('pass', 'DoubleJump')));
$('#sprintBtn').addEventListener('click', () => actions.toggleSprint());
$('#btnStore').addEventListener('click', () => openModal('store'));
$('#btnConfig').addEventListener('click', () => openModal('config'));
$('#btnInvite').addEventListener('click', () => openModal('invite'));
$('#btnGift').addEventListener('click', () => openModal('gifts'));
$('#btnTeleport').addEventListener('click', () => openModal('teleport'));
$('#btnDaily').addEventListener('click', openDaily);
$('#bigSlapPic').innerHTML = `<img src="${gloveIcon('big')}" alt="" style="width:100%;height:100%">`;
actions.openStore = () => openModal('store');
actions.openTrails = () => openModal('trails');
actions.openTeleport = () => openModal('teleport');
actions.openInvite = () => openModal('invite');
actions.buy = buy;

// Closes the topmost popup (Escape / controller B); false when nothing was open
export function closeTop() {
    for (const id of ['#confirm', '#daily']) {
        if (!$(id).hidden) {
            if (id === '#confirm') closeConfirm(); else $('#dailyClose').click();
            return true;
        }
    }
    if (modalOpen()) { closeModal(); return true; }
    if (!$('#gearPop').hidden) { $('#gearPop').hidden = true; return true; }
    if (reviveOpen()) { hideRevive(); return true; }
    return false;
}
export const anyPopup = () => ['#confirm', '#daily', '#modal'].some((id) => !$(id).hidden);
