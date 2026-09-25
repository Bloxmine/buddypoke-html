// Port of com.buddylabs.player.BitStream and EBDecompression (Edgebreaker
// mesh decompression). The control flow mirrors the ActionScript exactly;
// AS3 int parameters are emulated with `|0` coercion.

export class BitStream {
  constructor(ba) {
    if (ba) ba.position = 0;
    this.base = ba;
    this.bitBuffer = 0;
    this.curPos = 0;
  }
  readBit() {
    if (this.curPos === 0) this.bitBuffer = this.base.readUnsignedByte();
    const r = ((1 << (7 - this.curPos)) & this.bitBuffer) > 0 ? 1 : 0;
    this.curPos = (this.curPos + 1) % 8;
    return r;
  }
  readBits(n) {
    let v = 0;
    n--;
    for (let i = 0; i <= n; i++) v |= this.readBit() << (n - i);
    return v;
  }
  byteAlign() { if (this.curPos !== 0) this.curPos = 0; }
}

function readFloatArrayInts(ba) {
  const out = [];
  ba.position = 0;
  while (ba.bytesAvailable > 0) out.push(ba.readInt());
  return out;
}

class Coord3D {
  constructor() {
    this.x = 0; this.y = 0; this.z = 0; this.u = 0; this.v = 0;
    this.morphDeltas = null; this.morphChannel = null;
    this.numBones = 0; this.boneIndex = null; this.boneWeight = null;
  }
}

const nextEdge = (e) => { e |= 0; return 3 * ((e / 3) | 0) + ((e + 1) % 3); };
const prevEdge = (e) => nextEdge(nextEdge(e));
const e2T = (e) => ((e | 0) / 3) | 0;

export class EBDecompression {
  constructor() {
    this.A = 0; this.T = 0; this.N = 0;
    this.C = null; this.G = null; this.H = null; this.M = null; this.O = null; this.U = null; this.V = null;
    this.G_in = null; this.triCullRegion = null;
    this.cullmin = 0; this.quantcull = null; this.quantcullbits = 0; this.hasCulling = false;
  }

  leftTri(e, arr) { return arr[nextEdge(nextEdge(e))]; }
  rightTri(e, arr) { return arr[nextEdge(e)]; }

  readCler(bs) {
    if (bs.readBit() === 0) return 'C';
    switch (bs.readBits(2)) {
      case 2: return 'L';
      case 3: return 'E';
      case 1: return 'R';
      case 0: return 'S';
      default: return 'C';
    }
  }

  decompressConnectivity(c) {
    c |= 0;
    const O = this.O, V = this.V;
    loop0: for (;;) {
      if (this.hasCulling) this.triCullRegion[this.T] = this.quantcull.readBits(this.quantcullbits) + this.cullmin;
      ++this.T;
      const t3 = 3 * this.T;
      O[c] = t3;
      O[t3] = c;
      V[t3 + 1] = V[prevEdge(c)];
      V[t3 + 2] = V[nextEdge(c)];
      c = nextEdge(O[c]);
      switch (this.C[this.T - 1]) {
        case 'C':
          O[nextEdge(c)] = -1;
          V[t3] = ++this.N;
          break;
        case 'L':
          O[nextEdge(c)] = -2;
          if (!this.checkHandle(nextEdge(c))) this.zip(nextEdge(c));
          break;
        case 'R':
          O[c] = -2;
          this.checkHandle(c);
          c = nextEdge(c);
          break;
        case 'S':
          this.decompressConnectivity(c);
          c = nextEdge(c);
          if (O[c] >= 0) return;
          break;
        case 'E':
          break loop0;
      }
    }
    O[c] = -2;
    O[nextEdge(c)] = -2;
    this.checkHandle(c);
    if (this.checkHandle(nextEdge(c)) === false) this.zip(nextEdge(c));
  }

  zip(c) {
    c |= 0;
    const O = this.O, V = this.V;
    let b = nextEdge(c);
    while (O[b] >= 0 && O[b] !== c) b = nextEdge(O[b]);
    if (O[b] !== -1) return;
    O[c] = b;
    O[b] = c;
    let a = nextEdge(c);
    const vv = V[nextEdge(b)] | 0;
    V[nextEdge(a)] = vv;
    while (O[a] >= 0 && a !== b) {
      a = nextEdge(O[a]);
      V[nextEdge(a)] = vv;
    }
    c = prevEdge(c);
    while (O[c] >= 0 && c !== b) c = prevEdge(O[c]);
    if (O[c] === -2) this.zip(c);
  }

  checkHandle(c) {
    c |= 0;
    const O = this.O, H = this.H;
    if (this.A >= H.length || c !== H[this.A + 1]) return false;
    O[c] = H[this.A];
    O[H[this.A]] = c;
    let a = prevEdge(c);
    while (O[a] >= 0 && a !== H[this.A]) a = prevEdge(O[a]);
    if (O[a] === -2) this.zip(a);
    a = prevEdge(O[c]);
    while (O[a] >= 0 && a !== c) a = prevEdge(O[a]);
    if (O[a] === -2) this.zip(a);
    this.A += 2;
    return true;
  }

