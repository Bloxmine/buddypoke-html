import fs from 'node:fs';
import {ByteArray, inflate} from '../js/bytearray.js';
const raw = new Uint8Array(fs.readFileSync(process.argv[2]));
const ba = new ByteArray(raw); ba.position = 9;
const obj = ba.readObject();
console.log(Object.keys(obj));
for (const k of Object.keys(obj)) console.log(k, obj[k] && obj[k].length);
if (obj.a) {
  const a = new ByteArray(await inflate(obj.a.bytes));
  const lib = a.readObject(); console.log(lib);
  const names=[]; while (a.bytesAvailable>0){ const an=a.readObject(); names.push(an.name); }
  console.log(names.length, names.join(' '));
}
