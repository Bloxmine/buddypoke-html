// Port of buddypoke.render.BuddyPokeRenderer (minus the social / network
// parts): owns the two buddies, the mood and poke scene settings, cameras
// and the frame loop.

import { Buddy, SceneSetting, parsePackage, PANEL_W, PANEL_H } from './buddy.js';
import { MediaLibrary } from './medialib.js';
import { GLRenderer } from './engine/glrenderer.js';
import { drawTrianglesCanvas } from './engine/canvasrenderer.js';
import { Vector3, AxisAngle } from './engine/math.js';
import { MOODS, POKES } from './data/moods.js';

const attr = (o, k, def) => (o[k] !== undefined ? o[k] : def);

export class BuddyPokeRenderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.gl = new GLRenderer(canvas, PANEL_W, PANEL_H);
    this.mode = 'mood'; // mood | poke | customize
    this.customizeTarget = null;
    this.paused = false;
    this.advance = true;
    this.fps = 0; // 0 = display refresh rate; otherwise a fixed tick
    this.lastTick = 0;
    this.listeners = {};
    this.mouseDown = false;
    this.lastX = 0;
    this.showBackgrounds = true;
  }

  on(ev, fn) { (this.listeners[ev] || (this.listeners[ev] = [])).push(fn); }
  emit(ev, ...a) { for (const f of this.listeners[ev] || []) f(...a); }

  async load(progress = () => {}) {
    progress('Loading content…', 0.05);
    const [pkgBytes, v1Bytes, extraBytes, libJson, iconBytes] = await Promise.all([
      fetchBytes('assets/chick.bin'),
      fetchBytes('assets/anims_v1.bin').catch(() => null),
      fetchBytes('assets/anims_extra.bin').catch(() => null),
      fetch('assets/library.json').then((r) => r.json()),
      fetchBytes('assets/icons.swf').catch(() => null),
    ]);
    progress('Unpacking model…', 0.25);
    const pkg = await parsePackage(pkgBytes);
    progress('Loading textures…', 0.45);
    this.matLib = new MediaLibrary();
    await this.matLib.init(pkg.m, libJson, iconBytes);
    progress('Loading animations…', 0.65);
    const animSources = [{ name: 'embedded', bytes: pkg.a, override: true }];
    const { inflate } = await import('./bytearray.js');
    // Standalone animations recovered from the MySpace CDN (newer format).
    if (extraBytes) animSources.push({ name: 'extra', bytes: await inflate(extraBytes) });
    // BuddyPoke 1.0 animation library (older format, see Anim.decode).
    if (v1Bytes) animSources.push({ name: 'v1', bytes: await inflate(v1Bytes) });
    this.pkg = pkg;
    this.animSources = animSources;

    // loadBlankSetting
    this.moodSceneSetting = new SceneSetting();
    this.moodSceneSetting.createDefault(PANEL_W, PANEL_H);
    this.pokeSceneSetting = new SceneSetting();
    this.pokeSceneSetting.createDefault(PANEL_W, PANEL_H);

    progress('Building buddies…', 0.8);
    this.buddy1 = new Buddy();
    this.buddy1.load(pkg, 'pose_contra', false, this.matLib, animSources);
    this.buddy2 = new Buddy();
    this.buddy2.visible = false;
    this.buddy2.load(pkg, 'pose_contra', false, this.matLib, animSources);

    // Off-screen buddy used only for friend portraits.
    this.portraitBuddy = new Buddy();
    this.portraitBuddy.load(pkg, 'pose_contra', false, this.matLib, animSources);

    this.moodSceneSetting.addSceneObject(this.buddy1, 'Buddy1');
    this.pokeSceneSetting.addSceneObject(this.buddy1, 'Buddy1');
    this.addedBuddy2ToPokeScene = false;
    progress('Ready', 1);
  }

  hasAnim(name) { return this.buddy1.hasAnimation(name); }
  moodAvailable(m) { return this.hasAnim(m.a0); }
  pokeAvailable(p) { return this.hasAnim(p.a0) && this.hasAnim(p.a1); }

  setShadows(on) {
    for (const b of [this.buddy1, this.buddy2]) {
      const s = b.player.scene.getNodeByName('Shadow');
      if (s) s.visible = on;
    }
  }

  // doMood
  showMood(id) {
    const mood = MOODS.list.find((m) => m.id === id);
    if (!mood || !this.moodAvailable(mood)) return false;
    const d = MOODS.defaults;
    const cam = this.moodSceneSetting.player.context.camera;
    const holder = this.moodSceneSetting.player.scene.getNodeByName('Buddy1');
    cam.fov = Number(attr(mood, 'camFov', d.camFov));
    cam.pos = Vector3.parse(attr(mood, 'camPos', d.camPos));
    cam.rot = AxisAngle.parse(attr(mood, 'camRot', d.camRot));
    holder.pos = Vector3.parse(attr(mood, 'buddyPos', d.buddyPos));
    holder.rot = AxisAngle.parse(attr(mood, 'buddyRot', d.buddyRot));
    this.setShadows(mood.shadows !== 'false');
    this.endCustomize();
    this.mode = 'mood';
    this.buddy1.selectedAnim = mood.a0;
    if (this.buddy1.animation) this.buddy1.animation.loop = true;
    this.currentMood = mood;
    this.play(true);
    this.emit('mode', 'mood', mood);
    return true;
  }

  // doPoke
  showPoke(id) {
    const poke = POKES.list.find((p) => p.id === id);
    if (!poke || !this.pokeAvailable(poke)) return false;
    if (!this.addedBuddy2ToPokeScene) {
      this.addedBuddy2ToPokeScene = true;
      this.pokeSceneSetting.addSceneObject(this.buddy2, 'Buddy2');
    }
    const d = POKES.defaults;
    const cam = this.pokeSceneSetting.player.context.camera;
    const h1 = this.pokeSceneSetting.player.scene.getNodeByName('Buddy1');
    const h2 = this.pokeSceneSetting.player.scene.getNodeByName('Buddy2');
    cam.fov = Number(attr(poke, 'camFov', d.camFov));
    cam.pos = Vector3.parse(attr(poke, 'camPos', d.camPos));
    cam.rot = AxisAngle.parse(attr(poke, 'camRot', d.camRot));
    h1.pos = Vector3.parse(attr(poke, 'buddy1Pos', d.buddyPos));
    h1.rot = AxisAngle.parse(attr(poke, 'buddy1Rot', d.buddyRot));
    h2.pos = Vector3.parse(attr(poke, 'buddy2Pos', d.buddyPos));
    h2.rot = AxisAngle.parse(attr(poke, 'buddy2Rot', d.buddyRot));
    this.setShadows(poke.shadows !== 'false');
    this.endCustomize();
    this.mode = 'poke';
    this.buddy1.selectedAnim = poke.a0;
    this.buddy2.selectedAnim = poke.a1;
    const now = performance.now();
    for (const b of [this.buddy1, this.buddy2]) if (b.animation) { b.animation.loop = true; b.animation.reset(now); }
    this.currentPoke = poke;
    this.play(true);
    this.emit('mode', 'poke', poke);
    return true;
  }

  // customize(): examine camera on the buddy's own scene.
  customize(buddy = this.buddy1) {
    this.endCustomize();
    this.customizeTarget = buddy;
    for (const b of [this.buddy1, this.buddy2]) {
      const s = b.player.scene.getNodeByName('Shadow');
      if (s) s.visible = true;
    }
    const cam = buddy.player.scene.getNodeByName('Camera_Long2');
    if (cam) {
      this.savedCamera = buddy.context.camera;
      buddy.context.camera = cam;
      cam.lookAt = null;
      cam.centerOffset = null;
      if (!cam.origPos) cam.origPos = cam.pos.clone();
      cam.pos = cam.origPos.clone();
    }
    buddy.selectedAnim = 'pose_contra';
    if (buddy.animation) buddy.animation.loop = true;
    this.mode = 'customize';
    this.play(true);
    this.emit('mode', 'customize', buddy);
  }

  endCustomize() {
    if (this.customizeTarget) {
      const b = this.customizeTarget;
      const cam = b.player.scene.getNodeByName('Camera_Long');
      if (cam) b.context.camera = cam;
      this.customizeTarget = null;
    }
  }

  // Examine-camera mouse handling (onExamineMouseDown / Move).
  examineDown(x) {
    const b = this.customizeTarget;
    if (!b) return;
    let cam = b.context.camera;
    if (cam.name !== 'Camera_Long2') {
      cam = b.player.scene.getNodeByName('Camera_Long2');
      if (cam) b.context.camera = cam;
    }
    const root = b.player.scene.getNodeByName('IG_Root');
    if (cam) { cam.lookAt = root; cam.centerOffset = { x: 0, y: 15.5 }; }
    this.mouseDown = true;
    this.lastX = x;
  }

  examineMove(x) {
    const b = this.customizeTarget;
    if (!this.mouseDown || !b) return;
    const cam = b.context.camera;
    const root = b.player.scene.getNodeByName('IG_Root');
    const rv = new Vector3(), cv = new Vector3();
    root.getWorldPosition(rv);
    cam.getWorldPosition(cv);
    const ang = Math.atan2(cv.z - rv.z, cv.x - rv.x);
    const dx = x - this.lastX;
    this.lastX = x;
    const na = ang + (dx / PANEL_W) * 2 * Math.PI;
    const dist = Math.sqrt((cv.z - rv.z) ** 2 + (cv.x - rv.x) ** 2);
    cam.pos.x = rv.x + dist * Math.cos(na);
    cam.pos.z = rv.z + dist * Math.sin(na);
  }

  examineUp() { this.mouseDown = false; }

  play(on) { this.paused = !on; if (on) this.advance = true; }

  // drawFrame
  drawFrame(now) {
    if (this.paused || !this.buddy1) return;
    this.gl.begin();
    let tris;
    if (this.mode === 'customize' && this.customizeTarget) {
      const b = this.customizeTarget;
      if (this.advance) b.stepAnimation(true, now);
      tris = b.player.collect();
    } else if (this.mode === 'poke') {
      tris = this.pokeSceneSetting.collect(this.advance, now);
    } else {
      tris = this.moodSceneSetting.collect(this.advance, now);
    }
    this.gl.drawTriangles(tris, this.backgroundFor());
    this.emit('frame', now);
  }

  backgroundFor() {
    if (!this.showBackgrounds) return null;
    const b = this.mode === 'customize' && this.customizeTarget ? this.customizeTarget : this.buddy1;
    return b.background || null;
  }

  // A still frame of a mood or poke (for comic panels): `fraction` is the
  // position in the animation (0..1), `zoom` 'long' | 'medium' | 'close'.
  renderStill(action, fraction, zoom, w, h) {
    const ok = action.type === 'mood' ? this.showMood(action.id) : this.showPoke(action.id);
    if (!ok) return null;
    const setting = action.type === 'mood' ? this.moodSceneSetting : this.pokeSceneSetting;
    const cam = setting.player.context.camera;
    const saved = { fov: cam.fov, pos: cam.pos.clone() };
    const z = { long: [1, 0], medium: [0.72, 12], close: [0.55, 22] }[zoom] || [1, 0];
    cam.fov = saved.fov * z[0];
    cam.pos.y += z[1];
    const cast = action.type === 'mood' ? [this.buddy1] : [this.buddy1, this.buddy2];
    for (const b of cast) {
      const a = b.animation;
      if (a) { a.goToFraction(Math.max(0, Math.min(1, fraction))); a.draw(b.context); }
    }
    const tris = setting.player.collect();
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const ctx = c.getContext('2d');
    const s = Math.max(w / PANEL_W, h / PANEL_H);
    const ox = (w - PANEL_W * s) / 2, oy = (h - PANEL_H * s) / 2;
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, w, h);
    ctx.setTransform(s, 0, 0, s, ox, oy);
    const bg = this.showBackgrounds && this.buddy1.background;
    if (bg) ctx.drawImage(bg, 0, 0, PANEL_W, PANEL_H);
    drawTrianglesCanvas(new TransformedCtx(ctx, ctx.getTransform()), tris, 1);
    cam.fov = saved.fov;
    cam.pos = saved.pos;
    return c;
  }

  start() {
    // Don't render while the stage is scrolled out of view.
    this.onScreen = true;
    if (typeof IntersectionObserver !== 'undefined') {
      new IntersectionObserver((e) => { this.onScreen = e[0].isIntersecting; }).observe(this.canvas);
    }
    const loop = (t) => {
      requestAnimationFrame(loop);
      if (!this.onScreen) return;
      if (this.fps > 0) {
        const interval = 1000 / this.fps;
        if (t - this.lastTick < interval - 1) return;
        this.lastTick = t;
      }
      this.drawFrame(performance.now());
    };
    requestAnimationFrame(loop);
  }

  snapshot() { return this.canvas.toDataURL('image/png'); }

  // BuddyPokeRenderer.createIcon: a close-up of `buddy` in pose_contra
  // (frame 210) through Camera_CloseUp, rendered to a w x h canvas.
  portrait(buddy, w = 75, h = 75, voffset = 6) {
    const cam = buddy.player.scene.getNodeByName('Camera_CloseUp');
    const anim = buddy.getAnimationByName('pose_contra');
    if (!cam || !anim) return null;
    const oldCam = buddy.context.camera;
    const prev = buddy.currentAnim;
    const prevCurrent = prev ? prev.current : 0;
    buddy.context.camera = cam;
    anim.drawFrame(buddy.context, 210);
    const tris = buddy.player.collect();
    const s = w / PANEL_W * 1.23;
    const c = document.createElement('canvas');
    c.width = w * 2; c.height = h * 2;
    const ctx = c.getContext('2d');
    ctx.setTransform(2 * s, 0, 0, 2 * s, 2 * (w / 2 - PANEL_W / 2 * s), 2 * (h / 2 - PANEL_H / 2 * s + voffset));
    const base = ctx.getTransform();
    // drawTrianglesCanvas sets absolute transforms, so bake ours in.
    drawTrianglesCanvas(new TransformedCtx(ctx, base), tris, 1);
    buddy.context.camera = oldCam;
    if (prev) { prev.current = prevCurrent; if (prev !== anim) prev.draw(buddy.context); }
    return c;
  }
}

async function fetchBytes(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(url + ': ' + r.status);
  return new Uint8Array(await r.arrayBuffer());
}

// Wraps a 2D context so that absolute setTransform() calls are composed
// with a base transform (used to draw the 346x260 scene into thumbnails).
class TransformedCtx {
  constructor(ctx, base) { this.ctx = ctx; this.base = base; }
  save() { this.ctx.save(); }
  restore() { this.ctx.restore(); }
  beginPath() { this.ctx.beginPath(); }
  moveTo(x, y) { this.ctx.moveTo(x, y); }
  lineTo(x, y) { this.ctx.lineTo(x, y); }
  closePath() { this.ctx.closePath(); }
  clip() { this.ctx.clip(); }
  drawImage(...a) { this.ctx.drawImage(...a); }
  setTransform(a, b, c, d, e, f) {
    this.ctx.setTransform(this.base);
    this.ctx.transform(a, b, c, d, e, f);
  }
}
