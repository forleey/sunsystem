// Hull probe: top and bottom skin of the DEPLOYED hull by vertical raycast, in
// metres, normalised like js/models.js does (Box3 centre, longest axis 110 m).
// Vertex sampling is useless on this 15k-triangle hull (flat quads span
// metres without a vertex), so every grid point casts a ray through the
// triangles. GLB frame: nose +Z, up +Y (the web flips it with yaw PI).
// Run: cd /tmp && npm i @gltf-transform/core@4 @gltf-transform/extensions@4 gl-matrix meshoptimizer
//      curl -sO https://pub-71534651969246d597a0c1bf543eff8c.r2.dev/models/player.glb
//      cp <repo>/tools/hullprobe.mjs . && node hullprobe.mjs player.glb
// Measured 02.09.2026 for docs/superpowers/specs/2026-09-02-ship-interior-design.md section 5.
// The first version (vertex maxima on models_src/hero/valkyrie.glb) counted a
// shield bubble that player.glb does not carry and invented "engine humps at +10".
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { vec3 } from 'gl-matrix';
import { MeshoptDecoder } from 'meshoptimizer';
await MeshoptDecoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder });
const doc = await io.read(process.argv[2]);
const tris = []; const pts=[];
for (const node of doc.getRoot().listNodes()) {
  const mesh = node.getMesh(); if (!mesh) continue;
  const m = node.getWorldMatrix();
  for (const prim of mesh.listPrimitives()) {
    const pos = prim.getAttribute('POSITION'); const idx = prim.getIndices();
    const P=[]; const v=[0,0,0]; for (let i=0;i<pos.getCount();i++){ pos.getElement(i,v); const o=[0,0,0]; vec3.transformMat4(o,v,m); P.push(o); pts.push(o); }
    const n = idx ? idx.getCount() : P.length;
    for (let i=0;i<n;i+=3){ const a=idx?idx.getScalar(i):i, b=idx?idx.getScalar(i+1):i+1, c=idx?idx.getScalar(i+2):i+2; tris.push([P[a],P[b],P[c]]); }
  }
}
let mn=[1e9,1e9,1e9], mx=[-1e9,-1e9,-1e9];
for (const p of pts) for (let k=0;k<3;k++){ mn[k]=Math.min(mn[k],p[k]); mx[k]=Math.max(mx[k],p[k]); }
const size=mx.map((a,i)=>a-mn[i]); const s=110/Math.max(...size); const c=[(mn[0]+mx[0])/2,(mn[1]+mx[1])/2,(mn[2]+mx[2])/2];
const T=tris.map(t=>t.map(p=>[(p[0]-c[0])*s,(p[1]-c[1])*s,(p[2]-c[2])*s]));
console.log('tris',T.length,'size m',size.map(x=>(x*s).toFixed(1)).join(' x '));
// vertical ray at (x,z): return [minY,maxY] of intersections with the mesh, or null
function column(x,z){ let lo=Infinity, hi=-Infinity;
  for (const [a,b,cc] of T){
    // 2D point-in-triangle in XZ, then interpolate Y
    const d=(b[2]-cc[2])*(a[0]-cc[0])+(cc[0]-b[0])*(a[2]-cc[2]); if (Math.abs(d)<1e-12) continue;
    const l1=((b[2]-cc[2])*(x-cc[0])+(cc[0]-b[0])*(z-cc[2]))/d; if(l1<-1e-9||l1>1+1e-9) continue;
    const l2=((cc[2]-a[2])*(x-cc[0])+(a[0]-cc[0])*(z-cc[2]))/d; if(l2<-1e-9||l2>1+1e-9) continue;
    const l3=1-l1-l2; if(l3<-1e-9) continue;
    const y=l1*a[1]+l2*b[1]+l3*cc[1]; lo=Math.min(lo,y); hi=Math.max(hi,y);
  }
  return hi>-Infinity?[lo,hi]:null; }
const f=(v)=>v==null?'   -  ':v.toFixed(1).padStart(6);
console.log('  Z | top X0  X±2.5   X±5   X±10 | bot X0  X±5 | halfW(any Y)');
for (let z=-54; z<=52; z+=2){
  const cols={}; for (const x of [0,2.5,-2.5,5,-5,10,-10]) cols[x]=column(x,z);
  const top=(xs)=>{const v=xs.map(x=>cols[x]).filter(Boolean).map(c=>c[1]); return v.length?Math.min(...v):null;};
  const bot=(xs)=>{const v=xs.map(x=>cols[x]).filter(Boolean).map(c=>c[0]); return v.length?Math.max(...v):null;};
  let hw=0; for (let x=0;x<=60;x+=1){ if(column(x,z)||column(-x,z)) hw=x; }
  console.log(String(z).padStart(3),'|',f(top([0])),f(top([2.5,-2.5])),f(top([5,-5])),f(top([10,-10])),'|',f(bot([0])),f(bot([5,-5])),'|',hw);
}
// the highest skin point in the aft/mid body |X|<=14, Z -44..14, 1 m grid
let best=[-1e9,0,0]; for (let z=-44;z<=14;z+=1) for (let x=-14;x<=14;x+=1){ const cc=column(x,z); if(cc&&cc[1]>best[0]) best=[cc[1],x,z]; }
console.log('highest skin in the body: Y %s at X %s Z %s', best[0].toFixed(2), best[1], best[2]);
const cup=column(0,-18); console.log('column at cupola (0,-18): bottom %s top %s', cup[0].toFixed(2), cup[1].toFixed(2));
for (const z of [-30,-28,-26,-24,-22,-20,-18,-16,-14]) { const row=[]; for (const x of [-8,-6,-4,-2,0,2,4,6,8]) { const cc=column(x,z); row.push(cc?cc[1].toFixed(1).padStart(5):'   - '); } console.log('top skin Z'+String(z).padStart(4)+':', row.join(' ')); }
