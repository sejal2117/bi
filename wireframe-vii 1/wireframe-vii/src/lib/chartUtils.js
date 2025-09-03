// src/lib/chartUtils.js
import * as echarts from 'echarts/core';
import { BarChart, LineChart, TreemapChart, ScatterChart, GaugeChart } from 'echarts/charts';
import {
  GridComponent, TooltipComponent, TitleComponent, LegendComponent, VisualMapComponent, AxisPointerComponent,
} from 'echarts/components';
import { CanvasRenderer } from 'echarts/renderers';

// ECharts Registration - Run this once at application startup or in a top-level component
export function registerECharts() {
  echarts.use([
    TitleComponent, TooltipComponent, GridComponent, LegendComponent, VisualMapComponent, AxisPointerComponent,
    BarChart, LineChart, TreemapChart, ScatterChart, GaugeChart, CanvasRenderer,
  ]);
}

// Helpers to guess key fields in schema
export function pickFieldByName(fields, candidates) {
  const lower = fields.map(f => ({...f, _n: f.name.toLowerCase()}));
  const exact = lower.find(f => candidates.some(c => f._n === c.toLowerCase()));
  if (exact) return exact.name;
  // fuzzy contains
  const fuzzy = lower.find(f => candidates.some(c => f._n.includes(c.toLowerCase())));
  return fuzzy ? fuzzy.name : null;
}

