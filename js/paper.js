// 3D Paper Buddies: port of buddypoke.canvas.PaperDolls / PaperDollItem
// from the July 2009 Create window. The paper package holds unfolded
// papercraft meshes (paperchick.bd) that are drawn with the buddy's own
// materials through an orthographic camera at print resolution, plus the
// fold-line templates (paperchick.swf) and per-piece offsets (templates.xml).

import { ByteArray, inflate } from './bytearray.js';
import { Buddy } from './buddy.js';
import { SWF } from './swf/swf.js';
import { createInstance, renderDisplayObject, IDENTITY_CX } from './swf/display.js';
import { drawTrianglesCanvas } from './engine/canvasrenderer.js';
import { TEXTURE_SCALE, setTextureScale } from './medialib.js';
import { parseXML, xmlAttr, xmlChildren } from './xml.js';

export const PRINT_DPI = 150;
const PRINT_SCALE = PRINT_DPI / 72;
const PAGE_W = PRINT_DPI * 8, PAGE_H = PRINT_DPI * 10.5;

export class PaperBuddies {
  constructor(renderer) {
    this.renderer = renderer;
    this.loaded = null;
    this.pose = 0;
  }

  load() {
    if (!this.loaded) this.loaded = this.doLoad();
    return this.loaded;
  }

  async doLoad() {
    const bytes = new Uint8Array(await (await fetch('assets/paperbuddy.bin')).arrayBuffer());
    const ba = new ByteArray(bytes);
    ba.position = 9;
    const obj = ba.readObject();
    const text = async (k) => new TextDecoder().decode(await inflate(obj[k].bytes));
    this.templates = parseXML(await text('templates.xml'));
    this.catalogText = await text('paperchickcatalog.xml');
    this.geo = await inflate(obj['paperchick.bd'].bytes);
    this.templateSwf = await SWF.load(obj['paperchick.swf'].bytes);
  }

  // A paper buddy dressed like `buddy`: the paper catalog with the buddy's
  // materialOptions swapped in (PaperDolls.loadedDollHandler).
  makePaperBuddy(buddy) {
    const cat = parseXML(this.catalogText);
    const root = cat.documentElement;
    for (const mo of xmlChildren(root, 'materialOptions')) root.removeChild(mo);
    for (const mo of xmlChildren(buddy.catalogXML.documentElement, 'materialOptions')) root.appendChild(cat.importNode(mo, true));
    const paper = new Buddy();
    paper.load({ catalogText: new XMLSerializer().serializeToString(cat), g: this.geo }, null, false, this.renderer.matLib, []);
    paper.context.ORTHO_DPI = PRINT_DPI;
    return paper;
  }

  // PaperDolls.previewTemplates: which template pieces the buddy needs.
  pieces(buddy) {
    const names = [];
    const maps = Array.from(this.templates.getElementsByTagName('map'));
    for (const cat of buddy.itemCategories()) {
      if (!['Body', 'Skrt', 'Hair', 'Ears'].includes(xmlAttr(cat, 'name'))) continue;
      for (const it of xmlChildren(cat, 'item')) {
        const n = xmlAttr(it, 'name');
        if (xmlAttr(it, 'visible') !== 'true' || n === 'Shadow') continue;
        const m = maps.find((x) => xmlAttr(x, 'name') === n);
        const to = m ? xmlAttr(m, 'to') : n;
        for (const t of to.split(',')) if (t.indexOf('None') < 0) names.push(t);
      }
    }
    const items = [];
    for (let name of names) {
      if (name.startsWith('Skin_Body')) name = 'Skin_Body' + (this.pose + 1);
      const item = Array.from(this.templates.getElementsByTagName('item')).find((x) => xmlAttr(x, 'name') === name);
      if (item) items.push(item);
    }
    return items;
  }

