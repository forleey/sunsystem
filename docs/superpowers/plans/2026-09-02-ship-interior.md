# Ship Interior Implementation Plan (web)

> **For agentic workers:** implement task by task, in order. Every task ends with the named check passing and a screenshot or log line. Do not start a milestone before the previous one's acceptance is in a commit message. Spec: `docs/superpowers/specs/2026-09-02-ship-interior-design.md`.

**Goal:** a walkable, lived-in freighter deck inside the player's hull in the web game, with an observation cupola and a cockpit that look out at the real game universe through a two-scene two-pass render.

**Architecture:** `interiorScene` (metres) rendered by a second `RenderPass` with `clearDepth` after the space pass in the existing composer; `rig.js` couples the space camera to the interior camera each frame; rooms built code-first by `deck.js` on an invisible box shell; capsule-vs-boxes walk; two photoscanned trim sheets and CC0 props from R2; exterior glass counterparts on `shipView.grp`.

**Tech stack:** Three.js 0.170 via import map, ES modules with `?v=NNN`, `bump-version.sh`, Cloudflare Pages + R2, `gltf-transform` for the asset pipeline, Heddle shot service and offscreen browser for verification.

**Conventions:** all numbers in `hull_frame.js`; visual meshes never enter the shell list; no em dashes anywhere; `logDepth()` for any custom shader; assets over a few hundred KB go to R2, never git; after each milestone bump, deploy, live-check, commit and push (standing rule for this game).

---

## M0 Spike: the window is real

- [ ] **0.1 `hull_frame.js`.** Deck anchor in ship-local km (hull frame → render frame: (x, y, z) → (−x, y, −z), then × 0.001), the eight room boxes, cupola and canopy positions, well height. Check: a Node unit script (`tools/hull_frame_check.mjs`) asserts every room lies inside the envelope table of spec §5.
- [ ] **0.2 `rig.js`.** `interiorScene`, `interiorCamera` (68°, 0.03 m, 120 m), `board()`/`leave()`: insert or remove `RenderPass(interiorScene, interiorCamera)` with `clear=false, clearDepth=true` right after the space pass (`scene.js` exposes `composer.passes` insertion), force `focusName='Starship'` and remember the old one, set space camera FOV, toggle `body.boarded`, disable the `HullGlass` layer bit. Pose coupling per spec §4.2 in the frame hook, after `shipView.update`. Check: `__dbg.interior.rig` present; boarding and leaving ten times leaves the pass list and focus as before.
- [ ] **0.3 Bare hold with a hole.** Temporary deck: hold shell boxes and a visual ceiling with a 1.8 m round opening at the cupola position, an unlit grey box interior, one point light. Camera on a fixed rail (`?pose=rail&t=0..1`) below the hole. Check: screenshots at t = 0, 0.5, 1 show the real Earth and the ship's own dorsal deck or wing through the hole with visible parallax.
- [ ] **0.4 `hull_glass.js` cupola.** Km-scale seven-pane cupola on `shipView.grp` at the cupola position (outside the GLB subtree), warm emissive disc, layer bit. Check: chase-cam screenshot shows the bubble on the ridge at Z −18; boarded screenshot does not show it.
- [ ] **0.5 `windowTest()`.** Read back the composer's write buffer (`renderer.readRenderTargetPixels`) at the projected Earth centre and at a wall; assert as spec §11. Check: `WINDOWTEST result=PASS earthSeen=True leaks=0` from the offscreen browser eval.
- [ ] **0.6 `perf()`.** 10 s rail ride, mean and p95 at DPR 1 and 2. Check: mean ≤ 16.7 ms at DPR 2 on the MacBook Pro; if not, report before continuing.
- [ ] **0.7 Space-scene guards.** `sizeMult` forced to 1 while boarded, HUD/label/reticle writes skipped under `body.boarded`, OrbitControls stay off, `applyFocus` locked. Check: boarding with focus on Earth and sizeMult 200 still shows the correct view; leaving restores both.
- [ ] **0.8 Acceptance.** Screenshots `docs/superpowers/shots/m0_*.png` (small, PNG, 1280 wide) and the two log lines in the commit message. Bump, deploy, live-check.

## M1 Shell and walk

- [ ] **1.1 `deck.js` + `ShellBox` list.** All eight rooms as boxes with doorway gaps, ring corridor, well, cockpit tunnel. Check: `tools/hull_frame_check.mjs` extended: no two walkable volumes overlap, every doorway gap is ≥ 0.9 m wide.
- [ ] **1.2 Room shells (untextured).** Octagonal corridor profile with ribs every 1.2 m (`greeble.js` rib), hold, cockpit taper, bunks, engineering, airlock, the well. Check: screenshot set of eight poses via `?board=1&pose=…`.
- [ ] **1.3 `walk.js`.** WASD + pointer-lock look, capsule-vs-boxes per-axis resolution, step height, sticky ground, eye height; `drive(input)` seam. Check: `walkTest()` moves, stays grounded, never falls through the hold floor for 30 s of random input.
- [ ] **1.4 Ladder and seats.** `E` prompt (hint bar), scripted climb and descent, cupola seat with pitch limits, pilot seat. Check: `walkTest()` reports `climbed=True satCupola=True satCockpit=True`.
- [ ] **1.5 Entry points.** `V` in ship view, `BOARD` in the settings panel, `EXPLORE SHIP` on the title screen (Free Mode already boarded), `Esc`/`V` to leave, spawn in the hold facing the well. Check: each entry and exit path in a scripted click test through the offscreen browser.
- [ ] **1.6 Acceptance.** `WALKTEST result=PASS rooms=8 …`; screenshot set `m1_*.png`; bump, deploy, live-check.

