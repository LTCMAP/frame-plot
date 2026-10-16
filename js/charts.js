/*
 * charts.js — turns data + options + a target rectangle into drawing primitives:
 *   {kind:'rect'|'line'|'path'|'text', ...}
 * The same primitives feed the SVG preview and the IDML writer.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Charts = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const TYPES = [
    { id: 'bar', name: 'Column', group: 'Bars' },
    { id: 'barH', name: 'Bar', group: 'Bars' },
    { id: 'stacked', name: 'Stacked column', group: 'Bars' },
    { id: 'stackedH', name: 'Stacked bar', group: 'Bars' },
    { id: 'waterfall', name: 'Waterfall', group: 'Bars' },
    { id: 'line', name: 'Line', group: 'Trends' },
    { id: 'area', name: 'Area', group: 'Trends' },
    { id: 'combo', name: 'Column + line', group: 'Trends' },
    { id: 'radar', name: 'Radar', group: 'Trends' },
    { id: 'pie', name: 'Pie', group: 'Parts of a whole' },
    { id: 'doughnut', name: 'Doughnut', group: 'Parts of a whole' },
    { id: 'radialBar', name: 'Radial bar', group: 'Parts of a whole' },
    { id: 'treemap', name: 'Treemap', group: 'Parts of a whole' },
    { id: 'funnel', name: 'Funnel', group: 'Parts of a whole' },
    { id: 'gauge', name: 'Gauge', group: 'Parts of a whole' },
  ];

  const PALETTES = {
    press: ['#0B5C8E', '#E4572E', '#F2A900', '#2E9E83', '#7A4EAB', '#5C6B73', '#C93C74', '#8BA32D'],
    cool: ['#12355B', '#2A6F97', '#3FA7B5', '#8AD1C2', '#7B8FA1', '#B8C5D0', '#5B6FD6', '#2E4057'],
    warm: ['#8C2F1B', '#D1495B', '#EDAE49', '#F4D58D', '#B5651D', '#5E3023', '#E07A5F', '#A44A3F'],
    earth: ['#4F5D2F', '#8A9A5B', '#B08968', '#7F5539', '#DDB892', '#3D405B', '#81B29A', '#6B705C'],
    mono: ['#0A1F33', '#26435E', '#4A6C8C', '#7592AD', '#A2B8CB', '#CAD7E2', '#5D7186', '#E4EBF1'],
    vivid: ['#E6194B', '#3CB44B', '#4363D8', '#F58231', '#911EB4', '#42D4F4', '#F032E6', '#BFEF45'],
  };

  const DEFAULTS = {
    title: '', note: '', titleSize: 14, size: 8, legend: 'bottom', grid: true, values: true,
    decimals: 0, prefix: '', suffix: '', thousands: true,
    gap: 0.35, lineWeight: 1.5, marker: 3, percent: false, secondary: false,
    yMin: '', yMax: '', inner: 0.58, semi: false, centerText: '', pieLabels: 'percent',
    waterfallTotal: true, gaugeMax: 100, totals: false, pad: 6,
    para: null, titlePara: null, font: null, textColor: null, bare: false,
    colors: [], hexOf: null,
  };

  /* ---------- math + formatting ---------- */
  const TAU = Math.PI * 2;
  const pt = (cx, cy, r, t) => [cx + r * Math.sin(t), cy - r * Math.cos(t)];
  const sum = (a) => a.reduce((x, y) => x + y, 0);

  function niceNum(range, round) {
    const exp = Math.floor(Math.log10(range)), f = range / Math.pow(10, exp);
    let nf;
    if (round) nf = f < 1.5 ? 1 : f < 3 ? 2 : f < 7 ? 5 : 10;
    else nf = f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10;
    return nf * Math.pow(10, exp);
  }
  function scaleFor(min, max, o, count) {
    if (!isFinite(min) || !isFinite(max)) { min = 0; max = 1; }
    if (min === max) { max = min + 1; if (min > 0) min = 0; }
    const range = niceNum(max - min, false);
    const step = niceNum(range / ((count || 5) - 1), true);
    let lo = Math.floor(min / step + 1e-9) * step, hi = Math.ceil(max / step - 1e-9) * step;
    if (o && o.lo !== '' && o.lo != null && isFinite(+o.lo)) lo = +o.lo;
    if (o && o.hi !== '' && o.hi != null && isFinite(+o.hi)) hi = +o.hi;
    if (hi <= lo) hi = lo + step;
    const ticks = [];
    const dec = Math.max(0, -Math.floor(Math.log10(step)) + 1);
    for (let v = Math.ceil(lo / step - 1e-9) * step; v <= hi + step * 1e-6; v += step) ticks.push(+v.toFixed(dec));
    return { lo, hi, step, ticks };
  }
  function fmt(v, o, decimals) {
    if (v == null || isNaN(v)) return '';
    const d = decimals == null ? o.decimals : decimals;
    let s = Math.abs(v).toFixed(d);
    if (o.thousands) { const [i, f] = s.split('.'); s = i.replace(/\B(?=(\d{3})+(?!\d))/g, ',') + (f ? '.' + f : ''); }
    return (v < 0 ? '-' : '') + o.prefix + s + o.suffix;
  }
  function textW(str, size) {
    let w = 0;
    for (const ch of String(str)) {
      if ('ilI.,;:\'|!\u2019 jtfr'.includes(ch)) w += 0.3;
      else if ('mwMW@%'.includes(ch)) w += 0.85;
      else if (/[A-Z0-9]/.test(ch)) w += 0.62;
      else w += 0.52;
    }
    return w * size;
  }
  function hexLum(hex) {
    if (!/^#[0-9a-f]{6}$/i.test(hex || '')) return 0.2;
    const n = parseInt(hex.slice(1), 16);
    return (0.299 * ((n >> 16) & 255) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255;
  }

  /* ---------- path builder ---------- */
  class Path {
    constructor() { this.pts = []; this.closed = false; }
    M(x, y) { this.pts = [{ a: [x, y], l: [x, y], r: [x, y] }]; return this; }
    L(x, y) { this.pts.push({ a: [x, y], l: [x, y], r: [x, y] }); return this; }
    C(x1, y1, x2, y2, x, y) {
      this.pts[this.pts.length - 1].r = [x1, y1];
      this.pts.push({ a: [x, y], l: [x2, y2], r: [x, y] });
      return this;
    }
    arc(cx, cy, r, t0, t1) {
      const n = Math.max(1, Math.ceil(Math.abs(t1 - t0) / (Math.PI / 2) - 1e-9));
      const d = (t1 - t0) / n;
      for (let i = 0; i < n; i++) {
        const ta = t0 + d * i, tb = ta + d, k = (4 / 3) * Math.tan(d / 4) * r;
        const p0 = pt(cx, cy, r, ta), p1 = pt(cx, cy, r, tb);
        this.C(p0[0] + k * Math.cos(ta), p0[1] + k * Math.sin(ta), p1[0] - k * Math.cos(tb), p1[1] - k * Math.sin(tb), p1[0], p1[1]);
      }
      return this;
    }
    Z() {
      const f = this.pts[0], l = this.pts[this.pts.length - 1];
      if (this.pts.length > 1 && Math.abs(f.a[0] - l.a[0]) < 1e-6 && Math.abs(f.a[1] - l.a[1]) < 1e-6) { f.l = l.l; this.pts.pop(); }
      this.closed = true;
      return this;
    }
  }
  const sector = (cx, cy, r, t0, t1) => { const p = pt(cx, cy, r, t0); return new Path().M(cx, cy).L(p[0], p[1]).arc(cx, cy, r, t0, t1).Z(); };
  const ring = (cx, cy, R, r, t0, t1) => {
    const a = pt(cx, cy, R, t0), b = pt(cx, cy, r, t1);
    return new Path().M(a[0], a[1]).arc(cx, cy, R, t0, t1).L(b[0], b[1]).arc(cx, cy, r, t1, t0).Z();
  };
  const circle = (cx, cy, r) => { const p = pt(cx, cy, r, 0); return new Path().M(p[0], p[1]).arc(cx, cy, r, 0, TAU).Z(); };
  const poly = (points, closed) => {
    const p = new Path().M(points[0][0], points[0][1]);
    for (let i = 1; i < points.length; i++) p.L(points[i][0], points[i][1]);
    p.closed = !!closed;
    return p;
  };

  /* ---------- generator ---------- */
  function build(type, data, userOpts, area) {
    const o = Object.assign({}, DEFAULTS, userOpts || {});
    o.pad = +o.pad || 0;
    const prims = [];
    const palette = PALETTES.press;
    const colorOf = (i) => (o.colors && o.colors[i]) || palette[i % palette.length];
    const hexOf = (c) => (o.hexOf ? o.hexOf(c) : c);
    const GRID = 'doc:Color/Black';

    const addRect = (x, y, w, h, s) => prims.push(Object.assign({ kind: 'rect', x, y, w, h }, s));
    const addLine = (x1, y1, x2, y2, s) => prims.push(Object.assign({ kind: 'line', x1, y1, x2, y2 }, s));
    const addPath = (p, s) => prims.push(Object.assign({ kind: 'path', pts: p.pts, closed: p.closed }, s));
    function addText(str, ax, ay, align, role, extra) {
      if (o.bare || str === '' || str == null) return;
      extra = extra || {};
      const size = extra.size || o.size;
      const tw = textW(str.split('\n').reduce((a, b) => (b.length > a.length ? b : a), ''), size);
      const lines = str.split('\n').length;
      const w = extra.w || tw + 6, h = extra.h || size * 1.4 * lines;
      const x = align === 'center' ? ax - w / 2 : align === 'right' ? ax - w : ax;
      const y = extra.valign === 'top' ? ay : extra.valign === 'bottom' ? ay - h : ay - h / 2;
      prims.push({
        kind: 'text', x, y, w, h, text: str, align, valign: extra.valign || 'center', size,
        color: extra.color !== undefined ? extra.color : o.textColor, role: role || 'label',
        para: role === 'title' ? (o.titlePara || o.para) : o.para, font: o.font, name: extra.name || str.split('\n')[0].slice(0, 40),
      });
    }

    /* normalise data */
    const cats = (data.categories || []).map(String);
    let series = (data.series || []).map((s, i) => ({ name: s.name || 'Series ' + (i + 1), values: (s.values || []).map((v) => (v == null || isNaN(v) ? null : +v)) }));
    if (!cats.length || !series.length) return { prims: [], notes: ['Add some data to see a chart.'] };
    const nC = cats.length;

    /* ---- frame: title, note, legend ---- */
    let A = { x: area.x + o.pad, y: area.y + o.pad, w: area.w - o.pad * 2, h: area.h - o.pad * 2 };
    if (o.title && !o.bare) {
      const th = o.titleSize * 1.5;
      addText(o.title, A.x, A.y, 'left', 'title', { size: o.titleSize, valign: 'top', w: A.w, h: th, name: 'Title' });
      A.y += th + 4; A.h -= th + 4;
    }
    if (o.note && !o.bare) {
      const nh = o.size * 1.3 * 1.1;
      addText(o.note, A.x, A.y + A.h, 'left', 'label', { size: o.size - 1, valign: 'bottom', w: A.w, h: nh, name: 'Note' });
      A.h -= nh + 3;
    }
    const perSlice = ['pie', 'doughnut', 'radialBar', 'treemap', 'funnel', 'waterfall', 'gauge'].includes(type);
    const legendItems = perSlice
      ? (type === 'waterfall' || type === 'gauge' || type === 'treemap' || type === 'funnel' || type === 'radialBar' ? [] : cats.map((c, i) => ({ name: c, color: colorOf(i) })))
      : series.map((s, i) => ({ name: s.name, color: colorOf(i) }));
    if (type === 'waterfall') legendItems.push({ name: 'Increase', color: colorOf(0) }, { name: 'Decrease', color: colorOf(1) }, ...(o.waterfallTotal ? [{ name: 'Total', color: colorOf(2) }] : []));
    const showLegend = o.legend !== 'none' && legendItems.length > (perSlice && type !== 'waterfall' ? 0 : 1) && !o.bare;
    if (showLegend) {
      const sz = o.size, m = sz * 0.7, gap = 12;
      const items = legendItems.map((it) => Object.assign({ w: m + 5 + textW(it.name, sz) + 6 }, it));
      const draw = (it, x, y) => {
        addRect(x, y + (sz * 1.4 - m) / 2, m, m, { fill: it.color, name: 'Legend swatch' });
        addText(it.name, x + m + 4, y + sz * 0.7, 'left', 'legend', { w: it.w - m - 4, h: sz * 1.4, name: 'Legend ' + it.name });
      };
      if (o.legend === 'right' || o.legend === 'left') {
        const lw = Math.max(...items.map((i) => i.w)), lh = items.length * sz * 1.7;
        const lx = o.legend === 'right' ? A.x + A.w - lw : A.x;
        const ly = A.y + Math.max(0, (A.h - lh) / 2);
        items.forEach((it, i) => draw(it, lx, ly + i * sz * 1.7));
        if (o.legend === 'right') A.w -= lw + 12; else { A.x += lw + 12; A.w -= lw + 12; }
      } else {
        const rows = [[]]; let cur = 0;
        for (const it of items) {
          if (cur + it.w > A.w && rows[rows.length - 1].length) { rows.push([]); cur = 0; }
          rows[rows.length - 1].push(it); cur += it.w + gap;
        }
        const rh = sz * 1.7, lh = rows.length * rh;
        const top = o.legend === 'top' ? A.y : A.y + A.h - lh;
        rows.forEach((row, ri) => {
          const rw = sum(row.map((i) => i.w)) + gap * (row.length - 1);
          let x = A.x + (A.w - rw) / 2;
          row.forEach((it) => { draw(it, x, top + ri * rh); x += it.w + gap; });
        });
        if (o.legend === 'top') A.y += lh + 4; A.h -= lh + 4;
      }
    }
    if (A.w < 20 || A.h < 20) return { prims, notes: ['The area is too small for this chart.'] };

    /* =================== CARTESIAN =================== */
    const cartesian = ['bar', 'barH', 'stacked', 'stackedH', 'line', 'area', 'combo', 'waterfall'];
    if (cartesian.includes(type)) {
      const H = type === 'barH' || type === 'stackedH';
      const stacked = type === 'stacked' || type === 'stackedH';
      const isLine = type === 'line' || type === 'area';
      const val = o.percent && stacked ? Object.assign({}, o, { suffix: '%', decimals: 0 }) : o;

      let S = series;
      if (type === 'waterfall') S = [series[0]];
      if (stacked && o.percent) {
        const tot = cats.map((_, i) => sum(series.map((s) => Math.max(0, s.values[i] || 0))));
        S = series.map((s) => ({ name: s.name, values: s.values.map((v, i) => (v == null || !tot[i] ? null : (Math.max(0, v) / tot[i]) * 100)) }));
      }
      /* value domain */
      let lo = 0, hi = 0, wf = null;
      const primary = type === 'combo' ? [S[0]] : S;
      const secondarySeries = type === 'combo' ? S.slice(1) : [];
      if (type === 'waterfall') {
        wf = []; let cum = 0;
        S[0].values.forEach((v) => { const a = cum; cum += v || 0; wf.push({ a, b: cum, v: v || 0 }); });
        if (o.waterfallTotal) wf.push({ a: 0, b: cum, v: cum, total: true });
        wf.forEach((w) => { lo = Math.min(lo, w.a, w.b); hi = Math.max(hi, w.a, w.b); });
      } else if (stacked) {
        for (let i = 0; i < nC; i++) {
          let p = 0, n = 0;
          S.forEach((s) => { const v = s.values[i] || 0; if (v >= 0) p += v; else n += v; });
          hi = Math.max(hi, p); lo = Math.min(lo, n);
        }
        if (o.percent) { lo = 0; hi = 100; }
      } else {
        const all = primary.flatMap((s) => s.values.filter((v) => v != null));
        lo = Math.min(...all); hi = Math.max(...all);
        if (!isLine || o.yMin === 0 || o.yMin === '0') { lo = Math.min(lo, 0); hi = Math.max(hi, 0); }
        if (type === 'area') lo = Math.min(lo, 0);
      }
      const mainScale = scaleFor(lo, hi, { lo: o.yMin, hi: o.yMax });
      let secScale = null;
      if (secondarySeries.length && o.secondary) {
        const all = secondarySeries.flatMap((s) => s.values.filter((v) => v != null));
        secScale = scaleFor(Math.min(0, ...all), Math.max(0, ...all), {});
      }
      const tickLabel = (v) => fmt(v, val, Math.max(val.decimals, mainScale.step < 1 ? 1 : 0));
      const secLabel = (v) => fmt(v, o, o.decimals);

      /* bands for axis labels */
      const maxTickW = Math.max(...mainScale.ticks.map((t) => textW(tickLabel(t), o.size)));
      const maxCatW = Math.max(...cats.map((c) => textW(c, o.size)));
      let L = 0, B = 0, R = 0;
      const sz = o.size;
      if (H) { L = Math.min(maxCatW + 8, A.w * 0.35); B = sz * 1.8; R = textW(tickLabel(mainScale.ticks[mainScale.ticks.length - 1]), sz) / 2 + 2; }
      else {
        L = maxTickW + 8;
        if (secScale) R = Math.max(...secScale.ticks.map((t) => textW(secLabel(t), sz))) + 8;
      }
      const plotW0 = A.w - L - R;
      const nSlots = wf ? wf.length : nC;
      const slot0 = (H ? A.h : plotW0) / nSlots;
      let step = 1;
      if (!H) { while (step < nC && Math.ceil(maxCatW / (slot0 * step)) > 2) step++; B = sz * 1.4 * Math.min(2, Math.ceil(maxCatW / (slot0 * step))) + 6; }
      const P = { x: A.x + L, y: A.y + (o.values && !H ? sz * 1.2 : sz * 0.6), w: plotW0, h: 0 };
      P.h = A.h - B - (P.y - A.y);
      if (P.w < 20 || P.h < 20) return { prims, notes: ['The area is too small for this chart.'] };

      const Lc = H ? P.h : P.w, Lv = H ? P.w : P.h;
      const vlen = (v, sc) => ((v - sc.lo) / (sc.hi - sc.lo)) * Lv;
      const slot = Lc / nSlots;
      // map (cat a..b, value-length u..v) → rect
      const toRect = (c0, c1, u0, u1) => (H
        ? { x: P.x + Math.min(u0, u1), y: P.y + c0, w: Math.abs(u1 - u0), h: c1 - c0 }
        : { x: P.x + c0, y: P.y + Lv - Math.max(u0, u1), w: c1 - c0, h: Math.abs(u1 - u0) });
      const toPt = (c, u) => (H ? [P.x + u, P.y + c] : [P.x + c, P.y + Lv - u]);

      /* grid + value-axis labels */
      mainScale.ticks.forEach((t) => {
        const u = vlen(t, mainScale);
        if (o.grid) {
          if (H) addLine(P.x + u, P.y, P.x + u, P.y + P.h, { stroke: GRID, sw: 0.4, strokeTint: 18, name: 'Gridline' });
          else addLine(P.x, P.y + Lv - u, P.x + P.w, P.y + Lv - u, { stroke: GRID, sw: 0.4, strokeTint: 18, name: 'Gridline' });
        }
        if (H) addText(tickLabel(t), P.x + u, P.y + P.h + 3 + sz * 0.7, 'center', 'label', { name: 'Axis ' + t });
        else addText(tickLabel(t), P.x - 4, P.y + Lv - u, 'right', 'label', { name: 'Axis ' + t });
      });
      if (secScale) secScale.ticks.forEach((t) => addText(secLabel(t), P.x + P.w + 4, P.y + Lv - vlen(t, secScale), 'left', 'label', { name: 'Axis 2 ' + t }));

      /* category labels */
      cats.forEach((c, i) => {
        if (i % step) return;
        const cc = (i + 0.5) * slot;
        if (H) addText(c, P.x - 5, P.y + cc, 'right', 'label', { w: L - 5, name: 'Category ' + c });
        else {
          const w = slot * step;
          addText(c, P.x + cc - slot / 2 + w / 2 - (step > 1 ? 0 : 0), P.y + P.h + 3, 'center', 'label', { w, h: B - 3, valign: 'top', name: 'Category ' + c });
        }
      });

      const baseU = Math.max(0, Math.min(Lv, vlen(0, mainScale)));
      const barsFor = (list, offset) => {
        const nS = stacked ? 1 : list.length;
        const bw = (slot * (1 - o.gap)) / nS;
        list.forEach((s, si) => {
          const col = colorOf(offset + si);
          s.values.forEach((v, i) => {
            if (v == null) return;
            const c0 = i * slot + (slot * o.gap) / 2 + (stacked ? 0 : si * bw);
            const r = toRect(c0, c0 + bw, baseU, vlen(v, mainScale));
            addRect(r.x, r.y, r.w, r.h, { fill: col, name: s.name + ' · ' + cats[i] });
            if (o.values) {
              const lab = fmt(v, val);
              const tw = textW(lab, sz) + 4;
              if (H) addText(lab, v >= 0 ? r.x + r.w + 3 : r.x - 3, r.y + r.h / 2, v >= 0 ? 'left' : 'right', 'value', { name: 'Value ' + lab });
              else addText(lab, r.x + r.w / 2, v >= 0 ? r.y - sz * 0.75 : r.y + r.h + sz * 0.75, 'center', 'value', { w: Math.max(r.w, tw), name: 'Value ' + lab });
            }
          });
        });
      };

      if (stacked) {
        const posBase = new Array(nC).fill(0), negBase = new Array(nC).fill(0);
        S.forEach((s, si) => {
          s.values.forEach((v, i) => {
            if (v == null || v === 0) return;
            const from = v >= 0 ? posBase[i] : negBase[i], to = from + v;
            if (v >= 0) posBase[i] = to; else negBase[i] = to;
            const c0 = i * slot + (slot * o.gap) / 2, bw = slot * (1 - o.gap);
            const r = toRect(c0, c0 + bw, vlen(from, mainScale), vlen(to, mainScale));
            addRect(r.x, r.y, r.w, r.h, { fill: colorOf(si), name: s.name + ' · ' + cats[i] });
            if (o.values) {
              const lab = fmt(v, val), need = H ? textW(lab, sz) + 6 : sz * 1.5;
              if ((H ? r.w : r.h) >= need && (H ? r.h >= sz * 1.2 : r.w >= textW(lab, sz) + 2)) {
                const lum = hexLum(hexOf(colorOf(si)));
                addText(lab, r.x + r.w / 2, r.y + r.h / 2, 'center', 'value', { w: r.w, color: lum > 0.55 ? 'doc:Color/Black' : 'doc:Color/Paper', name: 'Value ' + lab });
              }
            }
          });
        });
        if (o.totals && !o.percent) {
          for (let i = 0; i < nC; i++) {
            const t = posBase[i]; if (!t) continue;
            const r = toRect(i * slot, (i + 1) * slot, 0, vlen(t, mainScale));
            const lab = fmt(t, val);
            if (H) addText(lab, r.x + r.w + 3, r.y + r.h / 2, 'left', 'value', { name: 'Total ' + lab });
            else addText(lab, r.x + r.w / 2, r.y - sz * 0.75, 'center', 'value', { w: Math.max(slot, textW(lab, sz) + 4), name: 'Total ' + lab });
          }
        }
      } else if (type === 'bar' || type === 'barH') {
        barsFor(S, 0);
      } else if (type === 'waterfall') {
        const n = wf.length, sl = Lc / n, bw = sl * (1 - o.gap);
        // (category labels were drawn for data categories only; add Total label)
        if (o.waterfallTotal) addText('Total', P.x + (nC + 0.5) * sl, P.y + P.h + 3, 'center', 'label', { w: sl, h: B - 3, valign: 'top', name: 'Category Total' });
        wf.forEach((w, i) => {
          const c0 = i * sl + (sl - bw) / 2;
          const col = w.total ? colorOf(2) : w.v >= 0 ? colorOf(0) : colorOf(1);
          const r = toRect(c0, c0 + bw, vlen(Math.min(w.a, w.b), mainScale), vlen(Math.max(w.a, w.b), mainScale));
          addRect(r.x, r.y, r.w, r.h, { fill: col, name: (cats[i] || 'Total') });
          if (i < n - 1 && !(wf[i + 1].total && false)) {
            const u = vlen(w.b, mainScale), p1 = toPt(c0 + bw, u), p2 = toPt((i + 1) * sl + (sl - bw) / 2, u);
            addLine(p1[0], p1[1], p2[0], p2[1], { stroke: GRID, sw: 0.4, strokeTint: 60, name: 'Connector' });
          }
          if (o.values) {
            const lab = (w.v > 0 && !w.total ? '+' : '') + fmt(w.v, val);
            addText(lab, r.x + r.w / 2, w.v >= 0 || w.total ? r.y - sz * 0.75 : r.y + r.h + sz * 0.75, 'center', 'value', { w: Math.max(r.w, textW(lab, sz) + 4), name: 'Value ' + lab });
          }
        });
      } else if (type === 'combo') {
        barsFor(primary, 0);
      }

      /* lines + areas */
      const lineSeries = type === 'combo' ? secondarySeries : isLine ? S : [];
      lineSeries.forEach((s, li) => {
        const si = type === 'combo' ? li + 1 : li;
        const sc = type === 'combo' && secScale ? secScale : mainScale;
        const pts = [];
        s.values.forEach((v, i) => { if (v != null) pts.push(toPt((i + 0.5) * slot, vlen(v, sc))); });
        if (pts.length < 2) return;
        const col = colorOf(si);
        if (type === 'area') {
          const base = vlen(Math.max(sc.lo, Math.min(0, sc.hi)), sc);
          const first = toPt(0.5 * slot, base), last = toPt((nC - 0.5) * slot, base);
          addPath(poly([first, ...pts, last], true), { fill: col, fillTint: 35, name: s.name + ' area' });
        }
        addPath(poly(pts, false), { stroke: col, sw: o.lineWeight, name: s.name });
        if (o.marker > 0) s.values.forEach((v, i) => {
          if (v == null) return;
          const p = toPt((i + 0.5) * slot, vlen(v, sc));
          addPath(circle(p[0], p[1], o.marker), { fill: col, stroke: 'doc:Color/Paper', sw: 0.75, name: s.name + ' point' });
        });
        if (o.values) s.values.forEach((v, i) => {
          if (v == null) return;
          const p = toPt((i + 0.5) * slot, vlen(v, sc)), lab = fmt(v, o);
          addText(lab, p[0], p[1] - o.marker - sz * 0.8, 'center', 'value', { w: Math.max(slot, textW(lab, sz) + 4), name: 'Value ' + lab });
        });
      });

      /* baseline last, on top of bars */
      if (H) addLine(P.x + baseU, P.y, P.x + baseU, P.y + P.h, { stroke: GRID, sw: 0.75, strokeTint: 80, name: 'Baseline' });
      else addLine(P.x, P.y + Lv - baseU, P.x + P.w, P.y + Lv - baseU, { stroke: GRID, sw: 0.75, strokeTint: 80, name: 'Baseline' });
      return { prims, notes: [] };
    }

    /* =================== RADAR =================== */
    if (type === 'radar') {
      const sz = o.size;
      const maxLab = Math.min(Math.max(...cats.map((c) => textW(c, sz))), A.w * 0.25);
      const Rr = Math.min(A.w / 2 - maxLab - 10, A.h / 2 - sz * 2.2);
      if (Rr < 20) return { prims, notes: ['The area is too small for this chart.'] };
      const cx = A.x + A.w / 2, cy = A.y + A.h / 2;
      const all = series.flatMap((s) => s.values.filter((v) => v != null));
      const sc = scaleFor(0, Math.max(...all), { lo: 0, hi: o.yMax });
      const ang = (i) => (i / nC) * TAU;
      const rings = sc.ticks.filter((t) => t > sc.lo);
      rings.forEach((t) => {
        const r = (t / sc.hi) * Rr;
        addPath(poly(cats.map((_, i) => pt(cx, cy, r, ang(i))), true), { stroke: GRID, sw: 0.4, strokeTint: 20, name: 'Ring ' + t });
        if (o.grid) addText(fmt(t, o), cx + 3, cy - r, 'left', 'label', { size: sz - 1, name: 'Ring label ' + t });
      });
      cats.forEach((c, i) => {
        const p = pt(cx, cy, Rr, ang(i));
        addLine(cx, cy, p[0], p[1], { stroke: GRID, sw: 0.4, strokeTint: 20, name: 'Spoke' });
        const q = pt(cx, cy, Rr + 6, ang(i)), s = Math.sin(ang(i)), co = Math.cos(ang(i));
        const align = s > 0.3 ? 'left' : s < -0.3 ? 'right' : 'center';
        const dy = co > 0.5 ? -sz * 0.7 : co < -0.5 ? sz * 0.7 : 0;
        addText(c, q[0], q[1] + dy, align, 'label', { w: maxLab + 6, name: 'Axis ' + c });
      });
      series.forEach((s, si) => {
        const pts = s.values.map((v, i) => pt(cx, cy, ((v || 0) / sc.hi) * Rr, ang(i)));
        addPath(poly(pts, true), { fill: colorOf(si), fillTint: 22, stroke: colorOf(si), sw: o.lineWeight, name: s.name });
        if (o.marker > 0) pts.forEach((p) => addPath(circle(p[0], p[1], Math.min(o.marker, 3)), { fill: colorOf(si), name: s.name + ' point' }));
      });
      return { prims, notes: [] };
    }

    /* the rest use the first series, one value per category */
    const vals = series[0].values.map((v) => (v == null ? 0 : v));

    /* =================== PIE / DOUGHNUT =================== */
    if (type === 'pie' || type === 'doughnut') {
      const sz = o.size, semi = !!o.semi;
      const items = vals.map((v, i) => ({ v: Math.max(0, v), i })).filter((d) => d.v > 0);
      const total = sum(items.map((d) => d.v));
      if (!total) return { prims, notes: ['All values are zero.'] };
      const labFor = (d) => {
        const pc = ((d.v / total) * 100).toFixed(o.decimals ? o.decimals : 0) + '%';
        return o.pieLabels === 'value' ? fmt(d.v, o) : o.pieLabels === 'percent' ? pc : o.pieLabels === 'both' ? fmt(d.v, o) + ' (' + pc + ')' : o.pieLabels === 'name' ? cats[d.i] : '';
      };
      const padX = o.pieLabels === 'none' ? 4 : Math.max(...items.map((d) => textW(labFor(d), sz))) + 10;
      const padY = o.pieLabels === 'none' ? 4 : sz * 2;
      const Rr = semi ? Math.min(A.w / 2 - padX, A.h - padY - 2) : Math.min(A.w / 2 - padX, A.h / 2 - padY);
      if (Rr < 15) return { prims, notes: ['The area is too small for this chart.'] };
      const cx = A.x + A.w / 2, cy = semi ? A.y + A.h - 2 : A.y + A.h / 2;
      const t0 = semi ? -Math.PI / 2 : ((+o.startAngle || 0) * Math.PI) / 180, span = semi ? Math.PI : TAU;
      let t = t0;
      items.forEach((d) => {
        const dt = (d.v / total) * span, a0 = t, a1 = t + dt; t = a1;
        const p = type === 'doughnut' ? ring(cx, cy, Rr, Rr * o.inner, a0, a1) : sector(cx, cy, Rr, a0, a1);
        addPath(p, { fill: colorOf(d.i), stroke: 'doc:Color/Paper', sw: 0.75, name: cats[d.i] });
        const lab = labFor(d);
        if (lab) {
          const mid = (a0 + a1) / 2, q = pt(cx, cy, Rr + 6, mid), s = Math.sin(mid), co = Math.cos(mid);
          const align = s > 0.25 ? 'left' : s < -0.25 ? 'right' : 'center';
          const dy = co > 0.6 ? -sz * 0.7 : co < -0.6 ? sz * 0.7 : 0;
          addText(lab, q[0], q[1] + dy, align, 'value', { name: 'Label ' + cats[d.i] });
        }
      });
      if (type === 'doughnut' && o.centerText) addText(o.centerText, cx, semi ? cy - Rr * o.inner * 0.35 : cy, 'center', 'title', { size: o.size * 2, w: Rr * o.inner * 1.6, name: 'Center text' });
      return { prims, notes: [] };
    }

    /* =================== RADIAL BAR =================== */
    if (type === 'radialBar') {
      const sz = o.size;
      const items = vals.map((v, i) => ({ v, i }));
      const mx = (+o.yMax) || Math.max(...vals, 1);
      const Rr = Math.min(A.w / 2, A.h / 2) - 2;
      if (Rr < 30) return { prims, notes: ['The area is too small for this chart.'] };
      const cx = A.x + A.w / 2, cy = A.y + A.h / 2, r0 = Rr * 0.22, sweep = TAU * 0.75;
      const band = (Rr - r0) / items.length, th = band * 0.72;
      items.forEach((d, k) => {
        const rOut = Rr - k * band, rIn = rOut - th;
        addPath(ring(cx, cy, rOut, rIn, 0, sweep), { fill: GRID, fillTint: 10, name: 'Track ' + cats[d.i] });
        const f = Math.max(0, Math.min(1, d.v / mx));
        if (f > 0) addPath(ring(cx, cy, rOut, rIn, 0, sweep * f), { fill: colorOf(d.i), name: cats[d.i] });
        const lab = cats[d.i] + (o.values ? '  ' + fmt(d.v, o) : '');
        addText(lab, cx - 5, cy - (rOut + rIn) / 2, 'right', 'label', { size: Math.min(sz, Math.max(5, th * 0.85)), w: Math.max(40, textW(lab, sz) + 6), name: 'Label ' + cats[d.i] });
      });
      return { prims, notes: [] };
    }

    /* =================== TREEMAP =================== */
    if (type === 'treemap') {
      const idx = vals.map((v, i) => ({ v: Math.max(0, v), i })).filter((d) => d.v > 0).sort((a, b) => b.v - a.v);
      const total = sum(idx.map((d) => d.v));
      if (!total) return { prims, notes: ['All values are zero.'] };
      const scale = (A.w * A.h) / total;
      const rects = squarify(idx.map((d) => d.v * scale), A.x, A.y, A.w, A.h);
      idx.forEach((d, k) => {
        const r = rects[k], g = 0.9;
        const x = r.x + g, y = r.y + g, w = r.w - g * 2, h = r.h - g * 2;
        if (w <= 1 || h <= 1) return;
        const col = colorOf(d.i);
        addRect(x, y, w, h, { fill: col, name: cats[d.i] });
        const lab = cats[d.i] + (o.values ? '\n' + fmt(d.v, o) : '');
        if (w > textW(cats[d.i], o.size) * 0.6 && h > o.size * 1.8 && !o.bare) {
          const lum = hexLum(hexOf(col));
          addText(lab, x + 4, y + 3, 'left', 'label', { valign: 'top', w: w - 8, h: Math.min(h - 6, o.size * 1.4 * 2), color: lum > 0.55 ? 'doc:Color/Black' : 'doc:Color/Paper', name: 'Label ' + cats[d.i] });
        }
      });
      return { prims, notes: [] };
    }

    /* =================== FUNNEL =================== */
    if (type === 'funnel') {
      const mx = Math.max(...vals, 1), n = vals.length, gap = 2, sh = (A.h - gap * (n - 1)) / n, cx = A.x + A.w / 2;
      vals.forEach((v, i) => {
        const w0 = (Math.max(v, 0) / mx) * A.w, nxt = i < n - 1 ? Math.max(vals[i + 1], 0) : v * 0.82;
        const w1 = (nxt / mx) * A.w, y0 = A.y + i * (sh + gap), y1 = y0 + sh;
        const col = colorOf(i);
        addPath(poly([[cx - w0 / 2, y0], [cx + w0 / 2, y0], [cx + w1 / 2, y1], [cx - w1 / 2, y1]], true), { fill: col, name: cats[i] });
        const lab = cats[i] + (o.values ? '  ' + fmt(v, o) : '');
        const lum = hexLum(hexOf(col));
        addText(lab, cx, (y0 + y1) / 2, 'center', 'label', { w: Math.max(40, Math.min(A.w, w1)), color: lum > 0.55 ? 'doc:Color/Black' : 'doc:Color/Paper', name: 'Label ' + cats[i] });
      });
      return { prims, notes: [] };
    }

    /* =================== GAUGE =================== */
    if (type === 'gauge') {
      const sz = o.size, v = vals[0], mx = +o.gaugeMax || 100;
      const Rr = Math.min(A.w / 2, A.h - sz * 2) - 2;
      if (Rr < 25) return { prims, notes: ['The area is too small for this chart.'] };
      const cx = A.x + A.w / 2, cy = A.y + A.h - sz * 1.8, rIn = Rr * o.inner;
      addPath(ring(cx, cy, Rr, rIn, -Math.PI / 2, Math.PI / 2), { fill: GRID, fillTint: 12, name: 'Track' });
      const f = Math.max(0, Math.min(1, v / mx));
      if (f > 0) addPath(ring(cx, cy, Rr, rIn, -Math.PI / 2, -Math.PI / 2 + Math.PI * f), { fill: colorOf(0), name: cats[0] || 'Value' });
      addText(fmt(v, o), cx, cy - rIn * 0.35, 'center', 'title', { size: sz * 3, w: rIn * 1.7, name: 'Gauge value' });
      addText(cats[0] || '', cx, cy - rIn * 0.35 + sz * 2.3, 'center', 'label', { w: rIn * 1.7, name: 'Gauge label' });
      addText(fmt(0, o), cx - (Rr + rIn) / 2, cy + sz, 'center', 'label', { name: 'Min' });
      addText(fmt(mx, o), cx + (Rr + rIn) / 2, cy + sz, 'center', 'label', { name: 'Max' });
      return { prims, notes: [] };
    }

    return { prims, notes: ['Unknown chart type.'] };
  }

  function squarify(vals, x, y, w, h) {
    const out = [];
    let rest = vals.slice();
    const worst = (row, side) => {
      const s = sum(row), mx = Math.max(...row), mn = Math.min(...row);
      return Math.max((side * side * mx) / (s * s), (s * s) / (side * side * mn));
    };
    while (rest.length) {
      const side = Math.min(w, h);
      const row = [rest[0]];
      let i = 1;
      while (i < rest.length && worst(row.concat(rest[i]), side) <= worst(row, side)) { row.push(rest[i]); i++; }
      const s = sum(row);
      if (w >= h) {
        const cw = s / h; let cy = y;
        row.forEach((v) => { const rh = v / cw; out.push({ x, y: cy, w: cw, h: rh }); cy += rh; });
        x += cw; w -= cw;
      } else {
        const rh = s / w; let cx = x;
        row.forEach((v) => { const rw = v / rh; out.push({ x: cx, y, w: rw, h: rh }); cx += rw; });
        y += rh; h -= rh;
      }
      rest = rest.slice(row.length);
    }
    return out;
  }

  /* ---------- data helpers ---------- */
  function parseNumber(s) {
    if (s == null) return null;
    let t = String(s).trim();
    if (!t) return null;
    let neg = false;
    if (/^\(.*\)$/.test(t)) { neg = true; t = t.slice(1, -1); }
    t = t.replace(/[$€£¥%\s]/g, '');
    if (/^\d{1,3}(\.\d{3})+,\d+$/.test(t)) t = t.replace(/\./g, '').replace(',', '.');
    else t = t.replace(/,/g, '');
    const n = parseFloat(t);
    return isFinite(n) && /^[-+]?[\d.]+(e[-+]?\d+)?$/i.test(t) ? (neg ? -n : n) : null;
  }
  /** grid: array of rows. Row 0 = headers (first cell ignored), column 0 = categories. */
  function gridToData(grid) {
    if (!grid || grid.length < 2 || grid[0].length < 2) return { categories: [], series: [] };
    const header = grid[0];
    const rows = grid.slice(1).filter((r) => r.some((c) => String(c || '').trim() !== ''));
    const cats = rows.map((r) => String(r[0] == null ? '' : r[0]));
    const series = [];
    for (let c = 1; c < header.length; c++) {
      const name = String(header[c] == null ? '' : header[c]).trim();
      const values = rows.map((r) => parseNumber(r[c]));
      if (!name && values.every((v) => v == null)) continue;
      series.push({ name: name || 'Series ' + c, values });
    }
    return { categories: cats, series };
  }
  function parseDelimited(text) {
    const delim = text.includes('\t') ? '\t' : text.split('\n')[0].split(';').length > text.split('\n')[0].split(',').length ? ';' : ',';
    const rows = []; let row = [], cell = '', q = false;
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (q) { if (ch === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += ch; }
      else if (ch === '"') q = true;
      else if (ch === delim) { row.push(cell); cell = ''; }
      else if (ch === '\n' || ch === '\r') { if (ch === '\r' && text[i + 1] === '\n') i++; row.push(cell); rows.push(row); row = []; cell = ''; }
      else cell += ch;
    }
    if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
    return rows.filter((r) => r.some((c) => c.trim() !== ''));
  }

  return { TYPES, PALETTES, DEFAULTS, build, gridToData, parseDelimited, parseNumber, fmt, textW };
});
