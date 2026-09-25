// A compact SWF parser covering what the BuddyPoke material library uses:
// DefineShape 1-4, DefineSprite timelines (PlaceObject2/3, RemoveObject2),
// bitmaps (lossless + JPEG) and SymbolClass linkage.

import { inflate } from '../bytearray.js';

class Reader {
  constructor(bytes, pos = 0) {
    this.b = bytes;
    this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    this.pos = pos;
    this.bitPos = 0;
    this.bitBuf = 0;
  }
  align() { this.bitPos = 0; }
  u8() { this.align(); return this.b[this.pos++]; }
  u16() { this.align(); const v = this.view.getUint16(this.pos, true); this.pos += 2; return v; }
  s16() { this.align(); const v = this.view.getInt16(this.pos, true); this.pos += 2; return v; }
  u32() { this.align(); const v = this.view.getUint32(this.pos, true); this.pos += 4; return v; }
  fixed8() { return this.s16() / 256; }
  bit() {
    if (this.bitPos === 0) { this.bitBuf = this.b[this.pos++]; this.bitPos = 8; }
    this.bitPos--;
    return (this.bitBuf >> this.bitPos) & 1;
  }
  ub(n) { let v = 0; for (let i = 0; i < n; i++) v = (v << 1) | this.bit(); return v >>> 0; }
  sb(n) { if (n === 0) return 0; const v = this.ub(n); const sh = 32 - n; return (v << sh) >> sh; }
  fb(n) { return this.sb(n) / 65536; }
  str() { this.align(); let s = ''; let c; const start = this.pos; while ((c = this.b[this.pos++]) !== 0); return new TextDecoder().decode(this.b.subarray(start, this.pos - 1)); }
  bytes(n) { this.align(); const r = this.b.subarray(this.pos, this.pos + n); this.pos += n; return r; }
  rect() {
    this.align();
    const n = this.ub(5);
    const r = { xmin: this.sb(n), xmax: this.sb(n), ymin: this.sb(n), ymax: this.sb(n) };
    this.align();
    return r;
  }
  matrix() {
    this.align();
    const m = { a: 1, b: 0, c: 0, d: 1, tx: 0, ty: 0 };
    if (this.bit()) { const n = this.ub(5); m.a = this.fb(n); m.d = this.fb(n); }
    if (this.bit()) { const n = this.ub(5); m.b = this.fb(n); m.c = this.fb(n); }
    const n = this.ub(5);
    m.tx = this.sb(n); m.ty = this.sb(n);
    this.align();
    return m;
  }
  cxform(withAlpha) {
    this.align();
    const hasAdd = this.bit(), hasMult = this.bit();
    const n = this.ub(4);
    const cx = [1, 1, 1, 1, 0, 0, 0, 0];
    if (hasMult) {
      cx[0] = this.sb(n) / 256; cx[1] = this.sb(n) / 256; cx[2] = this.sb(n) / 256;
      if (withAlpha) cx[3] = this.sb(n) / 256;
    }
    if (hasAdd) {
      cx[4] = this.sb(n); cx[5] = this.sb(n); cx[6] = this.sb(n);
      if (withAlpha) cx[7] = this.sb(n);
    }
    this.align();
    return cx;
  }
  rgb() { return [this.u8(), this.u8(), this.u8(), 255]; }
  rgba() { return [this.u8(), this.u8(), this.u8(), this.u8()]; }
}

// ---------------------------------------------------------------- shapes

function readGradient(r, shapeVer, focal) {
  r.align();
  const spread = r.ub(2), interp = r.ub(2), n = r.ub(4);
  const stops = [];
  for (let i = 0; i < n; i++) {
    const ratio = r.u8();
    stops.push({ ratio, color: shapeVer >= 3 ? r.rgba() : r.rgb() });
  }
  const g = { spread, interp, stops, focal: 0 };
  if (focal) g.focal = r.fixed8();
  return g;
}

function readFillStyle(r, shapeVer) {
  const type = r.u8();
  const f = { type };
  if (type === 0x00) f.color = shapeVer >= 3 ? r.rgba() : r.rgb();
  else if (type === 0x10 || type === 0x12 || type === 0x13) {
    f.matrix = r.matrix();
    f.gradient = readGradient(r, shapeVer, type === 0x13);
  } else if (type >= 0x40 && type <= 0x43) {
    f.bitmapId = r.u16();
    f.matrix = r.matrix();
    f.repeat = type === 0x40 || type === 0x42;
    f.smooth = type === 0x40 || type === 0x41;
  } else throw new Error('Unknown fill style ' + type);
  return f;
}

