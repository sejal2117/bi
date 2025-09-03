// src/lib/exportUtils.js

// Dynamic imports for export and zip.
// These variables MUST be declared with 'let' and without an initial value
// so they can be assigned the module exports when dynamically imported.
// The static `import { jsPDF } from 'jspdf';` was causing the "cannot reassign" error.
let htmlToImage;
let jsPDF; // Declared with let, no static import
let JSZip;

export async function ensureExportLibs() {
  if (!htmlToImage) {
    htmlToImage = await import('html-to-image');
  }
  // Assign the named export 'jsPDF' from the dynamically imported 'jspdf' module
  if (!jsPDF) {
    jsPDF = (await import('jspdf')).jsPDF;
  }
}

export async function ensureZipLib() {
  if (!JSZip) {
    JSZip = (await import('jszip')).default;
  }
}

export const copyToClipboard = async (text) => {
  try { await navigator.clipboard.writeText(text || ''); } catch {}
};

export const downloadText = (filename, content) => {
  const blob = new Blob([content || ''], { type: 'text/plain;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = filename; a.click();
  URL.revokeObjectURL(a.href);
};

export const downloadJSON = (filename, obj) => downloadText(filename, JSON.stringify(obj, null, 2));

export const exportAsImage = async (type /* 'png' | 'jpeg' */, node) => {
  await ensureExportLibs(); // Ensure htmlToImage is loaded
  if (!node || !htmlToImage) { // Check if htmlToImage is available after dynamic import
    console.error("html-to-image library not loaded or node not found for image export.");
    return;
  }

  const dataUrl = type === 'jpeg'
    ? await htmlToImage.toJpeg(node, { quality: 0.95, backgroundColor: '#0b1220' })
    : await htmlToImage.toPng(node, { backgroundColor: '#0b1220' });
  const a = document.createElement('a');
  a.href = dataUrl;
  a.download = `dashboard.${type}`;
  a.click();
};

export const exportAsPDF = async (node) => {
  await ensureExportLibs(); // Ensure jsPDF is loaded
  if (!node || !jsPDF || !htmlToImage) { // Check if both libs are available
    console.error("jsPDF or html-to-image library not loaded or node not found for PDF export.");
    return;
  }

  const pngUrl = await htmlToImage.toPng(node, { backgroundColor: '#0b1220' });
  const img = new Image(); img.src = pngUrl;
  await new Promise((res) => (img.onload = res));

  // Use the dynamically loaded jsPDF instance
  const pdf = new jsPDF({ orientation: 'landscape', unit: 'pt', format: 'a4' });
  // scale image to fit page
  const pageW = pdf.internal.pageSize.getWidth();
  const pageH = pdf.internal.pageSize.getHeight();
  const ratio = Math.max(0.01, Math.min(pageW / img.width, pageH / img.height));
  const w = img.width * ratio, h = img.height * ratio;
  const x = (pageW - w) / 2, y = (pageH - h) / 2;
  pdf.addImage(pngUrl, 'PNG', x, y, w, h);
  pdf.save('dashboard.pdf');
};

function escapeForTemplateLiteral(s) {
  return (s || '').replace(/`/g, '\\`').replace(/\\/g, '\\\\');
}

export function downloadAsJSX(name, html) {
  const safe = escapeForTemplateLiteral(html || '');
  const jsx = `/* Auto-generated dashboard component */
import React from 'react';
export default function ${name || 'Dashboard'}() {
  return (
    <div dangerouslySetInnerHTML={{ __html: \`${safe}\` }} />
  );
}
`;
  const blob = new Blob([jsx], { type: 'text/plain;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `${name || 'Dashboard'}.jsx`;
  a.click();
  URL.revokeObjectURL(a.href);
}

function buildIndexHTMLForZip(title, bodyHtml) {
  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <title>${title || 'Dashboard'}</title>
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <script src="https://cdn.tailwindcss.com"></script>
  <style>body{background:#0b1220;}</style>
</head>
<body class="min-h-screen">
  <div id="app" class="p-4">
${bodyHtml || ''}
  </div>
  <script src="https://cdn.jsdelivr.net/npm/echarts@5/dist/echarts.min.js"></script>
  <script src="./render.js"></script>
</body>
</html>`;
}

function buildRenderJSForZip() {
  // This is a string literal that gets written to render.js inside the zip.
  // Make sure all string concatenation and logic inside is correct JS.
  return `(() => {
  const ids = ['goalProgressGauge','dualAxisLineChart','stackedAreaChart','horizontalBarChart','treemapChart','regionalSalesChart','scatterPlot','kpiRevenueTrend','kpiUnitsTrend','kpiAOVTrend','kpiCacTrend'];
  function pick(fields, names) {
    const lower = fields.map(f => ({ ...f, _n: f.name.toLowerCase() }));
    const e = lower.find(f => names.some(n => f._n === n.toLowerCase()));
    if (e) return e.name;
    const c = lower.find(f => names.some(n => f._n.includes(n.toLowerCase())));
    return c ? c.name : null;
  }
  function renderWith(rows, fields) {
    const fDate = pick(fields, ['OrderDate','Date','Year']) || 'OrderDate';
    const fValue = pick(fields, ['SaleValue','Revenue','Amount','Value']) || 'SaleValue';
    const fUnits = pick(fields, ['Units','Qty','Count']) || fValue;
    const fRegion = pick(fields, ['Region']) || 'Region';
    const fProduct = pick(fields, ['ProductName','Product']) || 'ProductName';
    const fChannel = pick(fields, ['Category','Channel']) || 'Category';
    const by = (keyFn, valFn=(r)=>r) => rows.reduce((m,r)=>{ const k=keyFn(r); m[k]=(m[k]||[]).concat([valFn(r)]); return m;}, {});
    const sum = arr => arr.reduce((a,b)=> a+(+b||0), 0);
    const monthKey = (r) => {
      const d = new Date(r[fDate] || Date.now());
      return isNaN(d) ? 'Unknown' : d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0');
    };
    const mGroups = by(monthKey, r => ({rev:+r[fValue]||0, units:+r[fUnits]||0}));
    const months = Object.keys(mGroups).sort();
    const revSeries = months.map(m => sum(mGroups[m].map(x=>x.rev)));
    const unitSeries = months.map(m => sum(mGroups[m].map(x=>x.units)));
    const pGroups = by(r => r[fProduct], r => +r[fValue]||0);
    const pAgg = Object.entries(pGroups).map(([k,v])=>[k, sum(v)]).sort((a,b)=>b[1]-a[1]).slice(0,10);
    const prodCats = pAgg.map(x=>x[0]); const prodVals = pAgg.map(x=>+x[1].toFixed(2));
    const rGroups = by(r => r[fRegion], r => +r[fValue]||0);
    const rAgg = Object.entries(rGroups).map(([k,v])=>[k, sum(v)]).sort((a,b)=>b[1]-a[1]);
    const regionCats = rAgg.map(x=>x[0]); const regionVals = rAgg.map(x=>+x[1].toFixed(2));
    const cGroups = by(r => r[fChannel] || 'Online', r => ({ m: monthKey(r), val: +r[fValue]||0 }));
    const channels = Object.keys(cGroups);
    const stackedSeries = channels.map(ch => {
      const byM = cGroups[ch].reduce((m, x) => { m[x.m] = (m[x.m]||0)+x.val; return m; }, {});
      return months.map(m => +(byM[m]||0).toFixed(2));
    });
    function create(id, opt) {
      const el = document.getElementById(id); if (!el) return;
      el.innerHTML = '';
      const inst = echarts.init(el); inst.setOption(opt); window.addEventListener('resize', () => inst.resize());
    }
    const spark = (color, data) => ({ xAxis:{type:'category',show:false}, yAxis:{type:'value',show:false},
      grid:{top:2,bottom:2,left:2,right:2},
      series:[{type:'line',data,showSymbol:false,smooth:true,areaStyle:{opacity:.2},lineStyle:{color}}] });
    const k1 = months.map(()=> +(Math.random()*100).toFixed(2));
    const k2 = months.map(()=> +(Math.random()*100).toFixed(2));
    const k3 = months.map(()=> +(Math.random()*5).toFixed(2));
    const kCac = months.map(()=> +(Math.random()*20).toFixed(2));
    create('kpiRevenueTrend', spark('#00E396', k1));
    create('kpiUnitsTrend',   spark('#008FFB', k2));
    create('kpiAOVTrend',     spark('#5A54F1', k3));
    create('kpiCacTrend',     spark('#FFC107', kCac));
    create('goalProgressGauge', { series:[{type:'gauge', min:0,max:100, data:[{value:75}], detail:{formatter:'{value}%'}}] });
    create('dualAxisLineChart', {
      tooltip:{trigger:'axis'}, legend:{}, xAxis:{type:'category', data: months}, yAxis:[{type:'value'},{type:'value'}],
      series:[
        { name:'Total Revenue', type:'line', yAxisIndex:0, data: revSeries, smooth:true },
        { name:'Units Sold', type:'line', yAxisIndex:1, data: unitSeries, smooth:true }
      ]
    });
    create('stackedAreaChart', {
      tooltip:{trigger:'axis'}, legend:{data:channels}, xAxis:{type:'category', data: months}, yAxis:{type:'value'},
      series: channels.map((ch,i)=>({ name:ch, type:'line', stack:'total', areaStyle:{}, data: stackedSeries[i], smooth:true }))
    });
    create('horizontalBarChart', {
      tooltip:{trigger:'axis',axisPointer:{type:'shadow'}}, xAxis:{type:'value'}, yAxis:{type:'category', data: prodCats},
      series:[{ name:'Revenue', type:'bar', data: prodVals }]
    });
    create('treemapChart', { series: [{ type:'treemap', data: pAgg.map(([name,val])=>({ name, value: val })) }] });
    const scatterData = rows.slice(0, 200).map(r => [ +(+r[fValue]||0).toFixed(2), Math.floor(10+Math.random()*200) ]);
    create('regionalSalesChart', {
      tooltip:{trigger:'axis',axisPointer:{type:'shadow'}}, xAxis:{type:'value'}, yAxis:{type:'category', data: regionCats},
      series:[{ name:'Sales', type:'bar', data: regionVals }]
    });
    create('scatterPlot', {
      tooltip:{trigger:'item'}, xAxis:{type:'value', name:'Avg Price'}, yAxis:{type:'value', name:'Units'},
      series:[{ type:'scatter', data: scatterData }]
    });
  }
  fetch('./data.json').then(r => r.ok ? r.json() : null).then(json => {
    if (json && json.data) {
      const tables = Object.keys(json.data);
      if (tables.length) {
        const tname = tables[0];
        const rows = json.data[tname] || [];
        const fields = rows.length ? Object.keys(rows[0]).map(n => ({ name:n })) : [{name:'OrderDate'},{name:'SaleValue'},{name:'Region'},{name:'ProductName'}];
        renderWith(rows, fields);
      }
    } else {
      // Minimal fallback if no data
      const rows = Array.from({length:120}).map((_,i)=>({ OrderDate: new Date(Date.now()-i*86400000).toISOString().slice(0,10), SaleValue: +(Math.random()*1000).toFixed(2), Region: ['North America','Europe','Asia'][i%3], ProductName: 'Product ' + String.fromCharCode(65+(i%10)) }));
      const fields = [{name:'OrderDate'},{name:'SaleValue'},{name:'Region'},{name:'ProductName'}];
      renderWith(rows, fields);
    }
  });
})();`;
}

export async function downloadZipApp({ title, html, schema, dataSet }) {
  await ensureZipLib();
  const zip = new JSZip();
  const indexHtml = buildIndexHTMLForZip(title, html || '');
  const renderJs = buildRenderJSForZip();
  zip.file('index.html', indexHtml);
  zip.file('render.js', renderJs);
  if (schema) zip.file('schema.json', JSON.stringify(schema, null, 2));
  if (dataSet) zip.file('data.json', JSON.stringify({ data: dataSet }, null, 2));
  const blob = await zip.generateAsync({ type: 'blob' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `${(title || 'dashboard').replace(/\s+/g, '_')}.zip`;
  a.click();
  URL.revokeObjectURL(a.href);
}