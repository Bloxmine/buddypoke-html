// Appearance editor, modelled on the BuddyPoke CustomizationPanel: one row
// per CustomizationOptions entry with texture pickers (Icon_* symbols),
// colour pickers (palette bitmaps) and item-group pickers.

import { CUSTOMIZATION_OPTIONS } from '../data/options.js';
import { xmlAttr, xmlChildren } from '../xml.js';
import { popover } from './widgets.js';
import { LAYER_DEPENDENCIES } from '../buddy.js';

const ICON = 36;
const hex = (v) => '#' + (v & 0xffffff).toString(16).padStart(6, '0');

export class CustomizePanel {
  constructor(root, renderer, { onChange, isLocked, onLocked } = {}) {
    this.root = root;
    this.renderer = renderer;
    this.onChange = onChange || (() => {});
    this.isLocked = isLocked || (() => null);   // (sub, index) -> shop item id or null
    this.onLocked = onLocked || (() => {});
    this.iconCache = new Map();
    this.buddy = null;
    this.pending = false;
  }

  get lib() { return this.renderer.matLib; }

  setBuddy(buddy) {
    this.buddy = buddy;
    this.build();
  }

  refresh() { if (this.buddy) this.build(); }

  // ---------------------------------------------------------- model
  selection(sub) {
    const b = this.buddy;
    if (sub.type === 'texture') {
      const layer = b.findLayer(sub.path);
      if (!layer) return null;
      const textures = xmlChildren(layer, 'texture');
      let idx = parseInt(xmlAttr(layer, 'textureIndex'), 10);
      if (isNaN(idx)) idx = 0;
      return { layer, textures, idx: Math.min(idx, textures.length - 1) };
    }
    if (sub.type === 'color') {
      const tex = b.findTexture(sub.path);
      if (!tex) return null;
      const color = xmlAttr(tex, 'color');
      const colors = color ? this.lib.getColorTintOption(color) : null;
      if (!colors || colors.length < 2) return null;
      let idx = parseInt(xmlAttr(tex.parentNode, 'colorIndex'), 10);
      if (isNaN(idx) || idx < 0) idx = parseInt(xmlAttr(tex, 'colorSelection'), 10) || 0;
      return { tex, colors, idx: Math.min(idx, colors.length - 1) };
    }
    if (sub.type === 'itemGroup') {
      const [cat, grp] = sub.path.split(';');
      const items = b.findGroupItems(cat, grp);
      let idx = 0;
      items.forEach((it, i) => { if (xmlAttr(it, 'visible') === 'true') idx = i; });
      return { items, idx, cat };
    }
    if (sub.type === 'item') {
      const [cat, name] = sub.path.split(';');
      const item = b.findItem(cat, name);
      return item ? { item, idx: xmlAttr(item, 'visible') === 'true' ? 1 : 0, cat } : null;
    }
    return null;
  }

  selIndex(id) {
    for (const op of CUSTOMIZATION_OPTIONS) for (const sub of op.items) if (sub.id === id) { const s = this.selection(sub); return s ? s.idx : -1; }
    return -1;
  }

  // Material of the currently selected HeadTop item (Hair / Hair_Shave / BCap).
  headTopMaterial() {
    const items = this.buddy.findGroupItems('Hair', 'HeadTop');
    const vis = items.find((it) => xmlAttr(it, 'visible') === 'true');
    return vis ? xmlAttr(vis, 'mat') : null;
  }

  // Is a material option shown on the buddy right now? Materials only used
  // by props/vehicles count as in use (they appear during animations).
  materialInUse(mat) {
    let any = false;
    for (const cat of this.buddy.itemCategories()) {
      const cname = xmlAttr(cat, 'name');
      for (const it of xmlChildren(cat, 'item')) {
        if (xmlAttr(it, 'mat') !== mat) continue;
        any = true;
        if (cname === 'Props' || cname === 'Vehicles') return true;
        if (xmlAttr(it, 'alwaysVis') === 'true' || xmlAttr(it, 'visible') === 'true') return true;
      }
    }
    return !any;
  }

