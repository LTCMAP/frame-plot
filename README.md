# Frameplot

Charts for InDesign layouts, without a plug-in. Open an **IDML** file, pick an empty frame (or free space, or drag out an area), paste your numbers, and download the document back with **native, editable chart objects** on the page.

Everything runs in the browser. Files are never uploaded anywhere. It is a static site, so GitHub Pages hosts it for free.

## How to use it

1. In InDesign: **File ▸ Export ▸ Format: InDesign Markup (IDML)**.
2. Open that `.idml` in Frameplot (drop it on the page, or *Open IDML*).
3. Pick where the chart goes:
   - **Named frames.** Name an empty frame `CHART_1` (Layers panel name, or Window ▸ Utilities ▸ Script Label). Anything starting with *chart*, *plot*, *graph* or *fig* is listed first and auto-selected.
   - **Empty frames.** Frames with no content and no fill, including empty text frames.
   - **Free space.** The largest blank rectangles on each page, found from the geometry of everything else. Respects page margins (switchable).
   - **Your own area.** Drag on the page, or type X / Y / width / height (pt, in or mm).
4. Paste data into the grid (first row = series names, first column = categories). CSV and Excel import are there too.
5. Choose a chart type and style it. Pick **document swatches** for series colors and **document paragraph styles** for the text, so the chart matches the layout.
6. **Place chart in document**. Repeat as many times as you like, then **Download IDML** and open it in InDesign. *Save as* `.indd` from there.

## What gets written

Each chart is one **Group** named `Chart: <title>` on the layer of the frame it replaces. Inside it are ordinary InDesign objects: rectangles for bars, polygons with true Bézier curves for pies and rings, lines, and live text frames (one story each) using your paragraph styles. Nothing is a picture. New colors are added as swatches named `Chart_RRGGBB`.

## Chart types (15)

Column, bar, stacked column, stacked bar (each with a 100% option), waterfall, line, area, column + line (optional second axis), radar, pie, doughnut (both with a half-circle option), radial bar, treemap, funnel, gauge.

## Host it on GitHub Pages

1. Create a repository (for example `frameplot`) and upload the contents of this folder to the root. `index.html` must be at the top level.
2. **Settings ▸ Pages ▸ Build and deployment ▸ Deploy from a branch ▸ `main` / `(root)` ▸ Save.**
3. After a minute it is live at `https://<your-username>.github.io/frameplot/`.

The two libraries are vendored in `js/vendor/`, so there is no build step and no CDN dependency (only the Google Fonts stylesheet is remote, and the app falls back to system fonts without it). *Try the sample file* needs the app served over http(s), which Pages does.

## Known limits

- **IDML only.** `.indd` is a closed binary format. Export IDML first.
- **Never opened in InDesign by the author of this code.** The output is validated structurally (well-formed XML, unique IDs, `mimetype` first and stored, designmap and story lists updated) and every chart is checked visually, but test on a copy of a real file first. If InDesign reports a problem, the exact message points to the fix.
- Master-page items are not considered when looking for free space.
- Legends are swatches plus text frames, not an InDesign table.
- Category labels wrap or thin out instead of rotating.
- Text widths in the preview are estimated; real fonts differ a little.
- Round trips through IDML are very faithful, but check linked images, fonts and any complex effects in the result.

## Development

```
npm install      # jszip, jsdom (tests only)
npm test         # parser + all 15 chart types + injection + a jsdom UI smoke test
npm run sample   # rebuild sample/sample.idml (a hand-written test file, not an InDesign export)
```

`js/charts.js` turns data into drawing primitives. `js/render.js` draws them as SVG (preview, thumbnails, SVG export). `js/idml.js` reads the package and writes the same primitives as IDML objects. `js/app.js` is the UI.

## Third-party

[JSZip](https://stuk.github.io/jszip/) (MIT or GPLv3) and [SheetJS Community Edition](https://sheetjs.com/) (Apache-2.0), both vendored unmodified.
