/* render.js — draw chart primitives as SVG markup (used by the preview, thumbnails and SVG export) */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Render = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  const f = (v) => Math.round(v * 100) / 100;
  const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

  function mixWhite(hex, tint) {
    if (!/^#[0-9a-f]{6}$/i.test(hex)) return hex;
    const n = parseInt(hex.slice(1), 16), t = tint / 100;
    const ch = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((c) => Math.round(255 - (255 - c) * t));
    return '#' + ch.map((c) => c.toString(16).padStart(2, '0')).join('');
  }
  /** hexOf: spec -> '#rrggbb' | null */
  function paint(spec, tint, hexOf) {
    if (!spec || spec === 'none') return 'none';
    let h = hexOf(spec) || '#888888';
    if (tint != null && tint < 100) h = mixWhite(h, tint);
    return h;
  }
  function pathD(pts, closed) {
    let d = 'M' + f(pts[0].a[0]) + ' ' + f(pts[0].a[1]);
    const seg = (p, q) => ' C' + f(p.r[0]) + ' ' + f(p.r[1]) + ' ' + f(q.l[0]) + ' ' + f(q.l[1]) + ' ' + f(q.a[0]) + ' ' + f(q.a[1]);
    for (let i = 1; i < pts.length; i++) d += seg(pts[i - 1], pts[i]);
    if (closed) d += seg(pts[pts.length - 1], pts[0]) + 'Z';
    return d;
  }
  function primsToSvg(prims, hexOf, opts) {
    opts = opts || {};
    const font = opts.font || "'Hanken Grotesk', system-ui, sans-serif";
    const nse = opts.thin ? ' vector-effect="non-scaling-stroke"' : '';
    let out = '';
    for (const p of prims) {
      if (p.kind === 'rect') {
        out += '<rect x="' + f(p.x) + '" y="' + f(p.y) + '" width="' + f(Math.max(0, p.w)) + '" height="' + f(Math.max(0, p.h)) + '" fill="' + paint(p.fill, p.fillTint, hexOf) + '" stroke="' + paint(p.stroke, p.strokeTint, hexOf) + '" stroke-width="' + (p.stroke ? p.sw || 0.5 : 0) + '"/>';
      } else if (p.kind === 'line') {
        out += '<line x1="' + f(p.x1) + '" y1="' + f(p.y1) + '" x2="' + f(p.x2) + '" y2="' + f(p.y2) + '" stroke="' + paint(p.stroke, p.strokeTint, hexOf) + '" stroke-width="' + (p.sw || 0.5) + '"/>';
      } else if (p.kind === 'path') {
        out += '<path d="' + pathD(p.pts, p.closed) + '" fill="' + paint(p.fill, p.fillTint, hexOf) + '" stroke="' + paint(p.stroke, p.strokeTint, hexOf) + '" stroke-width="' + (p.stroke ? p.sw || 0.5 : 0) + '" stroke-linejoin="round"/>';
      } else if (p.kind === 'text') {
        const lines = String(p.text).split('\n'), lh = p.size * 1.2, total = lh * lines.length;
        const y0 = p.valign === 'top' ? p.y : p.valign === 'bottom' ? p.y + p.h - total : p.y + (p.h - total) / 2;
        const x = p.align === 'center' ? p.x + p.w / 2 : p.align === 'right' ? p.x + p.w : p.x;
        const anchor = p.align === 'center' ? 'middle' : p.align === 'right' ? 'end' : 'start';
        const col = p.color ? paint(p.color, null, hexOf) : '#1c2730';
        const weight = p.role === 'title' ? 700 : 400;
        out += '<text text-anchor="' + anchor + '" font-family="' + font + '" font-size="' + f(p.size) + '" font-weight="' + weight + '" fill="' + col + '">' +
          lines.map((ln, i) => '<tspan x="' + f(x) + '" y="' + f(y0 + i * lh + p.size * 0.88) + '">' + esc(ln) + '</tspan>').join('') + '</text>';
      }
    }
    return out;
  }
  return { primsToSvg, pathD, paint };
});