function readFillStyles(r, shapeVer) {
  let n = r.u8();
  if (n === 0xff && shapeVer >= 2) n = r.u16();
  const out = [];
  for (let i = 0; i < n; i++) out.push(readFillStyle(r, shapeVer));
  return out;
}

function readLineStyles(r, shapeVer) {
  let n = r.u8();
  if (n === 0xff) n = r.u16();
  const out = [];
  for (let i = 0; i < n; i++) {
    if (shapeVer === 4) {
      const width = r.u16();
      r.align();
      const startCap = r.ub(2), join = r.ub(2), hasFill = r.bit(), noH = r.bit(), noV = r.bit(), hint = r.bit();
      r.ub(5);
      const noClose = r.bit(), endCap = r.ub(2);
      const ls = { width, startCap, endCap, join, noClose, noScale: noH || noV };
      if (join === 2) ls.miter = r.fixed8();
      if (hasFill) { ls.fill = readFillStyle(r, shapeVer); ls.color = ls.fill.color || (ls.fill.gradient ? ls.fill.gradient.stops[0].color : [0, 0, 0, 255]); }
      else ls.color = r.rgba();
      out.push(ls);
    } else {
      out.push({ width: r.u16(), color: shapeVer >= 3 ? r.rgba() : r.rgb(), startCap: 0, endCap: 0, join: 0 });
    }
  }
  return out;
}

// Converts SWF edge records into drawable fill and stroke paths (in pixels).
function buildShape(r, shapeVer) {
  let fills = readFillStyles(r, shapeVer);
  let lines = readLineStyles(r, shapeVer);
  r.align();
  let fillBits = r.ub(4), lineBits = r.ub(4);
  const layers = [];
  let fillEdges = fills.map(() => []);
  let lineEdges = lines.map(() => []);
  const flush = () => {
    const layer = { fills: [], lines: [] };
    fillEdges.forEach((edges, i) => { if (edges.length) layer.fills.push({ style: fills[i], cmds: joinEdges(edges) }); });
    lineEdges.forEach((edges, i) => { if (edges.length) layer.lines.push({ style: lines[i], cmds: chainEdges(edges) }); });
    if (layer.fills.length || layer.lines.length) layers.push(layer);
  };
  let x = 0, y = 0, fs0 = 0, fs1 = 0, ls = 0;
  for (;;) {
    const isEdge = r.bit();
    if (!isEdge) {
      const newStyles = r.bit(), lineStyle = r.bit(), fillStyle1 = r.bit(), fillStyle0 = r.bit(), moveTo = r.bit();
      if (!newStyles && !lineStyle && !fillStyle1 && !fillStyle0 && !moveTo) break;
      if (moveTo) { const n = r.ub(5); x = r.sb(n); y = r.sb(n); }
      if (fillStyle0) fs0 = r.ub(fillBits);
      if (fillStyle1) fs1 = r.ub(fillBits);
      if (lineStyle) ls = r.ub(lineBits);
      if (newStyles) {
        flush();
        fills = readFillStyles(r, shapeVer);
        lines = readLineStyles(r, shapeVer);
        fillEdges = fills.map(() => []);
        lineEdges = lines.map(() => []);
        r.align();
        fillBits = r.ub(4); lineBits = r.ub(4);
      }
    } else {
      const straight = r.bit();
      const n = r.ub(4) + 2;
      let e;
      if (straight) {
        let dx = 0, dy = 0;
        if (r.bit()) { dx = r.sb(n); dy = r.sb(n); }
        else if (r.bit()) dy = r.sb(n); else dx = r.sb(n);
        e = { x1: x, y1: y, x2: x + dx, y2: y + dy };
      } else {
        const cdx = r.sb(n), cdy = r.sb(n), adx = r.sb(n), ady = r.sb(n);
        e = { x1: x, y1: y, cx: x + cdx, cy: y + cdy, x2: x + cdx + adx, y2: y + cdy + ady };
      }
      x = e.x2; y = e.y2;
      if (fs1 > 0 && fillEdges[fs1 - 1]) fillEdges[fs1 - 1].push(e);
      if (fs0 > 0 && fillEdges[fs0 - 1]) fillEdges[fs0 - 1].push(reverseEdge(e));
      if (ls > 0 && lineEdges[ls - 1]) lineEdges[ls - 1].push(e);
    }
  }
  flush();
  return layers;
}

function reverseEdge(e) {
  return e.cx === undefined ? { x1: e.x2, y1: e.y2, x2: e.x1, y2: e.y1 } : { x1: e.x2, y1: e.y2, cx: e.cx, cy: e.cy, x2: e.x1, y2: e.y1 };
}

const key = (x, y) => x + ',' + y;

