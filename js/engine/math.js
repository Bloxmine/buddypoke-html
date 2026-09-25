// Port of com.buddylabs.player.GLMatrix / Vector3 / AxisAngle.
// Kept numerically identical to the ActionScript originals (including the
// quirks, e.g. copyTo() does not copy m15 and glMultMatrix ignores row 3).

export class Vector3 {
  constructor(x = 0, y = 0, z = 0) { this.x = x; this.y = y; this.z = z; }
  static parse(str) {
    try {
      const a = String(str).split(' ');
      return new Vector3(Number(a[0]), Number(a[1]), Number(a[2]));
    } catch (e) { return new Vector3(); }
  }
  clone() { return new Vector3(this.x, this.y, this.z); }
  normalize() {
    const m = Math.sqrt(this.x * this.x + this.y * this.y + this.z * this.z);
    if (m !== 0) { this.x /= m; this.y /= m; this.z /= m; }
  }
}

export class AxisAngle {
  constructor(x = 0, y = 1, z = 0, angle = 0) { this.x = x; this.y = y; this.z = z; this.angle = angle; }
  static parse(str) {
    try {
      const a = String(str).split(' ');
      return new AxisAngle(Number(a[0]), Number(a[1]), Number(a[2]), Number(a[3]));
    } catch (e) { return new AxisAngle(); }
  }
  clone() { return new AxisAngle(this.x, this.y, this.z, this.angle); }
}

export class GLMatrix {
  constructor() {
    this.m0 = 1; this.m1 = 0; this.m2 = 0; this.m3 = 0;
    this.m4 = 0; this.m5 = 1; this.m6 = 0; this.m7 = 0;
    this.m8 = 0; this.m9 = 0; this.m10 = 1; this.m11 = 0;
    this.m12 = 0; this.m13 = 0; this.m14 = 0; this.m15 = 1;
  }

  gluLookAt(ex, ey, ez, cx, cy, cz, ux, uy, uz) {
    const f = [cx - ex, cy - ey, cz - ez];
    const fl = Math.sqrt(f[0] * f[0] + f[1] * f[1] + f[2] * f[2]);
    const ul = Math.sqrt(ux * ux + uy * uy + uz * uz);
    if (fl !== 0) { f[0] /= fl; f[1] /= fl; f[2] /= fl; }
    if (ul !== 0) { ux /= ul; uy /= ul; uz /= ul; }
    const up = [ux, uy, uz], s = [0, 0, 0], u = [0, 0, 0];
    cross(f, up, s);
    cross(s, f, u);
    this.m0 = s[0]; this.m4 = u[0]; this.m8 = -f[0];
    this.m1 = s[1]; this.m5 = u[1]; this.m9 = -f[1];
    this.m2 = s[2]; this.m6 = u[2]; this.m10 = -f[2];
    this.glTranslatef(-ex, -ey, -ez);
  }

  rotateVector(v) {
    const x = v.x, y = v.y, z = v.z;
    v.x = this.m0 * x + this.m4 * y + this.m8 * z;
    v.y = this.m1 * x + this.m5 * y + this.m9 * z;
    v.z = this.m2 * x + this.m6 * y + this.m10 * z;
  }

  glTranslatef(x, y, z) {
    this.m12 = this.m0 * x + this.m4 * y + this.m8 * z + this.m12;
    this.m13 = this.m1 * x + this.m5 * y + this.m9 * z + this.m13;
    this.m14 = this.m2 * x + this.m6 * y + this.m10 * z + this.m14;
  }

  glScalef(x, y, z) {
    this.m0 *= x; this.m1 *= x; this.m2 *= x;
    this.m4 *= y; this.m5 *= y; this.m6 *= y;
    this.m8 *= z; this.m9 *= z; this.m10 *= z;
  }

