# STARBLAZER · A Living Sol System – Complete Feature & Systems Specification

> **Purpose of this document.** This is a model-facing specification of STARBLAZER as deployed at
> https://starblazer.pages.dev (source of truth: this repository, `js/*.js` + `index.html`).
> It describes every shipped feature, the exact tuned constants, the architecture rules and the
> known traps, in enough detail that another AI model (or engineer) can understand, extend,
> port or re-implement the game faithfully. Where a number is stated, it is the live value,
> not an approximation. Section order goes from foundations to gameplay to tooling.

---

## 1. Product overview

STARBLAZER is a browser game built on top of a **real-scale, physically simulated 3D solar
system**. The player flies a ~300 m starship with Newtonian (optionally special-relativistic)
flight physics through a solar system whose planets follow genuine J2000 orbital elements and
N-body gravitation, populated by a living NPC fleet (stations on real circular orbits, patrol
warships, freighter lanes, shuttles). On top of the simulation sit two game modes:

- **Free Mode**: unrestricted exploration. Time warp up to 10^9x, beam-to-anywhere,
  a 100,000 g autopilot jump to the Andromeda galaxy (2.537 Mly away, real direction), fly home.
- **Battle Mode**: an arcade dogfight layer. Waves of raiders hunt the player; lasers,
  homing photon torpedoes, target lock, a radar scope, hull damage, cinematic explosions,
  and a dedicated combat music layer. Ship impulse power is limited to 20% while in battle.

Design pillars:
1. **Real scale everywhere** (km units, real radii/distances/elements, floating origin, log depth).
2. **No build step**: plain ES modules + CDN importmap; deployable by copying files.
3. **Procedural over assets**: planets, sky, music, SFX, explosions and station detailing are
   generated in code. The only binary assets are open-source ship GLBs and Earth/Moon textures.
4. **Filmic look**: ACES + bloom + custom film grade tuned via an in-game editor whose readouts
   get baked back into source as defaults.

---

## 2. Tech stack & architectural constraints

- **Three.js 0.170**, loaded via `<script type="importmap">` from jsdelivr. No bundler, no
  transpiler, no package.json build. All game code is native ES modules under `js/`.
- **Module cache busting**: every import carries a query version (`import ... from './x.js?v=98'`).
  `./bump-version.sh <n>` rewrites `?v=NN` across `index.html` and all `js/*.js`. Bump before
  every deploy; the version is the de-facto release number.
- **Files** (all under `js/` unless noted):
  - `main.js`: wiring, frame loop, input, camera, title/mode flow, look grade, debug surface.
  - `physics.js`: N-body integrator, Kepler propagation, ship physics, autopilots.
  - `data.js`: constants (G0, c, AU, LY, J2000 epoch), planet/sun/moon tables, formatters.
  - `scene.js`: renderer, post chain, sky instantiation, `toRender` frame mapping.
  - `shaders.js`: all GLSL (noise, sky, sun, planet types, rings, galaxy, atmosphere, logDepth helper).
  - `bodies3d.js`: sun/planet/atmosphere/ring/trail/Andromeda meshes and lights.
  - `ship3d.js`: player ship view, helm input, exhaust visuals, chase-cam support.
  - `fleet.js` + `fleet_meshes.js`: NPC stations/ships on analytic rails, procedural station meshes.
  - `megastation.js`: K-7 O'Neill-cylinder habitat generator.
  - `greeble.js`: procedural hull detailing shader injection (panels + windows).
  - `models.js`: GLB loading/normalization/painting, environment (IBL).
  - `combat.js`: Battle Mode (agents, weapons, radar, HUD, explosion kit).
  - `music.js` + `music_tracks.js`: WebAudio synth music engine + composed note data.
  - `sfx.js`: WebAudio synth sound effects.
  - `ui.js`: panels, sliders, HUD, labels, toasts.
  - `editor.js`: in-game live parameter editor (the tuning loop).
  - `index.html`: all CSS, panel markup, title screen with inline SVG logo.
- **Rendering frames**: physics runs in an ecliptic frame in **km**; render space maps
  `physics (x, y, z) -> render (x, z, -y)` (`toRender` in scene.js), so ecliptic north is render +Y.
- **Floating origin**: the focused object sits at the render origin every frame; every other
  position is expressed relative to it in km. World coordinates live in JS doubles. This keeps
  300 m ship close-ups and a 2.4e19 km Andromeda trip in one scene without jitter.
- **Depth**: `logarithmicDepthBuffer: true`; camera `fov 55, near 1e-3, far 2e20`. Any custom
  `ShaderMaterial` must include the shared log-depth chunks (`logDepth()` helper from shaders.js).
- **Order-of-update rule**: `fleet.tick(sim.time)` MUST run before `focusPos()` each frame,
  otherwise a focused NPC sits one frame away from the camera origin.

---

## 3. Rendering pipeline & film look

Composer chain: `RenderPass -> UnrealBloomPass -> OutputPass -> FXAA -> FilmLook`.

- Renderer: `antialias: false` (FXAA instead), `ACESFilmicToneMapping`,
  `toneMappingExposure 1.43`, pixel ratio capped at 2.
- **Bloom**: strength driven per-frame from the UI slider (default **0.06**),
  radius **0.58**, threshold **0.87**. HDR sources use `toneMapped:false` materials with
  colour components > 1 so bloom lifts them.
- **FilmLook** (custom full-screen ShaderPass, after FXAA so grain stays crisp):
  - chromatic aberration growing to the frame edge (`ca = c * r^2 * 0.010`),
  - teal shadows (mix 0.35) / warm highlights (mix 0.28) grade,
  - saturation **1.07**, contrast **1.075** (uniforms `uSat`, `uCon`),
  - animated film grain, stronger in shadows (strength multiplier default **1.0**),
  - vignette (corners ~ -22% at strength 1, default **1.0**),
  - dither (2/255) against banding.
- **Look persistence**: `LOOK_DEF = { bloom 0.06, exposure 1.43, contrast 1.075, saturation 1.07,
  grain 1, vignette 1, film true }` in main.js; user overrides persist to localStorage and a
  "Reset look" restores LOOK_DEF. The same values are baked as slider defaults in index.html
  and as constructor defaults in scene.js (three places, keep in sync).
