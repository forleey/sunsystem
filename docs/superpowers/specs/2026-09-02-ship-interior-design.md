# Ship Interior: a lived-in freighter deck with a real view of space

**Date:** 2026-09-02
**Status:** Draft for Konrad's review
**Target:** starblazer-web (Three.js 0.170, ES modules, no build step, Cloudflare Pages + R2)
**Related:** `SPEC.md` (world contract, gets a new section 6.5 when this ships); the Unity port's seven interior attempts of July 2026, whose lessons this design is built on

## 1. What this is for

Konrad's brief, in his words: the interior should feel like the inside of Han Solo's ship, with an observation cupola from which you see the *real* universe of the game outside, not a copy of it. The Unity port tried seven times in July and he was never satisfied. He wants it built in the web game now, and done right this time.

"Right" means, concretely:

1. **The view is the game.** Standing under the cupola you see the Earth the ship is actually orbiting, the sun that is actually lighting the hull, Cronos station, the traffic freighters, a raider wave if one is inbound. Move your head, and the view moves with correct parallax. No render texture, no second Earth, no "stars-only" sky through a window. Ever.
2. **It reads as a ship that has flown too long.** Grey-white panels with scuffs, floor grating with conduits visible beneath, exposed pipework and cable runs in the ceiling, warm amber practicals, big analogue switches, a round table with a curved bench, a cockpit with a multi-pane window, a ladder up into a glass bubble. Used, not derelict. Nothing clean, nothing cream, nothing cartoon.
3. **You can walk it** with mouse and keyboard without snagging or falling through, and the whole deck takes two to three minutes to explore.
4. **Every milestone is looked at**, in the running page, before the next one starts. The failures in Unity were never checked on the real target.

Not a goal now: flying from the cockpit seat (section 12), touch controls for the interior, NPCs, story, sound beyond an engine hum.

## 2. What the Unity attempts taught

Seven versions in three days (v1 tube, v2 Doom 3, v3 dark and dirty, v4 cream Pixar, v5/v6 four zones with a render-texture window, v7 back to a box with an Earth-textured sphere in front of a porthole, then a subway car with an Apollo capsule bolted on). Three structural causes, all avoidable here:

- **The interior could not see space by construction.** Built at 1 unit = 1 m, parked 50,000 km below the ship in a 1 unit = 1 km world, behind a camera that clipped at 3,000 units. A real window was arithmetically impossible, so every attempt became a render texture or a replica. This design keeps the two scales but couples them through the cameras, so the space camera really stands where the player's eye is.
- **The "live" window was a poster.** The portal camera was moved to a cinematic distance from Earth with a fixed field of view. No parallax, no dependence on where you stood. Here the window is an absence of interior geometry; the real space render fills it.
- **The look was chased through references with programmer art**, then patched with a commuter subway car. Here the deck is derived from the hull we have (section 5), with photoscanned surfaces and props (section 8).

Process lesson: every milestone ends with a screenshot of the running page and a self-test line, both taken by the agent, not promised.

## 3. Decisions

| Topic | Decision | Why |
|---|---|---|
| Target | `starblazer-web`, desktop first (mouse + keyboard). | Konrad's call of 2026-09-02. Touch walk controls come later. |
| Interior scale | A separate `THREE.Scene` at 1 unit = 1 m. | Human-scale geometry, lights and shadows at sensible numbers; the km world is untouched. |
| Where it lives | Inside the hull, at the ship's true position, through a two-scale two-pass render (section 4). | Removes the Unity cause 1. The space code does not change. |
| The window | An absence of interior geometry. Whatever the space pass renders is what you see. | Correct parallax, lighting and content for free. |
| Exterior counterpart | Procedural glass cupola and cockpit canopy added to the hull group at km scale, at exactly the interior apertures. | From the chase cam the ship shows the windows the player looks out of. |
| Art direction | One original "used freighter" language (section 7). No Star Wars assets or names in the code or the page. | Shippable, and derived from this hull. |
| Fidelity | Procedural shell with two photoscanned PBR trim sheets, plus photoscanned CC0 props for pipes, cables, ducts, switch boxes, lamps, crates. Low-poly kits for blocking only, never shipped. | The detail Konrad asked for in July, from sources that download without a login. |
| Collision | Hand-rolled capsule against a list of axis-aligned boxes (the invisible shell); doorways are gaps between boxes. | No physics engine, and the one thing Unity got right (v7). |
| Focus rule | Boarding forces `focusName = 'Starship'` and restores the previous focus on exit. | The ship must sit at the render origin for the coupling to be exact. |
| Assets and delivery | Props and trim sheets on R2 (`sunsystem-assets`), meshopt + WebP, lazy-loaded on first boarding; nothing big in git. | Project rule (`SPEC.md` §17). |
| Authoring | Code-first, like the rest of the game; `SPEC.md` gains a section when the feature lands. | Project rule. |