  inverseMatrix3in4() {
    const tx = -this.m12, ty = -this.m13, tz = -this.m14;
    const m0 = this.m0, m1 = this.m1, m2 = this.m2, m4 = this.m4, m5 = this.m5, m6 = this.m6, m8 = this.m8, m9 = this.m9, m10 = this.m10;
    const d = -m8 * m5 * m2 + m4 * m9 * m2 + m8 * m1 * m6 - m0 * m9 * m6 - m4 * m1 * m10 + m0 * m5 * m10;
    if (d === 0) return false;
    const a0 = (-m9 * m6 + m5 * m10) / d;
    const a4 = (m8 * m6 - m4 * m10) / d;
    const a8 = (-m8 * m5 + m4 * m9) / d;
    const a1 = (m9 * m2 - m1 * m10) / d;
    const a5 = (-m8 * m2 + m0 * m10) / d;
    const a9 = (m8 * m1 - m0 * m9) / d;
    const a2 = (-m5 * m2 + m1 * m6) / d;
    const a6 = (m4 * m2 - m0 * m6) / d;
    const a10 = (-m4 * m1 + m0 * m5) / d;
    this.m0 = a0; this.m1 = a1; this.m2 = a2;
    this.m4 = a4; this.m5 = a5; this.m6 = a6;
    this.m8 = a8; this.m9 = a9; this.m10 = a10;
    this.m12 = tx * a0 + ty * a4 + tz * a8;
    this.m13 = tx * a1 + ty * a5 + tz * a9;
    this.m14 = tx * a2 + ty * a6 + tz * a10;
    return true;
  }

  determinant4() {
    const { m0, m1, m2, m3, m4, m5, m6, m7, m8, m9, m10, m11, m12, m13, m14, m15 } = this;
    return m12 * m9 * m6 * m3 - m8 * m13 * m6 * m3 - m12 * m5 * m10 * m3 + m4 * m13 * m10 * m3 + m8 * m5 * m14 * m3 - m4 * m9 * m14 * m3 - m12 * m9 * m2 * m7 + m8 * m13 * m2 * m7 + m12 * m1 * m10 * m7 - m0 * m13 * m10 * m7 - m8 * m1 * m14 * m7 + m0 * m9 * m14 * m7 + m12 * m5 * m2 * m11 - m4 * m13 * m2 * m11 - m12 * m1 * m6 * m11 + m0 * m13 * m6 * m11 + m4 * m1 * m14 * m11 - m0 * m5 * m14 * m11 - m8 * m5 * m2 * m15 + m4 * m9 * m2 * m15 + m8 * m1 * m6 * m15 - m0 * m9 * m6 * m15 - m4 * m1 * m10 * m15 + m0 * m5 * m10 * m15;
  }

  inverseMatrix4() {
    const d = this.determinant4();
    if (d === 0) return false;
    const a = this.m0, b = this.m1, c = this.m2, e = this.m3, f = this.m4, g = this.m5, h = this.m6, i = this.m7,
      j = this.m8, k = this.m9, l = this.m10, m = this.m11, n = this.m12, o = this.m13, p = this.m14, q = this.m15;
    // Variable names follow the AS3 decompile: _loc2_..._loc17_ = a..q
    this.m0 = (-o * l * i + k * p * i + o * h * m - g * p * m - k * h * q + g * l * q) / d;
    this.m4 = (n * l * i - j * p * i - n * h * m + f * p * m + j * h * q - f * l * q) / d;
    this.m8 = (-n * k * i + j * o * i + n * g * m - f * o * m - j * g * q + f * k * q) / d;
    this.m12 = (n * k * h - j * o * h - n * g * l + f * o * l + j * g * p - f * k * p) / d;
    this.m1 = (o * l * e - k * p * e - o * c * m + b * p * m + k * c * q - b * l * q) / d;
    this.m5 = (-n * l * e + j * p * e + n * c * m - a * p * m - j * c * q + a * l * q) / d;
    this.m9 = (n * k * e - j * o * e - n * b * m + a * o * m + j * b * q - a * k * q) / d;
    this.m13 = (-n * k * c + j * o * c + n * b * l - a * o * l - j * b * p + a * k * p) / d;
    this.m2 = (-o * h * e + g * p * e + o * c * i - b * p * i - g * c * q + b * h * q) / d;
    this.m6 = (n * h * e - f * p * e - n * c * i + a * p * i + f * c * q - a * h * q) / d;
    this.m10 = (-n * g * e + f * o * e + n * b * i - a * o * i - f * b * q + a * g * q) / d;
    this.m14 = (n * g * c - f * o * c - n * b * h + a * o * h + f * b * p - a * g * p) / d;
    this.m3 = (k * h * e - g * l * e - k * c * i + b * l * i + g * c * m - b * h * m) / d;
    this.m7 = (-j * h * e + f * l * e + j * c * i - a * l * i - f * c * m + a * h * m) / d;
    this.m11 = (j * g * e - f * k * e - j * b * i + a * k * i + f * b * m - a * g * m) / d;
    this.m15 = (-j * g * c + f * k * c + j * b * h - a * k * h - f * b * l + a * g * l) / d;
    return true;
  }

