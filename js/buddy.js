// Port of buddypoke.render.SceneObject, Buddy and SceneSetting.

import { ByteArray, AMF3Reader, inflate } from './bytearray.js';
import { CLASS_ALIASES, Node, Camera, Anim, V1_STAGE_PLACEMENT } from './engine/scene.js';
import { Player, catalogItems, catalogMaterialOptions } from './engine/player.js';
import { Vector3, AxisAngle } from './engine/math.js';
import { parseXML, xmlAttr, xmlChildren } from './xml.js';
import { CUSTOMIZATION_OPTIONS } from './data/options.js';
import { DEFAULT_BUDDY } from './data/defaults.js';

export { DEFAULT_BUDDY };

Object.assign(AMF3Reader.classes, CLASS_ALIASES);

export const PANEL_W = 346;
export const PANEL_H = 260;

// Parses a BuddyPoke content package ("buddylabs" header + AMF3 object with
// g/c/m/d/a byte arrays). Returns raw pieces reusable by several buddies.
export async function parsePackage(bytes) {
  const ba = new ByteArray(bytes);
  ba.position = 9;
  const obj = ba.readObject();
  const out = {};
  for (const k of ['g', 'c', 'd', 'a']) out[k] = obj[k] ? await inflate(obj[k].bytes) : null;
  out.m = obj.m ? obj.m.bytes : null;
  out.catalogText = new TextDecoder().decode(out.c);
  return out;
}

// Parses an animation library stream: AnimLibrary followed by Anim objects.
export function parseAnimLibrary(bytes) {
  const ba = new ByteArray(bytes);
  const lib = ba.readObject();
  const anims = [];
  while (ba.bytesAvailable > 0) anims.push(ba.readObject());
  return { lib, anims };
}

export class SceneObject {
  constructor() {
    this.anims = [];
    this.animNameToAnim = {};
    this.animSources = []; // [{lib, bytes}] animation libraries (lazily parsed)
    this.currentAnim = null;
    this.player = null;
    this.materialLibrary = null;
    this.catalogXML = null;
    this.visible = true;
    this.width = PANEL_W; this.height = PANEL_H;
  }

  get context() { return this.player.context; }
  get animation() { return this.currentAnim; }

  // SceneObject.loadBin + parseData + initPlayer for an already-parsed package.
  load(pkg, animToPlay, initTextures, matLib, animSources) {
    this.catalogXML = parseXML(pkg.catalogText);
    this.materialLibrary = matLib;
    const geo = new ByteArray(pkg.g);
    this.player = new Player(this.width, this.height);
    this.player.loadObject(geo.readObject());
    if (this.materialLibrary && initTextures) {
      this.player.updateTextures(this.catalogXML, this.materialLibrary);
      this.player.setVisibleGeometry(this.catalogXML);
    }
    // Each buddy decodes its own Anim objects: controllers cache node
    // references per scene.
    for (const src of animSources) {
      const { lib, anims } = parseAnimLibrary(src.bytes);
      const names = new Set(anims.map((a) => a.name));
      for (const a of anims) {
        if (this.animNameToAnim[a.name] && !src.override) continue;
        a.lib = lib;
        a.source = src.name;
        if (lib.targets) {
          // Paired 1.0 poke animations (xxx1 / xxx2) take the old stage slot.
          const m = /^(.*)([12])$/.exec(a.name);
          if (m && names.has(m[1] + '1') && names.has(m[1] + '2')) a.rootPlacement = V1_STAGE_PLACEMENT[m[2]];
        }
        this.anims.push(a);
        this.animNameToAnim[a.name] = a;
      }
    }
    if (animToPlay) this.selectedAnim = animToPlay;
  }

  hasAnimation(name) { return name != null && this.animNameToAnim[name] != null; }

  getAnimationByName(name) {
    if (name == null) return null;
    const a = this.animNameToAnim[name];
    if (a == null) return null;
    a.decode(a.lib);
    return a;
  }

  set selectedAnim(name) {
    const a = this.getAnimationByName(name);
    if (a != null) { this.currentAnim = a; a.reset(performance.now()); }
  }
  get selectedAnim() { return this.currentAnim ? this.currentAnim.name : null; }

  stepAnimation(advance, now) {
    if (this.currentAnim != null && this.player != null) this.currentAnim.step(this.player.context, advance, now);
  }