## 4. The window mechanism: two scenes, two passes, one composer

This is the heart of the design. Everything else is dressing.

### 4.1 Principle

While boarded, each frame renders two scenes through the existing `EffectComposer`:

1. `RenderPass(spaceScene, spaceCamera)` as today: sky, sun, planets, stations, traffic, combat, the hull.
2. `RenderPass(interiorScene, interiorCamera)` with `clear = false` and `clearDepth = true`: the deck is drawn on top; where the deck has no geometry, the space image stays.
3. Bloom, OutputPass, FXAA, FilmLook once, on the combined image, as today.

`renderer.logarithmicDepthBuffer` is a renderer flag and applies to both passes; because depth is cleared between them, the metre scene and the kilometre scene never share a depth buffer. The interior camera uses near 0.03 m and far 120 m.

### 4.2 Pose coupling

The interior scene never rotates (gravity is always down inside). The player walks in the interior frame. After the walk update, every frame:

```
P_m, R  = interior camera position (m) and quaternion in the interior frame
D       = deck anchor in ship-local km (constant, HullFrame)
q       = shipView.quat

spaceCamera.position   = q * (D + P_m * 0.001)     // ship group sits at the origin
spaceCamera.quaternion = q * R
spaceCamera.up         = q * (0,1,0)
```

`js/main.js` already positions the camera absolutely every frame in ship-local terms on the title screen (`.applyQuaternion(shipView.quat)`), so this is the same pattern with a different offset. When the ship pitches or rolls, the view through every window rotates while the deck stays level: what a crew member in a ship with artificial gravity would see, and the feeling of "the ship is really flying".

Hull-frame to ship-local: `js/models.js` normalises `player.glb` with `yaw = Math.PI`, so the GLB's nose (+Z) points to render −Z and X is mirrored. A point (x, y, z) in the hull frame of section 5 is (−x, y, −z) in `shipView.grp` local space. `HullFrame` does this conversion once.

### 4.3 Camera parameters

| | Space camera (existing) | Interior camera (new) |
|---|---|---|
| Near / far | 1e-3 km / 2e20 km, unchanged | 0.03 m / 120 m |
| FOV | set to the interior FOV (68°) while boarded, restored on exit | 68° |
| Scene | `spaceScene` | `interiorScene` |
| Layers | as today, plus `HullGlass` layer disabled while boarded | default |

The space near plane of 1 m does not matter from inside: the only exterior geometry closer than that is the hull's own skin, and from inside its faces are back faces (culled). The hull parts you should see through a window (the wing beside the cupola, the engine humps aft) are 10 to 50 m away.

### 4.4 What must be handled in the space scene while boarded

- `focusName` forced to `'Starship'` (section 3). `applyFocus` and the dropdown are locked while boarded.
- `controls` (OrbitControls) stay disabled, as in ship view today.
- `HullGlass` (section 7.3) hidden from the space camera while boarded (a `THREE.Layers` bit), shown outside.
- Exhaust sprites and the engine lamp are children of `shipView.grp` with `depthWrite: false`: they render in the space pass and are covered by the deck in the interior pass, and are correctly visible aft of the cupola. Nothing to do.
- `selfLit` (the fill point light inside the hull, `js/ship3d.js`) belongs to the space scene and cannot reach the interior scene. Nothing to do.
- Combat's beam fade within 0.25 km of the camera: outgoing bolts start beyond the hull; no change.
- `sizeMult` (planet size slider) is forced to 1 while boarded; the view is only truthful at real sizes.
- The reticle, HUD, labels and radar are hidden (CSS class `boarded` on `body`, like `title`), and the per-frame DOM writes are skipped, as they already are on the title screen.

