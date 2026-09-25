import fs from 'node:fs';
import {ByteArray, AMF3Reader} from '../js/bytearray.js';
import {CLASS_ALIASES, Mesh, Node, Camera} from '../js/engine/scene.js';
import {Player, searchAllByType} from '../js/engine/player.js';
Object.assign(AMF3Reader.classes, CLASS_ALIASES);
const ba = new ByteArray(new Uint8Array(fs.readFileSync('extract/geo.amf')));
const scene = ba.readObject();
console.log(scene.constructor.name, Object.keys(scene));
console.log('bones', scene.bones?.length, 'props', scene.props, 'cullRegions', scene.cullRegions);
const p = new Player(346,260);
p.loadObject(scene);
const cams=[]; searchAllByType(Camera, scene, cams); console.log('cameras', cams.map(c=>c.name+' fov='+c.fov.toFixed(3)+' pos='+JSON.stringify(c.pos)));
const nodes = Object.values(scene.nodeMap);
let ok=0, bad=0, dummy=0;
for (const n of nodes) {
  if (n instanceof Node && n.mesh) {
    p.context.scene = scene;
    const m = n.mesh;
    try {
      m.init(p.context);
      const nf=m.numFaces; let inval=0; for (const f of m.faces) if (f<0||f>=m.numVerts*3) inval++;
      if (m.dummyVerts && m.dummyVerts.length) dummy++;
      if (inval) console.log('  invalid faces', n.name, inval, 'dummy', m.dummyVerts);
      ok++;
      if (ok<6 || n.name==='Skin_Head') console.log(n.name, 'v',m.numVerts,'f',m.numFaces, 'mod', !!m.modifier, m.modifier?.hasSkin, m.modifier?.hasMorpher, m.modifier?.channels?.slice(0,5), 'cull', m.cull? m.cull.length : 'none', 'dummy', m.dummyVerts, 'z', m.localZDepthOffset, m.screenZDepthOffset);
    } catch(e) { bad++; console.log('FAIL', n.name, e.stack.split('\n').slice(0,3).join(' | ')); }
  }
}
console.log('meshes ok', ok, 'bad', bad, 'withDummy', dummy);
for (const n of nodes) if (n instanceof Node && n.mesh && !(n.mesh.dummyVerts && n.mesh.dummyVerts.length)) console.log('NO DUMMY', n.name, n.mesh.numVerts, n.mesh.numFaces, n.mesh.faces.slice(0,12), n.mesh.dummyVerts);
