// Port of the com.buddylabs.player scene graph: BaseObj, Node, Bone, Scene,
// Camera, Mesh, Modifier, Anim, Controller and the serialisation-only
// helper classes. Instances are created by the AMF3 decoder through the
// class-alias registry at the bottom of this file (mirroring
// registerClassAlias in Player.loadObject).

import { GLMatrix, Vector3, AxisAngle } from './math.js';
import { EBDecompression } from './ebdecompression.js';
import { ByteArray } from '../bytearray.js';

const readVector3 = (ba) => { ba.position = 0; return new Vector3(ba.readFloat(), ba.readFloat(), ba.readFloat()); };
const readAxisAngle = (ba) => { ba.position = 0; return new AxisAngle(ba.readFloat(), ba.readFloat(), ba.readFloat(), ba.readFloat()); };

export class BaseObj {
  constructor() { this.name = null; }
  init(ctx) { if (this.name != null) ctx.scene.nodeMap[this.name] = this; }
  draw(ctx) {}
}

export class Node extends BaseObj {
  constructor() {
    super();
    this.pos = null; this.rot = null; this.scale = null;
    this.cpos = null; this.crot = null; this.cscale = null;
    this.deformPos = null; this.deformRot = null; this.deformScale = null; this.parentDeformScale = null;
    this.localToWorldTransform = new GLMatrix();
    this.transform = new GLMatrix();
    this.prevLocalToWorldTransform = null;
    this.initialTransform = null; this.invInitialTransform = null;
    this.mesh = null;
    this.visible = true;
    this.children = null;
  }

  addChild(c) { if (this.children == null) this.children = []; this.children.push(c); }
  removeChild(c) {
    if (this.children == null || c == null) return;
    const i = this.children.indexOf(c);
    if (i >= 0) this.children.splice(i, 1);
  }

  pushMatrix(ctx) {
    const t = this.transform;
    if (this.pos == null) t.glLoadIdentity(); else t.glIdentityTranslatef(this.pos.x, this.pos.y, this.pos.z);
    if (this.parentDeformScale != null) t.glScalef(this.parentDeformScale.x, this.parentDeformScale.y, this.parentDeformScale.z);
    if (this.rot != null && this.rot.angle !== 0) t.glRotateRad(this.rot.angle, this.rot.x, this.rot.y, this.rot.z);
    if (this.scale != null) t.glScalef(this.scale.x, this.scale.y, this.scale.z);
    if (this.deformPos != null) t.glTranslatef(this.deformPos.x, this.deformPos.y, this.deformPos.z);
    if (this.deformRot != null && this.deformRot.angle !== 0) t.glRotateRad(this.deformRot.angle, this.deformRot.x, this.deformRot.y, this.deformRot.z);
    if (this.deformScale != null) t.glScalef(this.deformScale.x, this.deformScale.y, this.deformScale.z);
    this.prevLocalToWorldTransform = ctx.hworld;
    ctx.hworld.copyTo(this.localToWorldTransform);
    this.localToWorldTransform.glMultMatrix(t);
    ctx.hworld = this.localToWorldTransform;
  }
  popMatrix(ctx) { ctx.hworld = this.prevLocalToWorldTransform; }

  draw(ctx) {
    this.pushMatrix(ctx);
    if (this.mesh != null && this.visible && this.mesh.material != null) {
      this.mesh.material.update();
      this.mesh.draw(ctx);
    }
    if (this.children != null) {
      const n = this.children.length;
      for (let i = 0; i < n; i++) this.children[i].draw(ctx);
    }
    this.popMatrix(ctx);
  }

  getWorldPosition(v) {
    v.x = this.localToWorldTransform.m12;
    v.y = this.localToWorldTransform.m13;
    v.z = this.localToWorldTransform.m14;
  }

  init(ctx) {
    super.init(ctx);
    if (this.cpos != null) { this.pos = readVector3(this.cpos); this.cpos = null; }
    if (this.crot != null) { this.rot = readAxisAngle(this.crot); this.crot = null; }
    // (The original tests cpos here, which is always null by now, so cscale
    // is never applied. Kept as-is.)
    if (this.cpos != null) { this.scale = readVector3(this.cscale); this.cscale = null; }
    const t = this.transform;
    t.glLoadIdentity();
    if (this.pos != null) t.glTranslatef(this.pos.x, this.pos.y, this.pos.z);
    if (this.rot != null && this.rot.angle !== 0) t.glRotateRad(this.rot.angle, this.rot.x, this.rot.y, this.rot.z);
    if (this.scale != null) t.glScalef(this.scale.x, this.scale.y, this.scale.z);
    this.prevLocalToWorldTransform = ctx.hworld;
    ctx.hworld.copyTo(this.localToWorldTransform);
    this.localToWorldTransform.glMultMatrix(t);
    ctx.hworld = this.localToWorldTransform;
    const w = ctx.hworld;
    this.initialTransform = new GLMatrix();
    this.invInitialTransform = new GLMatrix();
    this.localToWorldTransform = new GLMatrix();
    w.copyTo(this.initialTransform);
    this.initialTransform.copyTo(this.invInitialTransform);
    this.invInitialTransform.inverseMatrix4();
    if (this.children != null) {
      for (let i = 0; i < this.children.length; i++) this.children[i].init(ctx);
    }
    ctx.hworld = this.prevLocalToWorldTransform;
  }
}

