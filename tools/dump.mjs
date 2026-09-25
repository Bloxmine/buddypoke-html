// Unpacks a BuddyPoke content package ("buddylabs" header + AMF3 object with
// zlib-compressed g/c/d/a entries and the raw material SWF in m).
//   node tools/dump.mjs <package.bin> <out-dir>
import fs from 'node:fs';
import { ByteArray, inflate } from '../js/bytearray.js';

const [src = 'extract/v2/binaryData/2_buddypoke.render.Content__chickClass.bin', out = 'extract/v2/pkg'] = process.argv.slice(2);
fs.mkdirSync(out, { recursive: true });
const ba = new ByteArray(new Uint8Array(fs.readFileSync(src)));
ba.position = 9;
const obj = ba.readObject();
console.log('keys', Object.keys(obj));
fs.writeFileSync(out + '/chick_m.swf', obj.m.bytes);
fs.writeFileSync(out + '/desc.xml', await inflate(obj.d.bytes));
fs.writeFileSync(out + '/catalog.xml', await inflate(obj.c.bytes));
fs.writeFileSync(out + '/geo.amf', await inflate(obj.g.bytes));
if (obj.a) fs.writeFileSync(out + '/anim.amf', await inflate(obj.a.bytes));
console.log('written to', out);
