// Pulls the animation library out of the BuddyPoke 1.0 content package and
// stores its zlib stream as assets/anims_v1.bin.
import fs from 'node:fs';
import {ByteArray, inflate} from '../js/bytearray.js';
const ba = new ByteArray(new Uint8Array(fs.readFileSync('extract/old_chick.bin')));
ba.position = 9;
const obj = ba.readObject();
fs.writeFileSync('assets/anims_v1.bin', obj.a.bytes);
console.log('wrote', obj.a.bytes.length);
