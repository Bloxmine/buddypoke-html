import fs from 'node:fs';
import {ByteArray, AMF3Reader, inflate} from '../js/bytearray.js';
import {CLASS_ALIASES, Node} from '../js/engine/scene.js';
Object.assign(AMF3Reader.classes, CLASS_ALIASES);
const geo = new ByteArray(new Uint8Array(fs.readFileSync('extract/geo.amf'))).readObject();
function walk(n, d=0){ if (d<5) console.log(' '.repeat(d*2)+n.name+' ['+n.constructor.name+']'+(n.mesh?' mesh':'')); if(n.children) for(const c of n.children) if (d<4 || /Bip01$|Pelvis|IG_Root/.test(c.name)) walk(c,d+1); }
walk(geo);
const v1 = new ByteArray(await inflate(new Uint8Array(fs.readFileSync('assets/anims_v1.bin'))));
const lib = v1.readObject();
while (v1.bytesAvailable>0){ const a=v1.readObject(); if (a.name==='hug2'||a.name==='hug1'){ a.decode(lib); console.log(a.name, a.start, a.end, a.controllers.map(c=>c.target+(c.pos?'(pos)':'')+(c.rot?'(rot)':'')+(c.vis?'(vis)':'')).join(' ')); const c=a.controllers.find(c=>c.target==='Bip01'); if(c&&c.pos) console.log(' Bip01 pos f0', c.pos.slice(0,3), 'rot', c.rot&&c.rot.slice(0,4)); } }
const nw = new ByteArray(new Uint8Array(fs.readFileSync('extract/anim.amf'))); const nlib=nw.readObject();
while (nw.bytesAvailable>0){ const a=nw.readObject(); if (a.name==='bearHug2'){ a.decode(nlib); console.log(a.name, a.controllers.map(c=>c.target+(c.pos?'(pos)':'')+(c.rot?'(rot)':'')+(c.vis?'(vis)':'')).join(' ')); const c=a.controllers.find(c=>c.target==='Bip01'||c.target==='IG_Root'); console.log(' root', c && c.target, c&&c.pos&&c.pos.slice(0,3), c && c.rot && c.rot.slice(0,4)); } }
