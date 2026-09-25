// Port of com.buddylabs.player.MediaLibrary: builds texture bitmaps for a
// catalog <material> by compositing its layers (symbols from the embedded
// material SWF, colour tints, masks and lightmaps).

import { SWF, makeCanvas } from './swf/swf.js';
import { MovieClip, createInstance, renderDisplayObject, applyColorMatrix, blendToComposite, IDENTITY_CX } from './swf/display.js';
import { xmlAttr, xmlChildren, xmlHas } from './xml.js';
import { GpuTinter } from './gputint.js';

const MAT_50_PERCENT = [1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0.5, 0];
const IDENTITY_M = { a: 1, b: 0, c: 0, d: 1, tx: 0, ty: 0 };

// Texture resolution multiplier: materials are vector art, so they can be
// rendered sharper than the original bitmap sizes.
export let TEXTURE_SCALE = 2;
export function setTextureScale(s) { TEXTURE_SCALE = s; }

export class MediaLibrary {
  constructor() {
    this.swf = null;
    this.library = null;
    this.paletteCache = new Map();
    this.colorTintLut = new Map();
    this.symbolCanvasCache = new Map();
  }

  async init(swfBytes, libraryJson, iconSwfBytes = null) {
    this.swf = await SWF.load(swfBytes);
    // Picker thumbnails (Icon_* / Char_* symbols). The July 2009 app keeps
    // them in a separate SWF embedded in the Customization window.
    this.iconSwf = iconSwfBytes ? await SWF.load(iconSwfBytes) : null;
    this.library = libraryJson;
    this.frameRate = this.swf.frameRate;
  }

  hasSymbol(name) { return this.swf.symbols.has(name); }

  // Equivalent of getSymbol(): a fresh display object for a linked class.
  getSymbol(name) {
    if (name == null) return null;
    const id = this.swf.symbols.get(name);
    if (id === undefined) return null;
    const inst = createInstance(this.swf, id);
    if (inst == null) return null;
    const ch = this.swf.characters.get(id);
    if (ch.kind === 'bitmap') {
      const holder = new MovieClip(this.swf, null);
      holder.addChild(inst);
      return holder;
    }
    return inst;
  }

  getClipRect(name) {
    const r = this.library.clipRects[name];
    return r ? { x: r[0], y: r[1], width: r[2], height: r[3] } : null;
  }

  loadPalette(name) {
    if (name == null) return null;
    if (this.paletteCache.has(name)) return this.paletteCache.get(name);
    const ch = this.swf.getCharacterByName(name);
    if (!ch || ch.kind !== 'bitmap') return null;
    // Lossless bitmaps keep their decoded pixels; reading those avoids a
    // GPU readback of the canvas (about a second on slow phones).
    const d = (ch.imageData || ch.canvas.getContext('2d').getImageData(0, 0, ch.width, ch.height)).data;
    const out = new Uint32Array(d.length >> 2);
    for (let i = 0, j = 0; i < d.length; i += 4, j++) out[j] = ((d[i + 3] << 24) | (d[i] << 16) | (d[i + 1] << 8) | d[i + 2]) >>> 0;
    this.paletteCache.set(name, out);
    return out;
  }

  getColorTintOption(name) {
    if (name == null || this.library == null) return null;
    if (this.colorTintLut.has(name)) return this.colorTintLut.get(name);
    const opt = this.library.colorOptions[name];
    if (!opt) return null;
    const pal = this.loadPalette(opt.palette);
    if (pal != null) { this.colorTintLut.set(name, pal); return pal; }
    if (opt.colorMat) { const a = opt.colorMat.map((_, i) => i); this.colorTintLut.set(name, a); return a; }
    return null;
  }