- **Scene lighting**: sun is a `PointLight(0xfff2dd, intensity 0.60, no distance falloff)` at the
  sun's position + `AmbientLight(0x32404f, 0.115)` + `RoomEnvironment` IBL
  (`initEnvironment` in models.js; REQUIRED, otherwise metalness-1 CAD GLBs render black).

---

## 4. Astronomy & physics

### 4.1 Bodies and constants
- `G0 = 6.6743e-20 km^3/(kg s^2)`, `C_KMS = 299792.458`, `G_ACC = 9.80665e-3 km/s^2`,
  `AU = 1.495978707e8 km`, `LY = 9.4607304725808e12 km`, epoch `J2000`.
- Bodies: Sun, Mercury..Neptune, Pluto, Earth's Moon. Each planet entry carries mass, radius,
  J2000 elements (a, e, i, O, W, L), rotation period (`day`, negative = retrograde), axial tilt,
  a shader `type` (`rock | venus | earth | gas | ice | moon`) and three palette colours
  `c1/c2/c3` (e.g. Earth `0x01020f / 0x688d6c / 0x869aa6`). Saturn has `rings:[74500,140200]` km.
- Andromeda (M31): distance `2.537e6 LY`, radius `110e3 LY`, real ecliptic direction
  (lon 27.85°, lat 33.35°). Rendered procedurally and visible from the home system.

### 4.2 Integration
- **Velocity-Verlet N-body** over all bodies (Sun, planets, Pluto, Moon), so the Gravity
  slider (0..3x, default 1x) genuinely changes the dynamics.
- **Time warp**: log slider 0..9 -> 1x..10^9x. NPC fleet positions are analytic functions of
  sim time (warp-proof by construction; see §7).
- **Ship, powered**: thrust along the nose. Max speed comes from the ship-speed slider
  (log, 10^-1.5..10^2 multiples of c; default **0.05 c**); acceleration is sized to reach max
  in 10 s (`thrustAcc = maxV / 10`). Releasing thrust triggers an automatic retro-burn to local
  rest ("braking"); `X` cuts to pure coasting / aborts autopilot.
- **Ship, unpowered**: Kepler f&g propagation relative to the dominant body, stable up to 1e9x
  warp (no integration error at high warp).
- **Relativistic mode** (checkbox): integrates proper velocity `u = gamma*v`; speed asymptotes
  to c. HUD shows % of c when v > 1% c.
- **Autopilots** (flip & burn brachistochrone with overshoot guard at coarse dt):
  - `J`: Andromeda jump at **100,000 g** constant, arrival radius 6e16 km; time warp auto-ramps
    so the ~10 year proper trip plays in about a minute of wall time; arrival toast + focus.
  - `H`: home to Earth (same machinery, Earth-relative).
  - HUD shows an autopilot progress bar (label, phase ALIGN/BURN/FLIP..., km to go, % bar).
- **Player spawn**: 20,000 km circular Earth orbit (`resetShip()` re-parks there, toast).

---

## 5. Celestial rendering

- **Sun**: procedural granulation + corona shaders, HDR; brightness follows the "Sun light"
  slider (PointLight intensity, default 0.60).
- **Planets**: one `ShaderMaterial` per type with the body's `c1/c2/c3` palette uniforms
  (`uC1/uC2/uC3`, editable live in the editor):
  - `rock` (Mercury/Mars/Pluto), `venus` (banded clouds), `gas` (Jupiter/Saturn bands),
    `ice` (Uranus/Neptune), `moon`, and `earth`.
  - **Earth** is special: real texture maps (Solar System Scope, CC-BY: 2k day/night/clouds in
    `textures/`, progressive 8K variants streamed from R2 `textures/`), night-side city lights,
    cloud layer, plus distance-blended procedural fbm detail when closer than ~3 Earth radii.
  - Sphere tessellation 160x96 (sun/atmospheres 128).
- **Atmosphere rims** (additive Fresnel shells, colour + scale height per planet):
  `Earth [0x262a2e, 1.025]`, `Venus [0xe8c79a, 1.03]`, `Mars [0xd88a5a, 1.02]`,
  `Jupiter [0xd8b890, 1.012]`, `Saturn [0xe8d8a8, 1.012]`, `Uranus [0xa8e0dc, 1.015]`,
  `Neptune [0x5a78d8, 1.015]`. Editor exposes the colour as "Atmosphere".
- **Saturn's rings**: dedicated ring shader between the configured radii.
- **Sky**: one giant inward-facing sphere (r 6e19) with a procedural starfield + Milky Way band,
  oriented by real galactic north/centre directions. renderOrder -10, no depth write.
- **Andromeda**: procedural spiral-galaxy disc + 3D star sprinkle, brightness boosted so it is
  visibly a smudge from the home system; label + focus target; camera trip destination.
- **Orbit trails**: toggleable polyline trails per planet.

---

## 6. Player ship

### 6.1 Model & baked look
- GLB: **Valkyrie** from BabylonJS Space Pirates (Apache-2.0), served from R2, ~300 m
  (`SHIP.lengthKm 0.30`), meshopt+WebP optimized. Nose normalized to -Z.
- `playerPaint` (models.js) bakes the hero look at load: strips texture maps and lettering,
  hull colour black `0x000000`, emissive `0xe6e6e6`, metalness 0.2, roughness 0.56 (an
  editor-tuned look: dark glass hull that reads by rim light and self-illumination).
- Self illumination: `selfGlow = 1.2` scales grille emissive per frame; a fill
  `PointLight(0x414044, 1.8, distance 0.5, decay 2)` rides on the hull (`selfLit`).
- All of these are editor-tunable live (§11).

### 6.2 Exhaust & thrust visuals
- Per-pixel Gaussian round glow texture (`GLOW_TEX`, canvas radial falloff, zero at edge:
  avoids square bloom artifacts).
- 2 nozzle glow sprites + a 7-puff tapering trail along +Z + a soft halo; all additive,
  tinted by `exhaustColor 0xd8e7f3` and scaled by `exhaustMul 0.36` (both editor-tunable).
- Glow level lags throttle (rise rate 6/s, decay 2.2/s) so thrust pulses feel physical.
- Grille emissive = `selfGlow * throttleLag`.

### 6.3 Helm & camera
- Rotational inertia model: keys command angular acceleration; releasing damps rates.
  `ACC 6.5 rad/s^2, MAX 1.7 rad/s, DAMP 7.0` (exponential), pitch/yaw at half rate
  (`SPD x/y 0.5`), roll full (and applied at 1.2x). W/S or arrows pitch, A/D or arrows yaw, Q/E roll.