// MODIFIED: renderChartsFromData now accepts rootDomElement
export function renderChartsFromData(dataSet, schema, chartInstancesRef, rootDomElement) {
  // Clear previous instances
  chartInstancesRef.current.forEach((c) => c?.dispose?.());
  chartInstancesRef.current = [];

  // Check if rootDomElement is provided and exists
  if (!rootDomElement) {
    console.warn("rootDomElement not provided to renderChartsFromData. Charts cannot be initialized.");
    return;
  }

  if (!dataSet || !schema) {
    console.warn("No data or schema to render charts.");
    return;
  }

  function getPrimaryTable() {
    // pick first non-empty table
    const t = schema.tables.find(t => Array.isArray(dataSet[t.name]) && dataSet[t.name].length);
    return t ? { table: t, rows: dataSet[t.name] } : null;
  }

  const ctx = getPrimaryTable();
  const rows = ctx?.rows || [];

  // heuristic field selection
  const flds = ctx?.table?.fields || [];
  const fDate = pickFieldByName(flds, ['OrderDate', 'Date', 'Year']) || 'OrderDate';
  const fValue = pickFieldByName(flds, ['SaleValue','Revenue','Amount','Value']) || 'SaleValue';
  const fUnits = pickFieldByName(flds, ['Units','Qty','Count']) || fValue;
  const fRegion = pickFieldByName(flds, ['Region']) || 'Region';
  const fCountry = pickFieldByName(flds, ['Country']) || 'Country';
  const fProduct = pickFieldByName(flds, ['ProductName','Product']) || 'ProductName';
  const fChannel = pickFieldByName(flds, ['Channel','Category']) || 'Category';

  // helpers
  const by = (keyFn, valFn=(r)=>r) => rows.reduce((m,r)=>{ const k=keyFn(r); m[k]=(m[k]||[]).concat([valFn(r)]); return m;}, {});
  const sum = (arr) => arr.reduce((a,b)=>a+(+b||0),0);

  // Monthly series (Revenue & Units)
  const monthKey = (r) => {
    const d = new Date(r[fDate] || Date.now());
    return isNaN(d) ? 'Unknown' : `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
  };
  const mGroups = by(monthKey, r => ({ rev: +r[fValue]||0, units: +r[fUnits]||0 }));
  const months = Object.keys(mGroups).sort();
  const revSeries = months.map(m => sum(mGroups[m].map(x=>x.rev)));
  const unitSeries = months.map(m => sum(mGroups[m].map(x=>x.units)));

  // Top products by revenue
  const pGroups = by(r => r[fProduct], r => +r[fValue]||0);
  const pAgg = Object.entries(pGroups).map(([k,v]) => [k, sum(v)]).sort((a,b)=>b[1]-a[1]).slice(0,10);
  const prodCats = pAgg.map(x=>x[0]);
  const prodVals = pAgg.map(x=>+x[1].toFixed(2));

  // Region sales
  const rGroups = by(r => r[fRegion], r => +r[fValue]||0);
  const rAgg = Object.entries(rGroups).map(([k,v]) => [k, sum(v)]).sort((a,b)=>b[1]-a[1]);
  const regionCats = rAgg.map(x=>x[0]);
  const regionVals = rAgg.map(x=>+x[1].toFixed(2));

  // Channel stacked area
  const cGroups = by(r => r[fChannel] || 'Online', r => ({ m: monthKey(r), val: +r[fValue]||0 }));
  const channels = Object.keys(cGroups);
  const stackedSeries = channels.map(ch => {
    const byM = cGroups[ch].reduce((m, x) => { m[x.m] = (m[x.m]||0)+x.val; return m; }, {});
    return months.map(m => +(byM[m]||0).toFixed(2));
  });

  // KPI mini trends (randomized until you wire real KPIs)
  const k1 = months.map(()=> +(Math.random()*100).toFixed(2));
  const k2 = months.map(()=> +(Math.random()*100).toFixed(2));
  const k3 = months.map(()=> +(Math.random()*5).toFixed(2));
  const kCac = months.map(()=> +(Math.random()*20).toFixed(2));

  function createE(elementId, options) {
    // MODIFIED: Use rootDomElement.querySelector instead of document.getElementById
    const el = rootDomElement.querySelector(`#${elementId}`);
    if (!el) {
        console.warn(`Chart container with ID "${elementId}" not found within the wireframe.`);
        return;
    }
    el.innerHTML = ''; // Clear previous content
    const inst = echarts.init(el);
    inst.setOption(options);
    chartInstancesRef.current.push(inst);
    window.addEventListener('resize', () => inst.resize());
  }

  // KPI mini-trends:
  const spark = (color, data) => ({
    xAxis:{type:'category',show:false},
    yAxis:{type:'value',show:false},
    grid:{top:2,bottom:2,left:2,right:2},
    series:[{type:'line',data,showSymbol:false,smooth:true,areaStyle:{opacity:.2},lineStyle:{color}}]
  });
  createE('kpiRevenueTrend', spark('#00E396', k1));
  createE('kpiUnitsTrend',   spark('#008FFB', k2));
  createE('kpiAOVTrend',     spark('#5A54F1', k3));
  createE('kpiCacTrend',     spark('#FFC107', kCac));

  // Goal gauge (static demo)
  createE('goalProgressGauge', { series:[{type:'gauge', min:0,max:100, data:[{value:75}], detail:{formatter:'{value}%'}}] });

  // Dual-axis line
  createE('dualAxisLineChart', {
    tooltip:{trigger:'axis'}, legend:{}, xAxis:{type:'category', data: months}, yAxis:[{type:'value'},{type:'value'}],
    series:[
      { name:'Total Revenue', type:'line', yAxisIndex:0, data: revSeries, smooth:true },
      { name:'Units Sold', type:'line', yAxisIndex:1, data: unitSeries, smooth:true }
    ]
  });

  // Stacked area by channel
  createE('stackedAreaChart', {
    tooltip:{trigger:'axis'}, legend:{data:channels}, xAxis:{type:'category', data: months}, yAxis:{type:'value'},
    series: channels.map((ch,i)=>({ name:ch, type:'line', stack:'total', areaStyle:{}, data: stackedSeries[i], smooth:true }))
  });

  // Horizontal bar: top products
  createE('horizontalBarChart', {
    tooltip:{trigger:'axis',axisPointer:{type:'shadow'}}, xAxis:{type:'value'}, yAxis:{type:'category', data: prodCats},
    series:[{ name:'Revenue', type:'bar', data: prodVals }]
  });

  // Treemap (group by product -> value)
  createE('treemapChart', {
    series: [{ type:'treemap', data: pAgg.map(([name,val])=>({ name, value: val })) }]
  });

  // Regional sales
  createE('regionalSalesChart', {
    tooltip:{trigger:'axis',axisPointer:{type:'shadow'}}, xAxis:{type:'value'}, yAxis:{type:'category', data: regionCats},
    series:[{ name:'Sales', type:'bar', data: regionVals }]
  });

  // Scatter: price vs volume (if we only have one measure, just fake volume)
  const scatterData = rows.slice(0, 200).map(r => [ +(+r[fValue]||0).toFixed(2), Math.floor(10+Math.random()*200) ]);
  createE('scatterPlot', {
    tooltip:{trigger:'item'}, xAxis:{type:'value', name:'Avg Price'}, yAxis:{type:'value', name:'Units'},
    series:[{ type:'scatter', data: scatterData }]
  });
}