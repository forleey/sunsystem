// Lights of the ship interior (M2, spec 6). Nothing here reaches the space
// scene and nothing from space reaches in; the sun and the Earth enter as
// directions only, rotated into the interior frame every frame.
//
//   CupolaSun    DirectionalLight along the real sun direction, intensity
//                3 x a visibility factor (1 with the sun over the ring plane,
//                0 with the hull in the way, smooth over 15 degrees), one
//                1024 shadow map in a 6 x 6 m box aimed down the well: the
//                frames of the seven panes throw their shadows down the well
//                as the ship rolls.
//   earthshine   second directional from the Earth, blue-grey, intensity
//                from the Earth's angular size, capped, no shadow.
//   practicals   LIGHTING.pointLights PointLights that take the nearest
//                entries of LIGHTING.practicals each frame (the table is
//                longer than the budget; the count never changes, so the
//                shader never recompiles), every entry with an emissive lamp
//                mesh and an additive halo sprite (GLOW_TEX of ship3d.js).
//   environment  RoomEnvironment PMREM at LIGHTING.environmentIntensity, so
//                brushed metal and glass have something to reflect.
import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { toRender } from '../scene.js?v=103';
import { GLOW_TEX } from '../ship3d.js?v=103';
import { LIGHTING, WELL, CUPOLA, hullToInterior } from './hull_frame.js?v=103';
import { plain } from './trim.js?v=103';

const UP = new THREE.Vector3(0, 1, 0);

