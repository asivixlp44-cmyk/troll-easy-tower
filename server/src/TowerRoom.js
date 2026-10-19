import { Room } from 'colyseus';
import { GameState, PlayerState } from './schema.js';
import {
    getProfile, hasProfile, markDirty, saveProfiles, adoptGuestProgress, loadProfile, releaseProfile,
    topProfiles, recordSession, saveSoon, USE_DB,
} from './profiles.js';
import { sealProfile, openSave } from './saves.js';
import { verifyBloxityToken } from './bloxity.js';
import {
    CFG, STAGES, trailById, gloveById, isGlove, TOOLS, PASSES, PRODUCTS, priceOf, tpPrice, revivePrice, GIFTS, DAILY, CODES, KITS, SKINS,
    dailyStatus, dayKey, rewardText, winsMult, clamp, cleanFx, ghostGate,
} from '../../shared/config.js';
import { CHECKPOINTS, COINS, FINISH, CHEST, VIP, CAGE, FIRE_STAND, LOBBY, WORLD } from '../../shared/tower.js';

const GREEN = '#7dff6b', GOLD = '#ffd028', BLUE = '#6fe0ff';

function cleanName(name) {
    return String(name || '').replace(/[^\w .\-]/g, '').trim().slice(0, 20);
}
const randomName = () => 'Player' + Math.floor(1000 + Math.random() * 9000);
const finite = (v) => typeof v === 'number' && Number.isFinite(v);
// Guest ids come from the browser; they can never claim a Bloxity identity
const guestUid = (uid, fallback) => String(uid || fallback).replace(/^legion_/, 'guest_').slice(0, 64);
const cleanAvatar = (av) => (typeof av === 'string' && av.length <= 2000 ? av : '');
const dist2 = (a, b) => (a.x - b.x) ** 2 + (a.z - b.z) ** 2;
const newRun = () => ({ cps: new Set(), coins: new Set(), start: 0, fromLobby: true });
const owns = (p, id) => !!(p.gear[id] || (gloveById[id] && gloveById[id].free));

export const liveRooms = new Set();

// One shared tower. Movement is client-side; everything that changes progress (Wins, checkpoints,
// coins, the top, tools, trails) or touches other players (slaps, zaps, the nuke, trolls, traps) is
// decided here. There are no real-money purchases: every price is in Wins, checked and taken here.
export class TowerRoom extends Room {
    maxClients = CFG.maxPlayers;

    onCreate() {
        liveRooms.add(this);
        this.setState(new GameState());
        this.setPatchRate(50);
        this.sessions = new Map();
        this.joinCount = 0;
        this.traps = new Map();
        this.trapN = 0;

        const on = (type, fn) => this.onMessage(type, (client, m) => { try { fn.call(this, client, m || {}); } catch (e) { console.warn('[msg]', type, e.message); } });
        on('move', this.onMove);
        on('cp', this.onCheckpoint);
        on('coin', this.onCoin);
        on('win', this.onWin);
        on('chest', this.onChest);
        on('vipChest', this.onVipChest);
        on('ghost', this.onGhost);
        on('fire', this.onFire);
        on('lobby', this.onLobby);
        on('tp', this.onTeleport);
        on('revive', this.onRevive);
        on('fell', this.onFell);
        on('trolled', this.onTrolled);
        on('buy', this.onBuy);
        on('tool', this.onTool);
        on('slap', this.onSlap);
        on('ray', this.onRay);
        on('trap', this.onTrap);
        on('trapStep', this.onTrapStep);
        on('fx', this.onFx);
        on('fireworks', this.onFireworks);
        on('trail', this.onTrail);
        on('daily', this.onDaily);
        on('gift', this.onGift);
        on('code', this.onCode);
        on('auth', this.onBloxityLogin);
        on('avatar', this.onAvatar);
        on('emote', this.onEmote);
        on('chat', this.onChat);
        on('friends', this.onFriends);

        this.setSimulationInterval(() => this.tick(), 1000);
        this.clock.setInterval(() => this.broadcastBoards(), 10000);
    }

    async onAuth(client, options) {
        const legion = options && options.token ? await verifyBloxityToken(options.token) : null;
        return legion ? { legion } : { guest: true };
    }