  // Option visibility: the old CustomizationPanel.dependencies, expressed
  // by material names instead of hard-coded indices.
  optionVisible(op) {
    const between = (id, a, b) => { const v = this.selIndex(id); return v >= a && v <= b; };
    const hair = ['Hair', 'HairAfro', 'HairDread'].includes(this.headTopMaterial());
    switch (op.name) {
      case 'Hair 2': case 'Hair Color': case 'Hair Strand': case 'Hair Streak': return hair;
      case 'Shaved Hair': return this.headTopMaterial() === 'Hair_Shave';
      case 'Cap': case 'Cap 2': return ['BCap', 'WHat'].includes(this.headTopMaterial());
      case 'High Belt Pattern': return between('blt', 1, 3);
      case 'Low Belt Pattern': return between('blt', 4, 6);
      case 'Sling Pattern': return between('sst', 1, 3);
      case 'Shoe Pattern': return this.selIndex('sst') === 4;
      case 'Boot Pattern': return this.selIndex('sst') === 5;
      case 'Skirt 2': case 'Skirt 3': return this.selIndex('ski') >= 1;
      case 'Jersey #': return this.selIndex('sl2t') === 33;
      case 'Jersey ##': return this.selIndex('sl2t') === 34;
      case 'Jersey Line': return between('sl2t', 33, 34);
      default: return true;
    }
  }

  subVisible(sub) {
    if (sub.type === 'itemGroup' || sub.type === 'item') return true;
    return this.materialInUse(sub.path.split(';')[0]);
  }

  // ---------------------------------------------------------- view
  build() {
    const root = this.root;
    root.innerHTML = '';
    for (const op of CUSTOMIZATION_OPTIONS) {
      if (!this.optionVisible(op)) continue;
      const controls = [];
      for (const sub of op.items) {
        if (!this.subVisible(sub)) continue;
        const sel = this.selection(sub);
        if (!sel) continue;
        controls.push(this.control(op, sub, sel));
      }
      if (!controls.length) continue;
      const row = document.createElement('div');
      row.className = 'option';
      const label = document.createElement('div');
      label.className = 'option-name';
      label.textContent = op.name;
      const box = document.createElement('div');
      box.className = 'option-controls';
      controls.forEach((c) => box.appendChild(c));
      row.append(label, box);
      root.appendChild(row);
    }
  }

  control(op, sub, sel) {
    const btn = document.createElement('button');
    btn.type = 'button';
    if (sub.type === 'color') {
      btn.className = 'pick swatch';
      btn.style.background = hex(sel.colors[sel.idx]);
      btn.title = op.name + ' colour';
      btn.setAttribute('aria-label', op.name + ' colour');
      btn.addEventListener('click', () => this.openColors(btn, op, sub));
    } else {
      btn.className = 'pick';
      const names = this.iconNames(sub, sel);
      btn.appendChild(this.icon(names[sel.idx]));
      const caret = document.createElement('span');
      caret.className = 'caret';
      caret.textContent = '▾';
      btn.appendChild(caret);
      btn.title = op.name;
      btn.setAttribute('aria-label', op.name + ': choose');
      btn.addEventListener('click', () => this.openIcons(btn, op, sub));
    }
    return btn;
  }

  iconNames(sub, sel) {
    if (sub.type === 'texture') return sel.textures.map((t) => 'Icon_' + xmlAttr(t, 'symbol'));
    if (sub.type === 'itemGroup') return sel.items.map((it) => this.itemIconName(it));
    if (sub.type === 'item') return ['Icon_BlankClip', this.itemIconName(sel.item)];
    return [];
  }

  itemIconName(item) {
    const cat = item.parentNode;
    const group = cat.parentNode.parentNode;
    return xmlAttr(group, 'name') + '_' + xmlAttr(cat, 'name') + '_' + xmlAttr(item, 'name');
  }