// Join fill edges into closed contours. Returns a flat command list:
// ['M',x,y] ['L',x,y] ['Q',cx,cy,x,y] in twips.
function joinEdges(edges) {
  const byStart = new Map();
  edges.forEach((e, i) => {
    const k = key(e.x1, e.y1);
    let l = byStart.get(k);
    if (!l) byStart.set(k, l = []);
    l.push(i);
  });
  const used = new Uint8Array(edges.length);
  const cmds = [];
  for (let i = 0; i < edges.length; i++) {
    if (used[i]) continue;
    let e = edges[i];
    used[i] = 1;
    const sx = e.x1, sy = e.y1;
    cmds.push(['M', e.x1, e.y1]);
    for (;;) {
      if (e.cx === undefined) cmds.push(['L', e.x2, e.y2]); else cmds.push(['Q', e.cx, e.cy, e.x2, e.y2]);
      if (e.x2 === sx && e.y2 === sy) break;
      const l = byStart.get(key(e.x2, e.y2));
      let next = -1;
      if (l) for (const j of l) if (!used[j]) { next = j; break; }
      if (next < 0) break;
      used[next] = 1;
      e = edges[next];
    }
  }
  return cmds;
}

function chainEdges(edges) {
  const cmds = [];
  let px = NaN, py = NaN;
  for (const e of edges) {
    if (e.x1 !== px || e.y1 !== py) cmds.push(['M', e.x1, e.y1]);
    if (e.cx === undefined) cmds.push(['L', e.x2, e.y2]); else cmds.push(['Q', e.cx, e.cy, e.x2, e.y2]);
    px = e.x2; py = e.y2;
  }
  return cmds;
}

// ---------------------------------------------------------------- bitmaps

function makeCanvas(w, h) {
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(Math.max(1, w), Math.max(1, h));
  const c = document.createElement('canvas');
  c.width = Math.max(1, w); c.height = Math.max(1, h);
  return c;
}

async function decodeLossless(tag, withAlpha) {
  const r = new Reader(tag.data);
  const id = r.u16();
  const format = r.u8();
  const w = r.u16(), h = r.u16();
  let tableSize = 0;
  if (format === 3) tableSize = r.u8() + 1;
  const raw = await inflate(tag.data.subarray(r.pos));
  const img = new ImageData(w, h);
  const px = img.data;
  if (format === 3) {
    const cs = withAlpha ? 4 : 3;
    const table = raw.subarray(0, tableSize * cs);
    const rowBytes = (w + 3) & ~3;
    const data = raw.subarray(tableSize * cs);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const idx = data[y * rowBytes + x];
      const o = (y * w + x) * 4;
      px[o] = table[idx * cs]; px[o + 1] = table[idx * cs + 1]; px[o + 2] = table[idx * cs + 2];
      px[o + 3] = withAlpha ? table[idx * cs + 3] : 255;
    }
  } else if (format === 5) {
    for (let i = 0, j = 0; i < w * h; i++, j += 4) {
      const a = withAlpha ? raw[j] : 255;
      let rr = raw[j + 1], gg = raw[j + 2], bb = raw[j + 3];
      if (withAlpha && a > 0 && a < 255) { rr = Math.min(255, rr * 255 / a); gg = Math.min(255, gg * 255 / a); bb = Math.min(255, bb * 255 / a); }
      px[i * 4] = rr; px[i * 4 + 1] = gg; px[i * 4 + 2] = bb; px[i * 4 + 3] = a;
    }
  } else if (format === 4) {
    const rowBytes = ((w * 2) + 3) & ~3;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const v = (raw[y * rowBytes + x * 2] << 8) | raw[y * rowBytes + x * 2 + 1];
      const o = (y * w + x) * 4;
      px[o] = ((v >> 10) & 31) * 255 / 31; px[o + 1] = ((v >> 5) & 31) * 255 / 31; px[o + 2] = (v & 31) * 255 / 31; px[o + 3] = 255;
    }
  }
  const c = makeCanvas(w, h);
  c.getContext('2d').putImageData(img, 0, 0);
  return { id, canvas: c, width: w, height: h, imageData: img };
}

function fixJpeg(bytes) {
  // Strip the erroneous FFD9FFD8 header some SWF encoders emit.
  let b = bytes;
  if (b[0] === 0xff && b[1] === 0xd9 && b[2] === 0xff && b[3] === 0xd8) b = b.subarray(4);
  // Also remove embedded EOI/SOI pairs.
  const out = [];
  for (let i = 0; i < b.length; i++) {
    if (i > 2 && b[i] === 0xff && b[i + 1] === 0xd9 && b[i + 2] === 0xff && b[i + 3] === 0xd8 && i + 4 < b.length) { i += 3; continue; }
    out.push(b[i]);
  }
  return new Uint8Array(out);
}