    async onJoin(client, options, auth) {
        options = options || {};
        const guest = guestUid(options.uid, client.sessionId);
        let uid = guest, name = cleanName(options.name);
        if (auth && auth.legion) {
            uid = 'legion_' + auth.legion.id;
            name = cleanName(auth.legion.name) || name;
            await adoptGuestProgress(uid, guest, name);
        }
        await loadProfile(uid);
        // A fresh server on a temporary disk restores the browser's signed backup.
        // With a database the profile is never lost, so backups are not accepted at all.
        const restore = !USE_DB && !hasProfile(uid) && openSave(options.save, [uid, guest]);
        const profile = getProfile(uid, name, randomName());
        if (restore) { Object.assign(profile, restore); markDirty(); }
        this.fixProfile(profile);
        const player = new PlayerState();
        player.name = profile.name;
        player.av = cleanAvatar(options.av);
        player.x = LOBBY.spawn.x; player.y = LOBBY.spawn.y; player.z = LOBBY.spawn.z; player.ry = 0;
        player.kit = this.joinCount % KITS.length;
        player.skin = (this.joinCount * 3) % SKINS.length;
        this.joinCount++;
        this.state.players.set(client.sessionId, player);
        const s = {
            client, profile, player,
            pos: { x: LOBBY.spawn.x, y: LOBBY.spawn.y, z: LOBBY.spawn.z },
            run: newRun(), status: {},
            joinedAt: Date.now(), lastWin: 0, giftClaimed: {}, friends: 0, guest, lastChat: 0, lastZap: 0, lastSlap: 0, lastNuke: 0, lastTroll: 0,
            lastRevive: 0, lastFireworks: 0, lastTrap: 0, playSecs: 0,
            stats: { fresh: Date.now() - (profile.firstPlay || 0) < 60000, maxStage: -1, climbs: 0, falls: 0, wins0: profile.totalWins, buys: 0 },
        };
        this.sessions.set(client.sessionId, s);
        this.syncPublic(client.sessionId);
        client.send('hello', { now: Date.now(), bloxity: uid.startsWith('legion_'), traps: [...this.traps.values()].map(this.trapMsg) });
        this.sendProfile(client.sessionId);
        this.broadcastBoards(client);
    }

    // Older saves / hand-edited data: keep every field the right shape
    fixProfile(p) {
        for (const k of ['wins', 'totalWins', 'climbs', 'bonusAt', 'boostUntil', 'vipAt', 'slaps', 'trolled']) if (!finite(p[k])) p[k] = 0;
        if (!p.trails || typeof p.trails !== 'object') p.trails = { starter: true };
        if (!trailById[p.trail] || !p.trails[p.trail]) p.trail = 'starter';
        if (!p.gear || typeof p.gear !== 'object') p.gear = {};
        if (!p.passes || typeof p.passes !== 'object') p.passes = {};
        for (const k of Object.keys(p.gear)) if (!TOOLS.includes(k)) delete p.gear[k];
        if (typeof p.tool !== 'string' || (p.tool && !owns(p, p.tool))) p.tool = 'slap';
        p.fx = p.passes.Admin ? cleanFx(p.fx) : '';
        p.stage = clamp(Math.floor(finite(p.stage) ? p.stage : -1), -1, CHECKPOINTS.length - 1);
        p.maxStage = clamp(Math.floor(finite(p.maxStage) ? p.maxStage : 0), 0, CHECKPOINTS.length);
    }

    onDrop(client) {
        this.allowReconnection(client, 30);
    }
    onReconnect(client) {
        const s = this.sessions.get(client.sessionId);
        if (!s) return;
        s.client = client;
        client.send('hello', { now: Date.now(), bloxity: s.profile.uid.startsWith('legion_'), traps: [...this.traps.values()].map(this.trapMsg) });
        this.sendProfile(client.sessionId);
        this.broadcastBoards(client);
    }

    onLeave(client) {
        const s = this.sessions.get(client.sessionId);
        this.state.players.delete(client.sessionId);
        this.sessions.delete(client.sessionId);
        for (const [id, t] of this.traps) if (t.by === client.sessionId) this.removeTrap(id);
        markDirty();
        if (!s) return;
        const st = s.stats;
        recordSession({
            at: new Date(), secs: Math.round((Date.now() - s.joinedAt) / 1000), fresh: st.fresh, maxStage: st.maxStage,
            endStage: s.profile.stage, climbs: st.climbs, falls: st.falls, wins: (s.profile.totalWins || 0) - (st.wins0 || 0), buys: st.buys,
        }).catch((e) => console.warn('[stats]', e.message));
        if (!isOnline(s.profile.uid)) releaseProfile(s.profile.uid, isOnline);
    }

