// Display-list runtime for SWF symbols (MovieClip timelines with
// gotoAndStop) and a Canvas 2D renderer that follows Flash semantics for
// matrices, colour transforms and the blend modes used by the library.

import { makeCanvas } from './swf.js';
import { GpuTinter } from '../gputint.js';

const IDENTITY_CX = [1, 1, 1, 1, 0, 0, 0, 0];
const BLEND_NAMES = ['normal', 'normal', 'layer', 'multiply', 'screen', 'lighten', 'darken', 'difference', 'add', 'subtract', 'invert', 'alpha', 'erase', 'overlay', 'hardlight'];

export function blendToComposite(mode) {
  switch (mode) {
    case 'multiply': return 'multiply';
    case 'screen': return 'screen';
    case 'lighten': return 'lighten';
    case 'darken': return 'darken';
    case 'difference': return 'difference';
    case 'add': return 'lighter';
    case 'overlay': return 'overlay';
    case 'hardlight': return 'hard-light';
    case 'alpha': return 'destination-in';
    case 'erase': return 'destination-out';
    default: return 'source-over';
  }
}

export function concatMatrix(p, c) {
  // result = p * c (apply c first, then p)
  return {
    a: p.a * c.a + p.c * c.b,
    b: p.b * c.a + p.d * c.b,
    c: p.a * c.c + p.c * c.d,
    d: p.b * c.c + p.d * c.d,
    tx: p.a * c.tx + p.c * c.ty + p.tx,
    ty: p.b * c.tx + p.d * c.ty + p.ty,
  };
}

export function concatCx(p, c) {
  if (c === IDENTITY_CX) return p;
  if (p === IDENTITY_CX) return c;
  return [
    p[0] * c[0], p[1] * c[1], p[2] * c[2], p[3] * c[3],
    p[0] * c[4] + p[4], p[1] * c[5] + p[5], p[2] * c[6] + p[6], p[3] * c[7] + p[7],
  ];
}

function isIdentityCx(cx) {
  return cx === IDENTITY_CX || (cx[0] === 1 && cx[1] === 1 && cx[2] === 1 && cx[3] === 1 && !cx[4] && !cx[5] && !cx[6] && !cx[7]);
}

const clamp255 = (v) => (v < 0 ? 0 : v > 255 ? 255 : v);

function applyCx(color, cx) {
  return [
    clamp255(color[0] * cx[0] + cx[4]),
    clamp255(color[1] * cx[1] + cx[5]),
    clamp255(color[2] * cx[2] + cx[6]),
    clamp255(color[3] * cx[3] + cx[7]),
  ];
}

const cssColor = (c) => `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${(c[3] / 255).toFixed(4)})`;

// ------------------------------------------------------------- instances

export class DisplayObject {
  constructor() {
    this.matrix = { a: 1, b: 0, c: 0, d: 1, tx: 0, ty: 0 };
    this.cxform = IDENTITY_CX;
    this.blendMode = 'normal';
    this.filters = null;   // flash filters from PlaceObject3
    this.colorMatrix = null; // ColorMatrixFilter set from script
    this.visible = true;
    this.name = null;
  }
}

export class ShapeInstance extends DisplayObject {
  constructor(def) { super(); this.def = def; }
}

export class BitmapInstance extends DisplayObject {
  constructor(bitmap) { super(); this.bitmap = bitmap; this.smoothing = false; }
}

export class Container extends DisplayObject {
  constructor() { super(); this.children = []; }
  addChild(c) { this.children.push(c); return c; }
}

export class MovieClip extends Container {
  constructor(swf, def) {
    super();
    this.swf = swf;
    this.def = def;
    this.currentFrame = 0;
    this.depths = new Map(); // depth -> child
    this.totalFrames = def ? Math.max(1, def.frames.length) : 1;
    if (def) this.gotoFrame(1);
  }

  get children() {
    if (!this.depths) return this._extra || [];
    const arr = Array.from(this.depths.entries()).sort((a, b) => a[0] - b[0]).map((e) => e[1]);
    return this._extra ? arr.concat(this._extra) : arr;
  }
  set children(v) { /* managed through depths */ }
  addChild(c) { (this._extra || (this._extra = [])).push(c); return c; }