export class Bone extends Node {}

export class Scene extends Node {
  constructor() {
    super();
    this.cull = null; this.cullDict = null;
    this.backgroundColor = NaN;
    this.cullRegions = null; this.bones = null; this.props = null;
    this.propDict = null; this.nodeMap = null;
  }
  draw(ctx) {
    if (!this.visible) return;
    const prev = ctx.scene;
    ctx.scene = this;
    super.draw(ctx);
    ctx.scene = prev;
  }
  hideProps() {
    if (this.propDict != null) for (const k in this.propDict) { const n = this.propDict[k]; if (n != null) n.visible = false; }
  }
  init(ctx) {
    if (this.cullRegions != null && (this.cull == null || this.cullRegions.length !== this.cull.length)) {
      this.cull = new Array(this.cullRegions.length).fill(false);
      this.cullDict = {};
      for (let i = 0; i < this.cull.length; i++) this.cullDict[this.cullRegions[i]] = i;
    }
    if (isNaN(this.backgroundColor)) this.backgroundColor = 0xffffff;
    super.init(ctx);
    if (this.props != null) {
      this.propDict = {};
      for (const p of this.props) {
        const n = this.getNodeByName(p);
        if (n != null) this.propDict[p] = n;
      }
    }
  }
  cullByName(name) {
    if (this.cullRegions == null || this.cull == null) return;
    const i = this.cullDict[name] | 0; // int(undefined) === 0, as in AS3
    this.cull[i] = true;
  }
  getNodeByName(name) { return this.nodeMap[name]; }
  resetCulling() { for (let i = 0; i < this.cull.length; i++) this.cull[i] = false; }
  getBoneByIndex(i) { return this.getNodeByName(this.bones[i]); }
  addChild(c) {
    super.addChild(c);
    if (c.name != null) this.nodeMap[c.name] = c;
  }
}

export class Camera extends BaseObj {
  constructor() {
    super();
    this.lookAtRot = null; this.centerOffset = null;
    this.fov = 0.785398;
    this.cpos = null; this.crot = null;
    this.rot = null; this.pos = null;
    this.view = new GLMatrix();
    this.cameraToWorld = new GLMatrix();
    this.isBound = false; this.lookAt = null;
    this.ortho = false; // orthographic (paper buddies), July 2009 engine
  }
  update(ctx) {
    const view = this.view;
    const applyCenterOffset = () => {
      if (this.centerOffset != null) {
        const f = 1 / Math.tan(this.fov / 2);
        const ax = this.centerOffset.x / (ctx.width * 0.5) / f;
        const ay = -(this.centerOffset.y / (ctx.height * 0.5));
        view.glRotateRad(ax, 0, -1, 0);
        view.glRotateRad(ay, 1, 0, 0);
      }
    };
    if (this.lookAt != null) {
      let tx, ty, tz;
      if (Array.isArray(this.lookAt)) { tx = +this.lookAt[0]; ty = +this.lookAt[1]; tz = +this.lookAt[2]; }
      else { const m = this.lookAt.localToWorldTransform; tx = m.m12; ty = m.m13; tz = m.m14; }
      view.glLoadIdentity();
      view.gluLookAt(this.pos.x, this.pos.y, this.pos.z, tx, ty, tz, 0, 1, 0);
      if (this.lookAtRot == null) this.lookAtRot = new AxisAngle();
      view.matrixToAxisAngle(this.lookAtRot);
      view.glLoadIdentity();
      applyCenterOffset();
      view.glRotateRad(-this.lookAtRot.angle, this.lookAtRot.x, this.lookAtRot.y, this.lookAtRot.z);
      view.glTranslatef(-this.pos.x, -this.pos.y, -this.pos.z);
    } else {
      view.glLoadIdentity();
      applyCenterOffset();
      if (this.rot == null) this.rot = new AxisAngle(0, 1, 0, 0);
      view.glRotateRad(-this.rot.angle, this.rot.x, this.rot.y, this.rot.z);
      if (this.pos == null) this.pos = new Vector3(0, 0, 10);
      view.glTranslatef(-this.pos.x, -this.pos.y, -this.pos.z);
    }
    view.copyTo(this.cameraToWorld);
    this.cameraToWorld.inverseMatrix3in4();
  }
  getWorldPosition(v) { v.x = this.pos.x; v.y = this.pos.y; v.z = this.pos.z; }
  init(ctx) {
    super.init(ctx);
    if (this.cpos != null) { this.pos = readVector3(this.cpos); this.cpos = null; }
    if (this.crot != null) { this.rot = readAxisAngle(this.crot); this.crot = null; }
    if (this.pos == null) this.pos = new Vector3(0, 0, 10);
    if (this.rot == null) this.rot = new AxisAngle(0, 1, 0, 0);
  }
}