    onDispose() { liveRooms.delete(this); markDirty(); return saveProfiles(); }

    // ----- helpers -----
    syncPublic(id) {
        const s = this.sessions.get(id);
        if (!s) return;
        const p = s.profile, pl = s.player;
        pl.wins = p.wins;
        pl.stage = p.stage;
        pl.tool = p.tool || '';
        pl.trail = p.trail || 'starter';
        pl.fx = p.fx || '';
        pl.admin = !!p.passes.Admin;
        pl.name = p.name;
    }
    sendProfile(id) {
        const s = this.sessions.get(id);
        if (!s) return;
        const p = s.profile;
        s.client.send('profile', {
            wins: p.wins, totalWins: p.totalWins, climbs: p.climbs, playtime: p.playtime, slaps: p.slaps, trolled: p.trolled,
            stage: p.stage, maxStage: p.maxStage, best: p.best,
            trails: p.trails, trail: p.trail, gear: p.gear, tool: p.tool, passes: p.passes, fx: p.fx, bonusAt: p.bonusAt, vipAt: p.vipAt,
            boostUntil: p.boostUntil, daily: p.daily, codes: p.codes, firstPlay: p.firstPlay, giftClaimed: s.giftClaimed, sessionSecs: s.playSecs,
            save: sealProfile(p),
        });
    }
    changed(id) { this.syncPublic(id); this.sendProfile(id); saveSoon(); }
    toast(s, text, color) { s.client.send('toast', { text, color: color || '#ffffff' }); }
    mult(s) { return winsMult(s.profile, Date.now(), s.friends); }
    addWins(s, base, why, extra) {
        const n = Math.max(1, Math.round(base * this.mult(s)));
        s.profile.wins = (s.profile.wins || 0) + n;
        s.profile.totalWins = (s.profile.totalWins || 0) + n;
        s.client.send('earn', { n, why, ...(extra || {}) });
        return n;
    }
    // A status everyone sees on a player (b bubble, f frozen, x on fire) for a few seconds
    setStatus(s, letter, secs) {
        s.status[letter] = Date.now() + secs * 1000;
        this.syncStatus(s);
        this.clock.setTimeout(() => this.syncStatus(s), secs * 1000 + 30);
    }
    syncStatus(s) {
        const now = Date.now();
        let st = '';
        for (const [k, until] of Object.entries(s.status)) if (until > now) st += k;
        if (s.player.st !== st) s.player.st = st;
    }
    // Every second: playtime; Fire Punch unlocks itself after enough of it
    tick() {
        for (const s of this.sessions.values()) {
            s.profile.playtime = (s.profile.playtime || 0) + 1;
            s.playSecs++;
        }
        markDirty();
    }
    // Recharges: seconds left, or 0
    wait(last, secs) { return Math.max(0, Math.ceil((secs * 1000 - (Date.now() - last)) / 1000)); }

    // ----- movement & the climb -----
    onMove(client, m) {
        const s = this.sessions.get(client.sessionId);
        if (!s || !finite(m.x) || !finite(m.y) || !finite(m.z)) return;
        const pl = s.player;
        pl.x = clamp(m.x, WORLD.x0, WORLD.x1); pl.y = clamp(m.y, WORLD.y0, WORLD.y1); pl.z = clamp(m.z, WORLD.z0, WORLD.z1);
        pl.ry = finite(m.ry) ? m.ry : 0;
        pl.anim = clamp(m.a | 0, 0, 4);
        s.pos = { x: pl.x, y: pl.y, z: pl.z };
    }
    near(s, x, y, z, r, dy) { return dist2(s.pos, { x, z }) <= r * r && Math.abs(s.pos.y - y) <= dy; }

