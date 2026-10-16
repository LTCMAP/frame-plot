(function () {
  'use strict';

  const $ = (s, el) => (el || document).querySelector(s);
  const $$ = (s, el) => Array.from((el || document).querySelectorAll(s));
  const NS = 'http://www.w3.org/2000/svg';
  const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

  const EXAMPLE = [
    ['', 'North', 'South', 'West'],
    ['Q1', '120', '90', '60'],
    ['Q2', '150', '110', '75'],
    ['Q3', '135', '130', '88'],
    ['Q4', '180', '125', '95'],
  ];

  const S = {
    doc: null, buf: null, orig: null, fileName: '',
    spreadIdx: 0, zoom: 1,
    area: null,                       // {spread, rect:{x,y,w,h}, frame:{id,tag,kind,layer}|null, label}
    grid: EXAMPLE.map((r) => r.slice()),
    type: 'bar', palette: 'press', overrides: {},
    opts: {
      title: '', note: '', legend: 'bottom', grid: true, values: true, decimals: 0, prefix: '', suffix: '', thousands: true,
      gap: 0.35, lineWeight: 1.5, marker: 3, percent: false, totals: false, secondary: false, yMin: '', yMax: '',
      waterfallTotal: true, semi: false, startAngle: 0, inner: 0.58, centerText: '', pieLabels: 'percent', gaugeMax: 100,
    },
    style: { para: '', titlePara: '', font: '', textColor: '', size: 8, titleSize: 14, pad: 6, colorSpace: 'CMYK' },
    placed: [], hidden: new Set(), workbook: null,
  };

  /* ------------------------------------------------------------------ helpers */
  const swatchMap = () => { const m = {}; if (S.doc) S.doc.swatches.forEach((s) => { m[s.ref] = s; }); return m; };
  function hexOf(spec) {
    if (!spec) return null;
    if (spec[0] === '#') return spec;
    if (spec.startsWith('doc:')) {
      const ref = spec.slice(4), sw = swatchMap()[ref];
      if (sw) return sw.hex;
      return ref === 'Color/Paper' ? '#ffffff' : ref === 'Color/Black' ? '#000000' : '#888888';
    }
    return spec;
  }
  function status(msg, err) { const el = $('#status'); el.textContent = msg || ''; el.classList.toggle('err', !!err); }
  const fmtUnit = (pt, u) => (u === 'in' ? pt / 72 : u === 'mm' ? (pt * 25.4) / 72 : pt);
  const toPt = (v, u) => (u === 'in' ? v * 72 : u === 'mm' ? (v * 72) / 25.4 : v);
  const round2 = (v) => Math.round(v * 100) / 100;
  const baseName = () => (S.fileName || 'document').replace(/\.idml$/i, '');
  function download(blob, name) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
  }
  let raf = 0;
  const schedule = () => { cancelAnimationFrame(raf); raf = requestAnimationFrame(updateChartLayer); };

  /* ------------------------------------------------------------------ chart generation */
  function slotNames(data) {
    const t = S.type;
    if (t === 'waterfall') return ['Increase', 'Decrease', 'Total'];
    if (t === 'gauge') return [data.series[0] ? data.series[0].name : 'Value'];
    if (['pie', 'doughnut', 'radialBar', 'treemap', 'funnel'].includes(t)) return data.categories.slice(0, 16);
    return data.series.map((s) => s.name);
  }
  function currentColors(n) {
    const pal = Charts.PALETTES[S.palette] || Charts.PALETTES.press;
    return Array.from({ length: n }, (_, i) => S.overrides[i] || pal[i % pal.length]);
  }
  function chartOptions(data) {
    const slots = slotNames(data);
    return Object.assign({}, S.opts, {
      colors: currentColors(Math.max(slots.length, 3)),
      para: S.style.para || null, titlePara: S.style.titlePara || null,
      font: S.style.font ? JSON.parse(S.style.font) : null,
      textColor: S.style.textColor || null,
      size: +S.style.size || 8, titleSize: +S.style.titleSize || 14, pad: S.style.pad,
      hexOf,
    });
  }
  function currentChart() {
    const data = Charts.gridToData(S.grid);
    if (!S.area) return { prims: [], notes: [], data };
    const r = S.area.rect;
    const res = Charts.build(S.type, data, chartOptions(data), { x: r.x, y: r.y, w: r.w, h: r.h });
    return { prims: res.prims, notes: res.notes, data };
  }

  /* ------------------------------------------------------------------ file loading */
  async function openBuffer(buf, name) {
    try {
      status('');
      const doc = await IDML.load(buf, JSZip, { ignoreMargins: !$('#optMargins').checked });
      S.doc = doc; S.buf = buf; S.orig = buf.slice ? buf.slice(0) : buf; S.fileName = name;
      S.placed = []; S.hidden = new Set(); S.spreadIdx = 0; S.area = null;
      afterDocChange();
      autoPick();
      renderAll();
      renderSlots();
      const frames = doc.spreads.reduce((n, s) => n + s.frames.length, 0);
      status(frames ? 'Opened. Pick a frame on the page or from the list.' : 'Opened. No empty frames found, so pick free space or drag out an area on the page.');
    } catch (e) {
      const msg = /central directory|zip/i.test(String(e.message))
        ? "That doesn't look like an IDML file. InDesign (.indd) files can't be read in a browser: in InDesign choose File ▸ Export, set Format to InDesign Markup (IDML), and open that file."
        : 'Could not open that file. ' + e.message;
      status(msg, true);
      if (!S.doc) alert(msg);
    }
  }
  function afterDocChange() {
    const d = S.doc;
    $('#fileInfo').innerHTML = d ? '<b>' + esc(S.fileName) + '</b> · ' + d.spreads.length + ' spread' + (d.spreads.length > 1 ? 's' : '') + ' · ' + d.swatches.length + ' swatches' : 'No file open';
    $('#btnDownload').disabled = !d;
    $('#btnRevert').disabled = !d || !S.placed.length;
    fillDocSelects();
  }
  function fillDocSelects() {
    const d = S.doc;
    const opt = (v, t, sel) => '<option value="' + esc(v) + '"' + (sel ? ' selected' : '') + '>' + esc(t) + '</option>';
    const styles = d ? d.paraStyles : [];
    const styleOpts = (cur) => opt('', 'Basic paragraph (default)', !cur) + styles.filter((s) => !/Basic Paragraph/.test(s.name)).map((s) => opt(s.ref, s.name, s.ref === cur)).join('');
    $('#paraStyle').innerHTML = styleOpts(S.style.para);
    $('#titleStyle').innerHTML = styleOpts(S.style.titlePara);
    const fonts = d ? d.fonts : [];
    $('#fontSel').innerHTML = opt('', "Use the style's font", !S.style.font) +
      fonts.map((f) => { const v = JSON.stringify({ family: f.family, style: f.style }); return opt(v, f.family + ' ' + f.style, v === S.style.font); }).join('');
    const sw = d ? d.swatches.filter((s) => !/^(Paper)$/i.test(s.name) || true) : [];
    $('#textColor').innerHTML = opt('', "Use the style's color", !S.style.textColor) +
      sw.map((s) => opt('doc:' + s.ref, s.name, 'doc:' + s.ref === S.style.textColor)).join('');
    $('#layerSel').innerHTML = (d ? d.layers : []).map((l) => opt(l.id, l.name, false)).join('') || opt('', '(default layer)', true);
  }

  /* ------------------------------------------------------------------ areas */
  function allFrames() {
    const out = [];
    if (!S.doc) return out;
    S.doc.spreads.forEach((sp) => sp.frames.forEach((f) => out.push({ spread: sp.index, frame: f })));
    return out;
  }
  function areaFromFrame(spreadIdx, f) {
    return { spread: spreadIdx, rect: { x: f.rect.x1, y: f.rect.y1, w: f.rect.x2 - f.rect.x1, h: f.rect.y2 - f.rect.y1 }, frame: { id: f.id, tag: f.tag, kind: f.kind, layer: f.layer }, label: f.title };
  }
  function areaFromVoid(spreadIdx, v) {
    return { spread: spreadIdx, rect: { x: v.rect.x1, y: v.rect.y1, w: v.rect.x2 - v.rect.x1, h: v.rect.y2 - v.rect.y1 }, frame: null, label: v.title };
  }
  function autoPick() {
    const fr = allFrames();
    const pick = fr.find((f) => f.frame.kind === 'named') || fr[0];
    if (pick) { S.spreadIdx = pick.spread; S.area = areaFromFrame(pick.spread, pick.frame); return; }
    for (const sp of S.doc.spreads) if (sp.voids.length) { S.spreadIdx = sp.index; S.area = areaFromVoid(sp.index, sp.voids[0]); return; }
  }
  function syncPlaceControls() {
    const a = S.area;
    const hasFrame = !!(a && a.frame && a.frame.tag === 'Rectangle');
    $('#optRemove').disabled = !hasFrame;
    if (a && a.frame && a.frame.layer && S.doc && S.doc.layers.some((l) => l.id === a.frame.layer)) $('#layerSel').value = a.frame.layer;
  }
  function setArea(a) {
    S.area = a; S.spreadIdx = a.spread;
    renderAreaPanel(); renderStage(); updateStageFoot(); syncPlaceControls();
  }
  const sameArea = (a, b) => a && b && a.spread === b.spread && ((a.frame && b.frame && a.frame.id === b.frame.id) || (!a.frame && !b.frame && a.label === b.label && Math.abs(a.rect.x - b.rect.x) < 0.01 && Math.abs(a.rect.y - b.rect.y) < 0.01));

  function renderAreaPanel() {
    const list = $('#areaList');
    if (!S.doc) { list.innerHTML = ''; $('#xywh').hidden = true; return; }
    const u = $('#unitSel').value;
    const dim = (r) => round2(fmtUnit(r.w, u)) + ' × ' + round2(fmtUnit(r.h, u)) + ' ' + u;
    const items = [];
    const frames = allFrames();
    const multi = S.doc.spreads.length > 1;
    const named = frames.filter((f) => f.frame.kind === 'named'), empty = frames.filter((f) => f.frame.kind !== 'named');
    const mk = (a, free) => ({ a, free });
    const group = (title, arr) => { if (arr.length) items.push({ h: title }); arr.forEach((x) => items.push(x)); };
    group('Named frames', named.map((f) => mk(areaFromFrame(f.spread, f.frame))));
    group('Empty frames', empty.map((f) => mk(areaFromFrame(f.spread, f.frame))));
    if ($('#optFree').checked) group('Free space on this spread', S.doc.spreads[S.spreadIdx].voids.map((v) => mk(areaFromVoid(S.spreadIdx, v), true)));
    if (S.area && !S.area.frame && !/^Free space/.test(S.area.label || '')) { items.push({ h: 'Your area' }); items.push(mk(S.area, true)); }
    list.innerHTML = '';
    if (!items.length) list.innerHTML = '<p class="hint">Nothing was found automatically. Drag on a page to draw an area.</p>';
    items.forEach((it) => {
      if (it.h) { const h = document.createElement('h3'); h.textContent = it.h; list.appendChild(h); return; }
      const b = document.createElement('button');
      b.type = 'button'; b.className = 'areabtn' + (it.free ? ' free' : '');
      b.setAttribute('aria-pressed', sameArea(S.area, it.a) ? 'true' : 'false');
      const pageNote = multi && it.a.frame ? ' · spread ' + (it.a.spread + 1) : '';
      b.innerHTML = '<span>' + esc(it.a.label || 'Area') + esc(pageNote) + '</span><span>' + dim(it.a.rect) + '</span>';
      b.addEventListener('click', () => setArea(it.a));
      list.appendChild(b);
    });
    const box = $('#xywh');
    box.hidden = !S.area;
    if (S.area) {
      const r = S.area.rect;
      $$('input', box).forEach((i) => { i.value = round2(fmtUnit(r[i.dataset.k], u)); });
    }
    $('#areaHint').textContent = S.area ? 'Click a highlighted frame on the page, pick one below, or drag out your own area.' : 'Click a highlighted frame on the page, pick one below, or drag out your own area.';
  }

  /* ------------------------------------------------------------------ stage */
  const stage = () => $('#stage');
  function spreadBounds(sp) {
    let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
    sp.pages.forEach((p) => { x1 = Math.min(x1, p.rect.x1); y1 = Math.min(y1, p.rect.y1); x2 = Math.max(x2, p.rect.x2); y2 = Math.max(y2, p.rect.y2); });
    return { x1, y1, x2, y2 };
  }
  function renderTabs() {
    const tabs = $('#spreadTabs');
    tabs.innerHTML = '';
    S.doc.spreads.forEach((sp) => {
      const b = document.createElement('button');
      b.type = 'button'; b.setAttribute('role', 'tab'); b.setAttribute('aria-selected', sp.index === S.spreadIdx ? 'true' : 'false');
      const names = sp.pages.map((p) => p.name);
      b.textContent = 'Page' + (names.length > 1 ? 's ' : ' ') + (names.length > 1 ? names[0] + '–' + names[names.length - 1] : names[0]);
      b.addEventListener('click', () => { S.spreadIdx = sp.index; if (S.area && S.area.spread !== sp.index) S.area = null; renderAll(); });
      tabs.appendChild(b);
    });
  }
  function renderStage() {
    const st = stage();
    if (!S.doc) { return; }
    $('#stageBar').hidden = false;
    renderTabs();
    const sp = S.doc.spreads[S.spreadIdx];
    const bb = spreadBounds(sp), m = 36;
    const vw = bb.x2 - bb.x1 + m * 2, vh = bb.y2 - bb.y1 + m * 2;
    const tagSize = Math.max(7, vw / 85);
    let s = '<svg id="svg" xmlns="' + NS + '" viewBox="' + (bb.x1 - m) + ' ' + (bb.y1 - m) + ' ' + vw + ' ' + vh + '" style="width:' + S.zoom * 100 + '%" role="img" aria-label="Page preview">';
    s += '<defs><pattern id="hatch" width="4" height="4" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><line x1="0" y1="0" x2="0" y2="4" stroke="#b4bfc8" stroke-width="0.7"/></pattern></defs>';
    sp.pages.forEach((p) => {
      const r = p.rect, mg = p.margins;
      s += '<rect x="' + (r.x1 + 3) + '" y="' + (r.y1 + 3) + '" width="' + (r.x2 - r.x1) + '" height="' + (r.y2 - r.y1) + '" fill="#000" opacity="0.18"/>';
      s += '<rect x="' + r.x1 + '" y="' + r.y1 + '" width="' + (r.x2 - r.x1) + '" height="' + (r.y2 - r.y1) + '" fill="#fff"/>';
      s += '<rect x="' + (r.x1 + mg.left) + '" y="' + (r.y1 + mg.top) + '" width="' + (r.x2 - r.x1 - mg.left - mg.right) + '" height="' + (r.y2 - r.y1 - mg.top - mg.bottom) + '" fill="none" stroke="#d6006e" stroke-width="0.75" stroke-dasharray="4 3" opacity="0.7" vector-effect="non-scaling-stroke"/>';
      s += '<text x="' + r.x1 + '" y="' + (r.y2 + tagSize * 1.6) + '" font-size="' + tagSize + '" fill="#3a4852" font-family="Hanken Grotesk, system-ui, sans-serif">' + esc(p.name) + '</text>';
    });
    const sm = swatchMap();
    sp.items.forEach((it) => {
      if (S.hidden.has(it.id) || it.kind) return;
      const r = it.rect, w = r.x2 - r.x1, h = r.y2 - r.y1;
      const base = 'x="' + r.x1 + '" y="' + r.y1 + '" width="' + w + '" height="' + h + '"';
      if (it.tag === 'TextFrame') s += '<rect ' + base + ' fill="url(#hatch)" stroke="#b4bfc8" stroke-width="0.5" vector-effect="non-scaling-stroke"/>';
      else if (it.hasContent) s += '<rect ' + base + ' fill="#e1ebf3" stroke="#9db0c0" stroke-width="0.5" vector-effect="non-scaling-stroke"/><path d="M' + r.x1 + ' ' + r.y1 + 'L' + r.x2 + ' ' + r.y2 + 'M' + r.x2 + ' ' + r.y1 + 'L' + r.x1 + ' ' + r.y2 + '" stroke="#9db0c0" stroke-width="0.5" vector-effect="non-scaling-stroke"/>';
      else if (it.fill && !/Swatch\/None/.test(it.fill) && sm[it.fill]) s += '<rect ' + base + ' fill="' + sm[it.fill].hex + '"/>';
      else if (it.tag !== 'GraphicLine') s += '<rect ' + base + ' fill="none" stroke="#c3ccd3" stroke-width="0.5" vector-effect="non-scaling-stroke"/>';
    });
    // charts placed in this session, drawn from their primitives
    S.placed.filter((p) => p.spread === S.spreadIdx).forEach((p) => { s += '<g>' + Render.primsToSvg(p.prims, hexOf) + '</g>'; });
    // candidates
    const cand = [];
    sp.frames.forEach((f) => cand.push({ a: areaFromFrame(sp.index, f), free: false, r: f.rect }));
    if ($('#optFree').checked) sp.voids.forEach((v) => cand.push({ a: areaFromVoid(sp.index, v), free: true, r: v.rect }));
    cand.forEach((c, i) => {
      const r = c.r, w = r.x2 - r.x1, h = r.y2 - r.y1, sel = sameArea(S.area, c.a);
      if (sel) return;
      s += '<g data-cand="' + i + '" tabindex="0" role="button" aria-label="' + esc(c.a.label) + '"><rect class="cand-box" x="' + r.x1 + '" y="' + r.y1 + '" width="' + w + '" height="' + h + '" fill="rgba(0,137,168,0.07)" stroke="#0089a8" stroke-width="1" ' + (c.free ? 'stroke-dasharray="2 3"' : 'stroke-dasharray="5 3"') + ' vector-effect="non-scaling-stroke"/>' +
        '<text x="' + (r.x1 + 4) + '" y="' + (r.y1 + tagSize * 1.25) + '" font-size="' + tagSize + '" fill="#006a84" font-family="Hanken Grotesk, system-ui, sans-serif" font-weight="600">' + esc(c.a.label) + '</text></g>';
    });
    s += '<g id="chartLayer"></g></svg>';
    st.innerHTML = s;
    st._cand = cand;
    st.querySelectorAll('[data-cand]').forEach((g) => g.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setArea(st._cand[+g.dataset.cand].a); } }));
    updateChartLayer();
  }
  function renderEmptyPreview() {
    const box = $('#emptyPreview');
    if (!box) return;
    const data = Charts.gridToData(S.grid);
    const res = Charts.build(S.type, data, chartOptions(data), { x: 0, y: 0, w: 560, h: 320 });
    box.innerHTML = '<svg viewBox="0 0 560 320" role="img" aria-label="Chart preview" style="display:block;width:100%">' + Render.primsToSvg(res.prims, hexOf) + '</svg><p class="hint" style="padding:0 14px 12px">Preview with your data. Open an IDML file to place it on a page.</p>';
  }
  function updateChartLayer() {
    const layer = $('#chartLayer');
    const place = $('#btnPlace');
    const dd = Charts.gridToData(S.grid);
    $('#dataMeta').textContent = dd.categories.length + ' categories × ' + dd.series.length + ' series';
    if (!S.doc) renderEmptyPreview();
    if (!S.area || !S.doc) { if (layer) layer.innerHTML = ''; place.disabled = true; return; }
    const res = currentChart();
    const r = S.area.rect;
    if (layer) {
      layer.innerHTML = '<rect x="' + r.x + '" y="' + r.y + '" width="' + r.w + '" height="' + r.h + '" fill="#fff" fill-opacity="0.92"/>' +
        Render.primsToSvg(res.prims, hexOf) +
        '<rect x="' + r.x + '" y="' + r.y + '" width="' + r.w + '" height="' + r.h + '" fill="none" stroke="#d6006e" stroke-width="1.5" vector-effect="non-scaling-stroke"/>' +
        (res.notes.length ? '<text x="' + (r.x + r.w / 2) + '" y="' + (r.y + r.h / 2) + '" text-anchor="middle" font-size="9" fill="#55656f" font-family="Hanken Grotesk, system-ui, sans-serif">' + esc(res.notes[0]) + '</text>' : '');
    }
    place.disabled = !res.prims.length;
    updateStageFoot();
  }
  function updateStageFoot() {
    const f = $('#stageFoot');
    f.hidden = !S.doc;
    if (!S.doc) return;
    if (!S.area) { f.textContent = 'No area selected'; return; }
    const r = S.area.rect;
    f.textContent = (S.area.label || 'Your area') + ' · ' + round2(r.w) + ' × ' + round2(r.h) + ' pt · ' + round2(r.w / 72) + ' × ' + round2(r.h / 72) + ' in · ' + round2((r.w * 25.4) / 72) + ' × ' + round2((r.h * 25.4) / 72) + ' mm';
  }

  /* drag to draw, click to pick */
  function stagePoint(ev) {
    const svg = $('#svg'); if (!svg) return null;
    const p = svg.createSVGPoint(); p.x = ev.clientX; p.y = ev.clientY;
    const q = p.matrixTransform(svg.getScreenCTM().inverse());
    return { x: q.x, y: q.y };
  }
  function initStageEvents() {
    const st = stage();
    let down = null, draft = null;
    st.addEventListener('pointerdown', (e) => {
      if (!S.doc || e.button !== 0 || !e.target.closest('svg')) return;
      down = { x: e.clientX, y: e.clientY, p: stagePoint(e), cand: e.target.closest('[data-cand]'), moved: false };
      st.setPointerCapture(e.pointerId);
    });
    st.addEventListener('pointermove', (e) => {
      if (!down) return;
      if (!down.moved && Math.hypot(e.clientX - down.x, e.clientY - down.y) < 5) return;
      down.moved = true;
      const svg = $('#svg'); svg.classList.add('drawing');
      const p = stagePoint(e), a = down.p;
      if (!draft) { draft = document.createElementNS(NS, 'rect'); draft.setAttribute('fill', 'rgba(214,0,110,0.1)'); draft.setAttribute('stroke', '#d6006e'); draft.setAttribute('stroke-width', '1.5'); draft.setAttribute('vector-effect', 'non-scaling-stroke'); svg.appendChild(draft); }
      draft.setAttribute('x', Math.min(a.x, p.x)); draft.setAttribute('y', Math.min(a.y, p.y));
      draft.setAttribute('width', Math.abs(p.x - a.x)); draft.setAttribute('height', Math.abs(p.y - a.y));
    });
    const end = (e) => {
      if (!down) return;
      const d = down; down = null;
      const svg = $('#svg'); if (svg) svg.classList.remove('drawing');
      if (draft) { draft.remove(); draft = null; }
      if (d.moved) {
        const p = stagePoint(e), a = d.p;
        const r = { x: Math.min(a.x, p.x), y: Math.min(a.y, p.y), w: Math.abs(p.x - a.x), h: Math.abs(p.y - a.y) };
        if (r.w >= 24 && r.h >= 24) setArea({ spread: S.spreadIdx, rect: { x: round2(r.x), y: round2(r.y), w: round2(r.w), h: round2(r.h) }, frame: null, label: 'Your area' });
      } else if (d.cand) {
        setArea(st._cand[+d.cand.dataset.cand].a);
      }
    };
    st.addEventListener('pointerup', end);
    st.addEventListener('pointercancel', () => { down = null; if (draft) { draft.remove(); draft = null; } });
  }

  /* ------------------------------------------------------------------ data grid */
  function renderGrid() {
    const t = $('#grid');
    t.innerHTML = S.grid.map((row, r) => '<tr>' + row.map((v, c) => '<td><input type="text" data-r="' + r + '" data-c="' + c + '" value="' + esc(v) + '" aria-label="' + (r === 0 ? (c === 0 ? 'Corner' : 'Series name ' + c) : c === 0 ? 'Category ' + r : 'Row ' + r + ' column ' + c) + '"></td>').join('') + '</tr>').join('');
  }
  function normalizeGrid(rows) {
    const w = Math.max(2, ...rows.map((r) => r.length));
    const g = rows.map((r) => Array.from({ length: w }, (_, i) => (r[i] == null ? '' : String(r[i]))));
    while (g.length < 2) g.push(new Array(w).fill(''));
    return g;
  }
  function setGrid(rows) { S.grid = normalizeGrid(rows); renderGrid(); renderSlots(); schedule(); }
  function initGrid() {
    const t = $('#grid');
    t.addEventListener('input', (e) => { const i = e.target; if (!i.matches('input')) return; S.grid[+i.dataset.r][+i.dataset.c] = i.value; renderSlots(); schedule(); });
    t.addEventListener('paste', (e) => {
      const i = e.target; if (!i.matches('input')) return;
      const txt = (e.clipboardData || window.clipboardData).getData('text');
      if (!/[\t\n\r]/.test(txt.trim())) return;
      e.preventDefault();
      const rows = Charts.parseDelimited(txt.replace(/\r?\n$/, ''));
      const r0 = +i.dataset.r, c0 = +i.dataset.c;
      if (r0 === 0 && c0 === 0) { setGrid(rows.map((r) => r.map((v) => v.trim()))); return; } // pasting at the corner replaces the table
      rows.forEach((row, dr) => row.forEach((v, dc) => {
        const r = r0 + dr, c = c0 + dc;
        while (S.grid.length <= r) S.grid.push(new Array(S.grid[0].length).fill(''));
        while (S.grid[0].length <= c) S.grid.forEach((x) => x.push(''));
        S.grid[r][c] = v.trim();
      }));
      S.grid = normalizeGrid(S.grid); renderGrid(); renderSlots(); schedule();
    });
    t.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter' || !e.target.matches('input')) return;
      e.preventDefault();
      const n = $('input[data-r="' + (+e.target.dataset.r + (e.shiftKey ? -1 : 1)) + '"][data-c="' + e.target.dataset.c + '"]', t);
      if (n) { n.focus(); n.select(); }
    });
    $$('[data-act]').forEach((b) => b.addEventListener('click', () => {
      const a = b.dataset.act, g = S.grid;
      if (a === 'addRow') g.push(new Array(g[0].length).fill(''));
      else if (a === 'addCol') g.forEach((r) => r.push(''));
      else if (a === 'delRow' && g.length > 2) g.pop();
      else if (a === 'delCol' && g[0].length > 2) g.forEach((r) => r.pop());
      else if (a === 'transpose') S.grid = g[0].map((_, c) => g.map((r) => r[c]));
      else if (a === 'example') S.grid = EXAMPLE.map((r) => r.slice());
      renderGrid(); renderSlots(); schedule();
    }));
    $('#btnImport').addEventListener('click', () => $('#fileData').click());
    $('#fileData').addEventListener('change', async (e) => {
      const f = e.target.files[0]; e.target.value = '';
      if (!f) return;
      try {
        if (/\.xlsx?$/i.test(f.name)) {
          const wb = XLSX.read(await f.arrayBuffer(), { type: 'array' });
          S.workbook = wb;
          const sel = $('#sheetSel');
          sel.hidden = wb.SheetNames.length < 2;
          sel.innerHTML = wb.SheetNames.map((n, i) => '<option value="' + i + '">' + esc(n) + '</option>').join('');
          loadSheet(0);
        } else {
          $('#sheetSel').hidden = true;
          setGrid(Charts.parseDelimited(await f.text()));
        }
      } catch (err) { status('Could not read that data file. ' + err.message, true); }
    });
    $('#sheetSel').addEventListener('change', (e) => loadSheet(+e.target.value));
  }
  function loadSheet(i) {
    const ws = S.workbook.Sheets[S.workbook.SheetNames[i]];
    const rows = XLSX.utils.sheet_to_json(ws, { header: 1, raw: false, defval: '' });
    setGrid(rows.filter((r) => r.some((c) => String(c).trim() !== '')));
  }

  /* ------------------------------------------------------------------ chart options UI */
  const BARS = ['bar', 'barH', 'stacked', 'stackedH', 'waterfall', 'combo'];
  const CART = ['bar', 'barH', 'stacked', 'stackedH', 'waterfall', 'line', 'area', 'combo'];
  const OPTS = [
    { k: 'title', label: 'Title', kind: 'text', wide: true },
    { k: 'note', label: 'Note or source line', kind: 'text', wide: true },
    { k: 'legend', label: 'Legend', kind: 'select', choices: [['bottom', 'Bottom'], ['top', 'Top'], ['right', 'Right'], ['left', 'Left'], ['none', 'Hidden']], not: ['gauge', 'treemap', 'funnel', 'radialBar'] },
    { k: 'values', label: 'Value labels', kind: 'check' },
    { k: 'grid', label: 'Gridlines', kind: 'check', only: [...CART, 'radar'] },
    { k: 'percent', label: 'Show as 100%', kind: 'check', only: ['stacked', 'stackedH'] },
    { k: 'totals', label: 'Show totals', kind: 'check', only: ['stacked', 'stackedH'] },
    { k: 'secondary', label: 'Lines on a second axis', kind: 'check', only: ['combo'] },
    { k: 'waterfallTotal', label: 'Add a total bar', kind: 'check', only: ['waterfall'] },
    { k: 'semi', label: 'Half circle', kind: 'check', only: ['pie', 'doughnut'] },
    { k: 'pieLabels', label: 'Slice labels', kind: 'select', choices: [['percent', 'Percent'], ['value', 'Value'], ['both', 'Value and percent'], ['name', 'Name'], ['none', 'None']], only: ['pie', 'doughnut'] },
    { k: 'centerText', label: 'Text in the hole', kind: 'text', only: ['doughnut'] },
    { k: 'startAngle', label: 'Start angle (°)', kind: 'number', only: ['pie', 'doughnut'] },
    { k: 'inner', label: 'Hole size', kind: 'range', min: 0.2, max: 0.85, step: 0.01, only: ['doughnut', 'gauge'] },
    { k: 'gap', label: 'Space between bars', kind: 'range', min: 0, max: 0.8, step: 0.01, only: BARS },
    { k: 'lineWeight', label: 'Line weight (pt)', kind: 'number', step: 0.25, only: ['line', 'area', 'combo', 'radar'] },
    { k: 'marker', label: 'Marker radius (pt)', kind: 'number', step: 0.5, only: ['line', 'area', 'combo', 'radar'] },
    { k: 'yMin', label: 'Axis minimum', kind: 'text', placeholder: 'auto', only: CART },
    { k: 'yMax', label: 'Axis maximum', kind: 'text', placeholder: 'auto', only: [...CART, 'radar', 'radialBar'] },
    { k: 'gaugeMax', label: 'Goal value', kind: 'number', only: ['gauge'] },
    { k: 'decimals', label: 'Decimals', kind: 'number', min: 0, max: 6, step: 1 },
    { k: 'prefix', label: 'Prefix', kind: 'text', placeholder: '$' },
    { k: 'suffix', label: 'Suffix', kind: 'text', placeholder: '%' },
    { k: 'thousands', label: 'Thousands separator', kind: 'check' },
  ];
  function renderOptions() {
    const box = $('#options');
    box.innerHTML = '';
    OPTS.forEach((o) => {
      if (o.only && !o.only.includes(S.type)) return;
      if (o.not && o.not.includes(S.type)) return;
      const id = 'o_' + o.k;
      const wrap = document.createElement('label');
      if (o.wide) wrap.className = 'wide';
      let inner = '';
      const v = S.opts[o.k];
      if (o.kind === 'check') { wrap.className = 'check' + (o.wide ? ' wide' : ''); inner = '<input type="checkbox" id="' + id + '"' + (v ? ' checked' : '') + '> ' + esc(o.label); }
      else if (o.kind === 'select') inner = esc(o.label) + '<select id="' + id + '">' + o.choices.map((c) => '<option value="' + c[0] + '"' + (c[0] === v ? ' selected' : '') + '>' + esc(c[1]) + '</option>').join('') + '</select>';
      else if (o.kind === 'range') inner = esc(o.label) + '<input type="range" id="' + id + '" min="' + o.min + '" max="' + o.max + '" step="' + o.step + '" value="' + v + '">';
      else inner = esc(o.label) + '<input type="' + (o.kind === 'number' ? 'number' : 'text') + '" id="' + id + '" value="' + esc(v) + '"' + (o.step ? ' step="' + o.step + '"' : '') + (o.min != null ? ' min="' + o.min + '"' : '') + (o.max != null ? ' max="' + o.max + '"' : '') + (o.placeholder ? ' placeholder="' + esc(o.placeholder) + '"' : '') + '>';
      wrap.innerHTML = inner;
      box.appendChild(wrap);
      const el = $('#' + id, wrap);
      el.addEventListener('input', () => {
        S.opts[o.k] = o.kind === 'check' ? el.checked : o.kind === 'number' || o.kind === 'range' ? (el.value === '' ? '' : +el.value) : el.value;
        if (o.k === 'legend' || o.k === 'values') renderSlots();
        schedule();
      });
    });
  }
  function renderGallery() {
    const g = $('#typeGallery');
    g.innerHTML = '';
    const sample = Charts.gridToData(EXAMPLE);
    let last = '';
    Charts.TYPES.forEach((t) => {
      if (t.group !== last) { const h = document.createElement('h3'); h.textContent = t.group; g.appendChild(h); last = t.group; }
      const res = Charts.build(t.id, sample, { bare: true, legend: 'none', values: false, grid: false, size: 4, pad: 4, marker: 1.6, lineWeight: 1, hexOf: (c) => c, totals: false, secondary: false, semi: false }, { x: 0, y: 0, w: 120, h: 80 });
      const b = document.createElement('button');
      b.type = 'button'; b.className = 'tbtn'; b.setAttribute('role', 'radio'); b.setAttribute('aria-checked', t.id === S.type ? 'true' : 'false'); b.dataset.type = t.id;
      b.innerHTML = '<svg viewBox="0 0 120 80" aria-hidden="true">' + Render.primsToSvg(res.prims, (c) => (c.startsWith('doc:') ? '#9aa8b3' : c)) + '</svg><span>' + esc(t.name) + '</span>';
      b.addEventListener('click', () => { S.type = t.id; $$('.tbtn', g).forEach((x) => x.setAttribute('aria-checked', x.dataset.type === S.type ? 'true' : 'false')); renderOptions(); renderSlots(); schedule(); });
      g.appendChild(b);
    });
  }

  /* ------------------------------------------------------------------ colours */
  function renderSlots() {
    const data = Charts.gridToData(S.grid);
    const names = slotNames(data);
    const colors = currentColors(names.length);
    const box = $('#slots');
    const sw = S.doc ? S.doc.swatches.filter((s) => !/^(Paper|Black)$/i.test(s.name)) : [];
    box.innerHTML = '';
    names.forEach((n, i) => {
      const row = document.createElement('div');
      row.className = 'slot';
      const spec = colors[i], isDoc = spec.startsWith('doc:');
      row.innerHTML = '<input type="color" aria-label="Color for ' + esc(n) + '" value="' + (isDoc ? hexOf(spec) : spec) + '"><span class="nm" title="' + esc(n) + '">' + esc(n) + '</span>' +
        '<select aria-label="Document swatch for ' + esc(n) + '"><option value="">Custom color</option>' + sw.map((s) => '<option value="' + esc(s.ref) + '"' + (isDoc && spec === 'doc:' + s.ref ? ' selected' : '') + '>' + esc(s.name) + '</option>').join('') + '</select>';
      $('input', row).addEventListener('input', (e) => { S.overrides[i] = e.target.value; $('select', row).value = ''; schedule(); });
      $('select', row).addEventListener('change', (e) => {
        if (e.target.value) { S.overrides[i] = 'doc:' + e.target.value; $('input', row).value = hexOf(S.overrides[i]); }
        else { S.overrides[i] = $('input', row).value; }
        schedule();
      });
      box.appendChild(row);
    });
  }
  function initStyle() {
    const pal = $('#palette');
    pal.innerHTML = Object.keys(Charts.PALETTES).map((k) => '<option value="' + k + '">' + ({ press: 'Press', cool: 'Cool', warm: 'Warm', earth: 'Earth', mono: 'Blue ramp', vivid: 'Vivid' }[k]) + '</option>').join('');
    pal.addEventListener('change', () => { S.palette = pal.value; S.overrides = {}; renderSlots(); schedule(); });
    const bind = (id, key, num) => $('#' + id).addEventListener('input', (e) => { S.style[key] = num ? +e.target.value : e.target.value; schedule(); });
    bind('paraStyle', 'para'); bind('titleStyle', 'titlePara'); bind('fontSel', 'font'); bind('textColor', 'textColor');
    bind('sizeLabel', 'size', true); bind('sizeTitle', 'titleSize', true); bind('padding', 'pad', true); bind('colorSpace', 'colorSpace');
  }

  /* ------------------------------------------------------------------ place / export / settings */
  async function place() {
    if (!S.doc || !S.area) return;
    const res = currentChart();
    if (!res.prims.length) return;
    const btn = $('#btnPlace'); btn.disabled = true; status('Writing chart objects…');
    try {
      const before = new Set(S.doc.spreads.flatMap((s) => s.items.map((i) => i.id)));
      const typeName = Charts.TYPES.find((t) => t.id === S.type).name;
      const frame = S.area.frame;
      const out = await IDML.addChart(S.doc, S.area.spread, res.prims, {
        name: 'Chart: ' + (S.opts.title || typeName),
        removeFrame: $('#optRemove').checked && frame && frame.tag === 'Rectangle' ? frame : null,
        layer: $('#layerSel').value || (frame && frame.layer) || '',
        colorSpace: S.style.colorSpace,
      });
      const spreadIdx = S.area.spread, rect = S.area.rect;
      const prevAreaLabel = S.area.label;
      out.doc.spreads.forEach((sp) => sp.items.forEach((i) => { if (!before.has(i.id) && sp.index === spreadIdx) S.hidden.add(i.id); }));
      S.placed.push({ spread: spreadIdx, prims: res.prims });
      S.doc = out.doc; S.buf = out.buffer;
      S.area = { spread: spreadIdx, rect, frame: null, label: 'Your area' };
      afterDocChange();
      renderAll();
      status('Placed ' + (S.opts.title || typeName.toLowerCase() + ' chart') + ' on ' + (prevAreaLabel || 'the page') + '. ' + S.placed.length + ' chart' + (S.placed.length > 1 ? 's' : '') + ' added so far. Download the IDML when you are done.');
    } catch (e) {
      console.error(e); status('Could not place the chart: ' + e.message, true);
    }
    btn.disabled = false;
  }
  function settingsObject() {
    return { app: 'frameplot', v: 1, type: S.type, opts: S.opts, grid: S.grid, palette: S.palette, overrides: S.overrides, style: S.style };
  }
  function applySettings(o) {
    if (!o || o.app !== 'frameplot') throw new Error('Not a Frameplot settings file.');
    S.type = o.type in Object.fromEntries(Charts.TYPES.map((t) => [t.id, 1])) ? o.type : 'bar';
    Object.assign(S.opts, o.opts || {}); S.grid = normalizeGrid(o.grid || EXAMPLE);
    S.palette = Charts.PALETTES[o.palette] ? o.palette : 'press'; S.overrides = o.overrides || {};
    Object.assign(S.style, o.style || {});
    $('#palette').value = S.palette; $('#sizeLabel').value = S.style.size; $('#sizeTitle').value = S.style.titleSize; $('#padding').value = S.style.pad; $('#colorSpace').value = S.style.colorSpace;
    renderGrid(); renderGallery(); renderOptions(); fillDocSelects(); renderSlots(); schedule();
  }
  function initActions() {
    $('#btnOpen').addEventListener('click', () => $('#fileIdml').click());
    $('#btnOpen2').addEventListener('click', () => $('#fileIdml').click());
    $('#fileIdml').addEventListener('change', async (e) => { const f = e.target.files[0]; e.target.value = ''; if (f) openBuffer(await f.arrayBuffer(), f.name); });
    $('#btnSample').addEventListener('click', async () => {
      try { const r = await fetch('sample/sample.idml'); if (!r.ok) throw new Error(r.status); openBuffer(await r.arrayBuffer(), 'sample.idml'); }
      catch (e) { alert('The sample file can only load when the app is served from a web address (GitHub Pages or a local server), not from a file on disk.'); }
    });
    $('#btnPlace').addEventListener('click', place);
    $('#btnDownload').addEventListener('click', () => { if (S.buf) download(new Blob([S.buf], { type: 'application/vnd.adobe.indesign-idml-package' }), baseName() + (S.placed.length ? '-charts' : '') + '.idml'); });
    $('#btnRevert').addEventListener('click', () => { if (S.orig && confirm('Remove all charts placed in this session and go back to the file as you opened it?')) openBuffer(S.orig.slice(0), S.fileName); });
    $('#btnSvg').addEventListener('click', () => {
      const res = currentChart();
      if (!res.prims.length) { status('Pick an area first.', true); return; }
      const r = S.area.rect;
      const svg = '<svg xmlns="' + NS + '" viewBox="' + r.x + ' ' + r.y + ' ' + r.w + ' ' + r.h + '" width="' + r.w + '" height="' + r.h + '">' + Render.primsToSvg(res.prims, hexOf) + '</svg>';
      download(new Blob([svg], { type: 'image/svg+xml' }), (S.opts.title || S.type).replace(/[^\w-]+/g, '-') + '.svg');
    });
    $('#btnSave').addEventListener('click', () => download(new Blob([JSON.stringify(settingsObject(), null, 2)], { type: 'application/json' }), (S.opts.title || 'chart').replace(/[^\w-]+/g, '-') + '.frameplot.json'));
    $('#btnLoad').addEventListener('click', () => $('#fileSettings').click());
    $('#fileSettings').addEventListener('change', async (e) => { const f = e.target.files[0]; e.target.value = ''; if (!f) return; try { applySettings(JSON.parse(await f.text())); status('Settings loaded.'); } catch (err) { status(err.message, true); } });
    $('#unitSel').addEventListener('change', renderAreaPanel);
    $('#optFree').addEventListener('change', () => { renderAreaPanel(); renderStage(); });
    $('#optMargins').addEventListener('change', async () => { if (S.buf) { const keep = S.placed.slice(), hid = new Set(S.hidden), area = S.area; S.doc = await IDML.load(S.buf, JSZip, { ignoreMargins: !$('#optMargins').checked }); S.placed = keep; S.hidden = hid; S.area = area; renderAll(); } });
    $$('#xywh input').forEach((i) => i.addEventListener('change', () => {
      if (!S.area) return;
      const u = $('#unitSel').value, v = toPt(+i.value, u);
      if (!isFinite(v) || ((i.dataset.k === 'w' || i.dataset.k === 'h') && v < 12)) { renderAreaPanel(); return; }
      S.area = { spread: S.area.spread, rect: Object.assign({}, S.area.rect, { [i.dataset.k]: round2(v) }), frame: null, label: 'Your area' };
      renderAreaPanel(); renderStage();
    }));
    $('#zIn').addEventListener('click', () => { S.zoom = Math.min(5, S.zoom * 1.25); renderStage(); });
    $('#zOut').addEventListener('click', () => { S.zoom = Math.max(0.4, S.zoom / 1.25); renderStage(); });
    $('#zFit').addEventListener('click', () => { S.zoom = 1; renderStage(); });
    // drag a file anywhere
    const drop = $('#drop');
    ['dragenter', 'dragover'].forEach((ev) => window.addEventListener(ev, (e) => { e.preventDefault(); if (drop) drop.classList.add('over'); }));
    ['dragleave', 'drop'].forEach((ev) => window.addEventListener(ev, (e) => { e.preventDefault(); if (drop) drop.classList.remove('over'); }));
    window.addEventListener('drop', async (e) => {
      const f = e.dataTransfer && e.dataTransfer.files[0];
      if (!f) return;
      if (/\.(csv|tsv|txt)$/i.test(f.name)) setGrid(Charts.parseDelimited(await f.text()));
      else openBuffer(await f.arrayBuffer(), f.name);
    });
  }

  function renderAll() {
    renderAreaPanel();
    if (S.doc) renderStage();
    updateStageFoot();
    syncPlaceControls();
    $('#btnRevert').disabled = !S.doc || !S.placed.length;
  }

  /* ------------------------------------------------------------------ boot */
  initGrid(); initStyle(); initActions(); initStageEvents();
  renderGrid(); renderGallery(); renderOptions(); renderSlots(); fillDocSelects(); schedule();
  window.__frameplot = S; // handy for debugging in the console
})();
