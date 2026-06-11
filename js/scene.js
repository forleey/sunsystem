// Renderer, post-processing, sky. Render space = km, focus object at origin,
// ecliptic (x,y,z) mapped to render (x, z, -y) so ecliptic north is +Y.
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { FXAAShader } from 'three/addons/shaders/FXAAShader.js';
import { SKY_V, SKY_F } from './shaders.js?v=10';

export function toRender(v, out) { return out.set(v.x, v.z, -v.y); }

function eclDir(lonRad, latRad) {
  const cl = Math.cos(latRad);
  return new THREE.Vector3(
    cl * Math.cos(lonRad),
    Math.sin(latRad),                    // render Y = ecliptic Z
    -cl * Math.sin(lonRad)               // render Z = -ecliptic Y
  );
}

export function createStage(container) {
  const renderer = new THREE.WebGLRenderer({ antialias: false, logarithmicDepthBuffer: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.15;
  container.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(55, window.innerWidth / window.innerHeight, 1e-3, 2e20);
  camera.position.set(0, 2e4, 6e4);

  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  const bloom = new UnrealBloomPass(new THREE.Vector2(window.innerWidth, window.innerHeight), 1.0, 0.45, 0.88);
  composer.addPass(bloom);
  composer.addPass(new OutputPass());
  const fxaa = new ShaderPass(FXAAShader);
  composer.addPass(fxaa);

  function setSize() {
    const w = window.innerWidth, h = window.innerHeight;
    camera.aspect = w / h; camera.updateProjectionMatrix();
    renderer.setSize(w, h); composer.setSize(w, h);
    const pr = renderer.getPixelRatio();
    fxaa.material.uniforms.resolution.value.set(1 / (w * pr), 1 / (h * pr));
  }
  setSize();
  window.addEventListener('resize', setSize);

  return { renderer, scene, camera, composer, bloom };
}

export function makeSky(scene) {
  const DEG = Math.PI / 180;
  const mat = new THREE.ShaderMaterial({
    vertexShader: SKY_V, fragmentShader: SKY_F,
    uniforms: {
      uGNorth: { value: eclDir(180.02 * DEG, 29.81 * DEG) },
      uGCenter: { value: eclDir(266.84 * DEG, -5.54 * DEG) },
    },
    side: THREE.BackSide, depthWrite: false,
  });
  const sky = new THREE.Mesh(new THREE.SphereGeometry(6e19, 48, 32), mat);
  sky.frustumCulled = false;
  sky.renderOrder = -10;
  scene.add(sky);
  return sky;
}