  setCurrentFrame(frame) {
    if (this.currentAnim != null) this.currentAnim.drawFrame(this.player.context, frame);
  }

  resize(w, h) { this.width = w; this.height = h; this.player.resize(w, h); }
}

export class Buddy extends SceneObject {
  constructor() {
    super();
    this.prevDeserializeStr = null;
    this.defaultJSONObj = null;
  }

  // Buddy.deserializeCompressed
  async deserializeCompressed(comp) {
    if (comp == null || comp.length < 10) comp = DEFAULT_BUDDY;
    this.prevDeserializeStr = comp;
    if (this.defaultJSONObj == null) this.defaultJSONObj = JSON.parse(await decodeBuddyString(DEFAULT_BUDDY));
    try {
      const obj = JSON.parse(await decodeBuddyString(comp));
      for (const id in this.defaultJSONObj) if (obj[id] == null) obj[id] = this.defaultJSONObj[id];
      this.deserialize(obj);
    } catch (e) {
      console.warn('Could not read appearance code', e);
    }
    this.markProps();
    this.refresh();
  }

  markProps() {
    for (const cat of this.itemCategories()) {
      const n = xmlAttr(cat, 'name');
      if (n === 'Props' || n === 'Vehicles') for (const it of xmlChildren(cat, 'item')) it.setAttribute('prop', 'true');
    }
  }

  refresh() {
    this.player.updateTextures(this.catalogXML, this.materialLibrary);
    this.player.setVisibleGeometry(this.catalogXML);
    this.context.scene.hideProps();
    this.background = this.createBackground();
  }

  // The customisable panel background (materialOption "Bkg"), like
  // SceneObject's backgroundMatName / createMaterialMovieClip.
  createBackground() {
    const mo = catalogMaterialOptions(this.catalogXML).find((m) => xmlAttr(m, 'name') === 'Bkg');
    const mat = mo && xmlChildren(mo, 'material')[0];
    return mat ? this.materialLibrary.createMaterial(mat, null) : null;
  }

  itemCategories() {
    const out = [];
    const root = this.catalogXML.documentElement;
    for (const g of xmlChildren(root, 'group')) for (const cs of xmlChildren(g, 'categories')) for (const c of xmlChildren(cs, 'itemCategory')) out.push(c);
    return out;
  }

  // The E4X path "opt;material;layer[;texture]" lookups used by
  // serialize/deserialize. (The original's `.material.(@name = x)` is an
  // assignment, so it matches every material of the option.)
  findLayer(path) {
    const [opt, , layerName] = path.split(';');
    for (const mo of catalogMaterialOptions(this.catalogXML)) {
      if (xmlAttr(mo, 'name') !== opt) continue;
      for (const m of xmlChildren(mo, 'material')) for (const l of xmlChildren(m, 'layer')) if (xmlAttr(l, 'name') === layerName) return l;
    }
    return null;
  }

  findTexture(path) {
    const sym = path.split(';')[3];
    const layer = this.findLayer(path);
    if (!layer) return null;
    return xmlChildren(layer, 'texture').find((t) => xmlAttr(t, 'symbol') === sym) || null;
  }

  findItem(catName, itemName) {
    for (const c of this.itemCategories()) if (xmlAttr(c, 'name') === catName) for (const it of xmlChildren(c, 'item')) if (xmlAttr(it, 'name') === itemName) return it;
    return null;
  }

  findGroupItems(catName, visGroup) {
    const out = [];
    for (const c of this.itemCategories()) if (xmlAttr(c, 'name') === catName) for (const it of xmlChildren(c, 'item')) if (it.hasAttribute('visGroup') && xmlAttr(it, 'visGroup') === visGroup) out.push(it);
    return out;
  }