// A projected triangle, ready for the painter's-algorithm renderer.
export class Triangle {
  constructor() {
    this.farz = 0;
    this.screen_v0 = null; this.screen_v1 = null; this.screen_v2 = null;
    // Raw map coordinates; the renderer converts them to bitmap pixel space
    // (u*(w-1), (h-1)-v*(h-1)) like the Flash UV matrix did.
    this.u0 = 0; this.v0 = 0; this.u1 = 0; this.v1 = 0; this.u2 = 0; this.v2 = 0;
    this.material = null;
  }
}

export class Mesh extends BaseObj {
  constructor() {
    super();
    this.cullAllIndex = 0;
    this.M = new GLMatrix();
    this.screenVerts = null;
    this.numFaces = 0; this.numVerts = 0;
    this.dummyVerts = null;
    this.mverts = null; this.verts = null; this.faces = null; this.mapVerts = null; this.cull = null;
    this.modifier = null; this.ebc = null;
    this.localZDepthOffset = NaN; this.screenZDepthOffset = NaN;
    this.triangles = null;
    this.inited = false; this.firstPass = true;
    this.material = null;
  }

  initArrayToVector() {
    const n = this.numVerts;
    this.screenVerts = new Array(n);
    for (let i = 0; i < n; i++) this.screenVerts[i] = { x: 0, y: 0, z: 0 };
    const vs = new Array(n);
    let k = 0;
    for (let i = 0; i < n; i++) vs[i] = new Vector3(this.verts[k++], this.verts[k++], this.verts[k++]);
    this.verts = vs;
    this.triangles = new Array(this.numFaces);
    const faces = this.faces, mv = this.mapVerts;
    let t = 0;
    for (let f = 0; f < faces.length;) {
      const a = faces[f++] >>> 0, b = faces[f++] >>> 0, c = faces[f++] >>> 0;
      const ia = (a / 3) >>> 0, ib = (b / 3) >>> 0, ic = (c / 3) >>> 0;
      const tri = new Triangle();
      tri.screen_v0 = this.screenVerts[ia];
      tri.screen_v1 = this.screenVerts[ic];
      tri.screen_v2 = this.screenVerts[ib];
      tri.u0 = mv[a]; tri.v0 = mv[a + 1];
      tri.u1 = mv[c]; tri.v1 = mv[c + 1];
      tri.u2 = mv[b]; tri.v2 = mv[b + 1];
      tri.material = this.material;
      this.triangles[t++] = tri;
    }
  }

  draw(ctx) {
    if (!this.inited) this.init(ctx);
    if (this.faces == null || this.verts == null) return;
    if (ctx.scene.cull != null && this.cull == null && this.cullAllIndex >= 0 && ctx.scene.cull[this.cullAllIndex]) return;
    if (this.updateTextureBmd && this.triangles != null) {
      this.updateTextureBmd = false;
      for (const t of this.triangles) t.material = this.material;
    }
    this.renderNormal(ctx);
  }

  renderNormal(ctx) {
    const bmd = this.material == null ? null : this.material.bitmapData;
    if (bmd == null) return;
    if (this.firstPass) { this.firstPass = false; this.initArrayToVector(); }
    const sceneCull = ctx.scene.cull;
    const noCull = sceneCull == null || this.cull == null;
    const perTri = sceneCull != null && this.cull != null;
    if (perTri) {
      let any = false;
      for (let i = 0; i < this.numFaces; i++) if (!sceneCull[this.cull[i]]) { any = true; break; }
      if (!any) return;
    }
    const M = this.M;
    const ortho = ctx.camera && ctx.camera.ortho;
    if (ortho) ctx.hview.copyTo(M);
    else { ctx.hproj.copyTo(M); M.glMultMatrix(ctx.hview); }
    if (this.modifier == null || (this.modifier != null && this.modifier.hasSkin === false)) M.glMultMatrix(ctx.hworld);
    this.mverts = this.verts;
    if (this.modifier != null) this.modifier.modifyVerts(ctx, this);
    const mverts = this.mverts, sv = this.screenVerts;
    if (ortho) {
      // Orthographic projection in millimetres -> pixels at ORTHO_DPI.
      const k = ctx.ORTHO_DPI / 25.4, ox = ctx.ORTHO_OFFSET_X * k, oy = ctx.ORTHO_OFFSET_Y * k;
      for (let i = 0; i < this.numVerts; i++) {
        const v = mverts[i], s = sv[i];
        const x = v.x, y = v.y, z = v.z;
        s.z = 0;
        s.x = (M.m0 * x + M.m4 * y + M.m8 * z + M.m12) * k + ox;
        s.y = -(M.m1 * x + M.m5 * y + M.m9 * z + M.m13) * k + oy;
      }
    } else {
      const hw = ctx.width * 0.5, hh = ctx.height * 0.5, nh = -hh;
      const a0 = M.m0 * hw, a1 = M.m1 * nh, a2 = M.m2;
      const a4 = M.m4 * hw, a5 = M.m5 * nh, a6 = M.m6;
      const a8 = M.m8 * hw, a9 = M.m9 * nh, a10 = M.m10;
      const a12 = M.m12 * hw, a13 = M.m13 * nh, a14 = M.m14;
      for (let i = 0; i < this.numVerts; i++) {
        const v = mverts[i], s = sv[i];
        const x = v.x, y = v.y, z = v.z;
        s.z = a2 * x + a6 * y + a10 * z + a14;
        s.x = (a0 * x + a4 * y + a8 * z + a12) / s.z + hw;
        s.y = (a1 * x + a5 * y + a9 * z + a13) / s.z + hh;
      }
    }
    let zoff = 0;
    if (!ortho) {
      if (!isNaN(this.localZDepthOffset) && this.localZDepthOffset !== 0) {
        ctx.hview.copyTo(M);
        M.glMultMatrix(ctx.hworld);
        zoff = M.m10 * this.localZDepthOffset;
      }
      if (!isNaN(this.screenZDepthOffset)) zoff += this.screenZDepthOffset;
    }
    const list = ctx.visibleTriList;
    let count = ctx.visibleTriCount;
    const tris = this.triangles, cull = this.cull;
    for (let i = 0; i < this.numFaces; i++) {
      const t = tris[i];
      if (noCull || !(perTri && sceneCull[cull[i]])) {
        const p0 = t.screen_v0, p1 = t.screen_v1, p2 = t.screen_v2;
        if ((p1.x - p0.x) * (p2.y - p0.y) - (p2.x - p0.x) * (p1.y - p0.y) > -1) {
          t.farz = Math.max(p0.z + zoff, p1.z + zoff, p2.z + zoff);
          list[count++] = t;
        }
      }
    }
    ctx.visibleTriCount = count;
  }

