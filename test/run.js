const fs = require('fs');
const { JSDOM } = require('jsdom');
const JSZip = require('jszip');
global.DOMParser = new JSDOM('').window.DOMParser;
const IDML = require('../js/idml.js');
const Charts = require('../js/charts.js');

let fails = 0;
const ok = (c, m) => { console.log((c ? '  ok  ' : ' FAIL ') + m); if (!c) fails++; };

(async () => {
  const buf = fs.readFileSync('sample/sample.idml');
  let doc = await IDML.load(buf, JSZip);
  ok(doc.spreads.length === 2, 'two spreads parsed');
  ok(doc.spreads[0].pages.length === 1 && doc.spreads[1].pages.length === 2, 'page counts 1 and 2');
  const p0 = doc.spreads[0].pages[0].rect;
  ok(p0.x1 === 0 && p0.x2 === 612 && p0.y1 === -396 && p0.y2 === 396, 'page 1 rect in spread space ' + JSON.stringify(p0));
  const p2 = doc.spreads[1].pages[0].rect;
  ok(p2.x1 === -612 && p2.x2 === 0, 'facing left page offset ok');
  const named = doc.spreads[0].frames.filter((f) => f.kind === 'named');
  ok(named.length === 1 && named[0].title === 'CHART_1', 'finds frame named CHART_1');
  ok(doc.spreads[0].frames.some((f) => f.kind === 'empty-graphic'), 'finds an unnamed empty frame');
  ok(doc.spreads[1].frames.some((f) => f.kind === 'empty-text'), 'finds empty text frame');
  const grp = doc.spreads[1].items.find((i) => i.id === 'u212');
  ok(grp && grp.rect.x1 === 100 && grp.rect.y1 === 50 && grp.rect.x2 === 300, 'group transform composed: ' + JSON.stringify(grp && grp.rect));
  ok(doc.spreads[0].voids.length > 0, 'free space found: ' + doc.spreads[0].voids.map((v) => v.title + ' ' + Math.round(v.rect.x2 - v.rect.x1) + 'x' + Math.round(v.rect.y2 - v.rect.y1)).join(' | '));
  ok(doc.swatches.some((s) => s.name === 'Navy' && /^#/.test(s.hex)), 'swatches read (' + doc.swatches.map((s) => s.name).join(',') + ')');
  ok(doc.paraStyles.some((s) => s.name === 'Headline'), 'paragraph styles read');
  ok(doc.fonts.length === 2, 'fonts read');

  /* every chart type */
  const grid = [['', 'North', 'South', 'West'], ['Q1', '120', '90', '60'], ['Q2', '150', '110', '75'], ['Q3', '135', '130', '88'], ['Q4', '180', '125', '95']];
  const data = Charts.gridToData(grid);
  ok(data.series.length === 3 && data.categories.length === 4, 'grid → data');
  const area = { x: 36, y: -180, w: 540, h: 220 };
  for (const t of Charts.TYPES) {
    const opts = { title: 'Test ' + t.id, note: 'Source: test', legend: 'bottom', values: true, semi: t.id === 'pie', centerText: 'Hi', hexOf: (c) => c };
    const res = Charts.build(t.id, data, opts, area);
    const bad = res.prims.filter((p) => JSON.stringify(p).includes('NaN') || JSON.stringify(p).includes('null,null'));
    ok(res.prims.length > 5 && !bad.length, t.id + ' → ' + res.prims.length + ' primitives, no NaN');
    // all geometry inside area (allow small overflow tolerance)
    const out = res.prims.filter((p) => {
      const xs = p.kind === 'path' ? p.pts.map((q) => q.a[0]) : p.kind === 'line' ? [p.x1, p.x2] : [p.x, p.x + p.w];
      const ys = p.kind === 'path' ? p.pts.map((q) => q.a[1]) : p.kind === 'line' ? [p.y1, p.y2] : [p.y, p.y + p.h];
      return Math.min(...xs) < area.x - 2 || Math.max(...xs) > area.x + area.w + 2 || Math.min(...ys) < area.y - 2 || Math.max(...ys) > area.y + area.h + 2;
    });
    ok(out.length === 0, t.id + ' stays inside its area' + (out.length ? ' — ' + out.length + ' outside e.g. ' + out[0].name : ''));
  }

  /* inject into the named frame, with tricky options */
  const res = Charts.build('combo', data, { title: 'Revenue & O<>&"', secondary: true, para: 'ParagraphStyle/Body', titlePara: 'ParagraphStyle/Headline', colors: ['doc:Color/Navy', '#d6006e', '#00a3c4'] }, area);
  const out = await IDML.addChart(doc, 0, res.prims, { name: 'Chart: Revenue', removeFrame: named[0] && { id: named[0].id, tag: 'Rectangle' }, layer: 'u2f' });
  ok(out.stories > 5, 'wrote ' + out.stories + ' stories, ' + out.items + ' items');
  const zip2 = await JSZip.loadAsync(out.buffer);
  const names = Object.keys(zip2.files);
  ok(names[0] === 'mimetype', 'mimetype is first entry');
  ok(names.filter((n) => /^Stories\/.*\.xml$/.test(n)).length === 5 + out.stories, 'story files added');
  // all xml parses
  let parseErr = 0;
  for (const n of names.filter((n) => n.endsWith('.xml'))) { try { const d = new DOMParser().parseFromString(await zip2.file(n).async('string'), 'text/xml'); if (d.getElementsByTagName('parsererror').length) { parseErr++; console.log('   parse error in', n); } } catch (e) { parseErr++; console.log('   parse error in', n, e.message.slice(0, 80)); } }
  ok(parseErr === 0, 'every XML part still well-formed');
  const dm = await zip2.file('designmap.xml').async('string');
  ok((dm.match(/<idPkg:Story /g) || []).length === 5 + out.stories, 'designmap lists all stories');
  ok(/StoryList="u1a0 u1a1 u1a2 u1a3 u1a4 u/.test(dm), 'StoryList extended');
  ok(dm.startsWith('<?xml') && dm.includes('<?aid '), 'designmap prolog untouched');
  const gx = await zip2.file('Resources/Graphic.xml').async('string');
  ok(gx.includes('Color/Chart_D6006E') && gx.includes('Color/Chart_00A3C4'), 'new swatches added for custom colours');
  const sp = await zip2.file('Spreads/Spread_u100.xml').async('string');
  ok(!sp.includes('Self="u112"'), 'placeholder rectangle removed');
  const allStories = (await Promise.all(names.filter((n) => /^Stories\//.test(n) && n.endsWith('.xml')).map((n) => zip2.file(n).async('string')))).join('');
  ok(sp.includes('<Group ') && allStories.includes('Revenue &amp; O&lt;&gt;&amp;&quot;'), 'group present and story text escaped');
  ok(!names.some((n) => n.endsWith('/')), 'no directory entries in the zip');
  ok(sp.indexOf('</Group></Spread>') > 0, 'group inserted before </Spread>');
  // ids unique
  const ids = [...(sp + gx).matchAll(/\bSelf="([^"]+)"/g)].map((m) => m[1]);
  ok(new Set(ids).size === ids.length, 'no duplicate Self ids');
  // reload → new doc sees the chart items
  ok(out.doc.spreads[0].items.length > doc.spreads[0].items.length + 20, 'reloaded doc contains the chart objects');

  /* second chart on top of the first (round trip twice) */
  const res2 = Charts.build('doughnut', data, { title: 'Mix', hexOf: (c) => c }, { x: 36, y: 60, w: 260, h: 200 });
  const out2 = await IDML.addChart(out.doc, 0, res2.prims, { name: 'Chart: Mix', layer: 'u2f' });
  const sp2 = await (await JSZip.loadAsync(out2.buffer)).file('Spreads/Spread_u100.xml').async('string');
  ok((sp2.match(/<Group /g) || []).length === 2, 'second chart added alongside first');
  fs.writeFileSync('test/out.idml', Buffer.from(out2.buffer));
  console.log(fails ? '\n' + fails + ' FAILED' : '\nall passed');
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