### 4.5 Alternatives considered

- **Build the interior in km inside the space scene, one camera.** Rendering would work with the log depth buffer, but every tolerance in the walk code would be 1e-4 units, and every interior material would inherit the global `hardenDirectLighting` patch and the 0.012 environment. Two scenes are cleaner. Rejected.
- **Render-texture portal per window** (the Unity v4 approach, fixed). A second full space render per window, resolution-limited, and still a picture on a quad. Rejected.
- **Skybox plus an Earth billboard.** The definition of "Nachbildung". Rejected by the brief.

### 4.6 Risks and how Milestone 0 retires them

| Risk | Mitigation |
|---|---|
| The second `RenderPass` with `clearDepth` leaves space pixels inside seams | The box shell is watertight by construction; the spike's self-test points the camera at a wall and counts sky-coloured pixels (read back from the composer's target) and expects zero. |
| Bloom and FilmLook blow out interior lamps or crush the deck | Materials are dark to mid grey; lamps sit above the bloom threshold on purpose; the spike takes screenshots with the sun ahead and behind. |
| Frame cost of a second pass with 200k triangles | Desktop WebGL handles it; measured with `__dbg.perf()` in the spike; the title-screen DPR trick already exists if needed. |
| Log depth and the interior's 0.03 m near plane | Log depth is scale-free; the spike checks a 5 mm panel step for z-fighting at 0.5 m. |

## 5. Where it fits: the hull

Measured with `tools/hullprobe.mjs` on `models_src/hero/valkyrie.glb` (longest axis normalised to 110 m, as `loadModel` does). Coordinates are hull-centred, nose +Z, up +Y (GLB frame; see 4.2 for the render-frame flip).

| Region | Z range | Width (X) | Thickness | Top skin (Y) |
|---|---|---|---|---|
| Aft body (between the engine humps) | −43 to −13 m | ±14 m usable | 13 to 19 m | +7.3 to +7.5, humps at +10 (Z −28, X ±5) |
| Mid body | −13 to +13 m | ±12 m | 12 to 16 m | +4.7 to +8.2 (small dorsal bump at Z −8) |
| Nose | +13 to +45 m | ±6 m tapering | 8 to 13 m | +4 falling to 0 |
| Wing | −45 to −20 m | ±55 m | 4 to 12 m | 0 to +2.5 |

Design consequences:

- **Deck floor at Y −1.5 m, ceiling at Y +3.0 m** through the aft and mid body. Corridors get a 2.6 m clear height, the hold 4.5 m under the exposed structure.
- **Cupola at (X 0, Z −18) on the top skin at Y +7.4.** A flat saddle: two engine humps 2.6 m higher just aft, the dorsal bump forward, the wing spreading to both sides. The view from the bubble has the ship in it, which is what makes it *this* ship's cupola rather than a planetarium. Reached by a **4.4 m vertical well** with a ladder from the hold ceiling (+3.0) to the cupola ring (+7.4).
- **Cockpit at Z +10 to +18, floor Y −1.0, window sill +2.2.** The forward taper narrows the room naturally to 5 m wide. The exterior gets a five-pane canopy patch here; the Valkyrie mesh has none.
- **Engineering aft at Z −40 to −30**, under the humps: the tallest space on the deck, for the drive core.

## 6. Lighting and grade

The interior scene has its own lights; nothing from the space scene reaches it, and nothing from it reaches space. That alone removes the Unity v4 blow-out.