  updateTextures() { this.updateTextureBmd = true; }

  init(ctx) {
    if (this.ebc == null) return;
    const dec = new EBDecompression();
    dec.decompressMesh(this);
    this.ebc = null;
    if (this.faces == null || this.verts == null || this.mapVerts == null) return;
    const faces = this.faces;
    const nf = faces.length;
    if (this.dummyVerts != null && this.dummyVerts.length > 0 && faces != null) {
      const nd = this.dummyVerts.length;
      for (let i = 0; i < nf; i++) {
        for (let j = 0; j < nd; j++) if (faces[i] == this.dummyVerts[j]) faces[i] = -1;
        if (faces[i] !== -1) faces[i] *= 3;
      }
    } else {
      // Deviation from the original: closed meshes without dummy vertices
      // (Ball, Car_Steer) never had their indices scaled in the Flash
      // player, which rendered them scrambled. Scale them here too.
      for (let i = 0; i < nf; i++) faces[i] *= 3;
    }
    let valid = 0;
    for (let i = 0; i < nf; i += 3) if (faces[i] !== -1 && faces[i + 1] !== -1 && faces[i + 2] !== -1) valid++;
    if (valid !== this.numFaces) {
      const nfaces = new Array(valid * 3);
      let ncull = null;
      if (this.cull != null && this.cull.length === this.numFaces) ncull = new Array(valid);
      let k = 0, ci = 0, co = 0;
      for (let i = 0; i < nf; i += 3) {
        if (faces[i] !== -1 && faces[i + 1] !== -1 && faces[i + 2] !== -1) {
          nfaces[k++] = faces[i]; nfaces[k++] = faces[i + 1]; nfaces[k++] = faces[i + 2];
          if (ncull != null) ncull[co++] = this.cull[ci++];
        } else ci++;
      }
      this.faces = nfaces;
      this.numFaces = valid;
      this.cull = ncull;
    }
    if (this.modifier != null) this.modifier.initMod(ctx, this.numVerts, null);
    for (let i = 0; i < this.faces.length; i++) {
      if (this.faces[i] >= this.verts.length || isNaN(this.faces[i])) this.faces[i] = -1;
    }
    this.inited = true;
  }
}

export class Modifier extends BaseObj {
  constructor() {
    super();
    this.modVerts = null; this.weights = null; this.skinToBoneMat = null; this.weightsCache = null;
    this.numBones = null; this.morphedVerts = null; this.boneToSkinMat = null; this.channels = null;
    this.offset = null; this.firstCalcOffset = true; this.boneWeight = null; this.ebc = null;
    this.numTargets = 0; this.boneIndex = null; this.boneRef = null; this.hasSkin = false;
    this.delta = null; this.hasMorpher = false;
  }