    // The start pad of stage i: reaching it clears stage i - 1
    onCheckpoint(client, m) {
        const s = this.sessions.get(client.sessionId);
        const cp = CHECKPOINTS[m.i | 0];
        if (!s || !cp || !this.near(s, cp.x, cp.y, cp.z, 9, 8)) return;
        const p = s.profile;
        if (!s.run.start) s.run.start = Date.now();
        if (cp.i > p.stage) { p.stage = cp.i; s.player.stage = cp.i; }
        p.maxStage = Math.max(p.maxStage || 0, cp.i + 1);
        s.stats.maxStage = Math.max(s.stats.maxStage, cp.i);
        if (!s.run.cps.has(cp.i)) {
            s.run.cps.add(cp.i);
            if (cp.i > 0) this.addWins(s, STAGES[cp.i - 1].wins, 'cp', { i: cp.i });
        }
        this.changed(client.sessionId);
    }
    onCoin(client, m) {
        const s = this.sessions.get(client.sessionId);
        const c = COINS[m.i | 0];
        if (!s || !c || s.run.coins.has(c.i) || !this.near(s, c.x, c.y, c.z, 7, 8)) return;
        s.run.coins.add(c.i);
        this.addWins(s, CFG.pickupWins, 'coin', { i: c.i });
        this.changed(client.sessionId);
    }
    // The real WIN pad on the victory platform
    onWin(client) {
        const s = this.sessions.get(client.sessionId);
        if (!s || !this.near(s, FINISH.x, FINISH.y, FINISH.z, FINISH.pad + 3, 6)) return;
        const now = Date.now();
        const secs = s.run.start ? (now - s.run.start) / 1000 : 0;
        const short = !s.run.fromLobby;
        if (s.run.cps.size < CHECKPOINTS.length || secs < (short ? 8 : CFG.minRunSecs) || now - s.lastWin < 30000) {
            this.toast(s, 'Climb every stage of the tower to win!', BLUE);
            return;
        }
        const p = s.profile;
        s.lastWin = now;
        p.climbs = (p.climbs || 0) + 1;
        s.stats.climbs++;
        if (!short && (!p.best || secs < p.best)) p.best = Math.round(secs);
        const n = this.addWins(s, CFG.finishWins * (short ? 0.25 : 1), 'win');
        client.send('won', { climbs: p.climbs, secs: Math.round(secs), wins: n, best: p.best, short });
        this.broadcast('announce', { text: '🏆 ' + p.name + ' beat the Troll Easy Tower! (' + Math.round(secs) + 's)', color: GOLD }, { except: client });
        // rewards restart: a fresh climb from the lobby, checkpoints and coins pay again
        p.stage = -1;
        s.run = newRun();
        this.changed(client.sessionId);
    }
    onChest(client) {
        const s = this.sessions.get(client.sessionId);
        if (!s || !this.near(s, CHEST.x, CHEST.y, CHEST.z, 9, 6)) return;
        const p = s.profile, now = Date.now();
        if (now - (p.bonusAt || 0) < CFG.chestMinutes * 60000) return this.toast(s, 'The chest refills in ' + Math.ceil((CFG.chestMinutes * 60000 - (now - p.bonusAt)) / 60000) + ' min', BLUE);
        p.bonusAt = now;
        this.addWins(s, CFG.chestWins, 'chest');
        this.changed(client.sessionId);
    }
    // The VIP room's golden chest (the door opens after enough playtime)
    onVipChest(client) {
        const s = this.sessions.get(client.sessionId);
        const c = VIP.chest;
        if (!s || !this.near(s, c.x, c.y, c.z, 9, 6)) return;
        const p = s.profile, now = Date.now();
        if ((p.playtime || 0) < CFG.vipMinutes * 60 - 5) return this.toast(s, 'The VIP room opens after ' + CFG.vipMinutes + ' minutes of play', BLUE);
        if (now - (p.vipAt || 0) < CFG.vipChestMinutes * 60000) return;
        p.vipAt = now;
        this.addWins(s, CFG.vipWins, 'vip');
        this.changed(client.sessionId);
    }
    // The Ghost Slap cage: free while its gate is open
    onGhost(client) {
        const s = this.sessions.get(client.sessionId);
        if (!s || s.profile.gear.ghost || !this.near(s, CAGE.x, CAGE.y, CAGE.z, 8, 6)) return;
        if (!ghostGate(Date.now()).open) return this.toast(s, 'The gate is locked! Wait for it to open', BLUE);
        s.profile.gear.ghost = true;
        s.profile.tool = 'ghost';
        this.toast(s, '👻 You grabbed the Ghost Slap!', GREEN);
        s.client.send('fx', { kind: 'unlock', key: 'ghost' });
        this.changed(client.sessionId);
    }
    // Fire Punch: free after enough playtime (or bought in the shop)
    onFire(client) {
        const s = this.sessions.get(client.sessionId);
        if (!s || s.profile.gear.fire || !this.near(s, FIRE_STAND.x, FIRE_STAND.y, FIRE_STAND.z, 9, 6)) return;
        if ((s.profile.playtime || 0) < CFG.fireMinutes * 60 - 5) return;
        s.profile.gear.fire = true;
        s.profile.passes.Fire = true;
        s.profile.tool = 'fire';
        this.toast(s, '🔥 Fire Punch unlocked!', GREEN);
        s.client.send('fx', { kind: 'unlock', key: 'fire' });
        this.changed(client.sessionId);
    }
    onLobby(client) {
        const s = this.sessions.get(client.sessionId);
        if (s) { s.run.start = 0; s.run.fromLobby = true; }
    }
    onTeleport(client, m) {
        const s = this.sessions.get(client.sessionId);
        const i = m.i | 0, cp = CHECKPOINTS[i];
        if (!s || !cp) return;
        const p = s.profile, own = i === p.stage;
        if (!own && i >= (p.maxStage || 0)) return;
        const price = tpPrice(i, own);
        if ((p.wins || 0) < price) return client.send('broke', { need: price - (p.wins || 0), price, name: 'Teleport to Stage ' + (i + 1) });
        p.wins -= price;
        if (!own) {
            p.stage = i;
            s.run.fromLobby = false;
            for (let k = 0; k <= i; k++) s.run.cps.add(k);
        }
        if (!s.run.start) s.run.start = Date.now();
        s.pos = { x: cp.x, y: cp.y, z: cp.z };
        client.send('tpTo', { i });
        this.changed(client.sessionId);
    }
    // "Would you like to go back?": the client puts itself back where it fell from
    onRevive(client) {
        const s = this.sessions.get(client.sessionId);
        if (!s || s.profile.stage < 0 || Date.now() - s.lastRevive < 1500) return;
        const p = s.profile, price = revivePrice(p.stage);
        if ((p.wins || 0) < price) return client.send('broke', { need: price - (p.wins || 0), price, name: 'Revive' });
        s.lastRevive = Date.now();
        p.wins -= price;
        s.stats.buys++;
        client.send('revived', {});
        this.changed(client.sessionId);
    }
    onFell(client) { const s = this.sessions.get(client.sessionId); if (s) s.stats.falls++; }
    onTrolled(client) { const s = this.sessions.get(client.sessionId); if (s) { s.profile.trolled = (s.profile.trolled || 0) + 1; markDirty(); } }

