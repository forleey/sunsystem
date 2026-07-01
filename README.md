# Sol System — N-Body Simulator

A real-scale 3D solar system in the browser. Plain ES modules + Three.js (CDN import map), no build step.

## Run

Any static file server, e.g.:

```bash
cd ~/dev/sunsystem
python3 -m http.server 8643
# open http://localhost:8643
```

## What's inside

- **Real scale by default**: true planetary radii, distances and J2000 orbital elements; positions evolve via N-body velocity-Verlet integration (Sun, 8 planets, Pluto, Moon), so the Gravity slider genuinely changes the dynamics.
- **Floating origin** rendering (focus object at origin, JS doubles for world coords, log depth buffer) — stable from 300 m ship close-ups to the 2.537 Mly Andromeda run in one scene.
- **Cutting-edge-ish visuals**: procedural GLSL shaders for the Sun (granulation + corona), every planet type (gas bands, ice, rock, Venus clouds, Earth with continents/clouds/night-side city lights/atmosphere rim), Saturn's rings, a procedural starfield + Milky Way skybox, and a procedural Andromeda spiral with a 3D star sprinkle. ACES tone mapping, Unreal bloom, FXAA.
- **Starship** (Constitution-class silhouette, ~300 m) parked in a 20,000 km Earth orbit. Newtonian inertia; thrust via held Space at the slider-set g (default 10 g). Optional special-relativistic mode (proper-velocity integration, c-limit checkbox).
- **Andromeda jump (J)**: flip-and-burn brachistochrone autopilot at a constant 100,000 g with full inertia — accelerates to ~500,000 c (Newtonian mode), flips, decelerates, and parks at the galaxy. Time warp auto-ramps so the 10-year trip plays out in about a minute. H flies you home.

## Controls

| Key | Action |
| --- | --- |
| W/S, A/D, Q/E | pitch / yaw / roll |
| Space (hold) | thrust at slider g (inertia) |
| X | cut thrust / abort autopilot |
| J | Andromeda jump @ 100,000 g |
| H | autopilot home to Earth |
| F | focus ship |
| 1–9, 0 | focus Sun … Pluto |
| drag / wheel | orbit & zoom camera |

Sliders: time warp (1×–10⁹×), gravity G multiplier, planet visual size (1×–500×), ship max speed (0.05–100 ×c, reached in 10 s), bloom; toggles for relativistic c-limit, orbit trails, labels.

## Files

- `js/physics.js` — N-body integrator, Kepler element → state vector setup, ship + autopilot
- `js/data.js` — constants, planetary data, formatting
- `js/shaders.js` — all GLSL (noise, sky, sun, planets, rings, galaxy)
- `js/scene.js` — renderer, post-processing, skybox
- `js/bodies3d.js` — sun/planet/trail/Andromeda meshes
- `js/ship3d.js` — starship mesh + helm input
- `js/ui.js` — sliders, HUD, labels
- `js/main.js` — wiring + frame loop (with hidden-tab fallback ticker)

Known simplification: the Milky Way skybox stays fixed during the intergalactic trip (no parallax for the home galaxy).

- **Ambient soundtrack**: three instrumental space tracks ("Deep Field Drift", "Dawnlight Over the Rim", "Drift Among Distant Moons") composed as note data by claude-sonnet-5 via OpenRouter and synthesized live in the browser with Web Audio (no audio files). Starts on first interaction; M toggles, panel button skips tracks.

## Credits

Earth and Moon texture maps (`textures/`) by [Solar System Scope](https://www.solarsystemscope.com/textures/), licensed [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/), based on NASA imagery. All other surfaces are procedural GLSL.

## 3D model credits

Ship and station models are open-source assets, optimized with gltf-transform (meshopt + WebP) and served from Cloudflare R2:

| In-sim | Asset | Author / Source | License |
| --- | --- | --- | --- |
| Player ship | Valkyrie, [Babylon.js Space Pirates](https://github.com/BabylonJS/SpacePirates) | Babylon.js contributors | Apache-2.0 |
| Warships (Defiant, Excalibur, Reliant) | Raider, [Babylon.js Space Pirates](https://github.com/BabylonJS/SpacePirates) | Babylon.js contributors | Apache-2.0 |
| Freighters (Kobayashi Maru, Lakul) | carrier01, [Spaceships](https://opengameart.org/content/spaceships-6) | Viktor Hahn | [CC BY 3.0](https://creativecommons.org/licenses/by/3.0/) |
| Hauler (Botany Bay) | carrier03, [More Spaceships](https://opengameart.org/content/more-spaceships) | Viktor Hahn | [CC BY 3.0](https://creativecommons.org/licenses/by/3.0/) |
| Scouts (Grissom, Oberth, Copernicus) | frigate01, [Spaceships](https://opengameart.org/content/spaceships-6) | Viktor Hahn | [CC BY 3.0](https://creativecommons.org/licenses/by/3.0/) |
| ISS | ISS (D), [NASA 3D Resources](https://github.com/nasa/NASA-3D-Resources) | NASA | Public domain |
| Lunar Gateway | Gateway Core, [NASA 3D Resources](https://github.com/nasa/NASA-3D-Resources) | NASA | Public domain |
| Shuttle Galileo | [Space Shuttle Discovery scan](https://3d.si.edu/object/3d/orbiter-space-shuttle-ov-103-discovery:d8c636ce-4ebc-11ea-b77f-2e728ce88125) | Smithsonian Institution | CC0 |

The large Star Trek-style stations (Spacedock One, Utopia Planitia, Jove Gateway, Cronos Station) remain procedural meshes. NASA/Smithsonian usage does not imply endorsement.
