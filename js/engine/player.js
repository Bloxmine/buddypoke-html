// Port of com.buddylabs.player.Context, Player and SceneUtil.setSliders.
// Context.draw() collects and depth-sorts the visible triangles exactly as
// the Flash software renderer did; the sorted list is then handed to a
// rasteriser (see glrenderer.js) instead of flash.display.Graphics.

import { GLMatrix, Vector3, AxisAngle } from './math.js';
import { Scene, Camera, Node, BaseMaterial } from './scene.js';
import { xmlAttr, xmlChildren, xmlHas, xmlFind } from '../xml.js';

export class Context {
  constructor() {
    this.hproj = new GLMatrix();
    this.hview = new GLMatrix();
    this.hworld = new GLMatrix();
    this.invhview = new GLMatrix();
    this.width = 346; this.height = 260;
    this.scene = null;
    this.camera = null;
    this.visibleTriList = [];
    this.visibleTriCount = 0;
    this.cameras = null;
  }

  init(w, h) { this.width = w; this.height = h === 0 ? 1 : h; }

  initScene(scene) {
    this.scene = scene;
    this.initCamera(scene);
    this.hworld.glLoadIdentity();
    scene.init(this);
  }

  initCamera(scene) {
    this.camera = findWithType(Camera, scene) || new Camera();
    this.camera.isBound = true;
  }

  // Collect visible triangles for `scene`; returns the depth-sorted list
  // (far to near) that should be painted in order.
  draw(scene) {
    this.scene = scene;
    this.visibleTriCount = 0;
    this.camera.update(this);
    this.hproj.gluPerspective(this.camera.fov, this.height / this.width);
    this.hview = this.camera.view;
    this.hview.copyTo(this.invhview);
    this.invhview.inverseMatrix3in4();
    this.hworld.glLoadIdentity();
    scene.draw(this);
    const list = this.visibleTriList;
    list.length = this.visibleTriCount;
    if (list.length > 1) list.sort(byFarzDesc);
    return list;
  }

  findCameras() {
    this.cameras = [];
    searchAllByType(Camera, this.scene, this.cameras);
    return this.cameras;
  }
}

const byFarzDesc = (a, b) => b.farz - a.farz;

export function findWithType(Cls, obj) {
  if (obj == null) return null;
  if (obj instanceof Cls) return obj;
  if (!(obj instanceof Node)) return null;
  if (obj.children != null) {
    for (const c of obj.children) { const r = findWithType(Cls, c); if (r != null) return r; }
  }
  return null;
}

export function searchAllByType(Cls, obj, out) {
  if (obj == null) return;
  if (obj instanceof Cls) out.push(obj);
  if (!(obj instanceof Node)) return;
  if (obj.children != null) for (const c of obj.children) searchAllByType(Cls, c, out);
}

export class Player {
  constructor(w, h) {
    this.context = new Context();
    this.context.init(w, h);
    this.scene = null;
    this.loaded = false;
  }

  loadObject(sceneObj) {
    this.scene = sceneObj;
    this.scene.nodeMap = {};
    this.context.initScene(this.scene);
    this.loaded = true;
  }

  createEmpty() {
    this.scene = new Scene();
    this.scene.children = [];
    this.scene.nodeMap = {};
    this.context.initScene(this.scene);
    this.loaded = true;
  }

  resize(w, h) { this.context.init(w, h); }

  showGeometry(names) {
    if (this.scene == null || this.scene.nodeMap == null || names == null) return;
    for (const n of names) { const o = this.scene.nodeMap[n]; if (o instanceof Node) o.visible = true; }
  }

  hideGeometry(names) {
    if (this.scene == null || this.scene.nodeMap == null || names == null) return;
    for (const n of names) { const o = this.scene.nodeMap[n]; if (o instanceof Node) o.visible = false; }
  }

  hideAllGeometry() {
    const map = this.scene.nodeMap;
    if (map == null) return;
    for (const k in map) if (map[k] instanceof Node) map[k].visible = false;
  }

  cullByName(name) { if (this.scene != null) this.scene.cullByName(name); }
  resetCulling() { if (this.scene != null) this.scene.resetCulling(); }