    // ----- the Wins shop: the server checks the price, takes the Wins, then grants -----
    onBuy(client, m) {
        const s = this.sessions.get(client.sessionId);
        if (!s || !m || (m.kind !== 'pass' && m.kind !== 'product')) return;
        const p = s.profile, key = String(m.key || '');
        const item = (m.kind === 'pass' ? PASSES : PRODUCTS)[key];
        if (!item) return;
        if (m.kind === 'pass' && p.passes[key]) return this.toast(s, item.name + ' already owned!', BLUE);
        if (key === 'Skip' && p.stage >= CHECKPOINTS.length - 1) return this.toast(s, 'This is the final stage: climb it!', BLUE);
        if (key === 'SkipFinal' && p.stage >= CHECKPOINTS.length - 1) return this.toast(s, 'You\'re already on the final stage!', BLUE);
        if (key === 'Nuke' && this.wait(s.lastNuke, CFG.nukeCooldown)) return this.toast(s, '☢️ The nuke is recharging! Try again in ' + this.wait(s.lastNuke, CFG.nukeCooldown) + 's', BLUE);
        const troll = key === 'FlingAll' || key === 'FreezeAll' || key === 'Jumpscare';
        if (troll && this.wait(s.lastTroll, CFG.trollCooldown)) return this.toast(s, '😈 Your trolls are recharging! Try again in ' + this.wait(s.lastTroll, CFG.trollCooldown) + 's', BLUE);
        if ((troll || key === 'Nuke') && this.sessions.size < 2) return this.toast(s, 'Nobody else is here to troll yet!', BLUE);
        const price = priceOf(m.kind, key, p);
        if ((p.wins || 0) < price) return client.send('broke', { need: price - (p.wins || 0), price, name: item.name });
        p.wins -= price;
        this.grant(s, client.sessionId, m.kind, key);
    }
    grant(s, id, kind, key) {
        const client = s.client;
        const p = s.profile;
        s.stats.buys++;
        if (kind === 'pass') {
            const pass = PASSES[key];
            p.passes[key] = true;
            if (pass.tool) { p.gear[pass.tool] = true; p.tool = pass.tool; }
            if (key === 'Admin') p.fx = '';
            this.toast(s, pass.ic + ' ' + pass.name + ' unlocked!', GREEN);
            client.send('fx', { kind: 'unlock', key });
        } else {
            if (key === 'Skip') {
                p.stage = p.stage + 1;
                p.maxStage = Math.max(p.maxStage || 0, p.stage + 1);
                for (let k = 0; k <= p.stage; k++) s.run.cps.add(k);
                s.run.fromLobby = false;
                if (!s.run.start) s.run.start = Date.now();
                client.send('skipTo', { i: p.stage });
            } else if (key === 'SkipFinal') {
                p.stage = CHECKPOINTS.length - 1;
                p.maxStage = CHECKPOINTS.length;
                for (let i = 0; i < CHECKPOINTS.length; i++) s.run.cps.add(i);
                s.run.fromLobby = false;
                s.run.start = Date.now();
                client.send('skipTo', { i: p.stage });
            } else if (key === 'Nuke') {
                s.lastNuke = Date.now();
                this.broadcast('nuke', { by: p.name, s: id }, { except: client });
                this.toast(s, '☢️ You nuked the server!', GOLD);
                client.send('nukeSent', {});
            } else if (key === 'FlingAll') {
                s.lastTroll = Date.now();
                this.broadcast('fling', { by: p.name }, { except: client });
                this.toast(s, '🌪️ You flung everyone!', GOLD);
                client.send('trollSent', { kind: 'fling' });
            } else if (key === 'FreezeAll') {
                s.lastTroll = Date.now();
                for (const o of this.sessions.values()) if (o !== s) this.setStatus(o, 'f', CFG.freezeSecs);
                this.broadcast('freeze', { by: p.name }, { except: client });
                this.toast(s, '🧊 You froze everyone!', GOLD);
                client.send('trollSent', { kind: 'freeze' });
            } else if (key === 'Jumpscare') {
                s.lastTroll = Date.now();
                this.broadcast('jumpscare', { by: p.name }, { except: client });
                this.toast(s, '😈 Troll face sent!', GOLD);
                client.send('trollSent', { kind: 'scare' });
            } else if (key === 'WinsBoost') {
                p.boostUntil = Math.max(Date.now(), p.boostUntil || 0) + CFG.boostMinutes * 60000;
                this.toast(s, '⏱️ x2 Wins for ' + CFG.boostMinutes + ' minutes!', GOLD);
            }
            client.send('fx', { kind: 'confetti', key });
        }
        this.changed(id);
    }

