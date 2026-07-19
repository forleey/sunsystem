# STARBLAZER Unity Port – Implementation Plan

> Companion document to **SPEC.md** (the complete feature/systems specification of the shipped
> web game, v98). SPEC.md defines WHAT the game is; this plan defines HOW it gets ported to
> Unity, in what order, with which locked technical decisions, and who does what.
> Audience: the executing AI model/engineer + the project owner (KoL).

---

## 1. Goals, targets, non-goals

**Goals**
- A native STARBLAZER built in Unity from SPEC.md, targeting **iOS (App Store) as the primary
  platform**, with macOS/Windows desktop builds as near-free secondary targets from the same
  codebase.
- Feature parity with the web game per SPEC §17 acceptance checklist, adapted for touch.
- Keep the AI-first workflow: the project must remain fully drivable via text files + CLI.

**Non-goals**
- No Unity Web export. The existing three.js app at https://starblazer.pages.dev IS the web
  version and continues to live independently (see SPEC).
- No consoles in this plan (possible later; Unity keeps the door open).
- No multiplayer, no IAP in v1 (premium or free app without purchases: simplest App Store path).

---

## 2. Locked technical decisions

These are decided now to prevent churn. Change only with explicit owner sign-off.

1. **Unity 6 LTS** (6000.0.x latest LTS patch) with **URP** (Universal Render Pipeline).
   Rationale: current LTS, mobile-first pipeline, long support window.
2. **C# everywhere; physics in double precision.** The simulation ports 1:1 from the web
   architecture: ecliptic frame in **km, C# doubles** (JS numbers are doubles, so the numerics
   match exactly), render positions computed **relative to the focused object** (floating
   origin) and pushed to float transforms. Unity units: 1 unit = 1 km (same as web render space).
3. **Depth strategy: reversed-Z instead of logarithmic depth.** Unity's reversed float depth
   (default on Metal/iOS) distributes precision well enough for planet-to-station ranges with
   a generous far plane. The two web-specific extremes are handled explicitly:
   - Sky/Milky Way: real skybox (no depth involvement).
   - Andromeda + galaxy-scale objects: rendered on a **far layer** with an
     angular-size-preserving distance trick (place at 1e6 km with scaled radius) instead of
     their true 1e19 km positions. A dedicated `FarLayerPlacer` owns this mapping.
4. **Shaders: hand-written HLSL for URP, not Shader Graph.** Our GLSL (sun, planets, rings,
   atmosphere, galaxy, greeble) ports most directly to text HLSL includes; text files keep the
   AI workflow intact and diffs meaningful. Shader Graph is allowed only for trivial one-offs.
5. **Explosions: built-in Particle System + sprite flipbook** (port the procedural atlas
   generator to a C# texture baker) + a pooled point light. VFX Graph is NOT used (compute
   dependency, binary-ish assets, no need at our scale).
6. **Audio: port the WebAudio synth to C# DSP** rendered through `OnAudioFilterRead`
   (procedural audio works on native iOS/macOS/Windows; the WebGL limitation is irrelevant
   because we do not ship Unity-web). The composed note data in `music_tracks.js` is exported
   verbatim to JSON and reused. Fallback if DSP costs too much on device: offline-render the
   tracks to OGG once and ship files (the web repo already has `renderTest` as a model).
7. **Input: Unity Input System package.** Touch scheme for iOS (virtual steering area +
   thrust/fire buttons, see §6 Phase 2), keyboard/mouse scheme mirroring SPEC §8.4 on desktop,
   gamepad support comes nearly free and is included.
8. **UI: UI Toolkit** for HUD/panels/title (text-based UXML/USS assets fit the workflow);
   world-space labels via a lightweight screen-space overlay system like the web version.
9. **Models: glTFast package** loading the SAME optimized GLBs (meshopt+WebP) from
   `StreamingAssets/models/` (bundled offline; no R2 dependency at runtime).
10. **Code-first project discipline (hard rule).**
    - `EditorSettings.serializationMode = ForceText` from day one; `.meta` files committed.
    - Exactly **one** bootstrap scene containing one `Bootstrap` GameObject; EVERYTHING else
      (solar system, fleet, ship, UI) is spawned from code at startup, mirroring the web app.
    - No hand-edited scene state that cannot be reproduced from code. The Unity Editor GUI is
      for inspection/verification, not for authoring.