  // PaperDollItem.createPreview: render one piece (mesh + template) to a
  // canvas in print pixels. Returns {canvas, bounds}.
  renderPiece(paper, item) {
    const catName = xmlAttr(item.parentNode, 'name');
    const name = xmlAttr(item, 'name');
    const [ox, oy] = (xmlAttr(item, 'offset') || '0 0').split(' ').map(Number);
    const tex = Math.max(1, parseInt(xmlAttr(item, 'tex'), 10) || 1);
    const cat = paper.catalogXML;
    for (const g of xmlChildren(cat.documentElement, 'group')) {
      for (const it of g.getElementsByTagName('item')) { it.setAttribute('visible', 'false'); it.setAttribute('alwaysVis', 'false'); }
      for (const c of g.getElementsByTagName('itemCategory')) {
        if (xmlAttr(c, 'name') !== catName) continue;
        for (const it of xmlChildren(c, 'item')) if (xmlAttr(it, 'name') === name) it.setAttribute('visible', 'true');
      }
    }
    const prevScale = TEXTURE_SCALE;
    setTextureScale(tex);
    paper.context.ORTHO_OFFSET_X = ox || 0;
    paper.context.ORTHO_OFFSET_Y = oy || 0;
    paper.player.updateTextures(cat, paper.materialLibrary);
    paper.player.setVisibleGeometry(cat);
    const tris = paper.player.collect();
    setTextureScale(prevScale);

    // Bounds of the drawn piece and of its template artwork.
    let b = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };
    const grow = (x, y) => { b.x0 = Math.min(b.x0, x); b.y0 = Math.min(b.y0, y); b.x1 = Math.max(b.x1, x); b.y1 = Math.max(b.y1, y); };
    for (const t of tris) for (const p of [t.screen_v0, t.screen_v1, t.screen_v2]) grow(p.x, p.y);
    const lib = this.renderer.matLib;
    const id = this.templateSwf.symbols.get(name);
    const sym = id === undefined ? null : createInstance(this.templateSwf, id);
    if (sym) {
      const tb = lib.bounds(sym, { a: PRINT_SCALE, b: 0, c: 0, d: PRINT_SCALE, tx: 0, ty: 0 });
      if (tb) { grow(tb.xmin, tb.ymin); grow(tb.xmax, tb.ymax); }
    }
    if (!isFinite(b.x0)) return null;
    const pad = 24;
    const w = Math.ceil(b.x1 - b.x0 + pad * 2), h = Math.ceil(b.y1 - b.y0 + pad * 2);
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const ctx = c.getContext('2d');
    const tx = pad - b.x0, ty = pad - b.y0;
    ctx.setTransform(1, 0, 0, 1, tx, ty);
    drawTrianglesCanvas(new OffsetCtx(ctx, tx, ty), tris, 1);
    // Template (fold lines, tabs) goes on top of the rendered piece.
    const overlay = document.createElement('canvas');
    overlay.width = w; overlay.height = h;
    if (sym) renderDisplayObject(overlay.getContext('2d'), sym, { a: PRINT_SCALE, b: 0, c: 0, d: PRINT_SCALE, tx, ty }, IDENTITY_CX, this.templateSwf);
    return { piece: c, overlay, name };
  }

  // PaperDollItem.generatePNG: the printable page for one piece, rotated
  // onto an 8 x 10.5 inch sheet with a soft cutting margin.
  page(r, portrait) {
    const page = document.createElement('canvas');
    page.width = PAGE_W; page.height = PAGE_H;
    const ctx = page.getContext('2d');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, PAGE_W, PAGE_H);
    const place = () => {
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.translate(PAGE_W / 2, PAGE_H / 2);
      ctx.rotate(-Math.PI / 2);
      ctx.translate(-r.piece.width / 2, -r.piece.height / 2);
    };
    place();
    ctx.filter = 'blur(6px)';
    ctx.drawImage(r.piece, 0, 0);
    ctx.filter = 'none';
    ctx.drawImage(r.piece, 0, 0);
    ctx.drawImage(r.overlay, 0, 0);
    // Credit line and a small picture of the finished buddy.
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    if (portrait) ctx.drawImage(portrait, PAGE_W - 170, PAGE_H - 200, 130, 130);
    ctx.fillStyle = 'rgba(0,0,0,.5)';
    ctx.font = '16px Arial, sans-serif';
    ctx.textAlign = 'right';
    ctx.fillText('©2009 BuddyPoke LLC, http://buddypoke.com', PAGE_W - 40, PAGE_H - 40);
    return page;
  }

  // Renders every page for `buddy`. onProgress(done, total).
  async build(buddy, onProgress = () => {}) {
    await this.load();
    const paper = this.makePaperBuddy(buddy);
    const items = this.pieces(buddy);
    const portrait = this.renderer.portrait(buddy, 130, 130);
    const pages = [];
    for (let i = 0; i < items.length; i++) {
      const r = this.renderPiece(paper, items[i]);
      if (r) pages.push({ name: r.name, canvas: this.page(r, portrait), piece: r });
      onProgress(i + 1, items.length);
      await new Promise((res) => setTimeout(res, 0));
    }
    return pages;
  }
}

