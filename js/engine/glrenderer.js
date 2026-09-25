// WebGL rasteriser for the depth-sorted triangle lists produced by
// Context.draw(). It reproduces the Flash renderer's look: painter's
// algorithm (no depth buffer), affine (screen-space) texture mapping and
// wrapping bitmap fills - but runs on the GPU in a single draw call using a
// texture atlas.

const VS = `
attribute vec2 aPos;
attribute vec2 aUV;
attribute vec4 aRect;
uniform vec2 uScale;
varying vec2 vUV;
varying vec4 vRect;
void main() {
  vUV = aUV;
  vRect = aRect;
  gl_Position = vec4(aPos.x * uScale.x - 1.0, 1.0 - aPos.y * uScale.y, 0.0, 1.0);
}`;

const FS = `
precision highp float;
uniform sampler2D uTex;
uniform vec2 uAtlasSize;
varying vec2 vUV;
varying vec4 vRect;
void main() {
  // vRect = atlas rect in texels (x, y, w, h). Wrap like a repeating
  // bitmap fill, and keep half a texel away from the rect edges.
  vec2 f = fract(vUV);
  vec2 hp = vec2(0.5) / vRect.zw;
  f = clamp(f, hp, vec2(1.0) - hp);
  vec2 st = (vRect.xy + f * vRect.zw) / uAtlasSize;
  gl_FragColor = texture2D(uTex, st);
}`;

const FLOATS_PER_VERT = 8;

class Atlas {
  constructor(gl, size) {
    this.gl = gl;
    this.size = size;
    this.tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, this.tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, size, size, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    this.reset();
  }
  reset() {
    this.generation = (this.generation || 0) + 1;
    this.shelfX = 0; this.shelfY = 0; this.shelfH = 0;
    this.slots = new WeakMap();
  }
  // Returns {x,y,w,h} in texels, uploading the canvas if needed.
  get(canvas) {
    let slot = this.slots.get(canvas);
    if (slot) return slot;
    const pad = 2;
    const w = canvas.width, h = canvas.height;
    if (w + pad * 2 > this.size || h + pad * 2 > this.size) return null;
    if (this.shelfX + w + pad * 2 > this.size) { this.shelfY += this.shelfH; this.shelfX = 0; this.shelfH = 0; }
    if (this.shelfY + h + pad * 2 > this.size) return null; // full
    const x = this.shelfX + pad, y = this.shelfY + pad;
    this.shelfX += w + pad * 2;
    this.shelfH = Math.max(this.shelfH, h + pad * 2);
    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D, this.tex);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, x, y, gl.RGBA, gl.UNSIGNED_BYTE, canvas);
    // Extend edge pixels into the padding to avoid bleeding when filtering.
    slot = { x, y, w, h };
    this.slots.set(canvas, slot);
    return slot;
  }
}