11. **Repository**: new git repo at `~/dev/starblazer-unity` (NOT inside OneDrive: Unity's
    Library/Temp churn and file locks do not belong in a synced folder). `Library/`, `Temp/`,
    `Logs/`, `Build/` gitignored. GitHub backup optional after Phase 0.

---

## 3. Working model (who does what)

**KoL, one-time setup (the only manual/credentialed steps):**
1. Install **Unity Hub**, then Unity **6 LTS** with modules: *iOS Build Support*,
   *Mac Build Support (IL2CPP)*, *Windows Build Support (IL2CPP)*.
2. Sign in / activate the (free Personal) license in the Hub.
3. Install/update **Xcode** + command line tools; accept licenses (`xcodebuild -license`).
4. **Apple Developer Program** membership (USD 99/yr) when device/TestFlight builds start
   (Phase 0 device test can run with a free provisioning profile on your own iPhone).
5. Later (Phase 7): App Store Connect app entry, signing certificates via Xcode automatic
   signing, screenshots/metadata review.

**The AI (me), everything else, via text + CLI:**
- Write all C#, HLSL, UXML/USS, JSON; edit ProjectSettings assets as text.
- Drive Unity headless: `Unity -batchmode -quit -projectPath . -executeMethod <Builder>`
  for imports, scene generation, tests, screenshot renders and player builds; read
  `~/Library/Logs/Unity/Editor.log` + custom logs for verification.
- Scripted visual verification: an editor method renders defined camera setups to PNG
  (same freeze-frame idea as the web workflow); I inspect the PNGs.
- Unity Test Framework (EditMode/PlayMode) for physics/regression tests (e.g. Kepler
  propagation vs analytic values, station rail positions, impulse limiter ratio).
- Adopt the **official Unity MCP Server** (Unity AI Suite, `com.unity.ai.assistant` package,
  Unity 6+; Claude Code is a first-class client via the `~/.unity/relay` binary) as the live
  editor channel, evaluated in Phase 0: scene/GameObject/asset/script tools + console reading,
  and CUSTOM tools via `McpToolRegistry` (the screenshot rig and acceptance checks get
  registered as MCP tools, so verification runs in seconds against the live editor instead of
  batchmode round-trips). Caveats: package is pre-release, first editor instance only,
  one-time connection approval. Fallback if flaky: batchmode-only (community CoplayDev
  bridge as second fallback). Batchmode remains the deterministic backbone for builds/CI
  regardless. Unity's Agentic Assistant and AI Gateway stay OFF during the port (one
  authoritative agent + code-first discipline; the in-editor assistant would mutate editor
  state outside git).
- Occasional GUI inspection via computer use where logs/PNGs are insufficient.

**Cadence**: same as the web project: small iterations, each ending in a verifiable state
(test green + screenshot), committed. "Deploy" here means: device build on the iPhone at
phase gates, TestFlight from Phase 7.

---

## 4. Project structure

```
~/dev/starblazer-unity/
  Assets/
    Scenes/Bootstrap.unity          # the only scene: one Bootstrap GO
    Scripts/
      Core/      (Bootstrap, FocusSystem/FloatingOrigin, FarLayerPlacer, TimeWarp, Toasts)
      Sim/       (NBody, Kepler, ShipPhysics, Autopilot; pure C#, unit-testable, doubles)
      Render/    (PlanetBuilder, SunBuilder, SkyBuilder, AndromedaBuilder, TrailRenderer)
      FleetNS/   (Fleet, Rails, StationBuilders, Megastation, Greeble, Paint)
      Combat/    (Combat, Agents, Weapons, ExplosionKit, Radar)
      AudioNS/   (SynthEngine, Voices, MusicDirector, Sfx)
      UI/        (Hud, Panels, TitleScreen, Labels, Editor-mode inspector [stretch])
      EditorTools/ (BatchBuilder, ScreenshotRig, AssetImport, TestRunners)
    Shaders/     (Sun.hlsl, PlanetTypes.hlsl, Atmosphere.hlsl, Rings.hlsl, Galaxy.hlsl,
                  Greeble.hlsl, FilmLook renderer feature)
    StreamingAssets/
      models/*.glb                  # copied from the web repo's R2 set
      music/tracks.json             # exported note data from music_tracks.js
    Settings/ (URP assets, quality tiers)
  Packages/manifest.json            # com.unity.inputsystem, com.unity.cloud.gltfast, etc.
  ProjectSettings/                  # text-serialized
```

