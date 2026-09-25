import fs from 'node:fs';
import {ByteArray} from '../js/bytearray.js';
const ba = new ByteArray(new Uint8Array(fs.readFileSync('extract/anim.amf')));
const lib = ba.readObject(); console.log('lib', lib);
const names=[];
while (ba.bytesAvailable>0){ const a=ba.readObject(); names.push(a.name+'('+a.start+'-'+a.end+'@'+a.fps+')'); }
console.log(names.length, names.join(' '));