  gotoFrame(n) {
    n = Math.max(1, Math.min(this.totalFrames, n | 0));
    if (n === this.currentFrame) return;
    if (n < this.currentFrame) { this.depths.clear(); this.currentFrame = 0; }
    while (this.currentFrame < n) {
      const ops = this.def.frames[this.currentFrame] || [];
      for (const op of ops) this.applyOp(op);
      this.currentFrame++;
    }
  }

  applyOp(op) {
    if (op.code === 28) { this.depths.delete(op.depth); return; }
    let child = this.depths.get(op.depth);
    if (op.hasCharacter && (!op.move || !child || child.characterId !== op.characterId)) {
      const inst = createInstance(this.swf, op.characterId);
      if (!inst) return;
      if (op.move && child) {
        inst.matrix = child.matrix; inst.cxform = child.cxform; inst.blendMode = child.blendMode; inst.filters = child.filters; inst.name = child.name;
      }
      child = inst;
      child.characterId = op.characterId;
      this.depths.set(op.depth, child);
    }
    if (!child) return;
    if (op.matrix) child.matrix = op.matrix;
    if (op.cxform) child.cxform = op.cxform;
    if (op.name) child.name = op.name;
    if (op.blendMode !== undefined) child.blendMode = BLEND_NAMES[op.blendMode] || 'normal';
    if (op.filters) child.filters = op.filters;
    if (op.visible !== undefined) child.visible = !!op.visible;
  }

  // flash.display.MovieClip.gotoAndStop, applied recursively like
  // SceneUtil.advanceMovieClipsToFrame.
  static advanceToFrame(obj, frame) {
    if (obj instanceof MovieClip && obj.def) obj.gotoFrame(frame);
    if (obj instanceof Container) {
      const kids = obj.children;
      for (let i = kids.length - 1; i >= 0; i--) MovieClip.advanceToFrame(kids[i], frame);
    }
  }
}

export function createInstance(swf, id) {
  const ch = swf.characters.get(id);
  if (!ch) return null;
  if (ch.kind === 'shape') return new ShapeInstance(ch);
  if (ch.kind === 'sprite') return new MovieClip(swf, ch);
  if (ch.kind === 'bitmap') return new BitmapInstance(ch);
  return null; // text fields and others are not rendered
}

// ------------------------------------------------------------- rendering

const pathCache = new WeakMap();

function cmdsToPath(cmds, m) {
  // m maps twips to pixels (with scale/translation) - applied up front so
  // Path2D coordinates are in canvas pixels.
  const p = new Path2D();
  for (const c of cmds) {
    if (c[0] === 'M') p.moveTo(c[1] / 20, c[2] / 20);
    else if (c[0] === 'L') p.lineTo(c[1] / 20, c[2] / 20);
    else p.quadraticCurveTo(c[1] / 20, c[2] / 20, c[3] / 20, c[4] / 20);
  }
  return p;
}

function getPaths(def) {
  let paths = pathCache.get(def);
  if (paths) return paths;
  paths = def.layers.map((layer) => ({
    fills: layer.fills.map((f) => ({ style: f.style, path: cmdsToPath(f.cmds) })),
    lines: layer.lines.map((l) => ({ style: l.style, path: cmdsToPath(l.cmds) })),
  }));
  pathCache.set(def, paths);
  return paths;
}

// Bitmaps under a colour transform. Alpha-only transforms (the common
// case) are drawn with globalAlpha; anything else is tinted once on the GPU
// (CPU fallback) and cached. Returns [image, alpha].
const bitmapCxCache = new WeakMap();
let cxTinter;
function bitmapWithCx(bmp, cx) {
  if (isIdentityCx(cx)) return [bmp.canvas, 1];
  if (cx[0] === 1 && cx[1] === 1 && cx[2] === 1 && !cx[4] && !cx[5] && !cx[6] && !cx[7]) return [bmp.canvas, Math.max(0, Math.min(1, cx[3]))];
  let m = bitmapCxCache.get(bmp);
  if (!m) bitmapCxCache.set(bmp, m = new Map());
  const k = cx.map((v) => Math.round(v * 1000)).join(',');
  let c = m.get(k);
  if (c) return [c, 1];
  c = makeCanvas(bmp.width, bmp.height);
  const ctx = c.getContext('2d');
  ctx.drawImage(bmp.canvas, 0, 0);
  if (cxTinter === undefined) cxTinter = GpuTinter.create();
  const matrix = [cx[0], 0, 0, 0, cx[4], 0, cx[1], 0, 0, cx[5], 0, 0, cx[2], 0, cx[6], 0, 0, 0, cx[3], cx[7]];
  if (!(cxTinter && cxTinter.apply(c, matrix, null))) {
    const d = ctx.getImageData(0, 0, bmp.width, bmp.height);
    applyCxToImageData(d.data, cx);
    ctx.putImageData(d, 0, 0);
  }
  m.set(k, c);
  return [c, 1];
}