  // A finished (tinted + masked) layer bitmap, cached by its inputs since
  // symbols are static artwork. Returns null for empty symbols.
  layerCanvas(name, frame, rect, s, colorMatrix, maskKey) {
    const key = name + '|' + frame + '|' + rect.width + 'x' + rect.height + '@' + s + '|' + (colorMatrix ? colorMatrix.join(',') : '') + '|' + (maskKey || '');
    const cache = this.layerCache || (this.layerCache = new Map());
    if (cache.has(key)) { const v = cache.get(key); cache.delete(key); cache.set(key, v); return v; }
    const sym = this.getSymbol(name);
    let c = null;
    if (sym) {
      if (frame !== 1) MovieClip.advanceToFrame(sym, Math.max(1, frame));
      const b = this.bounds(sym, IDENTITY_M);
      if (b && b.xmax > b.xmin && b.ymax > b.ymin) {
        c = this.rasterize(sym, rect.width, rect.height, s);
        const m = maskKey ? this.maskCanvas(maskKey, rect, s) : null;
        if (this.tinter === undefined) this.tinter = GpuTinter.create();
        if ((colorMatrix || m) && this.tinter && this.tinter.apply(c, colorMatrix, m)) {
          // tinted and masked on the GPU
        } else {
          const ctx = c.getContext('2d');
          if (colorMatrix) {
            const d = ctx.getImageData(0, 0, c.width, c.height);
            applyColorMatrix(d.data, colorMatrix);
            ctx.putImageData(d, 0, 0);
          }
          if (maskKey) {
            ctx.globalCompositeOperation = 'destination-in';
            if (m) ctx.drawImage(m, 0, 0); else ctx.clearRect(0, 0, c.width, c.height);
            ctx.globalCompositeOperation = 'source-over';
          }
        }
      }
    }
    cache.set(key, c);
    if (cache.size > 160) cache.delete(cache.keys().next().value);
    return c;
  }

  maskCanvas(maskKey, rect, s) {
    const key = maskKey + '|' + rect.width + 'x' + rect.height + '@' + s;
    const cache = this.maskCache || (this.maskCache = new Map());
    if (cache.has(key)) return cache.get(key);
    const comp = new MovieClip(this.swf, null);
    for (const n of maskKey.split('+')) { const m = this.getSymbol(n); if (m) comp.addChild(m); }
    const c = this.rasterize(comp, rect.width, rect.height, s);
    cache.set(key, c);
    return c;
  }

  // Renders a display object into a new canvas of w x h (scaled by s).
  rasterize(obj, w, h, s, frame = 1) {
    const c = makeCanvas(Math.ceil(w * s), Math.ceil(h * s));
    const ctx = c.getContext('2d');
    if (frame !== 1) MovieClip.advanceToFrame(obj, frame);
    renderDisplayObject(ctx, obj, { a: s, b: 0, c: 0, d: s, tx: 0, ty: 0 }, IDENTITY_CX, this.swf);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    return c;
  }