## M2 Surfaces and light

- [ ] **2.1 `tools/interior_assets.sh`.** Fetch the Poly Haven and ambientCG sets of spec §8, simplify props with `gltf-transform` (per-prop budget), resize to 1K, WebP, meshopt, write `models_src/interior/` and `textures/interior/`, upload to R2 (`models/interior/`, `textures/interior/`), and append rows to `README.md` credits. Check: script idempotent; every URL 200; total under 25 MB.
- [ ] **2.2 `trim.js`.** Material factory with grime mask and per-room tint; surface sets: panel, rib, floor grating, tread plate, rubber, black powder-coat, greasy dark. Check: `?pose=swatch` renders a swatch strip; screenshot.
- [ ] **2.3 `HARD_TERMINATOR` opt-out.** Rewrite `hardenDirectLighting()` to guard the patch with `#ifdef HARD_TERMINATOR`; set the define on ship and station materials in `playerPaint`/`paintStation`. Check: chase-cam screenshot identical to before (pixel diff under 1 %); interior swatch shows a soft terminator.
- [ ] **2.4 Apply surfaces.** Corridor, hold, cockpit, bunks, engineering, airlock. Check: screenshot set; `windowTest()` extended with `wallBloom=0` (no wall pixel above the bloom threshold).
- [ ] **2.5 Cupola panes and frames.** Seven `MeshPhysicalMaterial` panes with scratch and dust normal map, anodised frames, handrail ring, ladder and platform. Check: screenshots from the seat, `sun=ahead` and `sun=behind`.
- [ ] **2.6 `lighting.js`.** `CupolaSun` (direction from `sim`, visibility factor, 6 × 6 m shadow frustum, 1024² map), earthshine, practicals with halo sprites, `RoomEnvironment` PMREM at 0.35, ambient. Check: a scripted 360° roll moves the frame shadows down the well (three screenshots); ≤ 8 point lights.
- [ ] **2.7 Perf gate.** `perf()` at DPR 2. Check: mean ≤ 16.7 ms.
- [ ] **2.8 Acceptance.** Screenshot set `m2_*.png`; bump, deploy, live-check.

## M3 Cockpit and hold

- [ ] **3.1 Cockpit.** Console with `vintage_spacecraft_instrument` and `retro_multimeter` gauges, `power_box_01` and generated toggle switches, four seats, overhead panel, five-pane forward window. Check: screenshot from the pilot seat.
- [ ] **3.2 `hull_glass.js` canopy.** Km-scale five-pane canopy at the cockpit position plus three starboard slits along the tunnel. Check: chase-cam screenshot; from the pilot seat a frame of the interior window aligns with the exterior frame (rig pose looking along it).
- [ ] **3.3 Hold.** Curved bench, round table, live system map hologram (positions from `sim.body(...)`, scaled, additive), engineering wall with pipes and the open breaker panel. Check: screenshot; the hologram moves in a 10 s warp test.
- [ ] **3.4 Engineering core.** Cylinder with pulsing ring, gantry grating, red standby lamp, spark burst every 20 to 40 s using the existing explosion sprite kit. Check: screenshot.
- [ ] **3.5 Acceptance.** Screenshot set `m3_*.png`; bump, deploy, live-check.

## M4 Dressing

- [ ] **4.1 `props.js`.** Placement table per room, size policy, lazy load with a boarding progress line. Check: total triangles ≤ 250 k logged by `__dbg.interior.budget()`.
- [ ] **4.2 Conduits.** Pipes, cables, circular ducts along the ceiling lines and under-deck; two floor hatches with lit crawlspace. Check: screenshot.
- [ ] **4.3 Decals and wear.** Generated decal set (scuffs, drips, tape, hazard stripe, labels, scorch); floor wear along the walk path. Check: screenshot.
- [ ] **4.4 Bunks and airlock.** Curtains, lockers, amber lamp; airlock door with round window (true aperture, `hull_glass.js` port). Check: `windowTest()` extended to the airlock port.
- [ ] **4.5 Sound.** Engine hum through the existing `sfx.engine()` bed keyed to throttle while boarded, engineering fan loop, breaker click on approach. Check: at most 4 active sources.
- [ ] **4.6 Acceptance.** Screenshot set `m4_*.png`; budget report; bump, deploy, live-check.

## M5 Ship it

- [ ] **5.1 `SPEC.md` §6.5 Interior.** Mechanism, focus rule, layout table, controls, self-tests, asset list. Check: section reviewed against the code's env names and keys.
- [ ] **5.2 README.** Credits rows, interior controls paragraph. Check: every R2 asset listed with source and licence.
- [ ] **5.3 Final pass.** `walkTest()`, `windowTest()`, `perf()` green on the live URL through the offscreen browser. Check: three PASS lines in the commit message.
- [ ] **5.4 Hand-over.** Konrad walks the deck on starblazer.pages.dev and sits under the cupola with the real Earth outside.