  modifyVerts(ctx, mesh) {
    const verts = mesh.verts;
    if (!this.hasSkin && !this.hasMorpher) return;
    const nv = verts.length;
    if (this.morphedVerts == null || this.morphedVerts.length !== verts.length) {
      this.morphedVerts = new Array(nv);
      this.modVerts = new Array(nv);
      for (let i = 0; i < nv; i++) { this.morphedVerts[i] = new Vector3(); this.modVerts[i] = new Vector3(); }
    }
    let changed = false;
    const morphed = this.morphedVerts, mod = this.modVerts;
    if (this.hasMorpher) {
      const nw = this.weights.length;
      if (this.weightsCache != null) {
        for (let i = 0; i < nw; i++) {
          if (this.weights[i] != this.weightsCache[i]) changed = true;
          this.weightsCache[i] = this.weights[i];
        }
      } else {
        changed = true;
        this.weightsCache = this.weights.slice();
      }
      if (!this.hasSkin && !changed) {
        for (let i = 0; i < nv; i++) { const d = mod[i], s = morphed[i]; d.x = s.x; d.y = s.y; d.z = s.z; }
        mesh.mverts = mod;
        return;
      }
      if (changed) {
        const nm = morphed.length;
        for (let i = 0; i < nm; i++) { const d = morphed[i], s = verts[i]; d.x = s.x; d.y = s.y; d.z = s.z; }
        const nch = this.channels.length;
        const delta = this.delta;
        let di = 0;
        for (let c = 0; c < nch; c++) {
          const w = Number(this.weights[c]);
          if (!(w > -0.01 && w < 0.01)) {
            if (w > 0.99 && w < 1.01) {
              for (let i = 0; i < nm;) { const v = morphed[i++]; v.x += delta[di++]; v.y += delta[di++]; v.z += delta[di++]; }
            } else if (w < -0.99 && w > -1.01) {
              for (let i = 0; i < nm;) { const v = morphed[i++]; v.x -= delta[di++]; v.y -= delta[di++]; v.z -= delta[di++]; }
            } else {
              for (let i = 0; i < nm;) { const v = morphed[i++]; v.x += delta[di++] * w; v.y += delta[di++] * w; v.z += delta[di++] * w; }
            }
          } else di += nv * 3;
        }
      }
      if (!this.hasSkin) {
        for (let i = 0; i < nv; i++) { const d = mod[i], s = morphed[i]; d.x = s.x; d.y = s.y; d.z = s.z; }
        mesh.mverts = mod;
        return;
      }
    }
    if (this.hasSkin) {
      const boneRef = this.boneRef, b2s = this.boneToSkinMat, s2b = this.skinToBoneMat;
      for (let i = 0; i < boneRef.length; i++) if (boneRef[i] != null) boneRef[i].localToWorldTransform.copyTo(b2s[i]);
      const numBones = this.numBones, boneIndex = this.boneIndex, boneWeight = this.boneWeight, offset = this.offset;
      if (this.firstCalcOffset || this.hasMorpher) {
        this.firstCalcOffset = false;
        const src = this.hasMorpher ? (changed ? morphed : null) : verts;
        if (src != null) {
          let bi = 0, oi = 0;
          for (let i = 0; i < nv; i++) {
            const v = src[i];
            const x = v.x, y = v.y, z = v.z;
            const nb = numBones[i] >>> 0;
            for (let j = 0; j < nb; j++) {
              const m = s2b[boneIndex[bi++] >>> 0];
              const o = offset[oi++];
              o.x = m.m0 * x + m.m4 * y + m.m8 * z + m.m12;
              o.y = m.m1 * x + m.m5 * y + m.m9 * z + m.m13;
              o.z = m.m2 * x + m.m6 * y + m.m10 * z + m.m14;
            }
          }
        }
      }
      let vi = 0, oi = 0, wi = 0, bi = 0;
      const nb = numBones.length;
      for (let i = 0; i < nb; i++) {
        const cnt = numBones[i] | 0;
        if (cnt === 1) {
          const m = b2s[boneIndex[bi++]];
          wi++;
          const o = offset[oi++];
          const x = o.x, y = o.y, z = o.z;
          const d = mod[vi++];
          d.x = m.m0 * x + m.m4 * y + m.m8 * z + m.m12;
          d.y = m.m1 * x + m.m5 * y + m.m9 * z + m.m13;
          d.z = m.m2 * x + m.m6 * y + m.m10 * z + m.m14;
        } else if (cnt === 2) {
          const m = b2s[boneIndex[bi++]];
          const w = Number(boneWeight[wi++]);
          const o = offset[oi++];
          const m2 = b2s[boneIndex[bi++]];
          const w2 = Number(boneWeight[wi++]);
          const o2 = offset[oi++];
          const d = mod[vi++];
          d.x = (m.m0 * o.x + m.m4 * o.y + m.m8 * o.z + m.m12) * w + (m2.m0 * o2.x + m2.m4 * o2.y + m2.m8 * o2.z + m2.m12) * w2;
          d.y = (m.m1 * o.x + m.m5 * o.y + m.m9 * o.z + m.m13) * w + (m2.m1 * o2.x + m2.m5 * o2.y + m2.m9 * o2.z + m2.m13) * w2;
          d.z = (m.m2 * o.x + m.m6 * o.y + m.m10 * o.z + m.m14) * w + (m2.m2 * o2.x + m2.m6 * o2.y + m2.m10 * o2.z + m2.m14) * w2;
        } else if (cnt > 2) {
          let m = b2s[boneIndex[bi]];
          let w = Number(boneWeight[wi++]);
          let o = offset[oi++];
          const d = mod[vi];
          d.x = (m.m0 * o.x + m.m4 * o.y + m.m8 * o.z + m.m12) * w;
          d.y = (m.m1 * o.x + m.m5 * o.y + m.m9 * o.z + m.m13) * w;
          d.z = (m.m2 * o.x + m.m6 * o.y + m.m10 * o.z + m.m14) * w;
          bi++;
          for (let j = 1; j < cnt; j++) {
            m = b2s[boneIndex[bi++]];
            w = Number(boneWeight[wi++]);
            o = offset[oi++];
            d.x += (m.m0 * o.x + m.m4 * o.y + m.m8 * o.z + m.m12) * w;
            d.y += (m.m1 * o.x + m.m5 * o.y + m.m9 * o.z + m.m13) * w;
            d.z += (m.m2 * o.x + m.m6 * o.y + m.m10 * o.z + m.m14) * w;
          }
          vi++;
        }
      }
    }
    mesh.mverts = mod;
  }

