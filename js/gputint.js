// GPU implementation of the per-layer tint + mask step of
// MediaLibrary.createMaterial (Flash ColorMatrixFilter followed by the
// BlendMode.ALPHA mask). Doing this with getImageData/putImageData forced a
// GPU->CPU readback and a JS loop per layer, which dominated texture build
// time on phones. Here the layer stays on the GPU: upload, shade, draw back.

const VS = `
attribute vec2 aPos;
varying vec2 vUV;
void main() {
  vUV = vec2(aPos.x * 0.5 + 0.5, 0.5 - aPos.y * 0.5);
  gl_Position = vec4(aPos, 0.0, 1.0);
}`;

const FS = `
precision mediump float;
uniform sampler2D uSrc;
uniform sampler2D uMask;
uniform mat4 uM;      // colour matrix, columns = input channel weights
uniform vec4 uOff;    // offsets (already /255)
uniform float uUseMatrix;
uniform float uUseMask;
varying vec2 vUV;
void main() {
  vec4 c = texture2D(uSrc, vUV);            // unpremultiplied RGBA
  vec4 o = c;
  if (uUseMatrix > 0.5 && c.a > 0.0) o = clamp(uM * c + uOff, 0.0, 1.0);
  if (uUseMask > 0.5) o.a *= texture2D(uMask, vUV).a;
  gl_FragColor = vec4(o.rgb * o.a, o.a);    // premultiplied for the canvas
}`;

export class GpuTinter {
  static create() {
    try { return new GpuTinter(); } catch (e) { console.warn('GPU tinting unavailable, using CPU', e); return null; }
  }

  constructor() {
    const canvas = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(1, 1) : document.createElement('canvas');
    const gl = canvas.getContext('webgl', { premultipliedAlpha: true, alpha: true, antialias: false, preserveDrawingBuffer: true });
    if (!gl) throw new Error('no webgl');
    this.canvas = canvas;
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
    gl.useProgram(prog);
    this.u = {};
    for (const n of ['uSrc', 'uMask', 'uM', 'uOff', 'uUseMatrix', 'uUseMask']) this.u[n] = gl.getUniformLocation(prog, n);
    gl.uniform1i(this.u.uSrc, 0);
    gl.uniform1i(this.u.uMask, 1);
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    const aPos = gl.getAttribLocation(prog, 'aPos');
    gl.enableVertexAttribArray(aPos);
    gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);
    this.texSrc = this.makeTex();
    this.texMask = this.makeTex();
    gl.disable(gl.BLEND);
  }

  makeTex() {
    const gl = this.gl;
    const t = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return t;
  }

  // Tints `src` with the 20-element Flash colour matrix `m` (or null) and
  // multiplies its alpha by `mask` (or null). Draws the result back into
  // `src` and returns it.
  apply(src, m, mask) {
    const gl = this.gl;
    if (gl.isContextLost()) return null;
    const w = src.width, h = src.height;
    // Only ever grow the canvas: resizing forces a reallocation and a GPU
    // sync. Smaller jobs render into the bottom-left corner.
    if (this.canvas.width < w || this.canvas.height < h) {
      this.canvas.width = Math.max(this.canvas.width, w);
      this.canvas.height = Math.max(this.canvas.height, h);
    }
    const H = this.canvas.height;
    gl.viewport(0, 0, w, h);
    // Canvas pixels are premultiplied; ask for straight alpha, which is what
    // ColorMatrixFilter operates on.
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.texSrc);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, src);
    gl.uniform1f(this.u.uUseMatrix, m ? 1 : 0);
    if (m) {
      // Flash row-major 4x5 -> GLSL column-major mat4 + offset vector.
      gl.uniformMatrix4fv(this.u.uM, false, new Float32Array([
        m[0], m[5], m[10], m[15],
        m[1], m[6], m[11], m[16],
        m[2], m[7], m[12], m[17],
        m[3], m[8], m[13], m[18],
      ]));
      gl.uniform4f(this.u.uOff, m[4] / 255, m[9] / 255, m[14] / 255, m[19] / 255);
    }
    gl.uniform1f(this.u.uUseMask, mask ? 1 : 0);
    if (mask) {
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, this.texMask);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, mask);
    }
    gl.enable(gl.SCISSOR_TEST);
    gl.scissor(0, 0, w, h);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.disable(gl.SCISSOR_TEST);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    const ctx = src.getContext('2d');
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalCompositeOperation = 'copy';
    ctx.drawImage(this.canvas, 0, H - h, w, h, 0, 0, w, h);
    ctx.restore();
    return src;
  }
}