---

## 5. Phase plan

Estimates are working iterations (one iteration = one focused session ending verified+committed).

### Phase 0 – Bootstrap & device spike (GO/NO-GO gate) · ~2-3 iterations
Tasks:
1. KoL setup steps 1-3 (§3). I scaffold the repo, ProjectSettings (ForceText), manifest,
   Bootstrap scene, batchmode build pipeline, screenshot rig, first PlayMode test.
2. Vertical slice: floating-origin camera + one procedural planet (rock shader ported) +
   sun light + skybox stub + a placeholder ship cube with touch-steer + thrust.
3. iOS device build on KoL's iPhone (free provisioning). Measure: FPS, thermal after 10 min,
   build size.
Exit criteria (GO): 60 fps on device for the slice, no thermal throttling within 10 min,
batchmode pipeline + screenshot verification loop proven end-to-end.
NO-GO fallback: revisit Godot decision with the same spike learnings.

### Phase 1 – Solar system core · ~4-5 iterations
Port per SPEC §4/§5: constants + planet table, velocity-Verlet N-body (doubles), time warp,
Kepler f&g for the unpowered ship, planet ShaderMaterial equivalents for all six types
(HLSL), atmosphere shells, Saturn rings, procedural sky + Milky Way, Andromeda on the far
layer, orbit trails, focus system + camera orbit controls, planet-size multiplier.
Tests: energy drift bound on N-body; Kepler propagation vs closed-form ellipse; warp
invariance of rails. Screenshots: each planet type, Earth close-up, Saturn rings.

### Phase 2 – Player ship & helm · ~3-4 iterations
Valkyrie GLB via glTFast + playerPaint port; chase cam with lag + zoom/elevation;
helm inertia model (exact constants SPEC §6.3); **touch controls v1**: left virtual
steering pad = nose rate control (maps to the same quaternion path as mouse steer),
right side: hold-to-thrust button, X/brake, fire buttons (combat later), pinch = camera
distance; desktop keyboard/mouse scheme incl. pointer lock; exhaust visuals (glow sprites,
puff trail, self-light); arrival fly-in; boot attitude; engine SFX stub (envelope only).
Tests: 10 s to max-speed rule; brake-to-local-rest; touch-vs-keyboard parity on turn rates.

### Phase 3 – Fleet & stations · ~3-4 iterations
Rails system (orbiter/patrol/lane, analytic velocities incl. parent motion), full station
catalog + ships per SPEC §7.2/7.3, procedural station meshes ported, greeble HLSL injection
(URP shader include with the same uniforms; toroidal ring windows), STATION_LOOK/whitewash/
paint pipeline with the glow-guard + uuid-dedupe semantics, K-7 megastation port
(instanced greeble carpet, baked window canvas as Texture2D), labels + beam-to.
Screenshots: every station vs its web counterpart side by side.

### Phase 4 – Game shell · ~2 iterations
Title screen (logo as vector-ish UI or pre-rendered from the SVG, mode buttons, hints),
HUD single row + autopilot bar + toasts, fold panels with the slider set + persistence,
Esc/back flow, Andromeda jump + home autopilot UX.

### Phase 5 – Battle mode · ~3-4 iterations
Combat agents (waves, jink AI, cadences), lasers (hitscan + cone/range gate + dry-fire
beams + camera-proximity fade), homing torpedoes, target lock + cycle, radar (nose-up,
hull arc) as UI Toolkit painter, damage/invuln/death-hold sequence, **explosion kit port**
(C#-baked flipbook atlas, flash, pooled light, ring, embers w/ drag, normal-blended smoke,
debris) with the exact SPEC §9.6 parameters, impulse limiter (0.2), combat HUD extras,
touch fire buttons.
Tests: limiter ratio == 0.2; wave scaling; explosion pool leak check (1000 booms).

### Phase 6 – Audio · ~2-3 iterations
C# synth voices (drone/pad/bass/bell/perc/brass) + master bus/reverb; `tracks.json` playback;
combat threat crossfade + title layer + ducking; full SFX inventory port; engine bed with
hold envelope. Device check: DSP CPU cost on iPhone; if > ~5% CPU, switch music (not SFX)
to offline-rendered OGG loops.