    // ----- tools -----
    onTool(client, m) {
        const s = this.sessions.get(client.sessionId);
        if (!s) return;
        const id = String(m.id || '');
        if (id && !owns(s.profile, id)) return;
        s.profile.tool = id;
        this.changed(client.sessionId);
    }
    // A slap: the closest player in reach (the client picks, the server checks reach and recharge)
    onSlap(client, m) {
        const s = this.sessions.get(client.sessionId);
        if (!s) return;
        const p = s.profile, g = gloveById[p.tool];
        if (!g || !owns(p, g.id)) return;
        const now = Date.now(), cd = (g.cooldown || CFG.slapCooldown) * (p.passes.SpeedSlap ? 0.5 : 1);
        if (now - s.lastSlap < cd * 1000 * 0.8) return;
        s.lastSlap = now;
        const t = this.sessions.get(String(m.t || ''));
        if (!t || t === s) { this.broadcast('slapFx', { s: client.sessionId, g: g.id }, { except: client }); return; }
        const d = Math.hypot(t.pos.x - s.pos.x, t.pos.y - s.pos.y, t.pos.z - s.pos.z);
        if (d > (g.range || CFG.slapRange) + 5) { this.broadcast('slapFx', { s: client.sessionId, g: g.id }, { except: client }); return; }
        const dbl = !!(g.luck && Math.random() < g.luck);
        const dx = t.pos.x - s.pos.x, dz = t.pos.z - s.pos.z, l = Math.hypot(dx, dz) || 1;
        t.client.send('slapped', { dx: dx / l, dz: dz / l, by: p.name, g: g.id, dbl });
        this.broadcast('slapFx', { s: client.sessionId, t: String(m.t), g: g.id, dbl });
        if (g.bubble) this.setStatus(t, 'b', CFG.bubbleSecs);
        if (g.fire) this.setStatus(t, 'x', 2.2);
        if (g.boost) client.send('slapHit', { boost: true });
        p.slaps = (p.slaps || 0) + 1;
        markDirty();
    }
    // The Laser Gun: zap a player and fling them away
    onRay(client, m) {
        const s = this.sessions.get(client.sessionId);
        const t = this.sessions.get(String(m.t || ''));
        const now = Date.now();
        if (!s || !t || t === s || s.profile.tool !== 'laser' || now - s.lastZap < CFG.rayCooldown * 1000 * 0.8) return;
        const d = Math.hypot(t.pos.x - s.pos.x, t.pos.y - s.pos.y, t.pos.z - s.pos.z);
        if (d > CFG.rayRange + 12) return;
        s.lastZap = now;
        const dx = t.pos.x - s.pos.x, dz = t.pos.z - s.pos.z, l = Math.hypot(dx, dz) || 1;
        t.client.send('zapped', { dx: dx / l, dz: dz / l, by: s.profile.name });
        this.broadcast('zapFx', { s: client.sessionId, t: String(m.t) });
    }
    // Bear traps: one each at a time, dropped at your feet; the first to step in is stuck
    trapMsg(t) { return { id: t.id, x: t.x, y: t.y, z: t.z, by: t.by }; }
    onTrap(client, m) {
        const s = this.sessions.get(client.sessionId);
        if (!s || s.profile.tool !== 'bearTrap' || !finite(m.x) || !finite(m.y) || !finite(m.z) || Date.now() - s.lastTrap < 2500) return;
        if (dist2(s.pos, m) > 36 || Math.abs(s.pos.y - m.y) > 4) return;
        s.lastTrap = Date.now();
        for (const [id, t] of this.traps) if (t.by === client.sessionId) this.removeTrap(id);
        const t = { id: ++this.trapN, x: m.x, y: m.y, z: m.z, by: client.sessionId, owner: s.profile.name };
        this.traps.set(t.id, t);
        t.timer = this.clock.setTimeout(() => this.removeTrap(t.id), CFG.trapLife * 1000);
        this.broadcast('trap', this.trapMsg(t));
    }
    onTrapStep(client, m) {
        const s = this.sessions.get(client.sessionId);
        const t = this.traps.get(m.id | 0);
        if (!s || !t || t.by === client.sessionId || !this.near(s, t.x, t.y, t.z, 4, 3)) return;
        client.send('trapped', { by: t.owner });
        this.broadcast('trapFx', { id: t.id });
        this.removeTrap(t.id);
    }
    removeTrap(id) {
        const t = this.traps.get(id);
        if (!t) return;
        if (t.timer) t.timer.clear();
        this.traps.delete(id);
        this.broadcast('trapGone', { id });
    }
    // ----- Admin (cosmetic commands everyone sees) -----
    onFx(client, m) {
        const s = this.sessions.get(client.sessionId);
        if (!s || !s.profile.passes.Admin) return;
        s.profile.fx = cleanFx(m.fx);
        this.changed(client.sessionId);
    }
    onFireworks(client) {
        const s = this.sessions.get(client.sessionId), now = Date.now();
        if (!s || !s.profile.passes.Admin || now - s.lastFireworks < 4000) return;
        s.lastFireworks = now;
        this.broadcast('fireworks', { s: client.sessionId });
    }