  updateTextures(catalog, lib, specificItem = null) {
    const materialHash = {};
    const items = catalogItems(catalog);
    const matOptions = catalogMaterialOptions(catalog);
    for (const item of items) {
      const alwaysVisible = xmlAttr(item, 'alwaysVis') === 'true';
      const visible = xmlAttr(item, 'visible') === 'true';
      const create = alwaysVisible || visible;
      const prop = xmlAttr(item, 'prop') === 'true';
      const hashOnly = specificItem != null && item !== specificItem;
      if (!create) continue;
      const materialName = xmlAttr(item, 'mat');
      const matOption = matOptions.find((m) => xmlAttr(m, 'name') === materialName);
      if (!matOption) continue;
      const shared = xmlAttr(matOption, 'shared') === 'true';
      const mats = xmlChildren(matOption, 'material');
      let index = parseInt(xmlAttr(matOption, 'materialIndex'), 10) | 0;
      if (isNaN(index) || index >= mats.length) { index = 0; matOption.setAttribute('materialIndex', '0'); }
      const material = mats[index];
      if (material == null) continue;
      for (let g = 1; g <= 4; g++) {
        if (xmlHas(item, 'geo' + g)) {
          this.applyTexture(xmlAttr(item, 'geo' + g), materialHash, lib, materialName, material, xmlAttr(item, 'lightmap' + g), shared, hashOnly, prop);
        }
      }
    }
  }

  applyTexture(geo, hash, lib, matName, desc, lightmap, shared, hashOnly, prop) {
    if (geo == null || geo.length < 1) return;
    const node = this.scene.nodeMap[geo];
    if (!(node instanceof Node)) return;
    const mesh = node.mesh;
    if (mesh == null) return;
    if (shared && hash[matName] != null) {
      mesh.material = hash[matName];
      mesh.updateTextures();
    } else if (hashOnly) {
      if (shared) hash[matName] = undefined;
    } else {
      if (mesh.material != null) { mesh.material.dispose(); mesh.material = null; }
      const m = new BaseMaterial();
      if (!prop) m.bitmapData = lib.createMaterial(desc, lightmap);
      m.desc = desc;
      m.lightmap = lightmap || null;
      m.materialLibrary = lib;
      mesh.material = m;
      mesh.updateTextures();
      if (shared) hash[matName] = m;
    }
  }

  hideCullingGroup(cullGroups, groupName) {
    if (groupName == null || groupName.length < 1) return;
    const group = cullGroups.find((g) => xmlAttr(g, 'name') === groupName);
    if (!group) return;
    for (const r of xmlChildren(group, 'region')) this.cullByName(xmlAttr(r, 'name'));
  }

  setVisibleGeometry(catalog, hideProps = false) {
    const items = catalogItems(catalog);
    if (items.length === 0) return;
    this.hideAllGeometry();
    this.resetCulling();
    const cullOptions = Array.from(catalog.getElementsByTagName('cullOption'));
    const cullGroups = Array.from(catalog.getElementsByTagName('cullGroup'));
    const visible = [];
    const applyCulls = (item) => {
      for (let c = 1; c <= 3; c++) if (xmlHas(item, 'cull' + c)) this.hideCullingGroup(cullGroups, xmlAttr(item, 'cull' + c));
      for (let c = 1; c <= 3; c++) {
        if (xmlHas(item, 'cullOption' + c)) {
          const opt = xmlAttr(item, 'cullOption' + c);
          const values = [];
          for (const o of cullOptions) if (xmlAttr(o, 'name') === opt) for (const v of xmlChildren(o, 'cullvalue')) if (xmlAttr(v, 'isDefault') === 'true') values.push(v);
          if (values.length > 0) this.hideCullingGroup(cullGroups, xmlAttr(values[0], 'cullGroup'));
        }
      }
    };
    for (const item of items) {
      if (xmlAttr(item, 'visible') === 'true' || xmlAttr(item, 'alwaysVis') === 'true') {
        for (let g = 1; g <= 4; g++) if (xmlHas(item, 'geo' + g)) visible.push(xmlAttr(item, 'geo' + g));
        applyCulls(item);
      }
      if (xmlAttr(item, 'forceCulling') === 'true') applyCulls(item);
    }
    const sliderSet = xmlFind(catalog.documentElement, 'sliderSet');
    if (sliderSet) setSliders(xmlChildren(sliderSet, 'slider'), this.scene);
    this.showGeometry(visible);
    if (hideProps) this.scene.hideProps();
  }

  // Collects this player's triangles (see Context.draw).
  collect() {
    if (this.scene == null) return [];
    this.context.scene = this.scene;
    return this.context.draw(this.scene);
  }
}

export function catalogItems(catalog) {
  // catalog.group.categories.itemCategory.item
  const out = [];
  const root = catalog.documentElement;
  for (const g of xmlChildren(root, 'group'))
    for (const cats of xmlChildren(g, 'categories'))
      for (const cat of xmlChildren(cats, 'itemCategory'))
        for (const it of xmlChildren(cat, 'item')) out.push(it);
  return out;
}

