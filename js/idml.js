/*
 * idml.js — read an IDML package, find places a chart can go, and write native
 * InDesign objects (rectangles, polygons, lines, text frames + stories) back in.
 * Works in the browser and in Node (pass a DOMParser-capable global).
 *
 * All coordinates are IDML points, in spread space.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.IDML = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const ITEM_TAGS = new Set(['Rectangle', 'Oval', 'Polygon', 'GraphicLine', 'TextFrame', 'Group',
    'Button', 'FormField', 'MultiStateObject']);
  const CONTENT_TAGS = new Set(['Image', 'PDF', 'EPS', 'ImportedPage', 'WMF', 'PICT', 'SVG']);

  /* ---------- small helpers ---------- */
  const r4 = (v) => Math.round(v * 1e4) / 1e4;
  const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const attr = (el, n) => el.getAttribute(n);

  function parseXml(str) {
    const d = new DOMParser().parseFromString(str, 'text/xml');
    if (d.getElementsByTagName('parsererror').length) throw new Error('Could not parse an XML part of this file.');
    return d;
  }
  const kids = (el, tag) => Array.from(el.children).filter((c) => c.tagName === tag);
  const firstKid = (el, tag) => kids(el, tag)[0] || null;

  /* ---------- matrices: [a b c d tx ty], row-vector convention ---------- */
  const IDENT = [1, 0, 0, 1, 0, 0];
  function parseMatrix(s) {
    if (!s) return IDENT.slice();
    const p = s.trim().split(/\s+/).map(Number);
    return p.length === 6 && p.every(isFinite) ? p : IDENT.slice();
  }
  // apply A first, then B
  function mul(A, B) {
    return [
      A[0] * B[0] + A[1] * B[2], A[0] * B[1] + A[1] * B[3],
      A[2] * B[0] + A[3] * B[2], A[2] * B[1] + A[3] * B[3],
      A[4] * B[0] + A[5] * B[2] + B[4], A[4] * B[1] + A[5] * B[3] + B[5],
    ];
  }
  const apply = (M, x, y) => [M[0] * x + M[2] * y + M[4], M[1] * x + M[3] * y + M[5]];

  /* ---------- colour helpers ---------- */
  function cmykToHex(c, m, y, k) {
    const f = (v) => Math.round(255 * (1 - v / 100) * (1 - k / 100));
    return '#' + [f(c), f(m), f(y)].map((v) => v.toString(16).padStart(2, '0')).join('');
  }
  function hexToCmyk(hex) {
    const n = parseInt(hex.slice(1), 16);
    const r = ((n >> 16) & 255) / 255, g = ((n >> 8) & 255) / 255, b = (n & 255) / 255;
    const k = 1 - Math.max(r, g, b);
    if (k >= 1) return [0, 0, 0, 100];
    const c = (1 - r - k) / (1 - k), m = (1 - g - k) / (1 - k), y = (1 - b - k) / (1 - k);
    return [c, m, y, k].map((v) => Math.round(v * 100));
  }

  /* ---------- geometry of one item ---------- */
  function itemAnchors(el, M) {
    const pts = [];
    const props = firstKid(el, 'Properties');
    const pg = props && firstKid(props, 'PathGeometry');
    if (!pg) return pts;
    for (const gpt of kids(pg, 'GeometryPathType')) {
      const arr = firstKid(gpt, 'PathPointArray');
      if (!arr) continue;
      for (const pp of kids(arr, 'PathPointType')) {
        const a = (attr(pp, 'Anchor') || '').split(/\s+/).map(Number);
        if (a.length === 2 && a.every(isFinite)) pts.push(apply(M, a[0], a[1]));
      }
    }
    return pts;
  }
  function bbox(pts) {
    let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
    for (const [x, y] of pts) { x1 = Math.min(x1, x); y1 = Math.min(y1, y); x2 = Math.max(x2, x); y2 = Math.max(y2, y); }
    return { x1, y1, x2, y2 };
  }
  function itemLabel(el) {
    const props = firstKid(el, 'Properties');
    const lab = props && firstKid(props, 'Label');
    if (!lab) return '';
    return kids(lab, 'KeyValuePair').map((k) => attr(k, 'Value') || '').join(' ').trim();
  }

  function walkItems(parent, M, out, groupDepth) {
    for (const c of Array.from(parent.children)) {
      if (!ITEM_TAGS.has(c.tagName)) continue;
      const m = mul(parseMatrix(attr(c, 'ItemTransform')), M);
      if (c.tagName === 'Group') { walkItems(c, m, out, groupDepth + 1); continue; }
      const pts = itemAnchors(c, m);
      if (!pts.length) continue;
      const rawName = attr(c, 'Name') || '';
      out.push({
        id: attr(c, 'Self'), tag: c.tagName,
        name: rawName === '$ID/' ? '' : rawName,
        label: itemLabel(c),
        layer: attr(c, 'ItemLayer'),
        story: attr(c, 'ParentStory'),
        fill: attr(c, 'FillColor'), stroke: attr(c, 'StrokeColor'),
        hasContent: Array.from(c.children).some((k) => CONTENT_TAGS.has(k.tagName)),
        rect: bbox(pts),
      });
    }
  }

  /* ---------- free space: maximal empty rectangles ---------- */
  function findVoids(bounds, obstacles, o) {
    const minW = o.minW, minH = o.minH, pad = o.pad;
    const obs = [];
    for (const b of obstacles) {
      const x1 = Math.max(bounds.x1, b.x1 - pad), y1 = Math.max(bounds.y1, b.y1 - pad);
      const x2 = Math.min(bounds.x2, b.x2 + pad), y2 = Math.min(bounds.y2, b.y2 + pad);
      if (x2 - x1 > 0.5 && y2 - y1 > 0.5) obs.push({ x1, y1, x2, y2 });
    }
    const xset = new Set([bounds.x1, bounds.x2]);
    for (const b of obs) { xset.add(b.x1); xset.add(b.x2); }
    const xs = Array.from(xset).sort((a, b) => a - b);
    const cand = [];
    for (let i = 0; i < xs.length - 1; i++) {
      for (let j = i + 1; j < xs.length; j++) {
        const xl = xs[i], xr = xs[j];
        if (xr - xl < minW) continue;
        const blocks = obs.filter((b) => b.x1 < xr - 0.01 && b.x2 > xl + 0.01).map((b) => [b.y1, b.y2]).sort((a, b) => a[0] - b[0]);
        let cur = bounds.y1;
        for (const [a, b] of blocks) {
          if (a - cur >= minH) cand.push({ x1: xl, y1: cur, x2: xr, y2: a });
          cur = Math.max(cur, b);
        }
        if (bounds.y2 - cur >= minH) cand.push({ x1: xl, y1: cur, x2: xr, y2: bounds.y2 });
      }
    }
    const area = (r) => (r.x2 - r.x1) * (r.y2 - r.y1);
    cand.sort((a, b) => area(b) - area(a));
    const maximal = [];
    for (const c of cand) {
      if (maximal.some((m) => m.x1 <= c.x1 + 0.01 && m.y1 <= c.y1 + 0.01 && m.x2 >= c.x2 - 0.01 && m.y2 >= c.y2 - 0.01)) continue;
      maximal.push(c);
      if (maximal.length > 400) break;
    }
    // keep a distinct, useful handful
    const picked = [];
    for (const m of maximal) {
      const overl = picked.some((p) => {
        const ix = Math.max(0, Math.min(p.x2, m.x2) - Math.max(p.x1, m.x1));
        const iy = Math.max(0, Math.min(p.y2, m.y2) - Math.max(p.y1, m.y1));
        return (ix * iy) / Math.min(area(p), area(m)) > 0.5;
      });
      if (!overl) picked.push(m);
      if (picked.length >= o.max) break;
    }
    return picked;
  }

  /* ---------- load ---------- */
  async function load(buf, JSZip, opts) {
    opts = opts || {};
    const zip = await JSZip.loadAsync(buf);
    const dmFile = zip.file('designmap.xml');
    if (!dmFile) throw new Error('This is a zip file, but it has no designmap.xml. Is it an .idml export?');
    const designmap = await dmFile.async('string');
    const src = (tag) => Array.from(designmap.matchAll(new RegExp('<idPkg:' + tag + '\\s+src="([^"]+)"', 'g'))).map((m) => m[1]);

    const doc = {
      zip, JSZip, designmapPath: 'designmap.xml',
      graphicPath: src('Graphic')[0], stylesPath: src('Styles')[0], fontsPath: src('Fonts')[0],
      swatches: [], paraStyles: [], fonts: [], layers: [], spreads: [],
    };

    /* layers */
    const dmDoc = parseXml(designmap);
    for (const l of dmDoc.getElementsByTagName('Layer')) doc.layers.push({ id: attr(l, 'Self'), name: attr(l, 'Name') });

    /* swatches */
    if (doc.graphicPath && zip.file(doc.graphicPath)) {
      const gx = parseXml(await zip.file(doc.graphicPath).async('string'));
      for (const c of gx.getElementsByTagName('Color')) {
        const name = attr(c, 'Name');
        if (/^registration$/i.test(name)) continue;
        const sp = attr(c, 'Space'), v = (attr(c, 'ColorValue') || '').split(/\s+/).map(Number);
        let hex = '#888888';
        if (sp === 'RGB' && v.length >= 3) hex = '#' + v.slice(0, 3).map((n) => Math.round(n).toString(16).padStart(2, '0')).join('');
        else if (sp === 'CMYK' && v.length >= 4) hex = cmykToHex(v[0], v[1], v[2], v[3]);
        doc.swatches.push({ ref: attr(c, 'Self'), name, space: sp, hex });
      }
    }
    /* paragraph styles */
    if (doc.stylesPath && zip.file(doc.stylesPath)) {
      const sx = parseXml(await zip.file(doc.stylesPath).async('string'));
      for (const p of sx.getElementsByTagName('ParagraphStyle')) {
        const self = attr(p, 'Self');
        if (/\[No paragraph style\]/i.test(self)) continue;
        let name = decodeURIComponent((attr(p, 'Name') || '').replace(/^\$ID\//, ''));
        if (/NormalParagraphStyle/.test(self)) name = '[Basic Paragraph]';
        doc.paraStyles.push({ ref: self, name });
      }
    }
    /* fonts */
    if (doc.fontsPath && zip.file(doc.fontsPath)) {
      const fx = parseXml(await zip.file(doc.fontsPath).async('string'));
      for (const f of fx.getElementsByTagName('Font')) {
        doc.fonts.push({ family: attr(f, 'FontFamily'), style: attr(f, 'FontStyleName'), name: attr(f, 'Name') });
      }
    }

    /* stories: is each one empty? */
    const storyEmpty = {};
    for (const p of src('Story')) {
      const f = zip.file(p); if (!f) continue;
      const xml = await f.async('string');
      const m = /<Story\b[^>]*\bSelf="([^"]+)"/.exec(xml);
      if (!m) continue;
      const text = Array.from(xml.matchAll(/<Content>([\s\S]*?)<\/Content>/g)).map((x) => x[1]).join('').replace(/[\uFEFF\s]/g, '');
      storyEmpty[m[1]] = !text && !/<Table\b|<Rectangle\b|<Oval\b|<Polygon\b|<Group\b/.test(xml);
    }

    /* spreads */
    const spreadPaths = src('Spread');
    let pageCounter = 0;
    for (let si = 0; si < spreadPaths.length; si++) {
      const path = spreadPaths[si];
      const f = zip.file(path); if (!f) continue;
      const xml = await f.async('string');
      const xd = parseXml(xml);
      const rootEl = xd.documentElement;
      const sp = Array.from(rootEl.children).find((c) => c.tagName === 'Spread');
      if (!sp) continue;
      const spread = { index: doc.spreads.length, path, self: attr(sp, 'Self'), dom: attr(rootEl, 'DOMVersion') || '20.0', pages: [], items: [], frames: [], voids: [] };
      const pages = kids(sp, 'Page');
      pages.forEach((pg, pi) => {
        const gb = (attr(pg, 'GeometricBounds') || '0 0 0 0').split(/\s+/).map(Number); // y1 x1 y2 x2
        const M = parseMatrix(attr(pg, 'ItemTransform'));
        const corners = [apply(M, gb[1], gb[0]), apply(M, gb[3], gb[2])];
        const rect = bbox(corners);
        const mp = firstKid(pg, 'MarginPreference');
        const mg = { top: 0, bottom: 0, left: 0, right: 0 };
        if (mp) {
          mg.top = +attr(mp, 'Top') || 0; mg.bottom = +attr(mp, 'Bottom') || 0;
          mg.left = +attr(mp, 'Left') || 0; mg.right = +attr(mp, 'Right') || 0;
          if (pages.length > 1 && pi === 0) { const t = mg.left; mg.left = mg.right; mg.right = t; } // inside margin faces the spine
        }
        pageCounter++;
        spread.pages.push({ id: attr(pg, 'Self'), name: attr(pg, 'Name') || String(pageCounter), rect, margins: mg });
      });
      walkItems(sp, IDENT.slice(), spread.items, 0);

      const minArea = 36 * 36;
      for (const it of spread.items) {
        const w = it.rect.x2 - it.rect.x1, h = it.rect.y2 - it.rect.y1;
        const nameHit = /^(chart|plot|graph|fig)/i.test(it.name) || /^(chart|plot|graph|fig)/i.test(it.label);
        const isGraphic = it.tag === 'Rectangle' || it.tag === 'Oval' || it.tag === 'Polygon';
        const noFill = !it.fill || /Swatch\/None/.test(it.fill);
        let kind = null;
        if (nameHit && w * h >= 400) kind = 'named';
        else if (it.tag === 'TextFrame' && it.story && storyEmpty[it.story] && w * h >= minArea) kind = 'empty-text';
        else if (isGraphic && !it.hasContent && noFill && w * h >= minArea) kind = 'empty-graphic';
        it.kind = kind;
        if (kind) {
          spread.frames.push({
            kind, id: it.id, tag: it.tag, rect: it.rect, layer: it.layer,
            title: it.name || it.label || (kind === 'empty-text' ? 'Empty text frame' : 'Empty frame'),
          });
        }
      }
      /* free space per page */
      for (const pg of spread.pages) {
        const m = opts.ignoreMargins ? { top: 0, bottom: 0, left: 0, right: 0 } : pg.margins;
        const bounds = { x1: pg.rect.x1 + m.left, y1: pg.rect.y1 + m.top, x2: pg.rect.x2 - m.right, y2: pg.rect.y2 - m.bottom };
        const pageArea = (pg.rect.x2 - pg.rect.x1) * (pg.rect.y2 - pg.rect.y1);
        const obstacles = spread.items.filter((it) => {
          if (it.kind) return false;
          const a = (it.rect.x2 - it.rect.x1) * (it.rect.y2 - it.rect.y1);
          if (a > pageArea * 0.85) return false; // full-page background
          const cx = (it.rect.x1 + it.rect.x2) / 2, cy = (it.rect.y1 + it.rect.y2) / 2;
          return cx > pg.rect.x1 - 1 && cx < pg.rect.x2 + 1 && cy > pg.rect.y1 - 1 && cy < pg.rect.y2 + 1;
        }).map((it) => it.rect);
        const vs = findVoids(bounds, obstacles, { minW: 130, minH: 90, pad: 8, max: 5 });
        vs.forEach((r, i) => spread.voids.push({ kind: 'void', rect: r, page: pg.name, title: 'Free space ' + (i + 1) + ' · page ' + pg.name }));
      }
      doc.spreads.push(spread);
    }
    if (!doc.spreads.length) throw new Error('No spreads were found in this file.');
    return doc;
  }

  /* ---------- write: path + shape XML ---------- */
  function pathXml(pts, open) {
    const p = (a) => r4(a[0]) + ' ' + r4(a[1]);
    return '<Properties><PathGeometry><GeometryPathType PathOpen="' + (open ? 'true' : 'false') + '"><PathPointArray>' +
      pts.map((q) => '<PathPointType Anchor="' + p(q.a) + '" LeftDirection="' + p(q.l) + '" RightDirection="' + p(q.r) + '"/>').join('') +
      '</PathPointArray></GeometryPathType></PathGeometry></Properties>';
  }
  const straight = (x, y) => ({ a: [x, y], l: [x, y], r: [x, y] });

  /**
   * Insert a set of drawing primitives (from charts.js) into one spread as a named group.
   * Returns a new, re-parsed doc.
   */
  async function addChart(doc, spreadIndex, prims, o) {
    o = o || {};
    const zip = doc.zip;
    const spread = doc.spreads[spreadIndex];
    let spreadXml = await zip.file(spread.path).async('string');

    /* unique ids across the whole package */
    const used = new Set();
    const scan = async (path) => {
      const f = zip.file(path); if (!f) return;
      const x = await f.async('string');
      for (const m of x.matchAll(/\bSelf="([^"]+)"/g)) used.add(m[1]);
    };
    await scan('designmap.xml');
    for (const p of Object.keys(zip.files)) if (/^(Spreads|Stories|MasterSpreads)\/.*\.xml$/.test(p) || p === doc.graphicPath || p === doc.stylesPath) await scan(p);
    let counter = 0x7e000 + used.size;
    const nextId = () => { let id; do { id = 'u' + (counter++).toString(16); } while (used.has(id)); used.add(id); return id; };

    /* colours */
    const swatchSet = new Set(doc.swatches.map((s) => s.ref));
    const newColors = new Map(); // ref -> xml
    const colorSpace = o.colorSpace === 'RGB' ? 'RGB' : 'CMYK';
    const resolveColor = (spec) => {
      if (!spec || spec === 'none') return 'Swatch/None';
      if (spec.startsWith('doc:')) {
        const ref = spec.slice(4);
        if (swatchSet.has(ref) || ref === 'Swatch/None') return ref;
        spec = ref === 'Color/Paper' ? '#ffffff' : '#000000'; // doc lacks that swatch → make our own
      }
      const hex = spec.toLowerCase();
      const name = 'Chart_' + hex.slice(1).toUpperCase() + (colorSpace === 'RGB' ? '_RGB' : '');
      const ref = 'Color/' + name;
      if (!swatchSet.has(ref) && !newColors.has(ref)) {
        const n = parseInt(hex.slice(1), 16);
        const val = colorSpace === 'RGB' ? [(n >> 16) & 255, (n >> 8) & 255, n & 255].join(' ') : hexToCmyk(hex).join(' ');
        newColors.set(ref, '<Color Self="' + ref + '" Model="Process" Space="' + colorSpace + '" ColorValue="' + val + '" ColorOverride="Normal" ConvertToHsb="false" AlternateSpace="NoAlternateColor" AlternateColorValue="" Name="' + name + '" ColorEditable="true" ColorRemovable="true" Visible="true"/>');
      }
      return ref;
    };

    const layer = o.layer || (doc.layers[0] && doc.layers[0].id) || '';
    const layerAttr = layer ? ' ItemLayer="' + layer + '"' : '';
    const stories = [];
    const parts = [];
    const strokeAttrs = (p) => ' StrokeColor="' + resolveColor(p.stroke) + '" StrokeWeight="' + r4(p.stroke ? (p.sw || 0.5) : 0) + '"' +
      (p.stroke && p.strokeTint != null ? ' StrokeTint="' + p.strokeTint + '"' : '');
    const fillAttrs = (p) => ' FillColor="' + resolveColor(p.fill) + '"' + (p.fill && p.fillTint != null ? ' FillTint="' + p.fillTint + '"' : '');
    const common = ' ItemTransform="1 0 0 1 0 0"';

    for (const p of prims) {
      const id = nextId();
      const nm = p.name ? ' Name="' + esc(p.name) + '"' : '';
      if (p.kind === 'rect') {
        const x1 = p.x, y1 = p.y, x2 = p.x + p.w, y2 = p.y + p.h;
        parts.push('<Rectangle Self="' + id + '" ContentType="GraphicType"' + layerAttr + fillAttrs(p) + strokeAttrs(p) + nm + common + '>' +
          pathXml([straight(x1, y1), straight(x1, y2), straight(x2, y2), straight(x2, y1)], false) + '</Rectangle>');
      } else if (p.kind === 'line') {
        parts.push('<GraphicLine Self="' + id + '" ContentType="Unassigned"' + layerAttr + ' FillColor="Swatch/None"' + strokeAttrs(p) + ' EndCap="ButtCap"' + nm + common + '>' +
          pathXml([straight(p.x1, p.y1), straight(p.x2, p.y2)], true) + '</GraphicLine>');
      } else if (p.kind === 'path') {
        const open = !p.closed;
        parts.push('<Polygon Self="' + id + '" ContentType="GraphicType"' + layerAttr + fillAttrs(p) + strokeAttrs(p) + (open ? ' EndJoin="RoundEndJoin"' : '') + nm + common + '>' +
          pathXml(p.pts, open) + '</Polygon>');
      } else if (p.kind === 'text') {
        const sid = nextId();
        const style = p.para || 'ParagraphStyle/$ID/NormalParagraphStyle';
        const just = p.align === 'center' ? 'CenterAlign' : p.align === 'right' ? 'RightAlign' : 'LeftAlign';
        const vj = p.valign === 'top' ? 'TopAlign' : p.valign === 'bottom' ? 'BottomAlign' : 'CenterAlign';
        const fillA = p.color ? ' FillColor="' + resolveColor(p.color) + '"' : '';
        const fontProps = p.font && p.font.family
          ? '<Properties><AppliedFont type="string">' + esc(p.font.family) + '</AppliedFont><Leading type="enumeration">Auto</Leading></Properties>'
          : '<Properties><Leading type="enumeration">Auto</Leading></Properties>';
        const fontStyle = p.font && p.font.style ? ' FontStyle="' + esc(p.font.style) + '"' : '';
        const lines = String(p.text).split('\n');
        const body = lines.map((ln, i) => '<Content>' + esc(ln) + '</Content>' + (i < lines.length - 1 ? '<Br/>' : '')).join('');
        stories.push({
          id, path: 'Stories/Story_' + sid + '.xml', sid,
          xml: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
            '<idPkg:Story xmlns:idPkg="http://ns.adobe.com/AdobeInDesign/idml/1.0/packaging" DOMVersion="' + spread.dom + '">' +
            '<Story Self="' + sid + '" AppliedTOCStyle="n" TrackChanges="false" StoryTitle="$ID/" AppliedNamedGrid="n">' +
            '<StoryPreference OpticalMarginAlignment="false" OpticalMarginSize="12" FrameType="TextFrameType" StoryOrientation="Horizontal" StoryDirection="LeftToRightDirection"/>' +
            '<ParagraphStyleRange AppliedParagraphStyle="' + esc(style) + '" Justification="' + just + '" SpaceBefore="0" SpaceAfter="0" FirstLineIndent="0" LeftIndent="0" RightIndent="0" Hyphenation="false">' +
            '<CharacterStyleRange AppliedCharacterStyle="CharacterStyle/$ID/[No character style]" PointSize="' + r4(p.size || 8) + '"' + fillA + fontStyle + '>' +
            fontProps + body + '</CharacterStyleRange></ParagraphStyleRange></Story></idPkg:Story>',
        });
        const x1 = p.x, y1 = p.y, x2 = p.x + p.w, y2 = p.y + p.h;
        parts.push('<TextFrame Self="' + id + '" ParentStory="' + sid + '" PreviousTextFrame="n" NextTextFrame="n" ContentType="TextType"' + layerAttr +
          ' FillColor="Swatch/None" StrokeColor="Swatch/None" StrokeWeight="0"' + nm + common + '>' +
          pathXml([straight(x1, y1), straight(x1, y2), straight(x2, y2), straight(x2, y1)], false) +
          '<TextFramePreference TextColumnCount="1" TextColumnGutter="12" AutoSizingType="Off" VerticalJustification="' + vj + '" IgnoreWrap="true">' +
          '<Properties><InsetSpacing type="list"><ListItem type="unit">0</ListItem><ListItem type="unit">0</ListItem><ListItem type="unit">0</ListItem><ListItem type="unit">0</ListItem></InsetSpacing></Properties>' +
          '</TextFramePreference></TextFrame>');
      }
    }

    const gid = nextId();
    const group = '<Group Self="' + gid + '"' + layerAttr + ' Name="' + esc(o.name || 'Chart') + '"' + common + '>' + parts.join('') + '</Group>';

    /* optionally delete the empty rectangle the chart replaces */
    if (o.removeFrame && o.removeFrame.tag === 'Rectangle') {
      const start = spreadXml.search(new RegExp('<Rectangle\\b[^>]*\\bSelf="' + o.removeFrame.id + '"'));
      if (start >= 0) {
        const tagEnd = spreadXml.indexOf('>', start);
        let end;
        if (spreadXml[tagEnd - 1] === '/') end = tagEnd + 1;
        else { const close = spreadXml.indexOf('</Rectangle>', tagEnd); end = close >= 0 ? close + '</Rectangle>'.length : -1; }
        const inner = end > 0 ? spreadXml.slice(start, end) : '';
        if (end > 0 && !/<(Image|PDF|EPS|ImportedPage|Group|Rectangle\b[^>]*Self)/.test(inner.slice(5))) spreadXml = spreadXml.slice(0, start) + spreadXml.slice(end);
      }
    }
    const closeAt = spreadXml.lastIndexOf('</Spread>');
    if (closeAt < 0) throw new Error('Unexpected spread structure.');
    spreadXml = spreadXml.slice(0, closeAt) + group + spreadXml.slice(closeAt);
    zip.file(spread.path, spreadXml, { createFolders: false });

    /* new colours into Graphic.xml */
    if (newColors.size && doc.graphicPath) {
      let gx = await zip.file(doc.graphicPath).async('string');
      const add = Array.from(newColors.values()).join('');
      const lastColor = Array.from(gx.matchAll(/<Color\b[^>]*\/>|<Color\b[^>]*>[\s\S]*?<\/Color>/g)).pop();
      if (lastColor) { const at = lastColor.index + lastColor[0].length; gx = gx.slice(0, at) + add + gx.slice(at); }
      else {
        const sw = gx.search(/<Swatch\b/);
        const at = sw >= 0 ? sw : gx.lastIndexOf('</idPkg:Graphic>');
        gx = gx.slice(0, at) + add + gx.slice(at);
      }
      zip.file(doc.graphicPath, gx, { createFolders: false });
    }

    /* stories into the package */
    if (stories.length) {
      for (const s of stories) zip.file(s.path, s.xml, { createFolders: false });
      let dm = await zip.file('designmap.xml').async('string');
      const refs = stories.map((s) => '<idPkg:Story src="' + s.path + '"/>').join('');
      const storyTags = Array.from(dm.matchAll(/<idPkg:Story\b[^>]*\/>/g));
      if (storyTags.length) { const l = storyTags[storyTags.length - 1]; const at = l.index + l[0].length; dm = dm.slice(0, at) + refs + dm.slice(at); }
      else dm = dm.replace(/<\/Document>\s*$/, refs + '</Document>');
      dm = dm.replace(/(<Document\b[^>]*\bStoryList=")([^"]*)(")/, (m, a, b, c) => a + (b ? b + ' ' : '') + stories.map((s) => s.sid).join(' ') + c);
      zip.file('designmap.xml', dm, { createFolders: false });
    }

    /* mimetype must be first and stored */
    zip.file('mimetype', 'application/vnd.adobe.indesign-idml-package', { compression: 'STORE', createFolders: false });
    const buf = await zip.generateAsync({ type: 'arraybuffer', compression: 'DEFLATE', mimeType: 'application/vnd.adobe.indesign-idml-package' });
    return { buffer: buf, doc: await load(buf, doc.JSZip, {}), stories: stories.length, items: parts.length };
  }

  return { load, addChart, findVoids, cmykToHex, hexToCmyk };
});