    // ----- trails -----
    onTrail(client, m) {
        const s = this.sessions.get(client.sessionId);
        const d = trailById[m.id];
        if (!s || !d) return;
        const p = s.profile;
        if (!p.trails[d.id]) {
            if (p.wins < d.price) return client.send('broke', { need: d.price - p.wins, price: d.price, name: d.name });
            p.wins -= d.price;
            p.trails[d.id] = true;
            this.toast(s, d.name + ' trail unlocked!', GREEN);
        }
        p.trail = d.id;
        this.changed(client.sessionId);
    }

    // ----- rewards -----
    giveReward(s, r) {
        const p = s.profile;
        if (r.wins) { p.wins += r.wins; p.totalWins += r.wins; }
        if (r.boost) p.boostUntil = Math.max(Date.now(), p.boostUntil || 0) + CFG.boostMinutes * 60000;
        if (r.glove && gloveById[r.glove]) {
            if (!p.gear[r.glove]) { p.gear[r.glove] = true; const k = Object.keys(PASSES).find((q) => PASSES[q].tool === r.glove); if (k) p.passes[k] = true; }
            else { p.wins += 100; p.totalWins += 100; }
        }
    }
    onDaily(client) {
        const s = this.sessions.get(client.sessionId);
        if (!s) return;
        const p = s.profile, now = Date.now();
        const st = dailyStatus(p.daily, now);
        if (!st.can) return this.toast(s, 'Come back tomorrow for more!', BLUE);
        const r = DAILY[st.day];
        p.daily = { last: dayKey(now), streak: st.streak + 1 };
        this.giveReward(s, r);
        this.toast(s, 'Day ' + p.daily.streak + ' reward: ' + rewardText(r) + '!', GREEN);
        client.send('fx', { kind: 'confetti' });
        this.changed(client.sessionId);
    }
    onGift(client, m) {
        const s = this.sessions.get(client.sessionId);
        const k = m.k | 0, g = GIFTS[k];
        if (!s || !g || s.giftClaimed[k]) return;
        if (s.playSecs < g.min * 60 - 2) return this.toast(s, 'Keep playing to unlock this gift!', BLUE);
        s.giftClaimed[k] = true;
        this.giveReward(s, g);
        this.toast(s, '🎁 ' + rewardText(g) + '!', GREEN);
        client.send('fx', { kind: 'confetti' });
        this.changed(client.sessionId);
    }
    onCode(client, m) {
        const s = this.sessions.get(client.sessionId);
        if (!s) return;
        const code = String(m.code || '').trim().toUpperCase().slice(0, 24);
        const r = CODES[code];
        const p = s.profile;
        p.codes = p.codes || {};
        if (!r) return client.send('codeResult', { ok: false, text: 'Invalid code' });
        if (p.codes[code]) return client.send('codeResult', { ok: false, text: 'Code already used' });
        p.codes[code] = true;
        this.giveReward(s, r);
        client.send('codeResult', { ok: true, text: rewardText(r) + '!' });
        this.changed(client.sessionId);
    }