- **Mouse steering**: hold LMB in ship view -> pointer lock; the nose follows mouse movement
  DIRECTLY (`K = 0.0035 rad/px`, no rotational inertia while steering; releasing exits lock).
  Residual key-spin is zeroed when steering starts. RMB vertical drag sets camera elevation
  (-0.45..1.35 rad). Mouse wheel sets chase distance (0.28..0.5 km, exponential).
- **Chase cam**: 3rd-person, follows orientation with a soft quaternion lag; boots at the
  closest stop (0.28). On focus change to Starship, the chase snaps behind the ship.
- **Flight reticle**: the nose direction projected on screen (crosshair, turns red/hot when
  the combat firing solution is valid).
- **Boot attitude**: nose aimed at a Sun/Earth blend (36%/64%) with roll -0.6 rad, so Earth
  rides top-right and sun glare sits bottom-left on spawn.
- **Arrival fly-in**: after mode select / beam / reset, the ship sweeps in from outside the
  frame (behind/below, offset `chaseDist * 1.6`) easing to park over **10 s** (cubic ease-out,
  render-only offset on a frozen line; physics is already parked, controls answer immediately).

### 6.4 Beaming
- Shift+click any label, or Shift+1..0: `beamShipTo` places the ship at a sunward standoff
  (`max(3 * radiusKm, 0.8 km)`) of the target with matched velocity, aims the nose at it,
  focuses the Starship and plays the arrival fly-in + toast.

---

## 7. NPC fleet & stations

### 7.1 Rails architecture
Every NPC position is an **analytic function of sim time** in the physics frame:
warp-proof, zero integration cost, independent of the player's rails.
- `addOrbiter`: real circular gravity orbit around a parent body (`om = sqrt(G0*M/R^3)`).
- `addPatrol`: powered impulse circle with a fixed period (visibly moving at warp 1).
- `addLane`: ping-pong runs between two anchors (bodies or stations) with smoothstep
  easing, a period and a phase.
- Analytic velocities MUST include the parent body's motion (finite-diff with frozen parent
  yields only the relative component; this was a real bug).
- Objects register `{name, grp, kind, radiusKm, spin, label, state(t,out), velAt(t,out)}`;
  `fleet.tick` evaluates states, `fleet.place` positions render groups (floating origin),
  applies `spin` about local Y and calls optional `grp.userData.animate(t)`.
- A combat override (`o.combat = agent`) makes fleet.tick/place follow a free-flying combat
  agent instead of the rail; clearing it returns the object to its rail (used for raiders).

### 7.2 Station catalog (name / parent / orbit radius km / body radius km / spin)
| Station | Parent | Orbit R | radiusKm | spin | Model |
|---|---|---:|---:|---:|---|
| Spacedock One | Earth | 45,000 | 4.2 | 0.02 | procedural `buildSpacedock` (mushroom dock) |
| Utopia Planitia | Mars | 15,000 | 2.2 | 0.05 | procedural `buildRingStation` |
| Jove Gateway | Jupiter | 450,000 | 1737 | 0.008 | procedural `buildGateway`, scale 632 (5.5 km build -> ~3475 km, Moon-class) |
| Cronos Station | Saturn | 400,000 | 1190 | 0.008 | procedural `buildRingStation`, scale 594 (Pluto-class) |
| Station K-7 | Sun (belt) | 4.19e8 | 1190 | 0.02 | procedural O'Neill cylinder (`buildGreebleStation`, seed 7, scale 297) |
| ISS | Earth | 6,791 | 0.06 | 0 | NASA GLB `iss.glb` |
| Lunar Gateway | Moon | 3,500 | 0.025 | 0 | NASA GLB `gateway_station.glb` |

### 7.3 Ships, lanes, shuttles
| Craft | Kind | Route/Orbit | Period/Alt |
|---|---|---|---|
| USS Defiant / USS Excalibur | warship patrol | Earth 52,000 / 62,000 km | 260 s / 340 s |
| USS Reliant | warship patrol | Jupiter 300,000 km | 600 s |
| USS Grissom | scout patrol | Venus 30,000 km | 300 s |
| SS Kobayashi Maru | freighter lane | Earth <-> Mars | 3.456e6 s |
| SS Botany Bay | hauler lane | Earth <-> Jupiter | 1.0368e7 s |
| SS Lakul | freighter lane | Mars <-> Saturn | 1.728e7 s |
| USS Oberth | scout lane | Earth <-> Moon | 240 s |
| Shuttle Galileo | Smithsonian Discovery GLB | Spacedock One <-> ISS | 90 s |
| Shuttle Copernicus | scout (0.45x) | Spacedock One <-> Moon | 300 s |

GLB mapping: freighters/hauler/scouts are Viktor Hahn OpenGameArt models (CC-BY 3.0),
warships are the SpacePirates Raider (Apache-2.0), all normalized nose -Z with per-model
yaw/pitch/roll fixes and blinker lights.

### 7.4 Shared station identity (the "fleet look")
One baked look, tuned in the editor on Cronos and applied to ALL stations:
```js
STATION_LOOK    = { hull: 0x697696, emissive: 0x141000, emissiveIntensity: 0.50,
                    metalness: 0.55, roughness: 0.10, glow: 3.70, glowColor: 0xc7c2a3 }
STATION_GREEBLE = { winFreq: 98, winBright: 6.0, winDensity: 0.97, winTint: 0xffdca8 }
```
- Procedural stations: `applyGreebleShading(mesh, {...STATION_GREEBLE, ringR})` THEN
  `paintStation(mesh, STATION_LOOK)`.
- GLB stations (ISS, Lunar Gateway): `paintObject(model, STATION_LOOK)` in `loadInto`'s
  `onLoaded` callback.
- **Exception**: Station K-7 keeps its bespoke O'Neill palette (white hull + warm window
  canyons via emissiveMap at intensity 3.8; the 3.7x glow multiplier would blow it out).
  It sets `grp.userData.noWash = true`.

Paint semantics (IMPORTANT):
- A material is a **glow** (window/running light/engine) if `emissive` channel sum > 0.2 and it
  has no colour map. Glow materials keep their light; `glow` multiplies their emissiveIntensity,
  `glowColor` recolours them. Everything else is structural hull: `hull/emissive/
  emissiveIntensity/metalness/roughness` are applied and the material is marked `_washed`.