async function decodeJpeg(tag, tables) {
  const r = new Reader(tag.data);
  const id = r.u16();
  let alphaOffset = -1;
  if (tag.code === 35) alphaOffset = r.u32();
  let img = alphaOffset >= 0 ? tag.data.subarray(r.pos, r.pos + alphaOffset) : tag.data.subarray(r.pos);
  const isJpeg = img[0] === 0xff;
  if (tag.code === 6 && tables) img = concat(tables.subarray(0, tables.length - 2), img.subarray(2));
  if (isJpeg) img = fixJpeg(img);
  const bmp = await createImageBitmap(new Blob([img]));
  const c = makeCanvas(bmp.width, bmp.height);
  const ctx = c.getContext('2d');
  ctx.drawImage(bmp, 0, 0);
  if (alphaOffset >= 0) {
    const alpha = await inflate(tag.data.subarray(r.pos + alphaOffset));
    const d = ctx.getImageData(0, 0, c.width, c.height);
    for (let i = 0; i < c.width * c.height; i++) {
      const a = alpha[i];
      d.data[i * 4 + 3] = a;
      // Colour data is premultiplied by alpha; unpremultiply.
      if (a > 0 && a < 255) for (let k = 0; k < 3; k++) d.data[i * 4 + k] = Math.min(255, d.data[i * 4 + k] * 255 / a);
    }
    ctx.putImageData(d, 0, 0);
  }
  return { id, canvas: c, width: c.width, height: c.height };
}

function concat(a, b) { const o = new Uint8Array(a.length + b.length); o.set(a, 0); o.set(b, a.length); return o; }

// ---------------------------------------------------------------- tags

function parsePlace(r, code, end) {
  const p = { code };
  if (code === 26 || code === 70) {
    const f = r.u8();
    let f2 = 0;
    if (code === 70) f2 = r.u8();
    p.move = !!(f & 1);
    p.hasCharacter = !!(f & 2);
    p.depth = r.u16();
    if (code === 70 && ((f2 & 8) || ((f2 & 16) && (f & 2)))) p.className = r.str();
    if (p.hasCharacter) p.characterId = r.u16();
    if (f & 4) p.matrix = r.matrix();
    if (f & 8) p.cxform = r.cxform(true);
    if (f & 16) p.ratio = r.u16();
    if (f & 32) p.name = r.str();
    if (f & 64) p.clipDepth = r.u16();
    if (code === 70) {
      if (f2 & 1) p.filters = readFilters(r);
      if (f2 & 2) p.blendMode = r.u8();
      if (f2 & 4) p.cacheAsBitmap = r.u8();
      if (f2 & 32) p.visible = r.u8();
      if (f2 & 64) p.bgColor = r.rgba();
    }
  } else if (code === 4) {
    p.hasCharacter = true;
    p.characterId = r.u16();
    p.depth = r.u16();
    p.matrix = r.matrix();
    if (r.pos < end) p.cxform = r.cxform(false);
  }
  return p;
}

function readFilters(r) {
  const n = r.u8();
  const out = [];
  for (let i = 0; i < n; i++) {
    const id = r.u8();
    const f = { id };
    switch (id) {
      case 0: // drop shadow
        f.color = r.rgba(); f.blurX = r.u32() / 65536; f.blurY = r.u32() / 65536; f.angle = r.u32() / 65536; f.distance = r.u32() / 65536; f.strength = r.fixed8();
        f.flags = r.u8(); break;
      case 1: f.blurX = r.u32() / 65536; f.blurY = r.u32() / 65536; f.passes = r.u8() >> 3; break;
      case 2: // glow
        f.color = r.rgba(); f.blurX = r.u32() / 65536; f.blurY = r.u32() / 65536; f.strength = r.fixed8(); f.flags = r.u8(); break;
      case 3: // bevel
        f.shadow = r.rgba(); f.highlight = r.rgba(); f.blurX = r.u32() / 65536; f.blurY = r.u32() / 65536; f.angle = r.u32() / 65536; f.distance = r.u32() / 65536; f.strength = r.fixed8(); f.flags = r.u8(); break;
      case 4: case 7: { // gradient glow / bevel
        const nc = r.u8(); f.colors = []; for (let k = 0; k < nc; k++) f.colors.push(r.rgba());
        f.ratios = []; for (let k = 0; k < nc; k++) f.ratios.push(r.u8());
        f.blurX = r.u32() / 65536; f.blurY = r.u32() / 65536; f.angle = r.u32() / 65536; f.distance = r.u32() / 65536; f.strength = r.fixed8(); f.flags = r.u8(); break;
      }
      case 5: { // convolution
        const mx = r.u8(), my = r.u8(); f.divisor = r.u32(); f.bias = r.u32();
        for (let k = 0; k < mx * my; k++) r.u32();
        r.rgba(); r.u8(); break;
      }
      case 6: f.matrix = []; for (let k = 0; k < 20; k++) { const v = r.view.getFloat32(r.pos, true); r.pos += 4; f.matrix.push(v); } break;
    }
    out.push(f);
  }
  return out;
}