  glLoadIdentity() {
    this.m0 = 1; this.m4 = 0; this.m8 = 0; this.m12 = 0;
    this.m1 = 0; this.m5 = 1; this.m9 = 0; this.m13 = 0;
    this.m2 = 0; this.m6 = 0; this.m10 = 1; this.m14 = 0;
    this.m3 = 0; this.m7 = 0; this.m11 = 0; this.m15 = 1;
  }

  glRotateRad(angle, x, y, z) {
    angle = -angle;
    const c = Math.cos(angle), s = Math.sin(angle), t = 1 - c;
    const r0 = c + x * x * t;
    const r4 = z * s + y * x * t;
    const r8 = -y * s + z * x * t;
    const r1 = -z * s + x * y * t;
    const r5 = c + y * y * t;
    const r9 = x * s + z * y * t;
    const r2 = y * s + x * z * t;
    const r6 = -x * s + y * z * t;
    const r10 = c + z * z * t;
    const a0 = this.m0, a1 = this.m1, a2 = this.m2, a4 = this.m4, a5 = this.m5, a6 = this.m6, a8 = this.m8, a9 = this.m9, a10 = this.m10;
    this.m0 = a0 * r0 + a4 * r1 + a8 * r2;
    this.m1 = a1 * r0 + a5 * r1 + a9 * r2;
    this.m2 = a2 * r0 + a6 * r1 + a10 * r2;
    this.m4 = a0 * r4 + a4 * r5 + a8 * r6;
    this.m5 = a1 * r4 + a5 * r5 + a9 * r6;
    this.m6 = a2 * r4 + a6 * r5 + a10 * r6;
    this.m8 = a0 * r8 + a4 * r9 + a8 * r10;
    this.m9 = a1 * r8 + a5 * r9 + a9 * r10;
    this.m10 = a2 * r8 + a6 * r9 + a10 * r10;
  }

  glMultMatrix(b) {
    const b0 = b.m0, b1 = b.m1, b2 = b.m2, b4 = b.m4, b5 = b.m5, b6 = b.m6, b8 = b.m8, b9 = b.m9, b10 = b.m10, b12 = b.m12, b13 = b.m13, b14 = b.m14;
    const a0 = this.m0, a1 = this.m1, a2 = this.m2, a4 = this.m4, a5 = this.m5, a6 = this.m6, a8 = this.m8, a9 = this.m9, a10 = this.m10, a12 = this.m12, a13 = this.m13, a14 = this.m14;
    this.m0 = a0 * b0 + a4 * b1 + a8 * b2;
    this.m1 = a1 * b0 + a5 * b1 + a9 * b2;
    this.m2 = a2 * b0 + a6 * b1 + a10 * b2;
    this.m4 = a0 * b4 + a4 * b5 + a8 * b6;
    this.m5 = a1 * b4 + a5 * b5 + a9 * b6;
    this.m6 = a2 * b4 + a6 * b5 + a10 * b6;
    this.m8 = a0 * b8 + a4 * b9 + a8 * b10;
    this.m9 = a1 * b8 + a5 * b9 + a9 * b10;
    this.m10 = a2 * b8 + a6 * b9 + a10 * b10;
    this.m12 = a0 * b12 + a4 * b13 + a8 * b14 + a12;
    this.m13 = a1 * b12 + a5 * b13 + a9 * b14 + a13;
    this.m14 = a2 * b12 + a6 * b13 + a10 * b14 + a14;
  }