// drawTrianglesCanvas uses absolute transforms; keep our translation.
class OffsetCtx {
  constructor(ctx, tx, ty) { this.ctx = ctx; this.tx = tx; this.ty = ty; }
  save() { this.ctx.save(); }
  restore() { this.ctx.restore(); }
  beginPath() { this.ctx.beginPath(); }
  moveTo(x, y) { this.ctx.moveTo(x, y); }
  lineTo(x, y) { this.ctx.lineTo(x, y); }
  closePath() { this.ctx.closePath(); }
  clip() { this.ctx.clip(); }
  drawImage(...a) { this.ctx.drawImage(...a); }
  setTransform(a, b, c, d, e, f) { this.ctx.setTransform(a, b, c, d, e + this.tx, f + this.ty); }
}

// Minimal PDF writer: one JPEG per US Letter page, the 8 x 10.5 inch
// artwork centred with a quarter-inch margin.
export async function pagesToPDF(canvases) {
  const enc = new TextEncoder();
  const chunks = [];
  let length = 0;
  const offsets = [];
  const push = (data) => { const b = typeof data === 'string' ? enc.encode(data) : data; chunks.push(b); length += b.length; };
  const obj = (n, body) => { offsets[n] = length; push(`${n} 0 obj\n`); for (const b of [].concat(body)) push(b); push('\nendobj\n'); };
  push('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n');
  const n = canvases.length;
  const kids = [];
  for (let i = 0; i < n; i++) kids.push(`${3 + i * 3} 0 R`);
  obj(1, '<< /Type /Catalog /Pages 2 0 R >>');
  obj(2, `<< /Type /Pages /Kids [${kids.join(' ')}] /Count ${n} >>`);
  for (let i = 0; i < n; i++) {
    const c = canvases[i];
    const blob = await new Promise((res) => c.toBlob(res, 'image/jpeg', 0.92));
    const jpg = new Uint8Array(await blob.arrayBuffer());
    const pageN = 3 + i * 3, contN = pageN + 1, imgN = pageN + 2;
    obj(pageN, `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /XObject << /Im${i} ${imgN} 0 R >> >> /Contents ${contN} 0 R >>`);
    const content = `q 576 0 0 756 18 18 cm /Im${i} Do Q`;
    obj(contN, [`<< /Length ${content.length} >>\nstream\n`, content, '\nendstream']);
    obj(imgN, [`<< /Type /XObject /Subtype /Image /Width ${c.width} /Height ${c.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpg.length} >>\nstream\n`, jpg, '\nendstream']);
  }
  const xref = length;
  const count = 3 + n * 3;
  push(`xref\n0 ${count}\n0000000000 65535 f \n`);
  for (let i = 1; i < count; i++) push(String(offsets[i]).padStart(10, '0') + ' 00000 n \n');
  push(`trailer\n<< /Size ${count} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`);
  return new Blob(chunks, { type: 'application/pdf' });
}
