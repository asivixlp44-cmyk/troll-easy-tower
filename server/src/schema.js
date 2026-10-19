import { schema, t } from '@colyseus/schema';

// Public, synced to every client. Private progress (trails, gear, Wins history...) is sent only to
// its owner with the "profile" message.
export const PlayerState = schema({
    name: t.string().default(''),
    x: t.float32().default(0),
    y: t.float32().default(0),
    z: t.float32().default(0),
    ry: t.angle(),
    anim: t.uint8().default(0),     // 0 idle, 1 run, 2 air, 3 climb, 4 fly
    stage: t.int8().default(-1),    // checkpoint reached this climb (-1 = none)
    wins: t.number().default(0),
    tool: t.string().default(''),   // the glove or gear in hand
    trail: t.string().default(''),
    fx: t.string().default(''),     // Admin commands on (letters, see ADMIN in shared/config.js)
    admin: t.boolean().default(false),
    st: t.string().default(''),     // status everyone sees: b bubble, f frozen, x on fire
    friends: t.uint8().default(0),  // Friend Boost: Bloxity friends in this server
    kit: t.uint8().default(0),
    skin: t.uint8().default(0),
    av: t.string().default(''),     // packed Bloxity avatar (equipped ids + proportions)
}, 'PlayerState');

export const GameState = schema({
    players: t.map(PlayerState),
}, 'GameState');