  copyTo(d) {
    d.m0 = this.m0; d.m1 = this.m1; d.m2 = this.m2; d.m3 = this.m3;
    d.m4 = this.m4; d.m5 = this.m5; d.m6 = this.m6; d.m7 = this.m7;
    d.m8 = this.m8; d.m9 = this.m9; d.m10 = this.m10; d.m11 = this.m11;
    d.m12 = this.m12; d.m13 = this.m13; d.m14 = this.m14;
  }

  gluPerspective(fov, aspect) {
    const f = 1 / Math.tan(fov / 2);
    const fovy = Math.atan(Math.tan(fov / 2) * aspect) * 2;
    const fy = 1 / Math.tan(fovy / 2);
    this.m0 = f; this.m1 = 0; this.m2 = 0; this.m3 = 0;
    this.m4 = 0; this.m5 = fy; this.m6 = 0; this.m7 = 0;
    this.m8 = 0; this.m9 = 0; this.m10 = -1; this.m11 = -1;
    this.m12 = 0; this.m13 = 0; this.m14 = 0; this.m15 = 0;
  }

  matrixToAxisAngle(out) {
    let x, y, z, w, s;
    const tr = this.m0 + this.m5 + this.m10;
    if (tr >= 0) {
      s = Math.sqrt(tr + 1); w = 0.5 * s; s = 0.5 / s;
      x = (this.m6 - this.m9) * s; y = (this.m8 - this.m2) * s; z = (this.m1 - this.m4) * s;
    } else if (this.m0 > this.m5 && this.m0 > this.m10) {
      s = Math.sqrt(1 + this.m0 - this.m5 - this.m10); x = s * 0.5; s = 0.5 / s;
      y = (this.m1 + this.m4) * s; z = (this.m8 + this.m2) * s; w = (this.m6 - this.m9) * s;
    } else if (this.m5 > this.m10) {
      s = Math.sqrt(1 + this.m5 - this.m0 - this.m10); y = s * 0.5; s = 0.5 / s;
      x = (this.m1 + this.m4) * s; z = (this.m6 + this.m9) * s; w = (this.m8 - this.m2) * s;
    } else {
      s = Math.sqrt(1 + this.m10 - this.m0 - this.m5); z = s * 0.5; s = 0.5 / s;
      x = (this.m8 + this.m2) * s; y = (this.m6 + this.m9) * s; w = (this.m1 - this.m4) * s;
    }
    out.angle = 2 * Math.acos(w);
    const sn = Math.sqrt(1 - w * w);
    if (sn < 0.001) { out.x = x; out.y = y; out.z = z; }
    else { out.x = x / sn; out.y = y / sn; out.z = z / sn; }
  }

  glIdentityTranslatef(x, y, z) {
    this.m0 = 1; this.m4 = 0; this.m8 = 0; this.m12 = x;
    this.m1 = 0; this.m5 = 1; this.m9 = 0; this.m13 = y;
    this.m2 = 0; this.m6 = 0; this.m10 = 1; this.m14 = z;
    this.m3 = 0; this.m7 = 0; this.m11 = 0; this.m15 = 1;
  }
}

function cross(a, b, o) {
  o[0] = a[1] * b[2] - a[2] * b[1];
  o[1] = a[2] * b[0] - a[0] * b[2];
  o[2] = a[0] * b[1] - a[1] * b[0];
}
