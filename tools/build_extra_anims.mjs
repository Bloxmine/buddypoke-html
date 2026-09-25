// Bundles standalone animation files (zlib-compressed AMF3 Anim objects, as
// streamed from the MySpace CDN) into assets/anims_extra.bin: a zlib stream
// holding an AnimLibrary header followed by the Anim objects.
//   node tools/build_extra_anims.mjs <anim files...>
import fs from 'node:fs';
import zlib from 'node:zlib';

const files = process.argv.slice(2);
if (!files.length) { console.error('usage: node tools/build_extra_anims.mjs <files>'); process.exit(1); }
// AMF3 object: class "AL" with one sealed property numAnim = files.length
const header = Buffer.from([0x0a, 0x13, 0x05, 0x41, 0x4c, 0x0f, ...Buffer.from('numAnim'), 0x04, files.length]);
const parts = [header, ...files.map((f) => zlib.inflateSync(fs.readFileSync(f)))];
fs.writeFileSync('assets/anims_extra.bin', zlib.deflateSync(Buffer.concat(parts)));
console.log('wrote assets/anims_extra.bin with', files.length, 'animations');