export function applyCxToImageData(p, cx) {
  for (let i = 0; i < p.length; i += 4) {
    p[i] = clamp255(p[i] * cx[0] + cx[4]);
    p[i + 1] = clamp255(p[i + 1] * cx[1] + cx[5]);
    p[i + 2] = clamp255(p[i + 2] * cx[2] + cx[6]);
    p[i + 3] = clamp255(p[i + 3] * cx[3] + cx[7]);
  }
}

// Flash ColorMatrixFilter on unmultiplied RGBA.
export function applyColorMatrix(p, m) {
  const [a0, a1, a2, a3, a4, b0, b1, b2, b3, b4, c0, c1, c2, c3, c4, d0, d1, d2, d3, d4] = m;
  for (let i = 0; i < p.length; i += 4) {
    const r = p[i], g = p[i + 1], b = p[i + 2], a = p[i + 3];
    if (a === 0) continue;
    p[i] = clamp255(a0 * r + a1 * g + a2 * b + a3 * a + a4);
    p[i + 1] = clamp255(b0 * r + b1 * g + b2 * b + b3 * a + b4);
    p[i + 2] = clamp255(c0 * r + c1 * g + c2 * b + c3 * a + c4);
    p[i + 3] = clamp255(d0 * r + d1 * g + d2 * b + d3 * a + d4);
  }
}

function makeGradient(ctx, style, cx) {
  const g = style.gradient;
  let grad;
  if (style.type === 0x10) grad = ctx.createLinearGradient(-819.2, 0, 819.2, 0);
  else if (style.type === 0x13) grad = ctx.createRadialGradient(g.focal * 819.2, 0, 0, 0, 0, 819.2);
  else grad = ctx.createRadialGradient(0, 0, 0, 0, 0, 819.2);
  for (const s of g.stops) grad.addColorStop(s.ratio / 255, cssColor(applyCx(s.color, cx)));
  return grad;
}

function setTransform(ctx, m) { ctx.setTransform(m.a, m.b, m.c, m.d, m.tx, m.ty); }

function drawShape(ctx, def, m, cx) {
  const paths = getPaths(def);
  const rule = def.winding ? 'nonzero' : 'evenodd';
  for (const layer of paths) {
    for (const f of layer.fills) {
      const s = f.style;
      setTransform(ctx, m);
      if (s.type === 0x00) {
        ctx.fillStyle = cssColor(applyCx(s.color, cx));
        ctx.fill(f.path, rule);
      } else if (s.type === 0x10 || s.type === 0x12 || s.type === 0x13) {
        const gm = s.matrix;
        const g = { a: gm.a, b: gm.b, c: gm.c, d: gm.d, tx: gm.tx / 20, ty: gm.ty / 20 };
        const det = g.a * g.d - g.b * g.c;
        if (Math.abs(det) < 1e-12) {
          const last = s.gradient.stops[s.gradient.stops.length - 1];
          ctx.fillStyle = cssColor(applyCx(last.color, cx));
          ctx.fill(f.path, rule);
          continue;
        }
        if (!f.gradPath) {
          const inv = new DOMMatrix([g.a, g.b, g.c, g.d, g.tx, g.ty]).inverse();
          f.gradPath = new Path2D();
          f.gradPath.addPath(f.path, inv);
        }
        ctx.transform(g.a, g.b, g.c, g.d, g.tx, g.ty);
        ctx.fillStyle = makeGradient(ctx, s, cx);
        ctx.fill(f.gradPath, rule);
      } else if (s.bitmapId !== undefined) {
        const bitmap = currentSwf.characters.get(s.bitmapId);
        if (!bitmap || bitmap.kind !== 'bitmap') continue;
        const [img, alpha] = bitmapWithCx(bitmap, cx);
        const pat = ctx.createPattern(img, s.repeat ? 'repeat' : 'no-repeat');
        const bm = s.matrix;
        pat.setTransform(new DOMMatrix([bm.a / 20, bm.b / 20, bm.c / 20, bm.d / 20, bm.tx / 20, bm.ty / 20]));
        ctx.imageSmoothingEnabled = s.smooth;
        ctx.fillStyle = pat;
        ctx.globalAlpha = alpha;
        ctx.fill(f.path, rule);
        ctx.globalAlpha = 1;
        ctx.imageSmoothingEnabled = true;
      }
    }
    for (const l of layer.lines) {
      const s = l.style;
      setTransform(ctx, m);
      ctx.strokeStyle = cssColor(applyCx(s.color, cx));
      let w = s.width / 20;
      const scale = Math.sqrt(Math.abs(m.a * m.d - m.b * m.c));
      if (s.noScale && scale > 0) w /= scale;
      if (w * scale < 1) w = 1 / (scale || 1); // hairline
      ctx.lineWidth = w;
      const cap = s.startCap === 1 ? 'butt' : s.startCap === 2 ? 'square' : 'round';
      ctx.lineCap = cap;
      ctx.lineJoin = s.join === 1 ? 'bevel' : s.join === 2 ? 'miter' : 'round';
      if (s.join === 2) ctx.miterLimit = s.miter || 3;
      ctx.stroke(l.path);
    }
  }
}