  // createMaterialInternal + createMaterial. Returns a canvas (the
  // BitmapData) or null. `frame` is the MovieClip frame (1-based).
  createMaterial(material, lightmapName = null, _bmd = null, frame = 1) {
    const s = TEXTURE_SCALE;
    const layers = xmlChildren(material, 'layer');
    if (layers.length < 1) return null;
    const rect = this.getClipRect(xmlAttr(material, 'clipRect'));
    if (rect == null) return null;
    const W = Math.round((rect.width - rect.x) * s), H = Math.round((rect.height - rect.x) * s);
    const out = makeCanvas(W, H);
    const octx = out.getContext('2d');
    const matBlend = xmlAttr(material, 'blendMode');
    const grabbedMaskLut = new Map();
    const findLayer = (name) => layers.find((l) => xmlAttr(l, 'name') === name) || null;

    for (const alayer of layers) {
      let whichTexture = -1, whichColor = -1;
      if (xmlHas(alayer, 'lockTexture')) {
        const lk = findLayer(xmlAttr(alayer, 'lockTexture'));
        const sel = lk ? xmlAttr(lk, 'textureIndex') : null;
        if (sel != null && sel.length > 0) whichTexture = parseInt(sel, 10) | 0;
      }
      if (xmlHas(alayer, 'lockColor')) {
        const cl = findLayer(xmlAttr(alayer, 'lockColor'));
        const sel = cl ? xmlAttr(cl, 'colorIndex') : null;
        if (sel != null && sel.length > 0) whichColor = parseInt(sel, 10) | 0;
      }
      const textures = xmlChildren(alayer, 'texture');
      const numTextures = textures.length;
      if (whichTexture === -1) {
        const t = xmlAttr(alayer, 'textureIndex');
        if (t != null && t.length > 0) whichTexture = parseInt(t, 10) | 0;
        else whichTexture = numTextures <= 1 ? 0 : randomInt(numTextures - 1);
      }
      if (whichTexture >= numTextures) whichTexture = numTextures - 1;
      const atexture = textures[whichTexture];
      if (!atexture) continue;
      const layerName = xmlAttr(alayer, 'name');
      if (layerName != null && layerName.length > 0) alayer.setAttribute('textureIndex', String(whichTexture));
      const symbolName = xmlAttr(atexture, 'symbol');
      if (symbolName == null || symbolName.length === 0) continue;
      if (!this.hasSymbol(symbolName)) return null;

      // Masks (own or grabbed from another layer's texture)
      let grabbed = false, maskNames = null, grabMask = null;
      if (xmlHas(alayer, 'grabMask')) {
        grabMask = xmlAttr(alayer, 'grabMask');
        const gl = findLayer(grabMask);
        if (gl) {
          const gi = parseInt(xmlAttr(gl, 'textureIndex'), 10) | 0;
          const gt = xmlChildren(gl, 'texture')[gi];
          maskNames = gt ? xmlChildren(gt, 'mask').map((m) => xmlAttr(m, 'maskSelection')) : [];
          if (maskNames.length > 0) grabbed = true;
        }
      }
      const ownMasks = xmlChildren(atexture, 'mask');
      let maskKey = null;
      if (grabbed || ownMasks.length > 0) {
        if (!grabbed) maskNames = ownMasks.map((m) => xmlAttr(m, 'maskSelection'));
        const valid = maskNames.filter((n) => this.hasSymbol(n));
        if (valid.length > 0) {
          if (grabbed) maskKey = grabbedMaskLut.get(grabMask) || null;
          else { maskKey = valid.join('+'); grabbedMaskLut.set(layerName, maskKey); }
        }
      }

      // Colour tint
      let colorMatrix = null;
      const whichColorOption = xmlAttr(atexture, 'color');
      let colorIndex;
      if (whichColor !== -1) { colorIndex = whichColor; atexture.setAttribute('colorSelection', String(whichColor)); }
      else {
        const cs = xmlAttr(atexture, 'colorSelection');
        colorIndex = cs == null || cs.length === 0 ? -1 : parseInt(cs, 10) | 0;
      }
      if (whichColorOption != null) {
        const option = this.library.colorOptions[whichColorOption];
        if (option != null) {
          const cm = option.colorMat;
          if (cm != null && colorIndex < cm.length) {
            if (colorIndex === -1) colorIndex = cm.length <= 1 ? 0 : Math.floor(Math.random() * (cm.length - 0.001));
            colorMatrix = cm[colorIndex];
          } else {
            const pal = this.loadPalette(option.palette);
            if (pal != null) {
              if (colorIndex >= pal.length) colorIndex = pal.length - 1;
              else if (colorIndex === -1) colorIndex = pal.length <= 1 ? 0 : Math.floor(Math.random() * (pal.length - 0.001));
              const v = pal[colorIndex];
              colorMatrix = [((v >> 16) & 255) / 255, 0, 0, 0, 0, 0, ((v >> 8) & 255) / 255, 0, 0, 0, 0, 0, (v & 255) / 255, 0, 0, 0, 0, 0, 1, 0];
            }
          }
        }
        atexture.setAttribute('colorSelection', String(colorIndex));
        alayer.setAttribute('colorIndex', String(colorIndex));
      }

      // Render the symbol layer, then tint, mask and composite it.
      let blend = xmlAttr(alayer, 'blendMode') || 'normal';
      if (maskKey) blend = 'normal'; // the masked group is a LAYER composited normally
      const lc = this.layerCanvas(symbolName, frame, rect, s, colorMatrix, maskKey);
      if (lc) {
        octx.globalCompositeOperation = blendToComposite(blend);
        octx.drawImage(lc, 0, 0);
        octx.globalCompositeOperation = 'source-over';
        if (this.debugLayers) this.debugLayers.push({ name: layerName + ':' + symbolName + (maskKey ? ' [mask ' + maskKey + ']' : '') + ' ' + blend + (colorMatrix ? ' tint' : ''), canvas: lc });
      }
    }

    // Lightmap: a HARDLIGHT copy and an OVERLAY copy, both at 50% alpha.
    const lmSymbol = lightmapName ? this.library.lightmaps[lightmapName] : null;
    if (lmSymbol) {
      const lc = this.layerCanvas(lmSymbol, 1, rect, s, null, null);
      if (lc) {
        octx.globalAlpha = 0.5;
        octx.globalCompositeOperation = 'hard-light';
        octx.drawImage(lc, 0, 0);
        octx.globalCompositeOperation = 'overlay';
        octx.drawImage(lc, 0, 0);
        octx.globalAlpha = 1;
        octx.globalCompositeOperation = 'source-over';
      }
    }

    // The material sprite is drawn into a transparent bitmap when hasAlpha,
    // otherwise into an opaque white one.
    const hasAlpha = xmlAttr(material, 'hasAlpha') === 'true';
    let result = out;
    if (matBlend && matBlend !== 'layer' && matBlend !== 'normal') {
      // A material-level blend mode blends against the empty bitmap.
      result = out;
    }
    if (!hasAlpha) {
      const opaque = makeCanvas(W, H);
      const c = opaque.getContext('2d');
      c.fillStyle = '#ffffff';
      c.fillRect(0, 0, W, H);
      c.drawImage(out, 0, 0);
      result = opaque;
    }
    result.baseWidth = rect.width - rect.x;
    result.baseHeight = rect.height - rect.x;
    return result;
  }