  initMod(ctx, numVerts, mask) {
    if (this.numTargets > 0 && this.delta != null && this.channels != null) {
      this.hasMorpher = true;
      this.weights = new Array(this.channels.length).fill(0);
    }
    if (this.numBones != null && this.boneIndex != null && this.boneWeight != null) {
      this.hasSkin = true;
      let max = 0;
      for (let i = 0; i < this.boneIndex.length; i++) if (this.boneIndex[i] > max) max = this.boneIndex[i] | 0;
      this.boneRef = new Array(max);
      this.skinToBoneMat = new Array(max);
      this.boneToSkinMat = new Array(max);
      for (let i = 0; i < this.boneIndex.length; i++) {
        const bi = this.boneIndex[i];
        if (this.boneRef[bi] == null) {
          this.boneRef[bi] = ctx.scene.getBoneByIndex(bi);
          this.skinToBoneMat[bi] = new GLMatrix();
          this.boneToSkinMat[bi] = new GLMatrix();
        }
      }
      this.offset = new Array(this.boneIndex.length);
      for (let i = 0; i < this.offset.length; i++) this.offset[i] = new Vector3();
      for (let i = 0; i < this.boneRef.length; i++) {
        if (this.boneRef[i] != null) this.boneRef[i].invInitialTransform.copyTo(this.skinToBoneMat[i]);
      }
    }
  }
}

// Serialized compressed-data holders (their fields come straight from AMF).
export class MeshEBC {}
export class ModifierEBC {}
export class Wv {}
export class AnimLibrary { constructor() { this.numAnim = 0; } }

export class BaseMaterial extends BaseObj {
  constructor() {
    super();
    this.bmd = null;
    this.lightmap = null;
    this.frames = null;
    this.desc = null;
    this.materialLibrary = null;
    this.lastFrame = -1;
    this.version = 0; // bumped whenever bmd changes (for texture caches)
  }
  get bitmapData() { return this.bmd; }
  set bitmapData(v) { this.bmd = v; this.version++; }
  // Material frame selection driven by Anim "mat" controllers.
  set test(frame) {
    if (this.materialLibrary == null) return;
    if (frame === this.lastFrame) return;
    this.lastFrame = frame;
    if (this.frames == null) this.frames = [];
    if (this.frames[frame] == null) {
      this.bmd = this.materialLibrary.createMaterial(this.desc, this.lightmap, null, frame);
      this.frames[frame] = this.bmd;
    } else this.bmd = this.frames[frame];
    this.version++;
  }
  update() {
    if (this.bmd == null && this.materialLibrary != null) {
      this.bmd = this.materialLibrary.createMaterial(this.desc, this.lightmap, null, 1);
      this.version++;
    }
  }
  dispose() { this.bmd = null; this.frames = null; }
}
export class StandardMaterial extends BaseMaterial {}

const SQRT3 = Math.sqrt(3);
const SQRT3OVER4 = Math.sqrt(3) / 4;
const SQRT3MINUS2OVER4 = (Math.sqrt(3) - 2) / 4;
const SQRT3MINUS1OVERSQRT2 = (Math.sqrt(3) - 1) / Math.sqrt(2);
const SQRT3PLUS1OVERSQRT2 = (Math.sqrt(3) + 1) / Math.sqrt(2);

function nextPowerOfTwo(n) {
  if (n === 1) return 0;
  if (n === 2) return 1;
  for (let p = 2; p <= 22; p++) if (n <= (1 << p)) return p;
  return -1;
}

function inverseDaubechiesTransform(a, n) {
  const h = n / 2;
  const s = new Array(h), d = new Array(h);
  for (let i = 0; i < h; i++) {
    d[i] = a[i + h] / SQRT3PLUS1OVERSQRT2;
    s[i] = a[i] / SQRT3MINUS1OVERSQRT2;
  }
  s[h - 1] += d[0];
  for (let i = 0; i < h - 1; i++) s[i] += d[i + 1];
  for (let i = 1; i < h; i++) a[2 * i + 1] = d[i] + SQRT3MINUS2OVER4 * s[i - 1] + SQRT3OVER4 * s[i];
  a[1] = d[0] + SQRT3OVER4 * s[0] + SQRT3MINUS2OVER4 * s[h - 1];
  for (let i = 0; i < h; i++) a[2 * i] = s[i] - SQRT3 * a[2 * i + 1];
}

function reconstructDaubechies(a, n) {
  while (a.length < n) a.push(0);
  for (let s = 4; s <= n; s *= 2) inverseDaubechiesTransform(a, s);
}

// Reads the wavelet-coded channel stream used by weight and rotation data.
function readWavelet(ba, n, highBits) {
  ba.position = 0;
  const hiScale = ba.readShort() & 0xffff;
  const loScale = ba.readShort() & 0xffff;
  const out = new Array(n);
  let i = 0;
  while (ba.bytesAvailable > 0) {
    out[i] = i < highBits ? ba.readShort() / hiScale : ba.readByte() / loScale;
    i++;
  }
  while (i < n) out[i++] = 0;
  return out;
}