export class SWF {
  constructor() {
    this.characters = new Map(); // id -> {kind, ...}
    this.symbols = new Map();    // class name -> id
    this.frameRate = 12;
    this.frameCount = 1;
    this.width = 0; this.height = 0;
  }

  static async load(bytes) {
    const swf = new SWF();
    await swf.parse(bytes);
    return swf;
  }

  async parse(bytes) {
    const sig = String.fromCharCode(bytes[0], bytes[1], bytes[2]);
    let body;
    if (sig === 'CWS') body = concat(bytes.subarray(0, 8), await inflate(bytes.subarray(8)));
    else if (sig === 'FWS') body = bytes;
    else throw new Error('Unsupported SWF signature ' + sig);
    const r = new Reader(body, 8);
    const frame = r.rect();
    this.width = (frame.xmax - frame.xmin) / 20;
    this.height = (frame.ymax - frame.ymin) / 20;
    r.u8(); this.frameRate = r.u8();
    this.frameCount = r.u16();
    const pending = [];
    this.rootFrames = this.readTags(r, body.length, pending, true);
    await Promise.all(pending);
  }

  readTags(r, end, pending, isRoot) {
    const frames = [[]];
    let jpegTables = null;
    while (r.pos < end) {
      const hdr = r.u16();
      const code = hdr >> 6;
      let len = hdr & 0x3f;
      if (len === 0x3f) len = r.u32();
      const start = r.pos;
      const tagEnd = start + len;
      const data = r.b.subarray(start, tagEnd);
      const tr = new Reader(r.b, start);
      switch (code) {
        case 0: r.pos = tagEnd; return frames;
        case 1: frames.push([]); break;
        case 2: case 22: case 32: case 83: {
          const ver = code === 2 ? 1 : code === 22 ? 2 : code === 32 ? 3 : 4;
          const id = tr.u16();
          const bounds = tr.rect();
          let winding = false;
          if (ver === 4) { tr.rect(); const fl = tr.u8(); winding = !!(fl & 4); }
          try {
            const layers = buildShape(tr, ver);
            this.characters.set(id, { kind: 'shape', id, bounds, layers, winding });
          } catch (e) { console.warn('shape', id, e); }
          break;
        }
        case 39: {
          const id = tr.u16();
          const fc = tr.u16();
          const sframes = this.readTags(tr, tagEnd, pending, false);
          if (sframes.length > 1 && sframes[sframes.length - 1].length === 0) sframes.pop();
          this.characters.set(id, { kind: 'sprite', id, frameCount: fc, frames: sframes });
          break;
        }
        case 4: case 26: case 70: frames[frames.length - 1].push(parsePlace(tr, code, tagEnd)); break;
        case 5: tr.u16(); frames[frames.length - 1].push({ code: 28, depth: tr.u16() }); break;
        case 28: frames[frames.length - 1].push({ code: 28, depth: tr.u16() }); break;
        case 8: jpegTables = data; break;
        case 20: case 36: pending.push(decodeLossless({ code, data }, code === 36).then((b) => this.characters.set(b.id, { kind: 'bitmap', ...b })).catch((e) => console.warn('bitmap', e))); break;
        case 6: case 21: case 35: {
          const tables = jpegTables;
          pending.push(decodeJpeg({ code, data }, tables).then((b) => this.characters.set(b.id, { kind: 'bitmap', ...b })).catch((e) => console.warn('jpeg', e)));
          break;
        }
        case 76: {
          const n = tr.u16();
          for (let i = 0; i < n; i++) { const id = tr.u16(); const name = tr.str(); this.symbols.set(name, id); }
          break;
        }
        case 37: {
          const id = tr.u16();
          this.characters.set(id, { kind: 'text', id, bounds: tr.rect() });
          break;
        }
        default: break;
      }
      r.pos = tagEnd;
    }
    return frames;
  }

  getCharacterByName(name) {
    const id = this.symbols.get(name);
    return id === undefined ? null : this.characters.get(id);
  }
}

export { makeCanvas };