  deserialize(ser) {
    const setColor = (path, val) => {
      const t = this.findTexture(path);
      if (t && t.parentNode) { t.parentNode.setAttribute('colorIndex', val); t.setAttribute('colorSelection', val); }
    };
    const setTexture = (path, val) => { const l = this.findLayer(path); if (l) l.setAttribute('textureIndex', val); };
    const setGroup = (path, val) => {
      const [cat, grp] = path.split(';');
      const idx = parseInt(val, 10) | 0;
      this.findGroupItems(cat, grp).forEach((it, i) => it.setAttribute('visible', i === idx ? 'true' : 'false'));
    };
    for (const op of CUSTOMIZATION_OPTIONS) {
      for (const sub of op.items) {
        const v = ser[sub.id];
        if (v == null) continue;
        const val = String(v);
        if (sub.type === 'color') {
          const tex = this.findTexture(sub.path);
          const color = tex && xmlAttr(tex, 'color');
          if (color != null && color.length > 0) setColor(sub.path, val);
          for (const copy of sub.copies || []) setColor(copy, val);
        } else if (sub.type === 'texture') {
          setTexture(sub.path, val);
          for (const copy of sub.copies || []) setTexture(copy, val);
        } else if (sub.type === 'item') {
          const [cat, name] = sub.path.split(';');
          const item = this.findItem(cat, name);
          if (item) item.setAttribute('visible', val === '1' ? 'true' : 'false');
        } else if (sub.type === 'itemGroup') {
          setGroup(sub.path, val);
          for (const copy of sub.copies || []) setGroup(copy, val);
        }
      }
    }
    // Buddy.deserialize layerDependencies: clear layers that do not apply
    // to the chosen shoe, belt, hair or shirt.
    for (const op of CUSTOMIZATION_OPTIONS) for (const sub of op.items) {
      const v = ser[sub.id];
      if (v != null && LAYER_DEPENDENCIES[sub.id]) this.resetLayers(LAYER_DEPENDENCIES[sub.id](parseInt(v, 10) | 0));
    }
  }

  resetLayers(ids) {
    for (const op of CUSTOMIZATION_OPTIONS) for (const sub of op.items) {
      if (sub.type !== 'texture' || !ids.includes(sub.id)) continue;
      const layer = this.findLayer(sub.path);
      if (layer) layer.setAttribute('textureIndex', '0');
    }
  }

  serialize() {
    const ser = [];
    for (const op of CUSTOMIZATION_OPTIONS) {
      for (const sub of op.items) {
        if (sub.type === 'color') {
          const tex = this.findTexture(sub.path);
          if (!tex) continue;
          const layer = tex.parentNode;
          const color = xmlAttr(tex, 'color');
          if (color != null && color.length > 0) {
            const arr = this.materialLibrary.getColorTintOption(color);
            if (arr != null && arr.length > 1) {
              layer.setAttribute('colorIndex', xmlAttr(tex, 'colorSelection'));
              ser.push('"' + sub.id + '":' + (parseInt(xmlAttr(layer, 'colorIndex'), 10) >>> 0));
            }
          }
        } else if (sub.type === 'texture') {
          const layer = this.findLayer(sub.path);
          if (layer) {
            let ti = parseInt(xmlAttr(layer, 'textureIndex'), 10);
            if (isNaN(ti)) ti = 0;
            ser.push('"' + sub.id + '":' + ti);
          }
        } else if (sub.type === 'item') {
          const [cat, name] = sub.path.split(';');
          const item = this.findItem(cat, name);
          if (item) ser.push('"' + sub.id + '":' + (xmlAttr(item, 'visible') === 'true' ? '1' : '0'));
        } else if (sub.type === 'itemGroup') {
          const [cat, grp] = sub.path.split(';');
          const items = this.findGroupItems(cat, grp);
          let sel = 0;
          items.forEach((it, i) => { if (xmlAttr(it, 'visible') === 'true') sel = i; });
          ser.push('"' + sub.id + '":' + sel);
        }
      }
    }
    return '{' + ser.join(',') + '}';
  }

  async serializeCompressed() { return encodeBuddyString(this.serialize()); }
  resetToDefault() { return this.deserializeCompressed(DEFAULT_BUDDY); }
}

// Which texture options to reset for a given selection (Buddy.as
// layerDependencies, July 2009 version).
export const LAYER_DEPENDENCIES = {
  sst: (v) => [...(v < 1 || v > 3 ? ['sd1'] : []), ...(v !== 4 ? ['sd3', 'sh1'] : []), ...(v !== 5 ? ['sd5', 'sh3'] : [])],
  blt: (v) => [...(v < 1 || v > 3 ? ['hbp'] : []), ...(v < 4 || v > 6 ? ['lbp'] : [])],
  hrt: (v) => (v !== 31 ? ['hst'] : []),
  sl2t: (v) => [...(v !== 34 ? ['nm2', 'nm3'] : []), ...(v !== 33 ? ['nm1'] : [])],
};

export class SceneSetting extends SceneObject {
  constructor() {
    super();
    this.objsDict = {};
    this.childObjects = [];
  }