const V1_ALWAYS_VISIBLE = ['Skin_Head', 'Skin_Torso', 'Skin_Legs'];
const V1_IDENTITY_PLACEMENT = [0, 0, 0, 0, 0, 0, 0];
export const V1_STAGE_PLACEMENT = { 1: [45, 0, 0, 0, -1, 0, 1.57], 2: [-45, 0, 0, 0, 1, 0, 1.57] };

export class Anim extends BaseObj {
  constructor() {
    super();
    this.poses = null; this.highBits = 0; this.targets = null;
    this.startTime = 0; this.controllers = [];
    this.end = 0; this.channels = null; this.start = 0;
    this.loop = true; this.frames = null; this.fps = 30;
    this.position = null; this.bounds = null; this.current = 0; this.decoded = false;
  }

  step(ctx, advance, now) {
    if (this.startTime === 0) this.startTime = now;
    if (advance) {
      const t = (now - this.startTime) / 1000;
      this.current = Math.trunc(t * this.fps + this.start + 0.499);
      if (this.current > this.end) {
        if (!this.loop) return false;
        this.current = (this.current - this.start) % (this.end - this.start) + this.start;
      }
      if (this.frames != null && this.frames.length === this.end - this.start + 1) {
        this.current = this.frames.bytes[this.current - this.start];
      }
    }
    this.draw(ctx);
    return true;
  }

  decode(lib) {
    if (this.decoded) return;
    this.decoded = true;
    // Newer animation files carry their own targets/channels/bounds; the
    // older (BuddyPoke 1.0) library shares them on the AnimLibrary.
    const targets = this.targets || (lib && lib.targets);
    const channels = this.channels || (lib && lib.channels);
    const bounds = this.bounds || (lib && lib.bounds);
    bounds.position = 0;
    const x0 = bounds.readFloat(), x1 = bounds.readFloat(), y0 = bounds.readFloat(), y1 = bounds.readFloat(), z0 = bounds.readFloat(), z1 = bounds.readFloat();
    const len = this.end - this.start + 1;
    const highBits = this.highBits;
    const isV1 = !this.targets && lib && lib.targets;
    for (const c of this.controllers) {
      c.target = targets[c.target];
      // 1.0 animations address the face material on "Head"; the newer model
      // names that mesh "Skin_Head".
      if (isV1 && c.target === 'Head') c.target = 'Skin_Head';
      if (c.mat != null && c.mat instanceof ByteArray) {
        c.mat = Array.from(c.mat.bytes.subarray(c.mat.position));
        c.matLength = c.mat.length;
      }
      if (c.pos != null && c.pos instanceof ByteArray) {
        const ba = c.pos;
        ba.position = 0;
        const n = (ba.bytesAvailable / 2) | 0;
        const arr = new Array(n);
        for (let i = 0; i < n; i += 3) {
          arr[i] = (ba.readShort() & 0xffff) / 65535 * (x1 - x0) + x0;
          arr[i + 1] = (ba.readShort() & 0xffff) / 65535 * (y1 - y0) + y0;
          arr[i + 2] = (ba.readShort() & 0xffff) / 65535 * (z1 - z0) + z0;
        }
        c.pos = arr;
        c.posLength = arr.length;
      }
      if (c.weight != null) {
        c.channel = channels[c.channel];
        if (c.weight instanceof ByteArray) {
          const n2 = 1 << nextPowerOfTwo(len);
          const w = readWavelet(c.weight, n2, highBits);
          reconstructDaubechies(w, n2);
          const out = new Array(len);
          out[0] = w[0];
          for (let i = 1; i < len; i++) out[i] = w[i] + out[i - 1];
          c.weight = out;
          c.weightLength = out.length;
        }
      }
      if (c.vis != null && c.vis instanceof ByteArray) {
        c.vis = Array.from(c.vis.bytes);
        c.visLength = c.vis.length;
      }
      if (c.rot != null) {
        if (c.rot instanceof ByteArray) {
          const ba = c.rot;
          ba.position = 0;
          let x = ba.readShort() / (65535 / 2), y = ba.readShort() / (65535 / 2), z = ba.readShort() / (65535 / 2), w = ba.readShort() / (65535 / 2);
          const m = Math.sqrt(w * w + x * x + y * y + z * z);
          w /= m; x /= m; y /= m; z /= m;
          const angle = 2 * Math.acos(w);
          const s = Math.sqrt(1 - w * w);
          c.rot = s < 0.001 ? [x, y, z, angle] : [x / s, y / s, z / s, angle];
        } else if (c.rot.x instanceof ByteArray) { // Wv
          const wv = c.rot;
          const n2 = 1 << nextPowerOfTwo(len);
          const xs = readWavelet(wv.x, n2, highBits);
          const ys = readWavelet(wv.y, n2, highBits);
          const zs = readWavelet(wv.z, n2, highBits);
          const ws = readWavelet(wv.w, n2, highBits);
          reconstructDaubechies(xs, n2);
          reconstructDaubechies(ys, n2);
          reconstructDaubechies(zs, n2);
          reconstructDaubechies(ws, n2);
          const out = new Array(len * 4);
          for (let i = 0, j = 0; i < out.length; i += 4, j++) {
            let x = xs[j], y = ys[j], z = zs[j], w = ws[j];
            const m = Math.sqrt(w * w + x * x + y * y + z * z);
            w /= m; x /= m; y /= m; z /= m;
            const angle = 2 * Math.acos(w);
            const s = Math.sqrt(1 - w * w);
            if (s < 0.001) { out[i] = 1; out[i + 1] = 0; out[i + 2] = 0; }
            else { out[i] = x / s; out[i + 1] = y / s; out[i + 2] = z / s; }
            out[i + 3] = angle;
          }
          c.rot = out;
          c.rotLength = out.length;
        }
      }
    }
  }