export class GLRenderer {
  constructor(canvas, logicalW = 346, logicalH = 260) {
    this.canvas = canvas;
    this.logicalW = logicalW;
    this.logicalH = logicalH;
    const gl = canvas.getContext('webgl', { antialias: true, premultipliedAlpha: true, alpha: true, preserveDrawingBuffer: true });
    if (!gl) throw new Error('WebGL not available');
    this.gl = gl;
    const prog = gl.createProgram();
    for (const [type, src] of [[gl.VERTEX_SHADER, VS], [gl.FRAGMENT_SHADER, FS]]) {
      const sh = gl.createShader(type);
      gl.shaderSource(sh, src);
      gl.compileShader(sh);
      if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(sh));
      gl.attachShader(prog, sh);
    }
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog));
    this.prog = prog;
    this.aPos = gl.getAttribLocation(prog, 'aPos');
    this.aUV = gl.getAttribLocation(prog, 'aUV');
    this.aRect = gl.getAttribLocation(prog, 'aRect');
    this.uScale = gl.getUniformLocation(prog, 'uScale');
    this.uAtlasSize = gl.getUniformLocation(prog, 'uAtlasSize');
    this.buf = gl.createBuffer();
    this.data = new Float32Array(3 * FLOATS_PER_VERT * 4096);
    const max = gl.getParameter(gl.MAX_TEXTURE_SIZE);
    this.atlas = new Atlas(gl, Math.min(4096, max));
    this.background = [1, 1, 1, 1];
  }

  resize(cssW, cssH, dpr = window.devicePixelRatio || 1) {
    const w = Math.round(cssW * dpr), h = Math.round(cssH * dpr);
    if (this.canvas.width !== w || this.canvas.height !== h) { this.canvas.width = w; this.canvas.height = h; }
  }

  begin() {
    const gl = this.gl;
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    const b = this.background;
    gl.clearColor(b[0] * b[3], b[1] * b[3], b[2] * b[3], b[3]);
    gl.clear(gl.COLOR_BUFFER_BIT);
  }

  // Draws a far-to-near sorted triangle list (Triangle objects).
  drawTriangles(list, background = null) {
    if (background) {
      // Full-panel quad drawn first (the Flash buddyPanelShape bitmap fill).
      const bg = { bmd: background };
      const q = (a, b, c) => Object.assign(new BgTri(), { screen_v0: a, screen_v1: b, screen_v2: c, material: bg });
      const W = this.logicalW, H = this.logicalH;
      const tl = { x: 0, y: 0, u: 0, v: 1 }, tr = { x: W, y: 0, u: 1, v: 1 }, bl = { x: 0, y: H, u: 0, v: 0 }, br = { x: W, y: H, u: 1, v: 0 };
      const t1 = q(tl, tr, br), t2 = q(tl, br, bl);
      for (const t of [t1, t2]) { t.u0 = t.screen_v0.u; t.v0 = t.screen_v0.v; t.u1 = t.screen_v1.u; t.v1 = t.screen_v1.v; t.u2 = t.screen_v2.u; t.v2 = t.screen_v2.v; }
      list = [t1, t2, ...list];
    }
    const n = list.length;
    if (n === 0) return;
    let data = this.data;
    const need = n * 3 * FLOATS_PER_VERT;
    if (data.length < need) data = this.data = new Float32Array(need * 1.5);
    let k = 0;
    let retried = false;
    for (let i = 0; i < n; i++) {
      const t = list[i];
      const bmd = t.material && t.material.bmd;
      if (!bmd) continue;
      let slot = this.atlas.get(bmd);
      if (!slot) {
        if (retried) continue;
        // Atlas full: start over (everything visible this frame is re-added).
        this.atlas.reset();
        retried = true;
        i = -1; k = 0;
        continue;
      }
      const bw = bmd.baseWidth || bmd.width, bh = bmd.baseHeight || bmd.height;
      const w1 = bw - 1, h1 = bh - 1;
      const p0 = t.screen_v0, p1 = t.screen_v1, p2 = t.screen_v2;
      k = pushVert(data, k, p0.x, p0.y, (t.u0 * w1) / bw, (h1 - t.v0 * h1) / bh, slot);
      k = pushVert(data, k, p1.x, p1.y, (t.u1 * w1) / bw, (h1 - t.v1 * h1) / bh, slot);
      k = pushVert(data, k, p2.x, p2.y, (t.u2 * w1) / bw, (h1 - t.v2 * h1) / bh, slot);
    }
    const gl = this.gl;
    gl.useProgram(this.prog);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buf);
    gl.bufferData(gl.ARRAY_BUFFER, data.subarray(0, k), gl.STREAM_DRAW);
    const stride = FLOATS_PER_VERT * 4;
    gl.enableVertexAttribArray(this.aPos);
    gl.vertexAttribPointer(this.aPos, 2, gl.FLOAT, false, stride, 0);
    gl.enableVertexAttribArray(this.aUV);
    gl.vertexAttribPointer(this.aUV, 2, gl.FLOAT, false, stride, 8);
    gl.enableVertexAttribArray(this.aRect);
    gl.vertexAttribPointer(this.aRect, 4, gl.FLOAT, false, stride, 16);
    gl.uniform2f(this.uScale, 2 / this.logicalW, 2 / this.logicalH);
    gl.uniform2f(this.uAtlasSize, this.atlas.size, this.atlas.size);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.atlas.tex);
    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.CULL_FACE);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.drawArrays(gl.TRIANGLES, 0, k / FLOATS_PER_VERT);
  }
}

function pushVert(d, k, x, y, u, v, s) {
  d[k++] = x; d[k++] = y; d[k++] = u; d[k++] = v;
  d[k++] = s.x; d[k++] = s.y; d[k++] = s.w; d[k++] = s.h;
  return k;
}

class BgTri {}
