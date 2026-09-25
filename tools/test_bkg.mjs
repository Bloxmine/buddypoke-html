import fs from 'node:fs';
import {ByteArray, AMF3Reader, inflate} from '../js/bytearray.js';
import {CLASS_ALIASES} from '../js/engine/scene.js';
Object.assign(AMF3Reader.classes, CLASS_ALIASES);
const raw = new Uint8Array(fs.readFileSync('extract/old_bkg.bin'));
console.log(Buffer.from(raw.slice(0,16)).toString('hex'));
const ba = new ByteArray(raw); ba.position = 9; const o = ba.readObject(); console.log(Object.keys(o));
for (const k of Object.keys(o)) console.log(k, o[k] && o[k].length);
if (o.g) { const g = new ByteArray(await inflate(o.g.bytes)).readObject(); const rd=(b)=>{ if(!b) return null; b.position=0; const a=[]; while(b.bytesAvailable>=4) a.push(+b.readFloat().toFixed(3)); return a; };
  for (const c of g.children||[]) console.log(c.constructor.name, c.name, 'cpos', rd(c.cpos), 'crot', rd(c.crot), 'fov', c.fov); }
if (o.d) console.log(new TextDecoder().decode(await inflate(o.d.bytes)));
{
const ba2 = new ByteArray(raw); ba2.position = 9; const o2 = ba2.readObject();
const g = new ByteArray(await inflate(o2.g.bytes)).readObject();
const rd=(b)=>{ if(!b) return null; b.position=0; const a=[]; while(b.bytesAvailable>=4) a.push(+b.readFloat().toFixed(3)); return a; };
(function walk(n,d){ console.log(' '.repeat(d*2)+n.constructor.name+' '+n.name+' pos '+JSON.stringify(rd(n.cpos))+' rot '+JSON.stringify(rd(n.crot))); for (const c of n.children||[]) walk(c,d+1); })(g,0);
}