  drawFrame(ctx, frame) {
    this.current = this.start + frame;
    if (this.current > this.end) this.current = this.end;
    this.draw(ctx);
  }

  draw(ctx) {
    ctx.scene.hideProps();
    if (this.lib && this.lib.targets) {
      // BuddyPoke 1.0 animations predate the skin meshes being listed as
      // props, so they carry no visibility tracks for them: keep them shown.
      for (const n of V1_ALWAYS_VISIBLE) { const node = ctx.scene.getNodeByName(n); if (node) node.visible = true; }
      // They also have no IG_Root track: the 1.0 stage placed the two
      // buddies itself (Buddy1 at x=45 facing -x, Buddy2 at x=-45 facing
      // +x). Newer animations bake exactly that into IG_Root.
      const root = ctx.scene.getNodeByName('IG_Root');
      if (root) {
        const p = this.rootPlacement || V1_IDENTITY_PLACEMENT;
        if (!root.pos) root.pos = new Vector3();
        if (!root.rot) root.rot = new AxisAngle();
        root.pos.x = p[0]; root.pos.y = p[1]; root.pos.z = p[2];
        root.rot.x = p[3]; root.rot.y = p[4]; root.rot.z = p[5]; root.rot.angle = p[6];
      }
    }
    if (this.controllers != null) {
      for (let i = 0; i < this.controllers.length; i++) this.controllers[i].animate(this, ctx);
    }
  }

  goToFraction(f) { this.current = Math.trunc((this.end - this.start) * f) + this.start; }
  reset(now) { this.startTime = now; this.current = this.start; }
  get length() { return this.end - this.start + 1; }
  currentTime(now) { if (this.startTime === 0) this.startTime = now; return now - this.startTime; }
}

export class Controller extends BaseObj {
  constructor() {
    super();
    this.targetRef = null; this.channel = null; this.channelIndex = -1;
    this.target = null; this.pos = null; this.rot = null; this.vis = null; this.mat = null; this.weight = null;
  }
  animate(anim, ctx) {
    const scene = ctx.scene;
    if (this.targetRef == null && this.target != null) {
      this.targetRef = scene.getNodeByName(String(this.target)) || null;
      if (this.targetRef != null && !(this.targetRef instanceof Node)) this.targetRef = null;
      if (this.pos != null && this.targetRef != null && this.targetRef.pos == null) this.targetRef.pos = new Vector3(0, 0, 0);
      if (this.rot != null && this.targetRef != null && this.targetRef.rot == null) this.targetRef.rot = new AxisAngle(0, 1, 0, 0);
    }
    const t = this.targetRef;
    if (t == null) return;
    const f = anim.current - anim.start;
    let i;
    if (this.mat != null) {
      i = f;
      if (i >= this.mat.length) i = 0;
      if (t.mesh != null && t.mesh.material != null) {
        t.mesh.material.test = this.mat[i];
        t.mesh.updateTextures();
      }
    }
    if (this.pos != null) {
      i = f * 3;
      if (i >= this.pos.length) i = 0;
      t.pos.x = Number(this.pos[i]); t.pos.y = Number(this.pos[i + 1]); t.pos.z = Number(this.pos[i + 2]);
    }
    if (this.vis != null) {
      i = f;
      if (i >= this.vis.length) i = 0;
      t.visible = Number(this.vis[i]) === 1;
    }
    if (this.rot != null) {
      i = f * 4;
      if (i >= this.rot.length) i = 0;
      t.rot.x = Number(this.rot[i]); t.rot.y = Number(this.rot[i + 1]); t.rot.z = Number(this.rot[i + 2]); t.rot.angle = Number(this.rot[i + 3]);
    }
    const m = t.mesh && t.mesh.modifier;
    if (this.weight != null && m != null && m.channels != null && m.weights != null) {
      if (this.channelIndex < 0) this.channelIndex = m.channels.indexOf(this.channel);
      i = f;
      if (i >= this.weight.length) i = 0;
      m.weights[this.channelIndex] = Number(this.weight[i]) / 100;
    }
  }
}

export class MapImage {}

// AMF3 class aliases, as registered in Player.loadObject().
export const CLASS_ALIASES = {
  AL: AnimLibrary, An: Anim, Bo: Bone, Ca: Camera, Co: Controller, Ma: MapImage,
  Me: Mesh, MeC: MeshEBC, Mo: Modifier, MoC: ModifierEBC, No: Node, Sc: Scene,
  SM: StandardMaterial, WD: Wv,
};
