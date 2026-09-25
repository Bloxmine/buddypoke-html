import fs from 'node:fs';
import {ByteArray, inflate} from '../js/bytearray.js';
const raw = fs.readFileSync('../binaryData/2_buddypoke.render.Content__chickClass.bin');
const ba = new ByteArray(new Uint8Array(raw));
ba.position = 9;
const obj = ba.readObject();
console.log(Object.keys(obj), ba.position, ba.length);
for (const k of Object.keys(obj)) { const v=obj[k]; console.log(k, v && v.length, v && v.bytes && Buffer.from(v.bytes.slice(0,8)).toString('hex')); }
fs.writeFileSync('extract/chick_m.swf', obj.m.bytes);
fs.writeFileSync('extract/desc.xml', await inflate(obj.d.bytes));
fs.writeFileSync('extract/catalog.xml', await inflate(obj.c.bytes));
fs.writeFileSync('extract/geo.amf', await inflate(obj.g.bytes));
fs.writeFileSync('extract/anim.amf', await inflate(obj.a.bytes));
