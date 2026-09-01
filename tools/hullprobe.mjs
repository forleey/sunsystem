// Hull probe: top-surface heightmap of a GLB in metres (longest axis = 110 m).
// Run: cd /tmp && npm i @gltf-transform/core@4 @gltf-transform/extensions@4 gl-matrix && node tools/hullprobe.mjs <file.glb>
// Used on 02.09.2026 to place the observation cupola and the cockpit canopy (see docs/superpowers/specs/2026-09-02-ship-interior-design.md).
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { mat4, vec3 } from 'gl-matrix';
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const doc = await io.read(process.argv[2]);
const pts = [];
for (const node of doc.getRoot().listNodes()) {
  const mesh = node.getMesh(); if (!mesh) continue;
  const m = node.getWorldMatrix();
  for (const prim of mesh.listPrimitives()) {
    const pos = prim.getAttribute('POSITION'); if (!pos) continue;
    const v = [0,0,0], o = [0,0,0];
    for (let i = 0; i < pos.getCount(); i++) { pos.getElement(i, v); vec3.transformMat4(o, v, m); pts.push([o[0], o[1], o[2]]); }
  }
}
let mn=[1e9,1e9,1e9], mx=[-1e9,-1e9,-1e9];
for (const p of pts) for (let k=0;k<3;k++){ mn[k]=Math.min(mn[k],p[k]); mx[k]=Math.max(mx[k],p[k]); }
const size = mx.map((a,i)=>a-mn[i]);
const longest = Math.max(...size);
const scale = 110 / longest; // metres per model unit, longest axis -> 110 m
console.log('verts', pts.length, 'bbox model units min', mn.map(x=>x.toFixed(2)), 'max', mx.map(x=>x.toFixed(2)));
console.log('size m: X %s  Y %s  Z %s', ...size.map(s=>(s*scale).toFixed(1)));
// top-surface heightmap: grid over X (span) and Z (length), max Y and min Y per cell, in metres, centred
const NX=22, NZ=18; const top=[], bot=[];
for (let i=0;i<NZ;i++){ top.push(new Array(NX).fill(-Infinity)); bot.push(new Array(NX).fill(Infinity)); }
const cx=(mn[0]+mx[0])/2, cy=(mn[1]+mx[1])/2, cz=(mn[2]+mx[2])/2;
for (const p of pts){ const ix=Math.min(NX-1,Math.floor((p[0]-mn[0])/size[0]*NX)), iz=Math.min(NZ-1,Math.floor((p[2]-mn[2])/size[2]*NZ)); const y=(p[1]-cy)*scale; if(y>top[iz][ix])top[iz][ix]=y; if(y<bot[iz][ix])bot[iz][ix]=y; }
console.log('\nTOP surface height above hull centre (m); rows = Z from %s m (min z) to %s m, cols = X from %s m to %s m', ((mn[2]-cz)*scale).toFixed(0), ((mx[2]-cz)*scale).toFixed(0), ((mn[0]-cx)*scale).toFixed(0), ((mx[0]-cx)*scale).toFixed(0));
for (let i=0;i<NZ;i++){ const z=((mn[2]-cz)+ (i+0.5)*size[2]/NZ)*scale; console.log(z.toFixed(0).padStart(4)+' | '+top[i].map(v=>v===-Infinity?'  . ':v.toFixed(1).padStart(4)).join(' ')); }
console.log('\nTHICKNESS top-bottom (m):');
for (let i=0;i<NZ;i++){ const z=((mn[2]-cz)+ (i+0.5)*size[2]/NZ)*scale; console.log(z.toFixed(0).padStart(4)+' | '+top[i].map((v,j)=>v===-Infinity?'  . ':(v-bot[i][j]).toFixed(1).padStart(4)).join(' ')); }