let currentSwf = null;

// Render a display object tree into ctx. `m` maps object space (pixels) to
// canvas pixels; `cx` is the accumulated colour transform.
export function renderDisplayObject(ctx, obj, m, cx, swf) {
  if (!obj.visible) return;
  if (swf) currentSwf = swf;
  const mm = concatMatrix(m, obj.matrix.tx !== undefined ? { ...obj.matrix, tx: obj.matrix.tx / 20, ty: obj.matrix.ty / 20 } : obj.matrix);
  const needsLayer = (obj.blendMode && obj.blendMode !== 'normal') || obj.colorMatrix || (obj.filters && obj.filters.length);
  if (needsLayer) {
    const c = makeCanvas(ctx.canvas.width, ctx.canvas.height);
    const lctx = c.getContext('2d');
    const layerCx = obj.blendMode === 'layer' ? concatCx(cx, [obj.cxform[0], obj.cxform[1], obj.cxform[2], 1, obj.cxform[4], obj.cxform[5], obj.cxform[6], 0]) : concatCx(cx, obj.cxform);
    renderContent(lctx, obj, mm, layerCx);
    lctx.setTransform(1, 0, 0, 1, 0, 0);
    if (obj.colorMatrix) {
      const d = lctx.getImageData(0, 0, c.width, c.height);
      applyColorMatrix(d.data, obj.colorMatrix);
      lctx.putImageData(d, 0, 0);
    }
    if (obj.filters) applyGlowFilters(lctx, obj.filters);
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalCompositeOperation = blendToComposite(obj.blendMode);
    if (obj.blendMode === 'layer') ctx.globalAlpha = Math.max(0, Math.min(1, obj.cxform[3] + obj.cxform[7] / 255));
    ctx.drawImage(c, 0, 0);
    ctx.restore();
    return;
  }
  renderContent(ctx, obj, mm, concatCx(cx, obj.cxform));
}

function renderContent(ctx, obj, m, cx) {
  if (obj instanceof ShapeInstance) drawShape(ctx, obj.def, m, cx);
  else if (obj instanceof BitmapInstance) {
    setTransform(ctx, m);
    ctx.imageSmoothingEnabled = obj.smoothing;
    const [img, alpha] = bitmapWithCx(obj.bitmap, cx);
    ctx.globalAlpha = alpha;
    ctx.drawImage(img, 0, 0);
    ctx.globalAlpha = 1;
    ctx.imageSmoothingEnabled = true;
  } else if (obj instanceof Container) {
    const kids = obj.children;
    for (let i = 0; i < kids.length; i++) renderDisplayObject(ctx, kids[i], m, cx);
  }
}

// Approximate Flash GlowFilter (outer glow) using canvas shadows.
function applyGlowFilters(ctx, filters) {
  for (const f of filters) {
    if (f.id !== 2) continue;
    const c = ctx.canvas;
    const copy = makeCanvas(c.width, c.height);
    copy.getContext('2d').drawImage(c, 0, 0);
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalCompositeOperation = 'destination-over';
    ctx.shadowColor = cssColor(f.color);
    ctx.shadowBlur = (f.blurX + f.blurY) / 2;
    const reps = Math.max(1, Math.round(f.strength));
    for (let i = 0; i < reps; i++) ctx.drawImage(copy, 0, 0);
    ctx.restore();
  }
}

export { IDENTITY_CX };
