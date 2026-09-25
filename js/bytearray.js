// Minimal port of flash.utils.ByteArray (big-endian) plus an AMF3 decoder.

export class ByteArray {
  constructor(bytes) {
    this.bytes = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes || 0);
    this.view = new DataView(this.bytes.buffer, this.bytes.byteOffset, this.bytes.byteLength);
    this.position = 0;
  }
  get length() { return this.bytes.length; }
  get bytesAvailable() { return this.bytes.length - this.position; }
  _need(n) { if (this.position + n > this.bytes.length) throw new Error('EOFError'); }
  readUnsignedByte() { this._need(1); return this.bytes[this.position++]; }
  readByte() { this._need(1); return this.view.getInt8(this.position++); }
  readShort() { this._need(2); const v = this.view.getInt16(this.position); this.position += 2; return v; }
  readUnsignedShort() { this._need(2); const v = this.view.getUint16(this.position); this.position += 2; return v; }
  readInt() { this._need(4); const v = this.view.getInt32(this.position); this.position += 4; return v; }
  readUnsignedInt() { this._need(4); const v = this.view.getUint32(this.position); this.position += 4; return v; }
  readFloat() { this._need(4); const v = this.view.getFloat32(this.position); this.position += 4; return v; }
  readDouble() { this._need(8); const v = this.view.getFloat64(this.position); this.position += 8; return v; }
  readUTFBytes(n) { this._need(n); const s = new TextDecoder().decode(this.bytes.subarray(this.position, this.position + n)); this.position += n; return s; }
  readBytesRaw(n) { this._need(n); const b = this.bytes.slice(this.position, this.position + n); this.position += n; return b; }
  readObject() { return new AMF3Reader(this).readValue(); }
  // Emulates flash.utils.ByteArray.uncompress() (zlib) in place.
  async uncompress() {
    const out = await inflate(this.bytes);
    this.bytes = out;
    this.view = new DataView(out.buffer, out.byteOffset, out.byteLength);
    this.position = 0;
  }
  clone() { const b = new ByteArray(this.bytes.slice()); return b; }
  toString() { return new TextDecoder().decode(this.bytes); }
}

export class AMF3Reader {
  // Class-alias registry (flash.net.registerClassAlias equivalent).
  static classes = {};
  constructor(ba) {
    this.ba = ba;
    this.strings = [];
    this.objects = [];
    this.traits = [];
  }
  u29() {
    let v = 0, b, i = 0;
    const ba = this.ba;
    while (i < 3) {
      b = ba.readUnsignedByte();
      if (b & 0x80) { v = (v << 7) | (b & 0x7f); i++; }
      else { return (v << 7) | b; }
    }
    b = ba.readUnsignedByte();
    return (v << 8) | b;
  }
  str() {
    const ref = this.u29();
    if ((ref & 1) === 0) return this.strings[ref >> 1];
    const len = ref >> 1;
    if (len === 0) return '';
    const s = this.ba.readUTFBytes(len);
    this.strings.push(s);
    return s;
  }
  readValue() {
    const m = this.ba.readUnsignedByte();
    switch (m) {
      case 0x00: return undefined;
      case 0x01: return null;
      case 0x02: return false;
      case 0x03: return true;
      case 0x04: { let v = this.u29(); if (v & 0x10000000) v -= 0x20000000; return v; }
      case 0x05: return this.ba.readDouble();
      case 0x06: return this.str();
      case 0x07: case 0x0b: { // XML doc / XML
        const ref = this.u29();
        if ((ref & 1) === 0) return this.objects[ref >> 1];
        const s = this.ba.readUTFBytes(ref >> 1);
        this.objects.push(s);
        return s;
      }
      case 0x08: {
        const ref = this.u29();
        if ((ref & 1) === 0) return this.objects[ref >> 1];
        const d = new Date(this.ba.readDouble());
        this.objects.push(d);
        return d;
      }
      case 0x09: {
        const ref = this.u29();
        if ((ref & 1) === 0) return this.objects[ref >> 1];
        const len = ref >> 1;
        const arr = [];
        this.objects.push(arr);
        for (;;) {
          const k = this.str();
          if (k === '') break;
          arr[k] = this.readValue();
        }
        for (let i = 0; i < len; i++) arr[i] = this.readValue();
        return arr;
      }
      case 0x0a: {
        const ref = this.u29();
        if ((ref & 1) === 0) return this.objects[ref >> 1];
        let t;
        if ((ref & 3) === 1) t = this.traits[ref >> 2];
        else {
          t = { ext: (ref & 4) !== 0, dyn: (ref & 8) !== 0, cls: this.str(), props: [] };
          const n = ref >> 4;
          for (let i = 0; i < n; i++) t.props.push(this.str());
          this.traits.push(t);
        }
        const Cls = t.cls ? AMF3Reader.classes[t.cls] : null;
        const obj = Cls ? new Cls() : {};
        if (t.cls && !Cls) obj.__class = t.cls;
        this.objects.push(obj);
        if (t.ext) throw new Error('Externalizable not supported: ' + t.cls);
        for (const p of t.props) obj[p] = this.readValue();
        if (t.dyn) {
          for (;;) {
            const k = this.str();
            if (k === '') break;
            obj[k] = this.readValue();
          }
        }
        return obj;
      }
      case 0x0c: {
        const ref = this.u29();
        if ((ref & 1) === 0) return this.objects[ref >> 1];
        const b = new ByteArray(this.ba.readBytesRaw(ref >> 1));
        this.objects.push(b);
        return b;
      }
      default:
        throw new Error('Unsupported AMF3 marker 0x' + m.toString(16) + ' at ' + (this.ba.position - 1));
    }
  }
}

// zlib inflate (ByteArray.uncompress) using the platform DecompressionStream,
// or node's zlib when available.
export async function inflate(bytes) {
  if (typeof DecompressionStream !== 'undefined') {
    const ds = new DecompressionStream('deflate');
    const stream = new Blob([bytes]).stream().pipeThrough(ds);
    return new Uint8Array(await new Response(stream).arrayBuffer());
  }
  const zlib = await import('node:zlib');
  return new Uint8Array(zlib.inflateSync(bytes));
}