    broadcastBoards(client) {
        const row = (key) => topProfiles(key).filter((p) => (p[key] || 0) > 0).map((p) => ({ n: p.name, v: Math.floor(p[key] || 0) }));
        const m = { climbs: row('climbs'), slaps: row('slaps') };
        if (client) client.send('boards', m); else this.broadcast('boards', m);
    }

    // ----- Bloxity -----
    async onBloxityLogin(client, m) {
        const s = this.sessions.get(client.sessionId);
        if (!s || !m || s.authing) return;
        s.authing = true;
        const legion = await verifyBloxityToken(m.token);
        s.authing = false;
        if (!legion || !this.sessions.has(client.sessionId)) return;
        const uid = 'legion_' + legion.id;
        if (s.profile.uid === uid) return;
        const name = cleanName(legion.name) || s.profile.name;
        const guestProfile = s.profile;
        await adoptGuestProgress(uid, guestProfile.uid, name);
        await loadProfile(uid);
        if (!this.sessions.has(client.sessionId)) return;
        s.profile = getProfile(uid, name, randomName());
        this.fixProfile(s.profile);
        if (!isOnline(guestProfile.uid)) releaseProfile(guestProfile.uid, isOnline);
        s.player.name = s.profile.name;
        this.changed(client.sessionId);
        client.send('authed', { name: s.profile.name });
        this.toast(s, 'Logged in as ' + s.profile.name, GREEN);
        this.broadcastBoards();
    }
    onAvatar(client, m) {
        const s = this.sessions.get(client.sessionId);
        if (s && m) s.player.av = cleanAvatar(m.av);
    }
    onEmote(client, m) {
        const s = this.sessions.get(client.sessionId);
        if (!s || !m || typeof m.id !== 'string' || m.id.length > 40) return;
        this.broadcast('emote', { s: client.sessionId, id: m.id }, { except: client });
    }
    onChat(client, m) {
        const s = this.sessions.get(client.sessionId);
        if (!s || !m || typeof m.text !== 'string') return;
        const now = Date.now();
        if (now - s.lastChat < 800) return;
        s.lastChat = now;
        const text = m.text.replace(/\s+/g, ' ').trim().slice(0, 120);
        if (text) this.broadcast('chat', { s: client.sessionId, name: s.profile.name, text });
    }
    onFriends(client, m) {
        const s = this.sessions.get(client.sessionId);
        if (!s || !m || !Array.isArray(m.names)) return;
        const here = new Set([...this.sessions.values()].filter((o) => o !== s).map((o) => o.profile.name));
        const n = new Set(m.names.slice(0, 50).map(String).filter((x) => here.has(x))).size;
        const friends = Math.min(CFG.friendMax, n);
        if (friends === s.friends) return;
        s.friends = friends;
        s.player.friends = friends;
    }
}

function isOnline(uid) {
    for (const room of liveRooms) for (const s of room.sessions.values()) if (s.profile.uid === uid) return true;
    return false;
}
void isGlove;
