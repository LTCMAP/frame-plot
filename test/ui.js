const fs = require('fs'); const path = require('path');
const { JSDOM, VirtualConsole } = require('jsdom');
const root = path.resolve(__dirname, '..');
let fails = 0; const ok = (c, m) => { console.log((c ? '  ok  ' : ' FAIL ') + m); if (!c) fails++; };
(async () => {
  const vc = new VirtualConsole(); const errs = [];
  vc.on('jsdomError', (e) => { if (!/stylesheet|fonts\.g|Could not load/i.test(e.message)) errs.push(e.message); });
  vc.on('error', (e) => errs.push(String(e)));
  const dom = await JSDOM.fromFile(path.join(root, 'index.html'), { runScripts: 'dangerously', resources: 'usable', pretendToBeVisual: true, virtualConsole: vc });
  const w = dom.window;
  await new Promise((r) => w.addEventListener('load', r));
  w.URL.createObjectURL = () => 'blob:x'; w.URL.revokeObjectURL = () => {};
  const $ = (s) => w.document.querySelector(s), $$ = (s) => Array.from(w.document.querySelectorAll(s));
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));

  await wait(100);
  ok(!!w.Charts && !!w.IDML && !!w.JSZip && !!w.XLSX && !!w.Render, 'all scripts loaded (Charts, IDML, JSZip, XLSX, Render)');
  ok($$('.tbtn').length === 15, '15 chart types in the gallery');
  ok($('#emptyPreview svg') && $('#emptyPreview svg').innerHTML.length > 500, 'empty-state preview already draws the chart');
  ok($$('#grid input').length === 20, 'data grid rendered 5x4');

  // open sample via the file input
  w.JSZip = require('jszip'); // jsdom's timer shim stalls JSZip's string path; Node's build behaves like a browser
  const buf = fs.readFileSync(path.join(root, 'sample/sample.idml'));
  const file = new w.File([buf], 'sample.idml');
  file.arrayBuffer = async () => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  const inp = $('#fileIdml'); Object.defineProperty(inp, 'files', { value: [file], configurable: true });
  inp.dispatchEvent(new w.Event('change'));
  for (let i = 0; i < 40 && !w.__frameplot.doc && !$('#status').textContent; i++) await wait(100);
  const S = w.__frameplot;
  console.log('   status:', $('#status').textContent);
  ok(S.doc && S.doc.spreads.length === 2, 'sample opened');
  ok(/sample\.idml/.test($('#fileInfo').textContent), 'file info shows name');
  ok(S.area && S.area.label === 'CHART_1', 'auto-picked the frame named CHART_1');
  ok($('#svg') && $$('#svg [data-cand]').length >= 2, 'stage drew candidates: ' + $$('#svg [data-cand]').length);
  ok($('#chartLayer').innerHTML.length > 1000, 'live chart drawn inside the selected area');
  ok($$('.areabtn').length >= 4, 'area list has entries: ' + $$('.areabtn').map((b) => b.textContent.replace(/\s+/g, ' ')).join(' | '));
  ok(!$('#btnPlace').disabled && !$('#btnDownload').disabled, 'place and download enabled');
  ok($$('#paraStyle option').some((o) => o.textContent === 'Headline'), 'document paragraph styles offered');
  ok($$('#slots .slot select option').some((o) => o.textContent === 'Navy'), 'document swatches offered per series');

  // switch type via gallery, tweak option, edit data
  for (const t of ['stacked', 'line', 'pie', 'doughnut', 'treemap', 'gauge', 'radar', 'combo']) {
    $(`.tbtn[data-type="${t}"]`).click(); await wait(30);
    ok($('#chartLayer').innerHTML.length > 500 && S.type === t, 'switching to ' + t + ' redraws');
  }
  $(`.tbtn[data-type="doughnut"]`).click(); await wait(30);
  const title = $('#o_title'); title.value = 'Region mix'; title.dispatchEvent(new w.Event('input', { bubbles: true })); await wait(50);
  ok($('#chartLayer').innerHTML.includes('Region mix'), 'title option reaches the preview');
  const cell = $('#grid input[data-r="1"][data-c="1"]'); cell.value = '999'; cell.dispatchEvent(new w.Event('input', { bubbles: true })); await wait(50);
  ok(S.grid[1][1] === '999', 'grid edit updates state');
  // paste block
  const pasteEv = new w.Event('paste', { bubbles: true, cancelable: true });
  pasteEv.clipboardData = { getData: () => 'Item\tA\tB\nX\t1\t2\nY\t3\t4\nZ\t5\t6' };
  $('#grid input[data-r="0"][data-c="0"]').dispatchEvent(pasteEv); await wait(50);
  ok(S.grid.length === 4 && S.grid[0][2] === 'B' && S.grid[3][1] === '5', 'pasting a TSV block fills the grid');
  ok(/3 categories × 2 series/.test($('#dataMeta').textContent), 'data meta: ' + $('#dataMeta').textContent);

  // style: choose doc swatch for slot 0 and a paragraph style
  const sel = $('#slots .slot select'); sel.value = 'Color/Navy'; sel.dispatchEvent(new w.Event('change', { bubbles: true })); await wait(30);
  const ps = $('#paraStyle'); ps.value = 'ParagraphStyle/Body'; ps.dispatchEvent(new w.Event('input', { bubbles: true })); await wait(30);
  ok(S.overrides[0] === 'doc:Color/Navy' && S.style.para === 'ParagraphStyle/Body', 'swatch + paragraph style stored');

  // place twice
  $('#btnPlace').click(); await wait(600);
  ok(S.placed.length === 1 && /1 chart added/.test($('#status').textContent), 'placed first chart: ' + $('#status').textContent);
  ok(!S.doc.spreads[0].items.some((i) => i.id === 'u112'), 'placeholder frame removed from the re-parsed doc');
  $(`.tbtn[data-type="bar"]`).click(); await wait(30);
  $('#btnPlace').click(); await wait(600);
  ok(S.placed.length === 2, 'placed second chart into same file');
  ok(!$('#btnRevert').disabled, 'revert enabled');

  // output is valid
  const z = await w.JSZip.loadAsync(S.buf);
  ok(Object.keys(z.files)[0] === 'mimetype', 'download buffer starts with mimetype');
  fs.writeFileSync(path.join(root, 'test/ui-out.idml'), Buffer.from(S.buf));

  // spread 2 tab + custom area numeric edit
  $$('#spreadTabs button')[1].click(); await wait(30);
  ok(S.spreadIdx === 1 && $$('#svg rect').length > 5, 'second spread renders');
  const fr = S.doc.spreads[1].frames[0]; $$('.areabtn')[0].click(); await wait(30);
  const wInp = $('#xywh input[data-k="w"]'); wInp.value = '300'; wInp.dispatchEvent(new w.Event('change', { bubbles: true })); await wait(30);
  ok(Math.round(S.area.rect.w) === 300 && S.area.label === 'Your area', 'numeric edit turns selection into a custom area');
  // settings round trip
  const saved = JSON.stringify({ app: 'frameplot', v: 1, type: 'funnel', opts: { title: 'Loaded' }, grid: [['', 'v'], ['a', '3'], ['b', '2']], palette: 'warm', overrides: {}, style: {} });
  const sf = new w.File([saved], 's.json'); sf.text = async () => saved;
  const si = $('#fileSettings'); Object.defineProperty(si, 'files', { value: [sf], configurable: true }); si.dispatchEvent(new w.Event('change')); await wait(60);
  ok(S.type === 'funnel' && S.opts.title === 'Loaded' && S.palette === 'warm', 'settings file applies');
  // dump stage svg for a visual check
  fs.writeFileSync(path.join(root, 'test/stage.svg'), $('#svg').outerHTML.replace('style="width:100%"', 'width="1100"'));
  ok(errs.length === 0, 'no runtime errors' + (errs.length ? ': ' + errs.slice(0, 3).join(' / ') : ''));
  console.log(fails ? '\n' + fails + ' FAILED' : '\nall passed'); process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