1. **`CupolaSun`**: a `DirectionalLight` in the interior scene whose direction is the real sun direction rotated into the interior frame (`q⁻¹ * (sunPos − shipPos)`), intensity = 3.0 × a visibility factor (1 when the sun is above the cupola's local horizon, 0 when the hull shadows it, smooth over 15°), `castShadow = true` with a 6 × 6 m orthographic shadow frustum aimed down the well, 1024² map. The frames of the seven panes throw moving shadows down the well as the ship rolls. One small shadow map; cheap.
2. **Earthshine**: a second directional from the Earth direction, blue-grey, intensity from Earth's angular size, capped at 0.25, no shadow. Optional after Milestone 1.
3. **Practicals do the work.** Amber caged lamps, white strip lights under the ceiling ducts, blue-white console glow, a red standby lamp in engineering. Budget: 8 `PointLight`s active (the deck is small; three.js forward lighting is fine at this count), the rest are emissive lamp meshes with small additive halos (the `GLOW_TEX` sprite of `ship3d.js`).
4. **Environment**: a `PMREMGenerator` map from `RoomEnvironment` at intensity 0.35 on `interiorScene.environment`, so brushed metal and glass reflect something. The space scene keeps its 0.012.
5. **Materials are dark to mid grey with low albedo (0.25 to 0.45)**, `MeshStandardMaterial` with the trim sheets. The existing grade (exposure 1.43, bloom threshold 0.87, FilmLook contrast 1.075, vignette) stays as the single look; only lamps, the sun and the drive core bloom.
6. **`hardenDirectLighting()`** (`js/models.js`) patches the shared shader chunk to a 13° terminator for every standard material. Interior materials must opt out: the patch is rewritten to read a `#ifdef HARD_TERMINATOR` define, set through `material.defines` only on ship and station materials (they already pass through `paintStation` / `playerPaint`). No behaviour change outside.
7. **Ambient**: `AmbientLight` 0x1a2028 at 0.15 in the interior scene.

## 7. The deck: layout and art direction

### 7.1 Language

An original design in the "used future" idiom: a working freighter that a small crew has kept flying with whatever parts they could get.

- **Structure**: octagonal corridor sections with exposed ribs every 1.2 m; panels bolted between the ribs, some missing, showing conduit behind.
- **Surfaces**: off-white and warm grey painted steel, chipped at edges (roughness and grime masks), diamond-plate and grating floors over a dark under-deck with visible cable runs, black rubber matting in the hold.
- **Systems on show**: pipes and circular ducts along the ceiling line, cable bundles with junction boxes, a breaker panel with its door hanging open, analogue gauges, big toggle switches with worn labels.
- **Colour accents**: amber practicals, blue-white console glow, a few red and green indicator lamps, one orange hazard stripe per room.
- **Wear**: decals for scuffs, drips, tape repairs, a scorch mark near the drive core, floor wear where people walk. No rust: old, not abandoned.
- **Sound** (minimal, through the existing `sfx.js` context): engine hum keyed to throttle (the `engine()` bed already exists), a fan in engineering, a breaker click.

### 7.2 Rooms

Positions in hull coordinates (X right, Y up, Z nose), sizes in metres. The player enters at the hold.

| Room | Position (Z, X) | Size (L×W×H) | Purpose and what you see |
|---|---|---|---|
| **Main hold** | Z −26 to −14, X ±6 | 12 × 12 × 4.5 | The heart. Curved padded bench around a round table with a slow holographic system map (the game's own body positions from `sim`). Engineering wall aft with pipes and the breaker panel. Ceiling open to structure and ducts. The cupola well rises from the aft-centre of the ceiling. |
| **Cupola well and cupola** | Z −18, X 0 | well 1.8 Ø × 4.4 tall; cupola 3.2 Ø × 1.1 above skin | Ladder in the well, handrail ring at the top, a swivel seat under the bubble. Seven panes: one round on top, six trapezoids around, aluminium frames 8 cm wide. **The real universe outside**, with the wing, the humps and the exhaust glow of your own ship in frame. |
| **Ring corridor** | around the hold, Z −30 to −10, X ±9 to ±12 | 2.4 wide, 2.6 clear | The octagonal ribbed profile, the signature walk. Connects hold, cockpit tunnel, bunks, engineering. Floor grating with lit conduits beneath. |
| **Cockpit tunnel** | Z −10 to +10, X 0 | 20 × 2.2 × 2.4 | Narrow, ribbed, three porthole slits on the starboard side (exterior counterpart patches). Builds anticipation for the cockpit. |
| **Cockpit** | Z +10 to +18, X ±2.5 | 8 × 5 × 3.2 | Four seats (two forward, two aft), console with gauges and switches, overhead panel, five-pane window forward and up. Sitting in the pilot seat sets a seated pose (no flying yet, section 12). |
| **Bunks** | Z −10 to −6, X +7 to +12 | 4 × 5 × 2.6 | Two bunks with curtains, a locker, a small amber lamp. The one warm, soft room. |
| **Engineering** | Z −40 to −30, X ±5 | 10 × 10 × 5.5 | The drive core: a vertical cylinder with a slow-pulsing blue-white ring, gantry grating around it, the loudest hum, the red standby lamp, one panel that sparks now and then. |
| **Airlock** | Z −10 to −7, X −12 to −9 (outboard wall at X −12) | 3 × 3 × 2.6 | Closed outer door with a small round window (another true aperture, side view). Later: EVA. |
| **Under-deck** | everywhere | (crawlspace, not walkable) | Two floor hatches in the corridor open to a lit crawlspace you can look into. Smuggler compartments. |

Walk path: hold → cupola (climb, sit, look) → ring corridor → bunks → engineering → corridor → cockpit tunnel → cockpit (sit) → back. About 140 m of walking, two to three minutes.

### 7.3 The cupola and the exterior glass

Seven-pane faceted design (a real spacecraft form, and the frames cast the shadows of section 6), radius 1.6 m, height 1.1 m above the skin, seat 0.45 m over the well platform at Y +7.4. Panes are `MeshPhysicalMaterial` with `transmission 1`, `roughness 0.05`, a scratch and dust normal map at low strength, drawn after the opaque deck. The frames are dark anodised aluminium with the trim-sheet bolts. A handrail ring at 1.0 m. From the seat, eye height is Y +8.6, 1.2 m above the skin: the two humps aft rise to +10 and are in frame; the whole sky forward and to the sides is open.

`HullGlass` is the exterior counterpart: the same cupola geometry at km scale (radius 0.0016) and the cockpit canopy, added as children of `shipView.grp` (not inside the normalised GLB subtree, so `playerPaint` does not black them out), with a warm emissive disc under the panes so the lit bubble reads from the chase cam on the night side. On a `THREE.Layers` bit the space camera disables while boarded.

## 8. Assets and licences

All sources download with plain `curl`, no login, verified 2026-09-02. Nothing from Sketchfab or Fab.

**Trim sheets and surfaces (CC0)**
- Poly Haven 2K: `metal_plate`, `blue_metal_plate`, `painted_metal_shutter` (ribs), `rubber_tiles` (hold floor), `metal_grate_rusty` (hatches). Pattern `https://dl.polyhaven.org/file/ph-assets/Textures/jpg/2k/<name>/<name>_<map>_2k.jpg`, maps `diff nor_gl rough metal ao`.
- ambientCG 2K-JPG: `MetalPlates015A` (sci-fi panel sheet, the main trim), `Metal027` (black powder-coat, switch panels), `DiamondPlate008C` (tread floor), `MetalWalkway006` (grating), `Metal046B` (greasy dark metal). Pattern `https://ambientcg.com/get?file=<Id>_2K-JPG.zip`.

**Photoscanned props (Poly Haven, CC0, glTF + 2K)**: `modular_industrial_pipes_01`, `modular_electric_cables`, `modular_airduct_circular_01`, `power_box_01`, `vintage_spacecraft_instrument`, `retro_multimeter`, `hanging_industrial_lamp`, `industrial_caged_sconce`, `mounted_fluorescent_lights`, `ceiling_fan`, `old_military_crate`, `plastic_crate_02`, `ammo_box`, `metal_stool_01`, `portable_generator`. Pattern `https://dl.polyhaven.org/file/ph-assets/Models/gltf/2k/<name>/<name>_2k.gltf` plus the files listed by `https://api.polyhaven.com/files/<name>`.

**Pipeline** (`tools/interior_assets.sh`, idempotent): fetch, `gltf-transform` simplify to a per-prop budget and resize textures to 1K, pack roughness/metal/AO, WebP textures, meshopt, one GLB per prop into `models_src/interior/`, uploaded to R2 under `models/interior/` with `wrangler r2 object put`. Trim sheets become 2K WebP sets under `textures/interior/` on R2. Target download on first boarding: under 25 MB, shown with the existing loading pattern (the ship's 6 s fallback timer becomes a small "boarding" progress line).

**Procedural (ours)**: corridor profiles, ribs, panels, floor grating, the hold bench and table, the cupola, the canopy, the drive core, the bunks, seats, the ladder, decals (a small generated set: scuffs, drips, tape, stripes, labels), all in `js/interior/`.

**Budget**: 150 to 250 k triangles, 8 point lights, 1 shadow map, under 25 MB download. `README.md`'s "3D model credits" table gains one row per source.

## 9. Player and interaction

- **Boarding**: key `V` in ship view or a `BOARD` button in the settings panel; `Esc` or `V` leaves. Boarding forces focus to the Starship, hides HUD, labels, reticle, radar and the panels (`body.boarded`), locks the pointer for look, and shows a one-line hint bar (`WASD walk · E use · V leave`). The title screen gets a third mode button, `EXPLORE SHIP`, that starts Free Mode already boarded.
- **Walking**: `WASD`/arrows at 2.7 m/s, mouse look through the existing pointer-lock path (reused, not duplicated), eye height 1.62 m, capsule radius 0.34 m, step height 0.3 m, sticky ground. Collision: capsule against the box list of the deck (`ShellBox`), resolved per axis; doorways are gaps between boxes, never holes in a mesh.
- **Ladder**: an `E` prompt at the foot and the head of the well; 3 s scripted climb along the ladder axis with a small hand-over-hand bob. No free climbing.
- **Seats**: cupola swivel seat and pilot seat; `E` sits (position locked, free look with pitch limits, `E` stands). The cupola seat allows 360° yaw and −20° to +90° pitch.
- **The ship keeps flying**: the sim steps on while boarded. Thrust and steering keys are released to the walk controller; if the autopilot is on, the view changes over minutes; otherwise the ship coasts. Battle mode cannot be started while boarded; a raid in progress continues and can be watched.
- **Touch**: not in this round. The desktop pointer-lock path is what exists today.

## 10. Code architecture

New modules under `js/interior/`, each with one job, imported by `js/main.js` through the usual `?v=NNN` convention:

| Module | Responsibility | Depends on |
|---|---|---|
| `hull_frame.js` | Every number of sections 5 and 7: deck anchor (km, ship-local after the yaw flip), room boxes, cupola and canopy positions, well height. | nothing |
| `rig.js` | Owns `interiorScene`, `interiorCamera`, the second `RenderPass`; `board()` / `leave()` (focus lock, layers, FOV, DOM class, pass insertion); the pose coupling each frame. | `hull_frame`, `scene.js` composer, `shipView` |
| `walk.js` | Input, capsule-vs-boxes collision, ladder and seat states, the `E` prompt. Exposes `drive(input)` for the self-test. | `hull_frame` |
| `lighting.js` | `CupolaSun` tracking and visibility factor, earthshine, practical halos, environment map. | `rig`, `sim` (sun position), `shipView.quat` |
| `deck.js` | Orchestrates the room builders; owns the `ShellBox` list and doorway gaps. | room builders |
| `rooms/hold.js`, `cupola.js`, `corridor.js`, `cockpit.js`, `bunks.js`, `engineering.js`, `airlock.js` | One room each, visuals only, meshes never enter the shell list. Each exposes its openings so the corridor meets them. | `trim.js`, `props.js`, `greeble.js` |
| `trim.js` | Material factory: loads the trim sheets and surface sets from R2, produces `MeshStandardMaterial` variants with grime masks and per-room tint. | `models.js` texture cache |
| `props.js` | Maps prop names to R2 GLBs, loads through the existing `loadModel` cache with a size policy, places instances from a placement table. | `models.js` |
| `greeble.js` (interior) | Ribs, bolted panels, grating, cable clips, generated decals. The existing `js/greeble.js` stays for stations; shared helpers move to `js/greeble_core.js` if they overlap. | `trim.js` |
| `hull_glass.js` | The km-scale cupola and canopy on `shipView.grp`, the layer bit, the night-side emissive disc. | `hull_frame`, `ship3d.js` |
| `selftest.js` | `__dbg.interior.walkTest()`, `windowTest()`, `perf()` (section 11). | `rig`, `walk` |

Edits outside: `js/main.js` (boarding keys, mode button, frame hook, focus lock), `js/scene.js` (expose the composer pass list), `js/models.js` (`HARD_TERMINATOR` define), `index.html` (mode button, hint bar, `body.boarded` CSS), `README.md` credits, `SPEC.md` §6.5.

## 11. Verification

Every milestone ends with screenshots of the running page (Heddle shot service or the offscreen browser, as used for the title-screen work) and self-test lines from `__dbg.interior`, both produced by the agent and pasted into the milestone commit message.

- **`walkTest()`**: drives `walk.js` along the path of 7.2 without real input, climbs, sits in both seats, checks moved/grounded/never-fell/never-stuck, returns `{pass, rooms, climbed, satCupola, satCockpit}` and logs one line `WALKTEST result=PASS …`.
- **`windowTest()`**: seats the player in the cupola, aims at the real Earth direction, renders one frame, reads back the composer target at the projected Earth centre and asserts Earth-coloured (not black, not sky); aims at the hold wall and asserts zero sky-coloured pixels. Logs `WINDOWTEST result=PASS earthSeen=True leaks=0`.
- **`perf()`**: 10 s of the scripted walk, mean and p95 frame time at DPR 1 and 2. Pass: mean ≤ 16.7 ms at DPR 2 on Konrad's MacBook Pro.
- **Deep links** for screenshots: `?board=1&pose=cupola|cockpit|hold|corridor|engineering|bunks|airlock&sun=ahead|behind` put the camera at a fixed pose after boot, so a screenshot set is one loop over URLs.
- **Deploy check**: after each milestone, `bump-version.sh`, deploy, and `curl` the live root for the new version, as for every iteration of this game.

## 12. Later, explicitly out of scope now

- Flying from the pilot seat (the reticle and radar drawn in the canopy, steering while seated). The architecture allows it: the seat pose is just another interior camera pose, and the space camera already follows.
- Touch walk controls (dual virtual sticks).
- EVA through the airlock; NPCs; a quest for the sparking panel.
- Porting the deck to the Unity build.

## 13. Milestones

| # | Deliverable | Acceptance |
|---|---|---|
| **M0 Spike: the window is real** | `rig.js`, `hull_frame.js`, the second pass, focus lock, a bare box hold with a round hole in the ceiling at the cupola position, `hull_glass.js` cupola outside, `V` to board and leave. No dressing, no walk (camera on a fixed rail). | Screenshots show the real Earth and the ship's own humps through the hole, parallax changes along the rail; `WINDOWTEST=PASS`; `perf()` within budget. **Nothing else starts before this passes.** |
| **M1 Shell and walk** | `deck.js`, all eight rooms as shell boxes plus untextured octagonal corridor and room shells, `walk.js` with ladder and seats, spawn, hint bar, mode button. | `WALKTEST=PASS` for the full path; screenshot set of the eight poses. |
| **M2 Surfaces and light** | Asset pipeline, R2 upload, `trim.js`, `greeble.js` ribs and panels, floors, the cupola panes and frames, `lighting.js` with `CupolaSun` shadows and practicals, `HARD_TERMINATOR` opt-out. | Screenshot set; the frame shadow moves in a scripted roll; no blown-out surface. |
| **M3 Cockpit and hold** | Console with gauges and switches, seats, five-pane canopy with exterior counterpart, hold bench and table with the live system map, engineering core. | Screenshot set; hologram follows `sim` in a time-warp test. |
| **M4 Dressing** | Props through `props.js`, decals, wear, cable runs, hatches, bunks, airlock window, sound hum. | Screenshot set; triangle, light and download budget report. |
| **M5 Ship it** | `SPEC.md` §6.5, README credits, deploy, live check. | Konrad walks the deck on starblazer.pages.dev and sits under the cupola with the real Earth outside. |

## 14. Open questions, with the defaults this spec takes

1. **Cupola form**: faceted seven-pane (default, casts frame shadows, real-spacecraft language) or a smooth bubble like a gun turret? One flag in `rooms/cupola.js`.
2. **Deck height**: one deck with a raised cupola well (default) or a second half-deck under the humps for engineering? Default keeps the walk simple.
3. **Sit-and-fly** in this round after all? It would add an M3b about the size of M3.
4. **Sound**: the minimal hum set (default) or nothing until later?

If Konrad says nothing, the defaults stand and M0 starts.