### Phase 7 – iOS hardening & App Store · ~3-4 iterations + review latency
Performance/thermal pass (quality tiers, resolution scaling, 30/60 fps option), safe-area
UI, app icon + launch screen, haptics on hits (nice-to-have), privacy manifest (no data
collection), TestFlight beta, App Store Connect metadata/screenshots, submission.
Desktop bonus builds: macOS notarized .app + Windows .exe from the same code (1 iteration).

**Total: roughly 20-27 iterations** to App-Store-ready, front-loaded so a playable
solar-system build exists after Phase 2.

---

## 6. Porting map (SPEC -> Unity)

| SPEC section | Unity approach |
|---|---|
| §2 floating origin, km doubles | C# doubles sim; FocusSystem recenters; 1 unit = 1 km |
| §2 log depth | reversed-Z + far plane ~1e7, FarLayerPlacer for galaxy-scale objects |
| §3 post chain | URP: Bloom (post-processing volume) + custom FilmLook Renderer Feature (grain/vignette/CA/grade; port of the GLSL) + FXAA/SMAA |
| §4 physics/autopilot | straight C# port, unit tests against web-derived fixtures |
| §5 planet/sun/sky shaders | hand HLSL per type; same palette uniforms; ATMO table as data |
| §6 ship | glTFast + playerPaint port; Input System action maps; touch scheme |
| §7 fleet/rails/greeble/paint | straight port; greeble as URP shader include; paint semantics identical |
| §8 shell/HUD/panels | UI Toolkit; slider ranges/defaults identical; localStorage -> PlayerPrefs |
| §9 combat/explosions | straight port; Particle System + pooled lights; flipbook baked in C# |
| §10 audio | C# DSP via OnAudioFilterRead; note data as JSON; OGG fallback for music |
| §11 editor mode | stretch goal post-v1 (desktop only); tuning happens via constants + tests instead |
| §12 debug | `Debug` singleton mirroring `window.__dbg`; batchmode screenshot rig; PlayMode tests |
| §13 assets | same GLBs/textures bundled in StreamingAssets; credits screen in-app (license duty) |

---

## 7. Risks & mitigations

1. **Thermals/perf on iPhone** (biggest unknown): Phase 0 measures it first on the thinnest
   slice; quality tiers + resolution scaling designed in from the start.
2. **Shader port fidelity**: per-planet A/B screenshots vs the web build; the SPEC constants
   make drift measurable. Apple-Silicon NaN traps (SPEC §12) apply to Metal HLSL too: keep the
   same clamps.
3. **Touch steering feel**: hardest UX item; prototype in Phase 2 with 2-3 variants
   (rate pad vs drag-to-aim), test on device early.
4. **glTFast material mismatch** (KHR extensions, occlusion): playerPaint/whitewash run after
   load and mostly override materials anyway; verify per model in Phase 2/3.
5. **DSP audio cost on mobile**: measured in Phase 6; OGG fallback is cheap and predefined.
6. **App Store review**: game with no accounts/data = low-risk category; main effort is
   metadata/screenshots. Model licenses (CC-BY credits) must appear in-app (§6 map, credits).
7. **AI workflow erosion** (binary assets creeping in): the code-first rule (§2.10) is the
   guardrail; any PR/iteration that adds authored scene state gets rejected/redone as code.

---

## 8. What stays shared with the web version

- **SPEC.md is the contract** for both implementations; changes to game design update SPEC
  first, then both codebases.
- GLB models + optimization pipeline (one source of truth in the web repo / R2).
- Music note data (exported to JSON; the composition is implementation-neutral).
- Tuning constants (SPEC §15): the Unity port encodes them in one `Tuning.cs` so future web
  editor-bake sessions can be mirrored by editing a single file.

---

## 9. Immediate next steps

**KoL (unblocks Phase 0):**
1. Install Unity Hub + Unity 6 LTS with iOS/macOS/Windows IL2CPP modules, sign in (license).
2. Xcode current + CLI tools installed, licenses accepted.
3. Tell me when done (+ whether an Apple Developer membership already exists or free
   provisioning should be used for the first device build).

**Me (immediately after):**
1. Scaffold `~/dev/starblazer-unity` (repo, settings, manifest, Bootstrap, batch pipeline).
2. Prove the loop: batchmode build -> PlayMode test -> scripted screenshot, all headless.
3. Build the Phase 0 vertical slice and hand over the first on-device test build.