- `paintStation` (procedural) must **dedupe by material uuid**: glow materials are shared
  across many meshes, and a per-mesh `*=` would compound (0.7 * 3.7^20 blew out the screen once).
- `paintObject` (GLB) clones materials per mesh before mutating (GLB templates are shared
  between fleet instances), so it needs no dedupe.
- A default **whitewash** pass runs over every fleet object not painted/noWash: colour maps get
  a white-tinted copy, plain colours collapse to a bright grey ramp; glow materials are skipped.

### 7.5 Generative hull detailing (`greeble.js`)
Injected into standard materials via `onBeforeCompile` (no custom material class):
- **Panel plating**: two-scale cell tone variation + darkened seams
  (`freq 42`, `strength 0.24` defaults).
- **Windows**, two layouts chosen per material:
  - generic: axis-aligned window cells gathered into horizontal deck bands;
  - **toroidal** (`material.userData._ringWin = true`, used by the ring-station torus): window
    columns laid out in true ring coordinates (angle around ring x angle around tube,
    `ringR 1.8`), so windows follow the curve as neat rows instead of cartesian confetti.
- All knobs are live uniforms (`uGWin, uGWinBright, uGWinDen, uGWinTint, uGStr`), and a
  reference is stashed on `material.userData._grb` so the editor can drive them (§11).

### 7.6 Station K-7 (O'Neill cylinder)
A spinning city-in-a-can: alternating LAND stripes (white hull, greebled) and recessed GLASS
stripes (baked CanvasTexture window field as emissiveMap: warm sodium + ~11% cool cells, dark
service bands) along the drum; endcap domes, agricultural torus collar, axial docking hub with
radial arms and docked craft, solar wings, truss bands, and an instanced greeble carpet with a
density gradient toward the drum's middle. Stock `MeshStandardMaterial` only (deliberately no
custom shader math: avoids Apple-Silicon NaN traps). Spin about the drum axis provides gravity;
the drum axis is vertical so the orbiter `spin` drives it.

### 7.7 Labels
Every station (and the Starship, planets, Andromeda) gets a floating DOM label, projected
per-frame, click = focus, Shift+click = beam. Station labels are green, ship amber, foes red.
The labels toggle lives in the settings panel.

---

## 8. Game shell (title, modes, HUD, panels)

### 8.1 Title screen
- `body.title` hides HUD/panels and shows `#title` over the live scene (the ship idles in
  view from astern; everything animates behind the menu).
- **Logo**: inline SVG wordmark "STARBLAZER", Orbitron 900 at 132px, letter-spacing 4,
  skewX(-7°) group. Face fill is a vertical chrome gradient (6 stops, white -> ice blue ->
  deep steel; softened horizon). 3D extrusion is 8 stacked offset copies filled with a dark
  steel gradient. A speed-streak polygon + comet dot cross behind the wordmark, a moving
  shine-sweep gradient plays across the face, plus twinkle star paths. NO stroke on the face
  (a 1.1px stroke once caused a notch artifact on the R; keep strokeless).
- Subtitle: `A living Sol system`. Buttons: **Free Mode**, **Battle Mode** (no description text).
- Hint line: `Space thrust · hold LMB steer · Esc back to this screen · M music`.
- Sound hint `♪ click anywhere for sound` pulses ONLY while the browser blocks audio autoplay
  (driven by AudioContext statechange; §10.3).
- `Esc` at any time returns to the title (combat stands down); mode buttons call
  `startGame(mode)`: reset ship to Earth orbit, boot attitude, arrival fly-in, enable combat
  if battle. Free Mode toasts a welcome hint.

### 8.2 HUD (bottom-left, one row)
`WARP x · SPEED (auto-format m/s, km/s, % c and "rel <target>") · THR percent or "100% AP" ·
ACC in g · NEAREST body`, plus in combat: `HULL % (colour-coded) · KILLS · WAVE`.
Below: autopilot progress bar when active. No date display (removed by design).

### 8.3 Panels
- **Physics & View** (top-right) and **Help** (top-left): frosted-glass fold panels.
  They boot **collapsed to chips**; the whole chip is clickable when closed, only the header
  when open. Height animates via CSS grid-rows, width via a JS FLIP tween (280 ms).
- Sliders (id: range -> meaning, default):
  - `s-warp` log 0..9 -> time warp 1x..1e9x (default 1x)
  - `s-g` 0..3 -> gravity multiplier (1)
  - `s-psize` log 0..2.7 -> planet visual size 1x..500x (1x, "real")
  - `s-shipg` log -1.5..2 -> ship max speed in multiples of c (default 0.05 c; reached in 10 s)
  - `s-bloom` 0..2.5 (0.06), `s-exposure` 0.5..2 (1.43), `s-contrast` 0.9..1.35 (1.075),
    `s-sat` 0.4..1.6 (1.07), `s-grain` 0..2.5 (1), `s-vig` 0..2 (1)
- Checkboxes: relativistic c-limit (off), orbit trails (on), labels (on). Buttons: realistic
  defaults reset, "Ship -> Earth orbit", music play/pause, next track. Focus dropdown
  (Starship, all bodies, all stations, Andromeda).
- **Toast** system (top-centre, amber, auto-fade) for all game messaging.
- Panel inputs blur back to the helm after use so keys keep flying the ship.