  createDefault(w, h) {
    this.width = w; this.height = h;
    this.player = new Player(w, h);
    this.player.createEmpty();
    const cam = new Camera();
    cam.fov = 0.404;
    cam.pos = new Vector3(0, 113.266, 639.817);
    cam.rot = new AxisAngle(-1, 0, 0, 0.071);
    cam.name = 'Camera01';
    const b1 = new Node(); b1.name = 'Buddy1';
    const b2 = new Node(); b2.name = 'Buddy2';
    const bkg = new Node(); bkg.name = 'bkg';
    this.player.scene.addChild(cam);
    this.player.scene.addChild(bkg);
    this.player.scene.addChild(b1);
    this.player.scene.addChild(b2);
    this.player.context.camera = cam;
  }

  addSceneObject(obj, parentName) {
    const parent = this.player.scene.getNodeByName(parentName);
    if (!parent) return;
    parent.pos = new Vector3();
    parent.rot = new AxisAngle();
    parent.addChild(obj.player.context.scene);
    this.childObjects.push(obj);
    this.objsDict[parentName] = obj;
  }

  removeSceneObject(parentName) {
    const obj = this.objsDict[parentName];
    if (!obj) return;
    const parent = this.player.scene.getNodeByName(parentName);
    parent.removeChild(obj.player.context.scene);
    const i = this.childObjects.indexOf(obj);
    if (i >= 0) this.childObjects.splice(i, 1);
    delete this.objsDict[parentName];
  }

  // SceneSetting.draw: advance animations of all children, collect triangles.
  collect(advance, now) {
    if (this.currentAnim != null && advance) this.currentAnim.step(this.player.context, advance, now);
    for (const o of this.childObjects) o.stepAnimation(advance, now);
    return this.player.collect();
  }
}

// ------------------------------------------------ appearance codes

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_/=';

export function base64Decode(str) {
  const out = [];
  const q = new Array(4);
  for (let i = 0; i < str.length; i += 4) {
    let n = 0;
    for (let j = 0; j < 4 && i + j < str.length; j++) { q[j] = B64.indexOf(str.charAt(i + j)); n++; }
    for (let j = n; j < 4; j++) q[j] = 64;
    out.push((q[0] << 2) + ((q[1] & 0x30) >> 4));
    if (q[2] !== 64) out.push(((q[1] & 0x0f) << 4) + ((q[2] & 0x3c) >> 2));
    if (q[3] !== 64) out.push(((q[2] & 0x03) << 6) + q[3]);
  }
  return new Uint8Array(out);
}

export function base64Encode(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i], b1 = bytes[i + 1], b2 = bytes[i + 2];
    const n = Math.min(3, bytes.length - i);
    const q = [(b0 & 0xfc) >> 2, ((b0 & 3) << 4) | ((b1 || 0) >> 4), (((b1 || 0) & 0x0f) << 2) | ((b2 || 0) >> 6), (b2 || 0) & 0x3f];
    for (let k = n; k < 3; k++) q[k + 1] = 64;
    for (const v of q) s += B64.charAt(v);
  }
  return s;
}

// base64 -> zlib -> AMF3 string (JSON)
export async function decodeBuddyString(comp) {
  const raw = base64Decode(comp);
  const ba = new ByteArray(await inflate(raw));
  return ba.readObject();
}

export async function encodeBuddyString(json) {
  const utf = new TextEncoder().encode(json);
  const hdr = [0x06];
  let v = (utf.length << 1) | 1;
  if (v < 0x80) hdr.push(v);
  else if (v < 0x4000) hdr.push(((v >> 7) & 0x7f) | 0x80, v & 0x7f);
  else if (v < 0x200000) hdr.push(((v >> 14) & 0x7f) | 0x80, ((v >> 7) & 0x7f) | 0x80, v & 0x7f);
  else hdr.push(((v >> 22) & 0x7f) | 0x80, ((v >> 15) & 0x7f) | 0x80, ((v >> 8) & 0x7f) | 0x80, v & 0xff);
  const amf = new Uint8Array(hdr.length + utf.length);
  amf.set(hdr, 0); amf.set(utf, hdr.length);
  const cs = new CompressionStream('deflate');
  const z = new Uint8Array(await new Response(new Blob([amf]).stream().pipeThrough(cs)).arrayBuffer());
  return base64Encode(z);
}