  // createMaterialMovieClip equivalent for backgrounds: returns a canvas.
  createMaterialCanvas(material) { return this.createMaterial(material, null, null, 1); }

  // Icon thumbnail (CustomizationPanel.cacheToBitmap): fits the symbol
  // bounds into size x size.
  hasIcon(name) { return (this.iconSwf && this.iconSwf.symbols.has(name)) || this.hasSymbol(name); }

  renderIcon(name, size = 36) {
    const swf = this.iconSwf && this.iconSwf.symbols.has(name) ? this.iconSwf : this.swf;
    const id = swf.symbols.get(name);
    const sym = id === undefined ? null : createInstance(swf, id);
    if (!sym) return null;
    const b = this.bounds(sym, IDENTITY_M);
    const c = makeCanvas(size * 2, size * 2);
    if (!b || b.xmax <= b.xmin) return c;
    const w = b.xmax - b.xmin, h = b.ymax - b.ymin;
    const sc = Math.min((size * 2) / w, (size * 2) / h);
    const ctx = c.getContext('2d');
    const tx = (size * 2 - w * sc) / 2 - b.xmin * sc, ty = (size * 2 - h * sc) / 2 - b.ymin * sc;
    renderDisplayObject(ctx, sym, { a: sc, b: 0, c: 0, d: sc, tx, ty }, IDENTITY_CX, swf);
    return c;
  }

  bounds(obj, m) {
    const mm = mul(m, { ...obj.matrix, tx: obj.matrix.tx / 20, ty: obj.matrix.ty / 20 });
    if (obj.def && obj.def.kind === 'shape') {
      const r = obj.def.bounds;
      return transformRect({ xmin: r.xmin / 20, ymin: r.ymin / 20, xmax: r.xmax / 20, ymax: r.ymax / 20 }, mm);
    }
    if (obj.bitmap) return transformRect({ xmin: 0, ymin: 0, xmax: obj.bitmap.width, ymax: obj.bitmap.height }, mm);
    if (obj.children) {
      let acc = null;
      for (const c of obj.children) {
        const b = this.bounds(c, mm);
        if (!b) continue;
        acc = acc ? { xmin: Math.min(acc.xmin, b.xmin), ymin: Math.min(acc.ymin, b.ymin), xmax: Math.max(acc.xmax, b.xmax), ymax: Math.max(acc.ymax, b.ymax) } : b;
      }
      return acc;
    }
    return null;
  }
}

function mul(p, c) {
  return { a: p.a * c.a + p.c * c.b, b: p.b * c.a + p.d * c.b, c: p.a * c.c + p.c * c.d, d: p.b * c.c + p.d * c.d, tx: p.a * c.tx + p.c * c.ty + p.tx, ty: p.b * c.tx + p.d * c.ty + p.ty };
}

function transformRect(r, m) {
  const pts = [[r.xmin, r.ymin], [r.xmax, r.ymin], [r.xmin, r.ymax], [r.xmax, r.ymax]].map(([x, y]) => [m.a * x + m.c * y + m.tx, m.b * x + m.d * y + m.ty]);
  return { xmin: Math.min(...pts.map((p) => p[0])), ymin: Math.min(...pts.map((p) => p[1])), xmax: Math.max(...pts.map((p) => p[0])), ymax: Math.max(...pts.map((p) => p[1])) };
}

// SceneUtil.randomInt(n) with the default second argument.
function randomInt(n) { return Math.floor(Math.random() * (n + 0.9999)); }