  decompressVertices(c) {
    c |= 0;
    const U = this.U, V = this.V, M = this.M, O = this.O;
    for (;;) {
      U[e2T(c)] = 1;
      const v = V[c];
      if (M[v] === 0) {
        ++this.N;
        this.G[this.N] = this.G_in[v];
        M[v] = 1;
        c = this.rightTri(c, O) | 0;
      } else if (U[e2T(this.rightTri(c, O))] === 1) {
        if (U[e2T(this.leftTri(c, O))] === 1) break;
        c = this.leftTri(c, O) | 0;
      } else if (U[e2T(this.leftTri(c, O))] === 1) {
        c = this.rightTri(c, O) | 0;
      } else {
        this.decompressVertices(this.rightTri(c, O));
        c = this.leftTri(c, O) | 0;
        if (U[e2T(c)] > 0) return;
      }
    }
  }

  decompressMesh(mesh) {
    if (mesh.ebc == null) return;
    const ebc = mesh.ebc;
    const mod = mesh.modifier;
    let mebc = null;
    if (mod != null) mebc = mod.ebc;
    const hasMod = mebc != null;
    this.hasCulling = ebc.cull != null;
    if (this.hasCulling) this.quantcull = new BitStream(ebc.cull);
    this.cullmin = ebc.cullMin | 0;
    if (this.hasCulling === false) mesh.cullAllIndex = this.cullmin;
    this.quantcullbits = ebc.numCullBits | 0;
    const numVerts = mesh.numVerts | 0;
    this.G_in = new Array(numVerts);
    this.G = new Array(numVerts);

    ebc.bounds.position = 0;
    const bx0 = ebc.bounds.readFloat(), by0 = ebc.bounds.readFloat(), bz0 = ebc.bounds.readFloat();
    const bx1 = ebc.bounds.readFloat(), by1 = ebc.bounds.readFloat(), bz1 = ebc.bounds.readFloat();
    ebc.mapBounds.position = 0;
    const mu0 = ebc.mapBounds.readFloat(), mv0 = ebc.mapBounds.readFloat();
    const mu1 = ebc.mapBounds.readFloat(), mv1 = ebc.mapBounds.readFloat();
    const vmax = (1 << ebc.vertBits) - 1;
    const dmax = hasMod ? (1 << mebc.deltaBits) - 1 : 0;
    const smax = hasMod ? (1 << mebc.skinBits) - 1 : 0;
    const mmax = (1 << ebc.mapVertBits) - 1;
    const sx = (bx1 - bx0) / vmax, sy = (by1 - by0) / vmax, sz = (bz1 - bz0) / vmax;
    const su = (mu1 - mu0) / mmax, sv = (mv1 - mv0) / mmax;
    let dx0 = 0, dy0 = 0, dz0 = 0, dsx = 0, dsy = 0, dsz = 0;
    let deltaBS = null;
    if (hasMod) {
      deltaBS = mebc.delta != null ? new BitStream(mebc.delta) : null;
      if (mebc.deltaBounds != null && deltaBS != null) {
        mebc.deltaBounds.position = 0;
        dx0 = mebc.deltaBounds.readFloat(); dy0 = mebc.deltaBounds.readFloat(); dz0 = mebc.deltaBounds.readFloat();
        const dx1 = mebc.deltaBounds.readFloat(), dy1 = mebc.deltaBounds.readFloat(), dz1 = mebc.deltaBounds.readFloat();
        dsx = (dx1 - dx0) / dmax; dsy = (dy1 - dy0) / dmax; dsz = (dz1 - dz0) / dmax;
      }
    }
    const hasSkin = mebc != null && mebc.skin != null;
    const skinBS = hasMod && hasSkin ? new BitStream(mebc.skin) : null;
    const vertBS = new BitStream(ebc.verts);
    const mapBS = new BitStream(ebc.mapVerts);
    let numChannels = 0;
    if (mod != null && mod.channels != null) numChannels = mod.channels.length;

    for (let i = 0; i < numVerts; i++) {
      const g = new Coord3D();
      this.G_in[i] = g;
      g.x = vertBS.readBits(ebc.vertBits) * sx + bx0;
      g.y = vertBS.readBits(ebc.vertBits) * sy + by0;
      g.z = vertBS.readBits(ebc.vertBits) * sz + bz0;
      g.u = mapBS.readBits(ebc.mapVertBits) * su + mu0;
      g.v = mapBS.readBits(ebc.mapVertBits) * sv + mv0;
      if (deltaBS != null) {
        g.morphDeltas = new Array(numChannels * 3);
        g.morphChannel = [];
        let k = 0;
        for (let ch = 0; ch < numChannels; ch++) {
          if (deltaBS.readBit() === 0) {
            g.morphDeltas[k++] = 0; g.morphDeltas[k++] = 0; g.morphDeltas[k++] = 0;
          } else {
            g.morphDeltas[k++] = deltaBS.readBits(mebc.deltaBits) * dsx + dx0;
            g.morphDeltas[k++] = deltaBS.readBits(mebc.deltaBits) * dsy + dy0;
            g.morphDeltas[k++] = deltaBS.readBits(mebc.deltaBits) * dsz + dz0;
          }
        }
      }
      if (hasSkin) {
        g.numBones = skinBS.readBits(mebc.nbpvb);
        g.boneIndex = new Array(g.numBones);
        g.boneWeight = new Array(g.numBones);
        for (let b = 0; b < g.numBones; b++) {
          g.boneIndex[b] = skinBS.readBits(mebc.nbib);
          g.boneWeight[b] = 1;
        }
        skinBS.byteAlign();
        if (g.numBones > 1) {
          for (let b = 0; b < g.numBones; b++) g.boneWeight[b] = skinBS.readBits(mebc.skinBits) / smax;
        }
        skinBS.byteAlign();
      }
      this.G[i] = g;
    }

    this.H = ebc.handles != null ? readFloatArrayInts(ebc.handles) : [];
    const numFaces = mesh.numFaces | 0;
    const V = this.V = new Array(3 * numFaces);
    const O = this.O = new Array(3 * numFaces);
    for (let i = 0; i < 3 * numFaces; i++) { O[i] = -3; V[i] = 0; }
    this.U = new Array(numFaces).fill(0);
    this.M = new Array(numVerts).fill(0);
    if (this.hasCulling) this.triCullRegion = new Array(numFaces).fill(0);

    const faces1st = readFloatArrayInts(ebc.numFaces1st);
    const numComponents = faces1st.length;
    const numClers = readFloatArrayInts(ebc.numClers);
    let total = 0;
    for (let i = 0; i < numComponents; i++) total += faces1st[i] - 2 + 1 + numClers[i] + 1;
    this.C = new Array(total);
    this.N = 0;
    let start = 0;
    let ci = 0;
    const clerBS = new BitStream(ebc.clers);
    for (let comp = 0; comp < numComponents; comp++) {
      const nf = faces1st[comp] | 0;
      const nc = numClers[comp] | 0;
      for (let k = 0; k < O.length; k++) {
        if (O[k] === -3) { start = k; break; }
      }
      for (let k = 0; k < nf - 2; k++) this.C[ci++] = 'C';
      this.C[ci++] = 'R';
      for (let k = 0; k < nc; k++) this.C[ci++] = this.readCler(clerBS);
      ci++;
      this.N += 2;
      V[0 + start] = this.N - 2;
      V[1 + start] = this.N;
      V[2 + start] = this.N - 1;
      O[0 + start] = -1;
      O[1 + start] = -1;
      this.decompressConnectivity(start + 2);
      if (this.hasCulling) this.triCullRegion[this.T] = this.quantcull.readBits(this.quantcullbits) + this.cullmin;
      ++this.N;
      ++this.T;
    }
    const G = this.G, G_in = this.G_in, M = this.M;
    G[0] = G_in[V[0]]; M[0] = 1;
    G[1] = G_in[V[2]]; M[1] = 1;
    G[2] = G_in[V[1]]; M[2] = 1;
    this.N = 2;
    this.U[0] = 1;
    this.decompressVertices(O[2]);

    if (numChannels > 0) {
      const delta = new Array(numVerts * 3 * numChannels);
      let k = 0, off = 0;
      for (let ch = 0; ch < numChannels; ch++) {
        for (let i = 0; i < numVerts; i++) {
          delta[k++] = G[i].morphDeltas[off];
          delta[k++] = G[i].morphDeltas[off + 1];
          delta[k++] = G[i].morphDeltas[off + 2];
        }
        off += 3;
      }
      mesh.modifier.delta = delta;
      mesh.modifier.numTargets = numChannels;
      mesh.modifier.hasMorpher = true;
    }
    if (hasSkin) {
      const numBonesArr = new Array(numVerts);
      const boneIndex = [];
      const boneWeight = [];
      for (let i = 0; i < numVerts; i++) {
        numBonesArr[i] = G[i].numBones | 0;
        for (let b = 0; b < G[i].boneIndex.length; b++) boneIndex.push(G[i].boneIndex[b] | 0);
        for (let b = 0; b < G[i].boneIndex.length; b++) boneWeight.push(Number(G[i].boneWeight[b]));
      }
      mesh.modifier.boneIndex = boneIndex;
      mesh.modifier.boneWeight = boneWeight;
      mesh.modifier.numBones = numBonesArr;
      mesh.modifier.hasSkin = true;
    }
    const verts = new Array(numVerts * 3);
    const mapVerts = new Array(numVerts * 3);
    let a = 0, b = 0;
    for (let i = 0; i < numVerts; i++) {
      verts[a++] = G[i].x; verts[a++] = G[i].y; verts[a++] = G[i].z;
      mapVerts[b++] = G[i].u; mapVerts[b++] = G[i].v; mapVerts[b++] = 0;
    }
    mesh.verts = verts;
    mesh.faces = V;
    mesh.mapVerts = mapVerts;
    if (this.hasCulling) mesh.cull = this.triCullRegion;
  }
}
