// Canvas 2D rasteriser for depth-sorted triangle lists: the same approach
// as the Flash renderer (one affine-mapped bitmap fill per triangle). Used
// for portraits/thumbnails and as a fallback when WebGL is unavailable.

export function drawTrianglesCanvas(ctx, list, scale = 1) {
  for (let i = 0; i < list.length; i++) {
    const t = list[i];
    const bmd = t.material && t.material.bmd;
    if (!bmd) continue;
    const bw = bmd.baseWidth || bmd.width, bh = bmd.baseHeight || bmd.height;
    const sx = bmd.width / bw, sy = bmd.height / bh;
    const w1 = bw - 1, h1 = bh - 1;
    // Texture-space (bitmap pixel) coordinates of the three corners.
    const u0 = t.u0 * w1 * sx, v0 = (h1 - t.v0 * h1) * sy;
    const u1 = t.u1 * w1 * sx, v1 = (h1 - t.v1 * h1) * sy;
    const u2 = t.u2 * w1 * sx, v2 = (h1 - t.v2 * h1) * sy;
    const x0 = t.screen_v0.x * scale, y0 = t.screen_v0.y * scale;
    const x1 = t.screen_v1.x * scale, y1 = t.screen_v1.y * scale;
    const x2 = t.screen_v2.x * scale, y2 = t.screen_v2.y * scale;
    // Solve the affine map texture -> screen.
    const du1 = u1 - u0, dv1 = v1 - v0, du2 = u2 - u0, dv2 = v2 - v0;
    const det = du1 * dv2 - du2 * dv1;
    if (Math.abs(det) < 1e-9) continue;
    const dx1 = x1 - x0, dy1 = y1 - y0, dx2 = x2 - x0, dy2 = y2 - y0;
    const a = (dx1 * dv2 - dx2 * dv1) / det;
    const b = (dy1 * dv2 - dy2 * dv1) / det;
    const c = (dx2 * du1 - dx1 * du2) / det;
    const d = (dy2 * du1 - dy1 * du2) / det;
    const e = x0 - a * u0 - c * v0;
    const f = y0 - b * u0 - d * v0;
    ctx.save();
    ctx.beginPath();
    // Grow the clip slightly to hide anti-aliasing seams between triangles.
    const cx = (x0 + x1 + x2) / 3, cy = (y0 + y1 + y2) / 3;
    const grow = (x, y) => { const lx = x - cx, ly = y - cy, l = Math.hypot(lx, ly) || 1; return [x + lx / l * 0.6, y + ly / l * 0.6]; };
    const p0 = grow(x0, y0), p1 = grow(x1, y1), p2 = grow(x2, y2);
    ctx.moveTo(p0[0], p0[1]); ctx.lineTo(p1[0], p1[1]); ctx.lineTo(p2[0], p2[1]);
    ctx.closePath();
    ctx.clip();
    ctx.setTransform(a, b, c, d, e, f);
    ctx.drawImage(bmd, 0, 0);
    ctx.restore();
  }
}
