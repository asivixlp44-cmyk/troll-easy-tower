# Troll Easy Tower

A multiplayer troll tower obby for the browser, built with **Three.js** and **Colyseus** for Bloxity. Climb **32** "easy" stages that spiral up the **outside** of a giant studded tower floating over the ocean: one wall per stage, eight laps round the tower, in four colour bands (mint green, magenta, blue, purple). Every stage hides trolls: fake blocks, invisible paths, slap hands, gloves punching out of the wall, lasers, blinking blocks, a red light / green light guard, a giant who strides across the path, "FREE SKIP!" buttons that throw you off, and a fake WIN pad on the roof. Fall off and you're back at your checkpoint. Slap other players off the course with gloves. It clones the Roblox game *[Troll Easy Tower](https://www.roblox.com/games/90048768291999/Troll-Easy-Tower)* (see the video in `reference/`).

**There are no in-app purchases.** Gloves, gear, Nuke Server, trolls, skips and revives are all bought with **Wins**, earned by climbing.

It shares its engine with the other Legion games (server, Bloxity login and avatars, profiles, saves; forked from Maze Obby, with Strawberry Tower's trusses and moving parts). The tower, the stages, the lobby, the HUD, the gloves and the soundtrack are new.

## Project layout

| Folder | What it is |
|---|---|
| `client/` | Vite + Three.js client: `main.js` (player physics, trusses, trampolines, belts, ice, double jump, sprint, every trap's hit test, falling off, slaps and status effects, revive, network, camera, the loading warm-up), `world.js` (the tower shell, the lobby and terrace, every course element, checkpoint beams, the doll, the giants, the roof and victory platform), `materials.js` (studs, planks, truss, ice, belts, keycaps, glass, our own troll grin), `gear.js` (the gloves, Laser Gun, coils, carpet, bear trap), `engine.js` (renderer, sky over the ocean, moods, lights, studs, text), `fx.js` (quality presets, one-draw-call particles, trails, slap bursts), `audio.js` (music and sounds), `ui.js` + `index.html` (HUD and panels) |
| `server/` | Colyseus 0.18 server: the `troll` room (`TowerRoom.js`), profiles, leaderboards, play stats |
| `shared/` | `config.js` (stages and their obstacle plans, gloves, gear, Wins economy, trolls, Admin, rewards) and `tower.js` (the whole tower as data, built from obstacle modules; used by both sides) |

## Run it locally

Needs Node 20 or newer. Double-click `start-local.bat`, or:

```sh
npm install          # installs client and server too
npm run build        # builds the client into client/dist
npm start            # server + game on http://localhost:2627
```

For development run `npm run dev:server` and `npm run dev:client`, then open http://localhost:5203 (the client talks to the server on port 2627; `VITE_SERVER_URL` overrides that). Dev builds (or a build with `VITE_QA=1`) expose `window.__qa` for automated test runs. Restart the server after changing `shared/` (it keeps the old checkpoint and coin positions otherwise).

## Gameplay

- **The lobby** is the tower's ground floor (mint studs, the white path with green borders and big red arrows, like the reference):
  - the spawn star, then the red arrows out through the big south doorway to the terrace ("FOLLOW THE ARROWS!")
  - **GAMEPASS** pads along the north wall: Fly, Laser Gun, Speed Coil, Gravity Coil, Bear Trap
  - the **Rainbow Chest** (free Wins every 30 minutes), **Top Winners** and **Top Slappers** boards
  - the **Ghost Slap cage**: its gate opens for 75 s every 10 minutes; walk in and the glove is yours
  - the **Fire Punch** stand: free after 30 minutes of playtime (or buy it now)
  - the **TELEPORT VIP** room: its golden door opens after 15 minutes of play; the VIP chest pays 40 Wins every 20 minutes
  - the free codes board (`TROLL`, `SLAP`, `EASY`, plus `LEGION` and `RELEASE`)
- **The terrace** outside, over the ocean: the **slap gloves** on stands (walk onto the ring to buy or equip), a giant strolling past who kicks you, TROLL: "GET SPEED COIL FAST!!! Press E" (a launch pad), and in the north-west corner the Stage 1 checkpoint where the climb starts.
- **The climb**: the course runs round the outside of the tower in the open sky, 12 studs out from the wall. Each stage is one wall, from a corner landing (with its checkpoint, a Skip Stage pad and a STAGE board on the wall) to the next. Stages are built from obstacle modules, sized by the stage's difficulty (smaller blocks, longer gaps, faster traps as you climb):
  - white **sky stairs** (steps go missing higher up) and narrow **wall stairs**, **hops**, **red slabs** that drop away, **truss towers** up to floating boxes, a **tightrope beam** with kill bricks, **springs** in glass tubes
  - **slap hands** turning over platforms, **gloves punching out of the wall** across a walkway, **sweepers**, **laser bars** bobbing up and down (under them when they're up, over when they're down; touch one and you're out)
  - **fake pairs** (one of two identical blocks is fake), an **invisible bridge**, a giant **keyboard** with fake keys, **blinking blocks** that flash before they go, **spinning discs**, **sliding plates**, squishy **pink balls**, **belts**, slippery **banana ice**
  - Stage 12: **Red Light, Green Light** (plank bridges out to an island in the sky; move on red and the guard zaps you back). Stage 21: a **giant** strides up and down a road across the path (his feet squash you).
  - TROLL: **"⏩ FREE SKIP!"** buttons on a few landings throw you off the tower.
  - **Fall off and you're back at your checkpoint** (out of the stage's space and dropping).
  - **Every stage is harder than the one before**: blocks shrink, gaps and rises grow, slabs drop sooner, belts, hands, gloves, lasers and blinking blocks speed up, and moving parts get faster stage by stage. From the middle of the tower some hops drop away, steps and wall stairs lose every other step, fake blocks come in threes with only one real, the keyboard grows a third row, and lasers cross the banana ice.

  | # | Stage | Difficulty | Obstacles | Next checkpoint pays |
  |---|---|---|---|---|
  | 1 | Totally Easy Steps | EASY | sky stairs, hops | 2 |
  | 2 | Red Means Run | EASY | hops, red drop slabs, sky stairs | 3 |
  | 3 | Truss Me | EASY | sky stairs, truss towers, hops | 5 |
  | 4 | Slap Happy | EASY | hops, slap hands, fake pairs | 6 |
  | 5 | Boing! | MEDIUM | red drop slabs, springs, hops | 7 |
  | 6 | Tightrope | MEDIUM | hops, tightrope beam, truss towers | 9 |
  | 7 | Wall Punchers | MEDIUM | fake pairs, wall punchers, sky stairs | 10 |
  | 8 | Banana Trap | MEDIUM | slap hands, banana ice, red drop slabs | 12 |
  | 9 | Keyboard Warrior | MEDIUM | keyboard, hops, invisible blocks | 13 |
  | 10 | Bouncy Castle | MEDIUM | pink balls, sliding plates, springs | 15 |
  | 11 | Conveyor Chaos | HARD | belts, fake pairs, slap hands | 17 |
  | 12 | Red Light, Green Light | HARD | hops, the guard's island, sky stairs | 18 |
  | 13 | Now You See Me | HARD | invisible blocks, wall punchers, red drop slabs | 20 |
  | 14 | Spin Cycle | HARD | spinning discs, keyboard, truss towers | 22 |
  | 15 | Slip 'n' Slide | HARD | banana ice, sliding plates, fake pairs | 24 |
  | 16 | The Long Climb | HARD | wall stairs, slap hands, pink balls | 26 |
  | 17 | Sweep Sweep | HARD | sweepers, red drop slabs, blinking blocks | 28 |
  | 18 | Laser Tag | HARD | lasers, hops, spinning discs | 30 |
  | 19 | Blink and You Fall | EXTREME | blinking blocks, invisible blocks, wall punchers | 32 |
  | 20 | Moving Day | EXTREME | sliding plates, sweepers, wall stairs | 34 |
  | 21 | Giant Trouble | EXTREME | red drop slabs, the giant's road, hops | 36 |
  | 22 | Factory Floor | EXTREME | belts, lasers, fake pairs | 38 |
  | 23 | Type and Fly | EXTREME | keyboard, springs, slap hands | 41 |
  | 24 | Dizzy Heights | EXTREME | spinning discs, blinking blocks, red drop slabs | 43 |
  | 25 | Troll Factory | EXTREME | lasers, wall punchers, invisible blocks | 45 |
  | 26 | Trust Issues | EXTREME | fake pairs, sweepers, sliding plates | 48 |
  | 27 | Clockwork | INSANE | blinking blocks, spinning discs, wall stairs | 50 |
  | 28 | Slippery Slaps | INSANE | banana ice, lasers, slap hands | 53 |
  | 29 | Invisible Elevator | INSANE | invisible blocks, sliding plates, springs, red drop slabs | 55 |
  | 30 | The Gauntlet | INSANE | wall punchers, blinking blocks, fake pairs | 58 |
  | 31 | Almost There... | INSANE | lasers, sweepers, spinning discs, red drop slabs | 61 |
  | 32 | The Final Troll | INSANE | fake pairs, invisible blocks, slap hands, red drop slabs, keyboard | +250 at the top |

- **The roof**: the last landing bridges onto the roof's south-west corner, where a shiny "🏆 WIN!" pad is a trapdoor into a troll pit (a trampoline throws you out). The real way: north through the gap in the rim, along the glowing rainbow tiles out into the sky to the victory platform and the real WIN pad. Then the rewards restart: back to the lobby for another climb.
- **TROLLED!**: falling through a fake block (or the fake WIN pad, or pressing FREE SKIP) pops up the troll face and a laugh.
- **"Would you like to go back?"** (the reference's revive card): after a fall, for 8 seconds, **Revive** puts you back exactly where you fell from for a few Wins (3 to 50, by stage).
- **Wins**: each new checkpoint of a climb pays the stage just cleared (2 to 61), troll coins +1, the top +250 (a climb must take at least 3 minutes and pass every checkpoint). Skipping ahead pays a quarter at the top. Wins are multiplied by x2 Wins, the x2 boost and Friend Boost (+10% per Bloxity friend in the server, up to +50%).

### Slap gloves

Everyone has the **Default Slap**. Click / E / the 🖐️ button next to a player to slap them flying (spawn bubbles block slaps).

| Glove | Price | What it does |
|---|---|---|
| Luck Slap | 25 | 40% chance of a double-power slap |
| Bubble Slap | 80 | traps them in a floating bubble |
| Light Slap | 200 | every hit gives you a burst of speed |
| Shadow Slap | 450 | blinds them for a few seconds |
| Tornado Slap | 900 | a tornado spins them sky high |
| Ghost Slap | free (cage) | spooks them slow |
| Fire Punch | free after 30 min / 1.2K | sets them on fire and launches them up |
| Big Slap | 1.5K | a huge glove: longer reach, harder slap |
| Mega Punch | 3K | the most powerful punch in the tower |

### The reference's buttons

- **Nuke Server** (300, 1 min recharge): everyone else is blown up and sent back to their checkpoint.
- **Skip To Final** (cheaper the higher you are): straight to Stage 32. **Skip Stage** pads sit next to every checkpoint.
- **Fly** (7K): the rainbow flying carpet (Space up, Shift down). **Mega Punch**, **Laser Gun** (600, zap and fling), **Big Slap**.
- **Admin** (2.5K): Giant, Tiny, Spin, Sparkles, Rainbow aura, Fireworks; everyone sees them and your name gets an ADMIN tag.
- **Troll** (the troll face): Fling All (200), Freeze All (250), Troll Face jumpscare (60), each with a recharge.
- **x2 Jump** (1.2K): jump again in mid-air. **x2 Speed Slap** (500): slap twice as often. **Sprint** (free): Shift or the button, a few seconds of speed that recharge.
- Also: **Bear Trap** (150, drop it and whoever steps in is stuck), Speed and Gravity Coils, trails, **x2 Wins** (4K), the x2 Wins boost, Daily Rewards (a Bubble Slap on day 7), playtime gifts and codes.
- **HUD**: Nuke Server / Skip To Final and the stage bar with your Wins along the top, Fly / Mega Punch / Laser Gun / Admin on the left, Big Slap and Troll on the right, x2 Speed Slap / x2 Jump / Sprint round buttons, the tool hotbar, Shop / Daily / Gifts / Teleport / Invite / Settings top right. The top-left corner is kept free for the Bloxity overlay.

## Sound

- **Music**, "Troll Climb": an original code-generated 116 BPM sneaky-bouncy shuffle in D minor. It tiptoes in (pizzicato walking bass, finger snaps, woodblock ticks, a staccato clarinet), bounces (oom-pah tuba, kick and claps, marimba stabs, a buzzing kazoo hook), climbs a tone higher with glockenspiel sparkles, breaks down to a "wah wah wah waaah" trombone (the troll laughing at you) and drum-rolls back round; 48 bars. The higher you climb, the more layers join in (the lobby, then each colour band).
- All effects synthesized: slaps and big slaps, the troll laugh, boings, the guard's red / green light chimes and alarm, laser zaps, splashes, freezing, traps, footsteps per surface (studs, planks, trusses, keycaps, ice...).

## Graphics and performance

- The reference's look, richer: a tall studded tower with rows of framed windows (some lit), rainbow neon trims running round it between the colour bands and round the roof, the band's name on every wall (TROLL TOWN, DIZZY HEIGHTS, TROLL KING'S PEAK), an arch with a row of bulbs over every stage's way out, searchlights sweeping the sky from the roof, balloons drifting round the tower, fireworks over the victory platform, the sky and light changing with each band, bevelled Roblox studs everywhere (one vertex-coloured material), every block softly shaded from top to bottom, floating rocks under the landings, little floating islands far round the tower, beams of light over the checkpoints (the next one pulses), an ocean below with waves and sun glitter (drawn by the sky shader), drifting clouds, cartoon gloves, a giant guard with a troll grin and a traffic light, giants that really walk, a waving flag at every checkpoint.
- **Built for weak PCs**: only matte (Lambert) and unlit materials, no reflections, no environment map, no post-processing (the vignette is CSS). The tower shell is a few merged meshes; the course's static parts are merged per colour band and per material, plain colours folded into shared vertex-colour materials (a handful of draw calls per band, frustum culled); the guard and the giants are one mesh per moving part; only the moving parts of the stages near you are drawn and animated; static objects have frozen matrices; the coins spin in the vertex shader; every particle is in one of two point clouds; trails are built in the vertex shader.
- **Smooth camera**: out in the open sky there are no ceilings to bump into; the camera pulls in at once when something is in the way and eases back out, ignoring thin posts and blinking blocks.
- **No stutter**: the world is built in slices while the server join runs in parallel; every shader (including the shadow pass's) is compiled in the background and every texture uploaded before you spawn.
- **Quality**: Low (no shadows, no particles or vignette, 0.8 resolution), Medium (default on desktop) and High; phones and weak PCs start on Low. Changing quality never recompiles a shader; an automatic step down is never saved.

## Controls

| Action | Keyboard / mouse | Controller | Touch |
|---|---|---|---|
| Move | WASD / arrows | Left stick | Joystick |
| Jump / fly up / double jump | Space | A | JUMP |
| Sprint / fly down | Shift (Q / C fly down) | LT/RT | Sprint / ⬇ |
| Slap / zap / drop trap / interact | Click, E or F | X | 🖐️ button |
| Tools | 1-9 | LB / RB | Hotbar |
| Climb a truss | Walk into it | Push into it | Push into it |
| Camera | Drag, wheel to zoom | Right stick, D-pad | Drag |

## Multiplayer and saves

- One shared `troll` room (up to 24 players). Movement is client-side; Wins, checkpoints, coins, the top, chests, the cage, tools, revives, slaps (reach and recharge), zaps, traps, the nuke and trolls (recharges) and purchases are decided by the server. Status effects (bubbles, ice, fire) are synced so everyone sees them.
- Progress is saved per browser or per Bloxity account: MongoDB on Legion (`MONGODB_URI`), `server/data/profiles.json` locally; saved within 1.5 s of checkpoints and purchases and every 10 s.
- Play stats: `GET /api/stats?key=<stats key>&days=7` (the key is in `server/STATS_KEY.local.txt`, not in the repo; locally the stats are open).

## Deploy (Bloxity hosting)

Pushing `main` (prod) or `dev` runs `.github/workflows/deploy.yml`: server image `ghcr.io/asivixlp44-cmyk/troll-easy-tower-server`, Legion rollout, client upload. Play at https://troll-easy-tower.play.bloxity.io once the app `troll-easy-tower` exists on hosting.bloxity.io and the repo has the `LEGION_DEPLOY_TOKEN` secret.

## QA

Bots in the session scratchpad played every hop of all 32 stages through the game's own physics (about 530 hops), with traps off and again with every trap on at 20 timings; walked spawn → terrace → Stage 1, the roof → rainbow path → WIN pad, and fell off a stage to check the trip back to the checkpoint; 27 server tests with two Colyseus clients cover checkpoints, codes, gloves, slaps, revive, trolls, skips, the cage and the top. Measured on the dev PC (headless Chrome, real GPU): 1600x900 High 90–145 FPS; with the CPU slowed 4x at 1366x768, Low 57–71 FPS and Medium 41–64 FPS; the shader count stays the same after using every tool. Loads in about 6 s.