### 8.4 Keyboard map (complete)
| Key | Action |
|---|---|
| W/S, ArrowUp/Down | pitch |
| A/D, ArrowLeft/Right | yaw |
| Q / E | roll |
| Space (hold) | thrust (release = auto retro-brake) |
| X | coast / abort autopilot |
| J | Andromeda jump autopilot (100,000 g) |
| H | autopilot home to Earth |
| F | focus ship |
| 1..9, 0 | focus Sun..Pluto |
| Shift + 1..0 / Shift+click label | beam ship there |
| hold LMB | steer (pointer lock) |
| RMB drag / wheel | camera height / zoom |
| M | music toggle |
| G (hold) | fire lasers (battle) |
| T | fire photon torpedo (battle) |
| R | cycle target lock (battle) |
| Backquote (`) | toggle editor mode |
| Esc | back to title / stand down |

---

## 9. Battle Mode (combat.js)

### 9.1 Lifecycle
- `combat.setEnabled(true)` (via Battle Mode button): resets kills/wave/HP, arms combat music,
  plays a klaxon, toasts
  `BATTLE MODE · impulse limited to 20% · G lasers · T torpedo · R target · Esc stand down`.
  2 s initial invulnerability; first wave after 2.5 s.
- `setEnabled(false)` (Esc): removes raiders and their labels, releases drafted ships back to
  rails, clears torpedoes/beams/fx (pooled pieces recycled), stops combat music, toasts stand-down.
  A pending death hold is cancelled and HP restored.
- **Impulse limiter**: while combat is enabled, main.js passes `shipG * 0.2` into the helm,
  so max speed AND thrust acceleration drop to 20% and restore instantly on exit.

### 9.2 Enemies & waves
- Wave n spawns `min(2 + n, 7)` raiders at 90..160 km, velocity near the player's,
  HP `50 + 6n`, acceleration 1.3 km/s^2. Names `Raider A-1, B-1, ...` with red labels.
- Raiders are dark repaints of the warship GLB (`raider: true` -> raiderPaint; materials are
  cloned before recolouring so the Federation ships keep their livery), length 0.18 km.
- **Raiders target ONLY the player** (design decision: no escort AI fights for you).
- AI behaviour: free-flight agents in the physics frame on wall-clock dt (a local combat bubble
  that ignores gravity). They chase with acceleration, jink evasively (randomized 2D noise
  refreshed on a timer), keep firing cadence cooldowns (`cLaser` 1..2 s initial, `cTorp` 6..12 s),
  and lead their shots. Fed-side agents exist in code (drafting machinery kept) but no escorts
  are spawned in the current design; the `pending` list stays empty.
- Wave cleared -> toast + next wave in 9 s.

### 9.3 Player weapons
- **Lasers** (`G` hold): light-speed hitscan (instant at combat ranges), needs the target
  inside a nose cone (`cos >= 0.86`) and within **12 km**; cooldown 0.32 s; damage 9.
  Dry-fire beams still render along the nose when no solution (feedback). Reticle turns hot
  when the solution is valid.
- **Photon torpedoes** (`T`): homing projectiles, launch speed 7 km/s + 5 km/s^2 guidance
  acceleration (relative closing speed capped 12 km/s), proximity fuse 0.3 km, life 18 s,
  cooldown 2.6 s, range gate 45 km ("Target out of torpedo range" toast), damage 34
  (30 against the player from enemy torps).
- **Target lock**: auto-acquires the nearest raider within **90 km**; `R` cycles targets;
  lock box UI with name, distance, HP%; lock beep SFX; torpedoes home on the lock.
- AI lasers: range 10.5 km, cooldown 1.15 s (foe) / 0.85 s (fed), damage 6/7.

### 9.4 Damage model
- Player HP **120**. Hits flash a red radial vignette (`#dmg`, decays 1.7/s) and thud.
- Hit-confirm SFX when the player's shot lands. Kills increment the HUD counter.
- **Player death sequence**: at HP <= 0, a big explosion (r 3.0, fire 1.9 s) erupts on the
  ship, `deathT = 1.35 s` holds the camera on the burning wreck (invulnerable 9 s), THEN the
  emergency beam-out fires: ship reset to Earth orbit, arrival fly-in, toast
  `Hull breached – emergency beam-out to Earth orbit`, HP restored.
- Raider kill: explosion r 1.35 / 1.15 s. A destroyed drafted fed would break off and warp
  clear (toast) rather than die.

### 9.5 Beams (laser rendering)
Unit-box mesh stretched a->b (thickness 0.012 km), additive HDR colour, life 0.13 s, pooled.
Endpoints are **absolute physics coordinates** (a beam does NOT follow the ship after firing).
Beams passing within 0.25 km of the camera fade out (a 40 m glow at arm's length would fill
the screen); the distance test is point-segment vs the CAMERA, not the focus origin.

### 9.6 Explosion kit (fully procedural, zero texture files)
Trigger: `boom(pos, r, dur, cold=false)`. `r < 0.5` = cheap spark (two additive HDR spheres,
used for laser impacts). `r >= 0.5` = the full kit; `cold=true` is the blue "warp flash"
variant (used for warp-ins: no smoke, no debris).

Layers (all pooled and recycled; fx record carries `durF` = fire phase and
`dur = durF * 1.9` total for warm blasts, so smoke outlives fire):
1. **Flipbook fireball**: 6x6 atlas (36 frames, 160 px each) generated once on a canvas:
   26 seeded turbulence blobs fly radially outward while a white-hot core cools; colour ramp
   white (255,255,244) -> amber (255,228,140) -> orange (255,158,54) -> ember (219,84,28) ->
   deep red (122,32,14) -> near-black; drawn with `lighter` compositing; frames fade out over
   the last 38% so the additive sprite needs no separate fade. Billboarded sprite, random
   rotation per boom, tint `EXPLO_WARM (1.35,1.18,1.02)` or `EXPLO_COLD (0.55,0.85,1.7)`,
   scale `r * (2.2 + 1.1 * easeOut(k))` (the ball swells as it burns).
   The atlas texture is cloned per pooled sprite (each drives its own `map.offset` frame).
2. **Birth flash**: soft-disc sprite, HDR tint (3.4,3.0,2.5) warm / (2,2.6,4) cold, scale
   `r * (0.7 + 2.0k)`, opacity `(1-k)^1.8 * 0.85`, gone within 14% of the fire phase.
3. **Light pulse**: pooled `PointLight`, colour 0xffb469 warm / 0x88bbff cold, intensity
   `26 * r^2 * (1-k)^2.4`, physical decay 2: it visibly licks nearby hulls and sells the blast.
4. **Shockwave ring**: billboarded ring mesh (HDR orange or ice blue), fast expand
   `r * (0.3 + 3.6 * easeOut)`, hard fade `(1-k)^2.2 * 0.85`.
5. **Embers**: 22 small HDR spheres flung on random directions, speed `r * (0.9..3.5) km/s`
   with drag (`distance = sp * (1 - e^{-1.7t}) / 1.7`), they outlive the fire slightly
   (their own clock `kE = t / (1.3 durF)`; scale and opacity run on kE, NOT on the fire clock).
6. **Smoke pall** (warm blasts only): 3 NORMAL-blended (this is the point: dark smoke cannot be
   additive) soft-puff sprites, colour ~(0.085,0.085,0.098), drifting outward and slowly
   rotating, blooming after 30% of the fire phase, peak opacity 0.58, expanding
   `r * sc * (1.3 + 2.6 ks)`, gone at the end of the 1.9x window.
7. **Debris** (warm only): 8 tumbling tetrahedra, size `r * (0.012..0.032)` (deliberately
   small: bigger reads as black paper), random spin, speed with drag, colour lerps from
   fire-lit ochre (0.51,0.31,0.19) to wreck-dark (0.06,0.06,0.07) as the fire dies, fading
   out over the last 30% of the total window.

Sound: `sfx.boom(volume, big)` accompanies; volume attenuated by distance.

### 9.7 Radar (bottom-right, circular canvas, combat only)
- 150 km range, nose-up projection (targets rotated into ship frame), foes red / friends cyan,
  own ship centre; range rings at 50/100/150 km + crosshair.
- **Hull-integrity arc on the rim**: full circle = 100%, depletes clockwise, colour shifts
  cyan -> amber -> red with HP.

### 9.8 Combat music coupling
Every 0.35 s the nearest-raider distance maps to the Red Alert layer level:
`level = clamp((130 - d) / 80, 0, 1)` (fades in from 130 km, full at 50 km). See §10.

---

## 10. Audio

Two independent WebAudio graphs: the music engine (`music.js`) and SFX (`sfx.js`).
Everything is synthesized live; the repo ships **zero audio files**.

### 10.1 Music engine
- Master bus with a soft compressor/reverb chain (`buildMaster`); per-track scheduling of note
  data (`scheduleTrack`), self-rearming loop timers, seamless loop crossover (schedules ahead;
  old nodes disconnected after fade).
- **Voice types**: `drone` (detuned saw pad, very slow), `pad` (filtered saws with LFO),
  `bass` (sub sine w/ envelope), `bell` (FM-ish decaying sine partials), `perc` (filtered noise
  hit; the MIDI note tunes the bandpass so one voice covers kick/snare/hat), `brass` (sawtooth
  fanfare stab with fast attack). All voices accept `[startBeat, durBeats, midi, velocity]`.
- **Ambient rotation** (Free Mode soundtrack), composed as note data (originally via
  claude-sonnet-5 through OpenRouter, stored verbatim in `music_tracks.js`):
  1. "Deep Field Drift" (46 bpm, 96 beats)
  2. "Dawnlight Over the Rim" (52 bpm, 96 beats)
  3. "Drift Among Distant Moons" (50 bpm, 96 beats)
  The rotation auto-advances; the panel shows the title and offers pause/next.
- **Aux layers** (own gain buses crossfaded OVER the ambient bed, which ducks by
  `1 - 0.75 * max(layerLevels)`):
  - **"Red Alert"** (combat flag): 132 bpm military march, kick/snare/hat via `perc`, brass
    stabs, driving bass; level driven by threat distance (§9.8).
  - **"Starblazer Theme"** (titleTrack flag): 84 bpm military bugle theme; level 1 while the
    title screen is up, 0 in game.
  - Both flagged tracks are excluded from the ambient rotation (`_nextIdx` skips them;
    note the flag is `titleTrack`, NOT `title`, which is the track-name field).

### 10.2 SFX inventory (synthesized, try/catch-guarded, own AudioContext)
| Name | Design |
|---|---|
| `laser` | sharp descending saw zap 1500->180 Hz doubled by a square an octave down |
| `torp` | rising band-passed noise whoosh (220->1400 Hz) over a sinking sine sub |
| `boom(v, big)` | noise through a falling lowpass (1800/1300 -> 65 Hz) + sub sine thump; big = 1.1 s |
| `hit` | dull metallic thud (lowpassed noise + falling triangle) when the player is hit |
| `impact` | crisp bright zap-thwack (bandpass noise 2600->650 + square) = your shot landed |
| `lock` | two quick sine blips (880, 1318 Hz) |
| `warp` | shimmering 3-voice detuned sweep 240->1500 Hz |
| `alert` | two-tone sawtooth klaxon (392->587 Hz, twice) |
| `engine(v)` | continuous bed: resonant band-passed noise roar (HP 130 Hz, LP 700+1500v Q3.5) + detuned saw thrum pair at ~108 Hz + 62 Hz sub pair; gains 0.34/0.11/0.15 · v |

**Engine bed envelope** (main.js): keyed to HOW LONG thrust is held, not throttle:
`env += dt/1.8` while Space or autopilot burns, `env -= dt/1.1` on release (clamped 0..1),
`sfx.engine(env)` every frame. Spool-up uses tau 0.1 s, spool-down 0.4 s inside the synth.

### 10.3 Autoplay policy handling
- `music.start()` runs right at boot (after `showTitle()`): browsers that trust the site
  (media engagement) start the title theme instantly on page load.
- If blocked, the context sits suspended with the track scheduled from t=0 (loop timers advance
  safely against the frozen clock; playback starts from the top on resume). The FIRST
  pointerdown/keydown anywhere resumes it (capture-phase one-shot listeners; they must handle
  the "context exists but suspended" case, not only "no context yet").
- A pulsing `#sndHint` ("♪ click anywhere for sound") shows on the title while
  `ctx.state !== 'running'`, wired to the AudioContext `statechange` event.

---

## 11. Editor mode (the live tuning loop)

A discreet in-game parameter inspector used to art-direct the game, then bake results back
into source. Toggle: bottom-centre chip or Backquote. While enabled, clicking any scene label
SELECTS the object for editing instead of focusing it, and LMB steering is disabled.

### 11.1 Panel structure (context-sensitive sections)
1. `Select Starship` shortcut button (its label can't be clicked in flight).
2. **Global · Bloom & Grade** (always): Bloom strength 0..3, Bloom radius 0..2, Bloom
   threshold 0..1, Exposure 0.3..2.5, Contrast 0.9..1.4, Saturation 0.3..1.7,
   Sun light 0..10, Ambient fill 0..0.15.
3. **Planet**: colour pickers for the shader palette `uC1/uC2/uC3` + Atmosphere colour.
   (Sun: hint only; its brightness is the Sun light slider.)
4. **Ship/Station · <name> (N materials)**: Hull colour, Hull emissive, Emissive intensity
   0..6, Metalness 0..1, Roughness 0..1. Structural materials only: glow materials
   (emissive sum > 0.12) are excluded from the hull controls. EXCEPTION: the player ship is
   treated all-structural (its bright hull emissive IS the baked self-illumination, not lights).
5. **Lights · windows & glows** (every NPC ship & station with glow materials):
   - Lights brightness 0..4: a MULTIPLIER over each glow's baked intensity (base cached once
     in `material.userData._eiBase`), so relative window/port/engine ratios are preserved.
   - Lights colour: recolours all glows.
6. **Station · hull detailing** (stations with greeble): Window frequency 2..120, Window
   brightness 0..6, Window sparsity 0..0.98, Panel strength 0..0.6, Window tint (colour).
   Drives the live `_grb` shader uniforms across all greebled materials.
7. **Station · motion**: Spin rate 0..0.1 (writes the fleet object's `spin`).
8. **Starship · self-light & exhaust** (player only): Ship-light glow 0..5, Fill light 0..2,
   Fill light colour, Exhaust brightness 0..2.5, Exhaust tint.
9. **Readout** textarea + copy button.

### 11.2 Readout format (the bake contract)
```
GLOBAL bloom.strength=0.06 radius=0.58 threshold=0.87 exposure=1.43 contrast=1.075 saturation=1.07 sunLight=0.60 ambient=0.115
<Name> hull=#697696 emissive=#141000 emissiveIntensity=0.50 metalness=0.55 roughness=0.10 [lights=3.70] [lightsColour=#c7c2a3]
<Name> detail winFreq=98.0 winBright=6.00 winSparsity=0.97 panel=0.24 winTint=#ffdca8 spin=0.008
Starship shipGlow=1.20 fillLight=1.80 fillColour=#414044 exhaustBright=0.36 exhaustTint=#d8e7f3
<Planet> c1=#01020f c2=#688d6c c3=#869aa6 atmosphere=#262a2e
```
- `lightsColour` is emitted only when ALL glows share one colour (mixed-glow objects omit it
  so a bake can't flatten them).
- **Colour-space rule (critical)**: readout hex values are **sRGB** (`Color.getHexString()`),
  which round-trips 1:1 into source as `new THREE.Color(0xRRGGBB)` / `setHex(0x...)`.
  Never emit linear component values; baking those would double-convert and darken everything.

### 11.3 Bake targets (where each readout line lands in source)
- GLOBAL -> scene.js (`toneMappingExposure`, UnrealBloom radius/threshold, FilmLook uSat/uCon),
  main.js `LOOK_DEF`, index.html slider defaults, bodies3d.js (sun light, ambient).
- Planet colours -> data.js palette entries; atmosphere -> bodies3d ATMO map.
- Starship -> models.js `playerPaint` + ship3d.js (`selfGlow`, `selfLit`, `exhaustMul`,
  `exhaustColor`).
- Stations -> fleet.js `STATION_LOOK` / `STATION_GREEBLE` (shared identity) or a per-station
  `paintStation`/`paintObject` spec; spin -> the `addOrbiter` argument.

---

## 12. Debug & test harness

- `window.__dbg = { stage, sim, system, shipView, sky, fleet, music, combat, editor, keys,
  renderTest, applyFocus, beamToName, tick }` where `tick(t)` runs one full frame body with an
  explicit timestamp (drives sim, fleet, combat, render).
- **Hidden-tab behaviour**: rAF freezes when `document.hidden`; a 1 Hz setInterval fallback
  keeps the sim alive. For deterministic testing, drive `d.tick(base + i*16)` manually.
- **Freeze-frame capture technique** (headless verification): run ticks and
  `renderer.domElement.toDataURL()` in the SAME JS task, burn the frames into DOM `<img>`
  overlays, then screenshot. Needed because live ticks overwrite the canvas between tool calls.
- **Drift trap**: the first manual tick after idle consumes a huge wall-clock dt (the ship can
  advance km), so any effect spawned at an absolute position beforehand ends up off-screen.
  Fix in tests: one settle tick first, then zero `sim.ship.vel` while capturing.
- `renderTest(seconds, trackIdx)` renders music offline and reports RMS (audio verification).
- **WebGL traps on ANGLE/Metal (Apple Silicon)**, all encountered for real:
  1. `normalize()` on positions > ~1e19 overflows float32 (length^2 > 3.4e38): direction
     collapses to 0. Pre-scale varyings (e.g. by 1e-15).
  2. `pow(base, non-integer)` NaNs the whole fragment if fast-math nudges base negative:
     always `max(base, 0.0) + eps`. Same for `normalize(a+b)` of near-antiparallel vectors.
  3. Diagnostic signature: a single NaN texel smears through UnrealBloom's downsample into a
     large flickering BLACK SQUARE. "Black rectangle flickers" = NaN somewhere bright.
  4. Reversed `smoothstep(hi, lo, x)` is undefined per spec: write `1.0 - smoothstep(lo, hi, x)`.

---

## 13. Assets & credits

- **R2 bucket** `sunsystem-assets`, public base
  `https://pub-71534651969246d597a0c1bf543eff8c.r2.dev` (`ASSET_BASE` in models.js):
  `models/*.glb` + progressive 8K Earth `textures/`.
- GLB models (all optimized `gltf-transform optimize --compress meshopt --texture-compress webp
  --texture-size 1024`; sources kept locally in `models_src/`, gitignored):

| In-game | Asset | Source | License |
|---|---|---|---|
| Player ship | Valkyrie | BabylonJS Space Pirates | Apache-2.0 |
| Warships & raiders | Raider | BabylonJS Space Pirates | Apache-2.0 |
| Freighters | carrier01 | Viktor Hahn / OpenGameArt | CC BY 3.0 |
| Hauler | carrier03 | Viktor Hahn / OpenGameArt | CC BY 3.0 |
| Scouts | frigate01 | Viktor Hahn / OpenGameArt | CC BY 3.0 |
| ISS | ISS (D) | NASA 3D Resources | Public domain |
| Lunar Gateway | Gateway Core | NASA 3D Resources | Public domain |
| Shuttle Galileo | Discovery scan | Smithsonian | CC0 |

- Earth/Moon textures: Solar System Scope (CC BY 4.0), local 2k in `textures/`.
- SpacePirates models: strip the `lambert1` hull shell mesh on import (double-shell artifact).
- GLB normalization: `loadInto(fallbackMesh, 'name.glb', { lengthKm, yaw/pitch/roll, blinkers,
  onLoaded })` swaps the GLB over a procedural fallback once loaded; noses normalized to -Z
  (rotation order 'ZYX'); the Smithsonian shuttle arrives in launch pose (nose -Y, belly -Z:
  pitch PI/2 + roll PI).

---

## 14. Build, deploy & operations

- **Live**: https://starblazer.pages.dev (Cloudflare Pages project `starblazer`).
  The old URL https://sunsystem-auk.pages.dev (project `sunsystem`) serves only a redirect page
  (meta refresh + `location.replace` preserving path/query). Never deploy game content there.
- **Deploy procedure** (after EVERY iteration, per project rule):
  1. `./bump-version.sh <n+1>`
  2. `git commit`
  3. `rsync -a --delete --exclude '.git' --exclude 'models_src' --exclude '.wrangler'
     --exclude '.DS_Store' ./ /tmp/pages-deploy/`
  4. `npx wrangler pages deploy /tmp/pages-deploy --project-name starblazer --branch main
     --commit-dirty=true`
  5. `git push` (GitHub `forleey/sunsystem` is source backup ONLY; GitHub Pages is disabled)
  6. Verify: `curl https://starblazer.pages.dev/` shows the new `main.js?v=N`
     (root URL, NOT /index.html which 308-redirects; edge cache may lag ~30 s).
- **Local dev**: any static server, e.g. `python3 -m http.server 8643`.
- Large binaries (models/8K textures) live on R2, NOT in git.

---

## 15. Tuning constants appendix (quick reference)

```
Camera: fov 55, near 1e-3, far 2e20, chase 0.28..0.5 km, elevation -0.45..1.35 rad
Grade:  exposure 1.43 · bloom 0.06/0.58/0.87 (strength/radius/threshold) · sat 1.07 · con 1.075
Lights: sun PointLight 0xfff2dd @ 0.60 · ambient 0x32404f @ 0.115
Helm:   ACC 6.5, MAX 1.7, DAMP 7.0 · pitch/yaw 0.5x rate, roll 1x (applied 1.2x)
        mouse steer K 0.0035 rad/px · thrust reaches slider max-speed in 10 s
Ship:   playerPaint hull 0x000000 / emissive 0xe6e6e6 / metal 0.2 / rough 0.56
        selfGlow 1.2 · selfLit 0x414044 @ 1.8 (d 0.5, decay 2)
        exhaustMul 0.36 · exhaustColor 0xd8e7f3 · glow lag 6 up / 2.2 down
Stations: STATION_LOOK hull 0x697696 / emissive 0x141000 @ 0.50 / metal 0.55 / rough 0.10 /
          glow x3.70 / glowColor 0xc7c2a3
          STATION_GREEBLE winFreq 98 / winBright 6.0 / winDensity 0.97 / winTint 0xffdca8
          greeble defaults freq 42 / strength 0.24 / ringR 1.8 (toroidal ring windows)
Combat: LASER  range 12, cone cos 0.86, cd 0.32 s, dmg 9
        AI_LASER range 10.5, cd 1.15 foe / 0.85 fed, dmg 6 / 7
        TORP   speed 7, accel 5, relMax 12, fuse 0.3, life 18 s, cd 2.6, range 45, dmg 34/30
        LOCK_RANGE 90 km · RADAR 150 km · PLAYER_HP 120
        waves min(2+n, 7) raiders @ 90..160 km, hp 50+6n, acc 1.3 · first 2.5 s, next +9 s
        impulse limiter x0.2 · death hold 1.35 s · spawn invuln 2 s, death invuln 9 s
Explosions: kit threshold r >= 0.5 · smoke window 1.9x fire · light 26 r^2 (1-k)^2.4
        raider kill r 1.35 / 1.15 s · player death r 3.0 / 1.9 s · warp flash r 0.5 cold
Music:  ambient 46/52/50 bpm · Red Alert 132 bpm (threat fade 130->50 km, poll 0.35 s)
        Starblazer Theme 84 bpm · duck ambient 1 - 0.75*layer
Engine SFX: hold envelope +dt/1.8 / -dt/1.1 · noise roar HP130/LP700+1500v Q3.5 ·
        saw thrum 108 Hz (detune 11) · sub 62 Hz (detune 9) · gains 0.34/0.11/0.15
Autopilot: J 100,000 g, arriveR 6e16 km · spawn orbit Earth 20,000 km · arrival fly-in 10 s
```

---

## 16. Known simplifications & non-features

- The Milky Way skybox does not parallax during the Andromeda trip (home galaxy stays fixed).
- Stations ride ideal circular orbits; no orbital decay/stationkeeping simulation.
- The combat bubble ignores gravity for agents/torpedoes (wall-clock dt, local frame).
- No persistence beyond the look grade (no save games, no score history).
- No mobile/touch controls; desktop keyboard + mouse only.
- Collision detection exists only implicitly (no ship-vs-hull collisions; explosions are
  scripted at object positions).
- Single player, no networking.

---

## 17. Acceptance checklist (for a re-implementation)

A faithful port passes when:
1. Boot lands on the STARBLAZER title over a live scene, ship visible from astern, theme
   playing (or the sound hint pulsing when autoplay is blocked, gone after the first click).
2. Free Mode: Earth fills the frame top-right at spawn; Space accelerates to exactly the
   slider speed in 10 s; releasing Space brakes to local rest; X coasts; J reaches Andromeda
   in ~1 min wall time with warp auto-ramp and returns via H.
3. Warp 1e9x keeps every station/lane/patrol glued to its rail (no drift, no jitter).
4. All six painted stations wear the identical STATION_LOOK; K-7 stays white with warm window
   canyons; the ring stations' windows follow the torus curvature in neat rows.
5. Battle Mode: toast announces the 20% impulse limiter and the measured max speed is exactly
   20% of the slider value; waves scale 3,4,5,6,7; lasers only fire with a valid cone+range
   solution; torpedoes home and fuse; the radar rim depletes with hull damage.
6. Raider kills produce the full explosion (flash, swelling fireball with the white->ember
   ramp, light pulse visible on nearby hulls, ring, embers, lingering dark smoke, tumbling
   debris); player death holds ~1.35 s on the burning wreck before the beam-out toast.
7. The editor round-trips: any readout line pasted back and baked reproduces the on-screen
   look exactly (sRGB hex rule), and Lights multipliers do not compound on shared materials.
8. No console errors; no flickering black squares (NaN check) anywhere near bright shaders.