export function catalogMaterialOptions(catalog) {
  const out = [];
  for (const mo of xmlChildren(catalog.documentElement, 'materialOptions'))
    for (const o of xmlChildren(mo, 'materialOption')) out.push(o);
  return out;
}

// ---- SceneUtil.setSliders ----
function strToNumArray(s) {
  if (s == null || s.length < 1) return null;
  return s.split(' ').map(Number);
}

function setSliderTargetValue(t, node, value, acc) {
  const target = xmlAttr(t, 'target');
  if (target == null || target.length < 1) return;
  const local = xmlAttr(t, 'local') === 'true';
  node.deformPos = null; node.deformRot = null; node.deformScale = null; node.parentDeformScale = null;
  if (node.children) for (const c of node.children) if (c instanceof Node) c.parentDeformScale = null;
  const lerp3 = (a, v) => v === 0 ? a[1] : v > 0 ? a[1] + (a[2] - a[1]) * v / 100 : a[0] - (a[0] - a[1]) * (100 + v) / 100;
  const px = strToNumArray(xmlAttr(t, 'posx')), py = strToNumArray(xmlAttr(t, 'posy')), pz = strToNumArray(xmlAttr(t, 'posz'));
  if (px && py && pz && px.length === 3 && py.length === 3 && pz.length === 3) {
    const v = new Vector3(lerp3(px, value), lerp3(py, value), lerp3(pz, value));
    const key = target + '_pos';
    if (acc[key] == null) acc[key] = { node, field: 'deformPos', data: v };
    else { const d = acc[key].data; d.x += v.x; d.y += v.y; d.z += v.z; }
  }
  const axis = strToNumArray(xmlAttr(t, 'axis')), angle = strToNumArray(xmlAttr(t, 'angle'));
  if (axis && angle && axis.length === 3 && angle.length === 3) {
    const r = new AxisAngle(axis[0], axis[1], axis[2], lerp3(angle, value));
    const key = target + '_rot';
    if (acc[key] == null) acc[key] = { node, field: 'deformRot', data: r };
    else { const d = acc[key].data; d.x += r.x; d.y += r.y; d.z += r.z; d.angle += r.angle; }
  }
  const sx = strToNumArray(xmlAttr(t, 'scalex')), sy = strToNumArray(xmlAttr(t, 'scaley')), sz = strToNumArray(xmlAttr(t, 'scalez'));
  if (sx && sy && sz && sx.length === 3 && sy.length === 3 && sz.length === 3) {
    const v = new Vector3(lerp3(sx, value), lerp3(sy, value), lerp3(sz, value));
    const key = target + '_deformScale';
    if (acc[key] == null) acc[key] = { node, field: 'deformScale', data: v, local };
    else { const d = acc[key].data; d.x *= v.x; d.y *= v.y; d.z *= v.z; }
  }
  const channel = xmlAttr(t, 'channel');
  const vals = strToNumArray(xmlAttr(t, 'value'));
  if (channel != null && channel.length > 0 && vals && vals.length === 3) {
    const w = lerp3(vals, value);
    const mod = node.mesh && node.mesh.modifier;
    if (mod != null && mod.channels != null) {
      const idx = mod.channels.indexOf(channel);
      const key = target + '_weights_' + idx;
      if (acc[key] == null) acc[key] = { node: mod, field: 'weights', index: idx, data: w, count: 1 };
      else { acc[key].data += w; acc[key].count++; }
    }
  }
}

export function setSliders(sliders, scene) {
  const acc = {};
  for (const s of sliders) {
    const vs = xmlAttr(s, 'value');
    const value = vs != null && vs.length > 0 ? Number(vs) : 0;
    for (const t of xmlChildren(s, 'sliderTarget')) {
      const node = scene.getNodeByName(xmlAttr(t, 'target'));
      if (node instanceof Node) setSliderTargetValue(t, node, value, acc);
    }
  }
  for (const k in acc) {
    const e = acc[k];
    if (e == null || e.node == null || e.field == null) continue;
    if (e.field === 'weights') {
      const arr = e.node.weights;
      if (arr != null) arr[e.index] = e.data / e.count;
    } else {
      e.node[e.field] = e.data;
      if (e.field === 'deformScale' && e.local === true) {
        const kids = e.node.children;
        if (kids != null && kids.length > 0) {
          const inv = new Vector3(1 / e.data.x, 1 / e.data.y, 1 / e.data.z);
          for (const c of kids) if (c instanceof Node && inv.x !== 0) c.parentDeformScale = inv;
        }
      }
    }
  }
}
