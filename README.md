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

Sliders: time warp (1×–10⁹×), gravity G multiplier, planet visual size (1×–500×), ship thrust (0.5–20 g), bloom; toggles for relativistic c-limit, orbit trails, labels.

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
