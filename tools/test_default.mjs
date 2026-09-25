import {ByteArray, inflate} from '../js/bytearray.js';
const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_/=';
const DEF='eNo1UstuhDAMvPVDOPfQBNh2_RwCIitAWBittFr1B/rVtTOT0zjj9zgff493k6fUDPGzGYn5vJohBDeMaHsz5IJHjOi6QsRm_CqMGdEttRh3aSqe5LGWm7JhKESwao6R2JrDI6QrGXMARHSf29Jzfl2gXz6dE0rCG1kdlaO8Vc6SsMO9M2wfKyK8T3gvW0Xw_8q41fvcrV7G0pqxkG7BiHsxPMRbb9Gon2JgW/GqN0eGiEv37Zigk1TppEjnhdcHETVUqL9K3ZApWlNGDj9y_DwKzjFi1o3vjW/lcbRqpqa1d9AInKC9ThEjTC3ipg6ia2ZC5iRTT7xRpBbvjFvqcRH5hfQQjnD4Vr7esj3rCZ4YazkDMfIWgbfBmPvqfyL_/gN6P7IG';
const out=[]; for (let i=0;i<DEF.length;i+=4){ const q=[0,1,2,3].map(j=>B64.indexOf(DEF.charAt(i+j))); out.push((q[0]<<2)+((q[1]&0x30)>>4)); if(q[2]!==64&&q[2]>=0) out.push(((q[1]&15)<<4)+((q[2]&0x3c)>>2)); if(q[3]!==64&&q[3]>=0) out.push(((q[2]&3)<<6)+q[3]); }
const ba=new ByteArray(await inflate(new Uint8Array(out.map(v=>v&255)))); console.log(ba.readObject());