  icon(name) {
    let src = this.iconCache.get(name);
    if (src === undefined) {
      src = this.lib.hasIcon(name) ? this.lib.renderIcon(name, ICON) : null;
      this.iconCache.set(name, src);
    }
    const c = document.createElement('canvas');
    c.width = ICON * 2; c.height = ICON * 2;
    if (src) c.getContext('2d').drawImage(src, 0, 0);
    else {
      const g = c.getContext('2d');
      g.strokeStyle = '#c8ced8'; g.lineWidth = 4;
      g.beginPath(); g.moveTo(18, 18); g.lineTo(54, 54); g.moveTo(54, 18); g.lineTo(18, 54); g.stroke();
    }
    return c;
  }

  openIcons(anchor, op, sub) {
    const sel = this.selection(sub);
    const names = this.iconNames(sub, sel);
    const wrap = document.createElement('div');
    const h = document.createElement('h3');
    h.textContent = op.name;
    const grid = document.createElement('div');
    grid.className = 'icon-grid';
    names.forEach((n, i) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.setAttribute('aria-pressed', String(i === sel.idx));
      b.setAttribute('aria-label', `${op.name} option ${i + 1}`);
      b.appendChild(this.icon(n));
      const locked = this.isLocked(sub, i);
      if (locked) {
        b.classList.add('locked');
        b.title = 'Unlock in the Gold shop';
        const l = document.createElement('span');
        l.className = 'lock-badge';
        l.textContent = '🔒';
        b.appendChild(l);
      }
      b.addEventListener('click', () => {
        popover.close();
        if (locked) this.onLocked(locked);
        else this.apply(sub, i);
      });
      grid.appendChild(b);
    });
    wrap.append(h, grid);
    popover.open(anchor, wrap);
  }

  openColors(anchor, op, sub) {
    const sel = this.selection(sub);
    const wrap = document.createElement('div');
    const h = document.createElement('h3');
    h.textContent = op.name;
    const grid = document.createElement('div');
    grid.className = 'swatch-grid';
    sel.colors.forEach((c, i) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.style.background = hex(c);
      b.title = hex(c);
      b.setAttribute('aria-pressed', String(i === sel.idx));
      b.addEventListener('click', () => { this.apply(sub, i); popover.close(); });
      grid.appendChild(b);
    });
    wrap.append(h, grid);
    popover.open(anchor, wrap);
  }

  // Applies a selection (the onChange*Handler functions of the old panel).
  apply(sub, i) {
    const b = this.buddy;
    const sel = this.selection(sub);
    if (!sel) return;
    if (sub.type === 'texture') {
      // Buddy.deserialize / CustomizationPanel layerDependencies: reset
      // pattern layers that do not apply to the new choice.
      if (LAYER_DEPENDENCIES[sub.id]) b.resetLayers(LAYER_DEPENDENCIES[sub.id](i));
      sel.layer.setAttribute('textureIndex', String(i));
      for (const copy of sub.copies || []) { const l = b.findLayer(copy); if (l) l.setAttribute('textureIndex', String(i)); }
    } else if (sub.type === 'color') {
      sel.tex.parentNode.setAttribute('colorIndex', String(i));
      sel.tex.setAttribute('colorSelection', String(i));
      for (const copy of sub.copies || []) {
        const t = b.findTexture(copy);
        if (t) { t.parentNode.setAttribute('colorIndex', String(i)); t.setAttribute('colorSelection', String(i)); }
      }
    } else if (sub.type === 'itemGroup') {
      sel.items.forEach((it, k) => it.setAttribute('visible', k === i ? 'true' : 'false'));
      for (const copy of sub.copies || []) {
        const [cat, grp] = copy.split(';');
        b.findGroupItems(cat, grp).forEach((it, k) => it.setAttribute('visible', k === i ? 'true' : 'false'));
      }
      if (LAYER_DEPENDENCIES[sub.id]) b.resetLayers(LAYER_DEPENDENCIES[sub.id](i));
    } else if (sub.type === 'item') {
      sel.item.setAttribute('visible', i === 1 ? 'true' : 'false');
    }
    this.commit();
  }

  commit() {
    if (this.pending) return;
    this.pending = true;
    requestAnimationFrame(() => {
      this.pending = false;
      this.buddy.refresh();
      this.build();
      this.onChange();
    });
  }
}