export class InteriorLighting {
  constructor({ scene, renderer }) {
    this.scene = scene;
    this.renderer = renderer;
    this._q = new THREE.Quaternion();
    this._v = new THREE.Vector3();
    this._w = new THREE.Vector3();
    this.sunVisibility = 0;

    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    // ambient
    scene.add(new THREE.AmbientLight(LIGHTING.ambient.color, LIGHTING.ambient.intensity));

    // environment (async import already done through the static import above)
    const pmrem = new THREE.PMREMGenerator(renderer);
    scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    scene.environmentIntensity = LIGHTING.environmentIntensity;
    pmrem.dispose();
    // the cupola glass reflects the same map at its own, much lower intensity
    const panes = scene.getObjectByName('cupolaPanes');
    if (panes) { panes.material.envMap = scene.environment; panes.material.envMapIntensity = LIGHTING.glassEnv; panes.material.needsUpdate = true; }

    // the sun over the well
    const S = LIGHTING.sun;
    const wellTop = hullToInterior(WELL.x, WELL.topY, WELL.z);
    this.wellTop = new THREE.Vector3(wellTop.x, wellTop.y, wellTop.z);
    this.sun = new THREE.DirectionalLight(0xfff2e0, 0);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(S.shadow.mapSize, S.shadow.mapSize);
    const cam = this.sun.shadow.camera;
    cam.left = -S.shadow.size / 2; cam.right = S.shadow.size / 2;
    cam.top = S.shadow.size / 2; cam.bottom = -S.shadow.size / 2;
    cam.near = S.shadow.near; cam.far = S.shadow.far;
    this.sun.shadow.bias = -0.0005;
    this.sun.shadow.normalBias = 0.02;
    this.sun.target.position.copy(this.wellTop);
    scene.add(this.sun, this.sun.target);

    // earthshine
    this.earth = new THREE.DirectionalLight(LIGHTING.earthshine.color, 0);
    this.earth.target.position.copy(this.wellTop);
    scene.add(this.earth, this.earth.target);

    // practicals: fixtures for every table entry, lights for the budget
    this.practicals = LIGHTING.practicals.map((p) => {
      const q = hullToInterior(p.x, p.y, p.z);
      return { ...p, pos: new THREE.Vector3(q.x, q.y, q.z), colorObj: new THREE.Color(p.color) };
    });
    this.fixtures = new THREE.Group();
    this.fixtures.name = 'fixtures';
    const haloMat = new Map();
    for (const p of this.practicals) {
      // lamp body: a caged lamp is a short cylinder, a strip is a flat bar
      const body = p.kind === 'cage'
        ? new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.09, 0.18, 12), plain({ color: 0x2a2a2a, roughness: 0.5, metalness: 0.6 }))
        : new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.05, 0.12), plain({ color: 0x3a3d40, roughness: 0.6, metalness: 0.4 }));
      body.position.copy(p.pos);
      if (p.kind === 'cage') body.position.y += 0.1;
      // the glowing part, above the bloom threshold on purpose
      const glow = p.kind === 'cage'
        ? new THREE.Mesh(new THREE.SphereGeometry(0.06, 12, 8), new THREE.MeshBasicMaterial({ color: p.color }))
        : new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.02, 0.08), new THREE.MeshBasicMaterial({ color: p.color }));
      glow.position.copy(p.pos);
      if (p.kind === 'strip') glow.position.y -= 0.03;
      glow.material.color.multiplyScalar(2.2);
      glow.material.toneMapped = true;
      // halo sprite
      const key = p.color;
      if (!haloMat.has(key)) haloMat.set(key, new THREE.SpriteMaterial({ map: GLOW_TEX, color: new THREE.Color(p.color), transparent: true, opacity: 0.35, depthWrite: false, blending: THREE.AdditiveBlending }));
      const halo = new THREE.Sprite(haloMat.get(key));
      halo.position.copy(glow.position);
      halo.scale.setScalar(LIGHTING.halo * (p.kind === 'strip' ? 1.6 : 1));
      this.fixtures.add(body, glow, halo);
    }
    scene.add(this.fixtures);
    this.lights = [];
    for (let i = 0; i < LIGHTING.pointLights; i++) {
      const l = new THREE.PointLight(0xffffff, 0, 10, 2);
      scene.add(l);
      this.lights.push(l);
    }
    this._order = this.practicals.map((_, i) => i);
  }

  // per frame, after the walk update: eye is the interior camera position
  update({ sim, shipView, eye }) {
    // sun and Earth directions in the interior frame: render direction turned
    // back by the ship attitude (the space camera is q * interior camera)
    const q = this._q.copy(shipView.quat).invert();
    const ship = sim.ship, sun = sim.bodies[0], earth = sim.body('Earth');
    const sd = toRender(this._w.set(sun.pos.x - ship.pos.x, sun.pos.y - ship.pos.y, sun.pos.z - ship.pos.z), this._v).normalize().applyQuaternion(q);
    // visibility: the sun over the ring plane lights the well, under it the hull is in the way
    const S = LIGHTING.sun, h = Math.sin(S.horizonBlend / 2);
    const vis = THREE.MathUtils.smoothstep(sd.y, -h, h);
    this.sunVisibility = vis;
    this.sun.intensity = S.intensity * vis;
    this.sun.position.copy(this.wellTop).addScaledVector(sd, S.shadow.distance);
    this.sun.castShadow = vis > 0.001;

    if (earth) {
      const ed = toRender(this._w.set(earth.pos.x - ship.pos.x, earth.pos.y - ship.pos.y, earth.pos.z - ship.pos.z), this._v);
      const dist = ed.length();
      const ang = Math.asin(Math.min(1, earth.r / Math.max(dist, earth.r)));
      const E = LIGHTING.earthshine;
      ed.normalize().applyQuaternion(q);
      this.earth.intensity = E.max * Math.min(1, ang / E.fullAt) * THREE.MathUtils.smoothstep(ed.y, -0.3, 0.2);
      this.earth.position.copy(this.wellTop).addScaledVector(ed, 10);
    }

    // practicals: the budget goes to the nearest fixtures
    if (eye) {
      const P = this.practicals;
      this._order.sort((a, b) => P[a].pos.distanceToSquared(eye) - P[b].pos.distanceToSquared(eye));
      for (let i = 0; i < this.lights.length; i++) {
        const p = P[this._order[i]], l = this.lights[i];
        l.position.copy(p.pos);
        l.color.copy(p.colorObj);
        l.intensity = p.intensity;
        l.distance = p.distance;
      }
    }
  }
}
