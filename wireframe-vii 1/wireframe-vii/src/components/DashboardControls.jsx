// src/components/DashboardControls.jsx
'use client';

import React, { useRef, useEffect } from 'react';
import { DEFAULT_DASHBOARD_POML, compilePomlToTextShim } from '../lib/pomlUtils'; // From new lib
import { copyToClipboard, downloadJSON, downloadText, downloadAsJSX, downloadZipApp } from '../lib/exportUtils'; // From new lib

// manualCodeInput content for initial example
const initialManualExample = `
<div class="p-4 bg-gray-900 text-gray-100 min-h-screen">
  <h1 class="text-3xl font-bold mb-6 text-center">Product Sales Dashboard</h1>
  
  <!-- Global Filters -->
  <div class="flex flex-wrap gap-4 mb-8 bg-gray-800 p-4 rounded-lg shadow-md">
    <div class="flex items-center gap-2">
      <label for="order-year" class="text-sm font-medium">Order Year:</label>
      <select id="order-year" class="bg-gray-700 border border-gray-600 text-sm rounded-md p-2 w-full sm:w-auto md:w-32">
        <option>All</option>
        <option>2023</option>
        <option>2022</option>
      </select>
    </div>
    <div class="flex items-center gap-2">
      <label for="supplier" class="text-sm font-medium">Supplier:</label>
      <select id="supplier" class="bg-gray-700 border border-gray-600 text-sm rounded-md p-2 w-full sm:w-auto md:w-48">
        <option>All</option>
        <option>Supplier A</option>
        <option>Supplier B</option>
      </select>
    </div>
    <div class="flex items-center gap-2">
      <label for="category" class="text-sm font-medium">Category:</label>
      <select id="category" class="bg-gray-700 border border-gray-600 text-sm rounded-md p-2 w-full sm:w-auto md:w-48">
        <option>All</option>
        <option>Electronics</option>
        <option>Clothing</option>
      </select>
    </div>
    <div class="flex items-center gap-2">
      <label for="country" class="text-sm font-medium">Country:</label>
      <select id="country" class="bg-gray-700 border border-gray-600 text-sm rounded-md p-2 w-full sm:w-auto md:w-48">
        <option>All</option>
        <option>USA</option>
        <option>Germany</option>
      </select>
    </div>
    <button class="ml-auto px-4 py-2 bg-blue-600 hover:bg-blue-700 rounded-md text-white font-semibold">Apply Filters</button>
  </div>
  <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
    <div class="bg-gray-800 p-4 rounded-lg shadow-md">
      <p class="text-sm text-gray-400">Total Revenue</p>
      <h3 class="text-2xl font-bold text-green-400">$1.23M</h3>
      <div id="kpiRevenueTrend" class="w-full h-16"></div>
    </div>
    <div class="bg-gray-800 p-4 rounded-lg shadow-md">
      <p class="text-sm text-gray-400">Total Units Sold</p>
      <h3 class="text-2xl font-bold text-blue-400">87,654</h3>
      <div id="kpiUnitsTrend" class="w-full h-16"></div>
    </div>
    <div class="bg-gray-800 p-4 rounded-lg shadow-md">
      <p class="text-sm text-gray-400">Average Order Value</p>
      <h3 class="text-2xl font-bold text-purple-400">$14.08</h3>
      <div id="kpiAOVTrend" class="w-full h-16"></div>
    </div>
    <div class="bg-gray-800 p-4 rounded-lg shadow-md flex flex-col justify-between items-center">
      <p class="text-sm text-gray-400">Quarterly Goal</p>
      <div id="goalProgressGauge" class="w-full h-40"></div>
    </div>
  </div>
  <div class="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
    <div class="bg-gray-800 p-4 rounded-lg shadow-md">
      <h3 class="text-lg font-semibold mb-2">Monthly Revenue & Units Trend</h3>
      <div id="dualAxisLineChart" class="w-full h-80"></div>
    </div>
    <div class="bg-gray-800 p-4 rounded-lg shadow-md">
      <h3 class="text-lg font-semibold mb-2">Channel Revenue Contribution</h3>
      <div id="stackedAreaChart" class="w-full h-80"></div>
    </div>
  </div>
  <div class="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
    <div class="bg-gray-800 p-4 rounded-lg shadow-md">
      <h3 class="text-lg font-semibold mb-2">Top/Bottom Products</h3>
      <div id="horizontalBarChart" class="w-full h-80"></div>
    </div>
    <div class="bg-gray-800 p-4 rounded-lg shadow-md">
      <h3 class="text-lg font-semibold mb-2">Product Category Breakdown</h3>
      <div id="treemapChart" class="w-full h-80"></div>
    </div>
  </div>
  <div class="grid grid-cols-1 lg:grid-cols-2 gap-6">
    <div class="bg-gray-800 p-4 rounded-lg shadow-md">
      <h3 class="text-lg font-semibold mb-2">Regional Sales</h3>
      <div id="regionalSalesChart" class="w-full h-80"></div>
    </div>
    <div class="bg-gray-800 p-4 rounded-lg shadow-md">
      <h3 class="text-lg font-semibold mb-2">Price vs. Volume</h3>
      <div id="scatterPlot" class="w-full h-80"></div>
    </div>
  </div>
  <p class="text-center text-gray-500 text-xs mt-8">This dashboard mockup is built with Tailwind CSS, and charts are rendered with ECharts (mock data).</p>
</div>
`.trim();

export default function DashboardControls({
  generatedWireframe, setGeneratedWireframe,
  loading, setLoading,
  error, setError,
  userImagePrompt, setUserImagePrompt,
  pomlTemplate, setPomlTemplate,
  usePoml, setUsePoml,
  metadataText, setMetadataText,
  schema, setSchema, // Schema setter should be passed as it's updated here
  dataSet, setDataSet, // DataSet setter should be passed as it's updated here
  rowsPerTable, setRowsPerTable,
  manualCodeInput, setManualCodeInput,
  showCode, setShowCode, // ADDED: showCode and setShowCode props
}) {
  const imgFileRef = useRef(null);

  // Load template (useEffect from page.jsx)
  useEffect(() => {
    let cancelled = false;
    fetch('/prompts/dashboard.poml')
      .then((res) => (res.ok ? res.text() : Promise.reject(new Error('Template not found'))))
      .then((text) => { if (!cancelled) setPomlTemplate(text); })
      .catch(() => { if (!cancelled) setPomlTemplate(DEFAULT_DASHBOARD_POML); });
    return () => { cancelled = true; };
  }, [setPomlTemplate]);

  // Init manual example (useEffect from page.jsx)
  useEffect(() => {
    setManualCodeInput(initialManualExample);
  }, [setManualCodeInput]);


  // ----------------- File handlers -----------------
  const onMetadataFileChange = async (e) => {
    setError(null);
    const f = e.target.files?.[0];
    if (!f) return;
    const text = await f.text();
    setMetadataText(text);
  };

  // ----------------- Data generation -----------------
  const handleGenerateData = async () => {
    if (!metadataText) {
      setError('Please upload a Qlik metadata JSON file first.');
      return;
    }
    setError(null);
    setLoading(true);
    try {
      const res = await fetch('/api/gen-data', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ metadataText, rowsPerTable }),
      });
      if (!res.ok) {
        const e = await res.json().catch(() => ({}));
        throw new Error(e?.error || 'Failed to generate data');
      }
      const { schema: sch, data, generator } = await res.json();
      setSchema(sch);
      setDataSet(data);
      console.log('Data generated via:', generator);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  // ----------------- AI Generation -----------------
  const handleGenerateWireframe = async () => {
    if (!userImagePrompt.trim()) {
      setError('Please provide a text prompt to guide the AI.');
      return;
    }
    setLoading(true);
    setError(null);
    setGeneratedWireframe('');

    let base64Image = null;
    const file = imgFileRef.current?.files?.[0];
    if (file) {
      try {
        base64Image = await new Promise((resolve, reject) => {
          const r = new FileReader();
          r.onloadend = () => resolve(r.result);
          r.onerror = reject;
          r.readAsDataURL(file);
        });
      } catch (err) {
        setError(`Failed to read image file: ${err.message}`);
        setLoading(false);
        return;
      }
    }

    try {
      let compiledInstructions = null;
      if (usePoml && pomlTemplate) {
        const effectivePoml = pomlTemplate.replace('{{USER_INSTRUCTIONS}}', userImagePrompt);
        compiledInstructions = compilePomlToTextShim(effectivePoml, userImagePrompt);
      }
      const schemaForAI = schema ?? null;
      const dataPreview = dataSet
        ? Object.fromEntries(Object.entries(dataSet).map(([k, arr]) => [k, arr.slice(0, 100)]))
        : null;

      const response = await fetch('/api/generate-wireframe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          image: base64Image,
          textPrompt: userImagePrompt,
          compiledInstructions,
          dataSchema: schemaForAI,
          dataPreview,
        }),
      });

      if (!response.ok) {
        const e = await response.json().catch(() => ({}));
        throw new Error(e?.error || 'Failed to generate wireframe.');
      }

      const data = await response.json();
      setGeneratedWireframe(data.wireframeCode); // ensureRequiredContainers will be run by Preview component
      setShowCode(true); // Show code automatically after generation
    } catch (err) {
      setError(err.message || 'An unknown error occurred.');
    } finally {
      setLoading(false);
    }
  };

  // ----------------- Manual render -----------------
  const handleRenderManualWireframe = () => {
    setGeneratedWireframe(manualCodeInput); // ensureRequiredContainers will be run by Preview component
    setShowCode(true); // Show code automatically after manual render
  };

  return (
    <div className="flex flex-col space-y-8 bg-white p-6 rounded-lg shadow-md">
      {/* AI Generation */}
      <div className="pb-4 border-b border-gray-200">
        <h2 className="text-xl font-bold mb-4 text-gray-800">Generate Dashboard with AI</h2>
        {/* Use POML Toggle */}
        <label className="inline-flex items-center gap-2 mb-3">
          <input type="checkbox" checked={usePoml} onChange={(e)=>setUsePoml(e.target.checked)}
            className="h-4 w-4 text-blue-600 rounded border-gray-300" />
          <span className="text-sm text-gray-800">Use POML (structured prompt)</span>
        </label>
        {/* Prompt */}
        <label className="block text-sm font-medium text-gray-700 mb-2">
          Text Prompt for AI: <span className="text-red-500">*</span>
        </label>
        <textarea className="w-full p-3 border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500 text-gray-800 h-24 resize-y"
          value={userImagePrompt} onChange={(e)=>{ setUserImagePrompt(e.target.value); setError(null); }} />
        {/* POML template editor */}
        {usePoml && (
          <div className="mt-4">
            <label className="block text-sm font-medium text-gray-700 mb-2">
              POML Template (from <code>/public/prompts/dashboard.poml</code>)
            </label>
            <textarea className="w-full p-3 border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500 text-gray-800 h-56 font-mono text-sm resize-y"
              value={pomlTemplate} onChange={(e)=>setPomlTemplate(e.target.value)} />
          </div>
        )}
        {/* Image */}
        <label className="block text-sm font-medium text-gray-700 mb-2 mt-4">Upload Image (Optional):</label>
        <input type="file" accept="image/*" onChange={()=>setError(null)} ref={imgFileRef}
          className="block w-full text-sm text-gray-500 file:mr-4 file:py-2 file:px-4 file:rounded-md file:border-0 file:text-sm file:font-semibold file:bg-blue-50 file:text-blue-700 hover:file:bg-blue-100 mb-4" />
        {/* Metadata */}
        <div className="mt-6 grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Qlik Metadata JSON:</label>
            <input type="file" accept=".json,.txt" onChange={onMetadataFileChange}
              className="block w-full text-sm text-gray-500 file:mr-4 file:py-2 file:px-4 file:rounded-md file:border-0 file:text-sm file:font-semibold file:bg-emerald-50 file:text-emerald-700 hover:file:bg-emerald-100" />
            <label className="block text-xs text-gray-500 mt-2">Rows per table</label>
            <input type="number" min={50} step={50} value={rowsPerTable} onChange={e=>setRowsPerTable(+e.target.value)}
              className="mt-1 w-32 border border-gray-300 rounded-md p-1 text-sm text-gray-800" />
            <button onClick={handleGenerateData}
              className="ml-2 py-1.5 px-3 bg-emerald-600 text-white rounded-md text-sm hover:bg-emerald-700">Generate Data</button>
          </div>
          <div className="text-sm text-gray-700">
            {schema ? (
              <div className="p-2 bg-gray-50 rounded border">
                <div className="font-semibold mb-1">Data Inspector</div>
                {schema.tables.map((t,i)=>(
                  <div key={i} className="mb-2">
                    <div className="font-medium">{t.name}</div>
                    <div className="text-xs text-gray-600">
                      {t.fields.map(f => <span key={f.name} className="inline-block mr-2">• {f.name}</span>)}
                    </div>
                  </div>
                ))}
                <div className="mt-2">
                  <button onClick={()=>downloadJSON('schema.json', schema)}
                    className="py-1 px-2 bg-gray-800 text-white rounded text-xs mr-2">Download Schema</button>
                  {dataSet && <button onClick={()=>downloadJSON('data.json', dataSet)}
                    className="py-1 px-2 bg-gray-800 text-white rounded text-xs">Download Data</button>}
                </div>
              </div>
            ) : (
              <div className="p-2 text-xs text-gray-500">Upload metadata and click <strong>Generate Data</strong> to see tables & fields.</div>
            )}
          </div>
        </div>
        {/* Action */}
        <div className="mt-4 flex flex-col sm:flex-row gap-3">
          <button onClick={handleGenerateWireframe}
            className="flex-1 py-3 px-6 bg-blue-600 text-white font-semibold rounded-lg shadow-md hover:bg-blue-700 transition-colors"
            disabled={loading}>{loading ? 'Generating...' : 'Generate Dashboard'}</button>
          <button onClick={handleRenderManualWireframe}
            className="py-3 px-6 bg-gray-600 text-white font-semibold rounded-lg shadow-md hover:bg-gray-700">Render Manual</button>
        </div>
        {loading && (
          <div className="w-full bg-gray-200 rounded-full h-2.5 mt-4">
            <div className="bg-blue-600 h-2.5 rounded-full animate-pulse" style={{ width: '100%' }} />
          </div>
        )}
        {error && <p className="text-red-500 text-sm mt-4">{error}</p>}
      </div>
      {/* Generated Code Viewer */}
      <div className="pt-2">
        <div className="flex items-center justify-between mb-2">
          <h2 className="text-xl font-bold text-gray-800">Generated Code</h2>
          <div className="flex gap-2">
            <button onClick={() => downloadText('dashboard.html', generatedWireframe)} className="py-1.5 px-3 bg-gray-800 text-white rounded text-sm">Download HTML</button>
            <button onClick={() => downloadAsJSX('Dashboard', generatedWireframe)} className="py-1.5 px-3 bg-gray-800 text-white rounded text-sm" title="Save a React component that renders this HTML">Save as .jsx</button>
            <button onClick={() => downloadZipApp({ title: 'Dashboard', html: generatedWireframe, schema, dataSet })} className="py-1.5 px-3 bg-emerald-700 text-white rounded text-sm" title="HTML + ECharts + data.json for local open">Download App (.zip)</button>
            <button onClick={() => copyToClipboard(generatedWireframe)} className="py-1.5 px-3 bg-gray-800 text-white rounded text-sm">Copy Code</button>
            <button onClick={() => setShowCode(!showCode)} className="py-1.5 px-3 bg-gray-800 text-white rounded text-sm">
              {showCode ? 'Hide Code' : 'Show Code'}
            </button>
          </div>
        </div>
        {showCode && (
          <pre className="w-full bg-gray-800 p-4 rounded-md text-sm text-gray-50 overflow-auto h-96 font-mono">
            <code>{generatedWireframe || 'Generated HTML/JSX will appear here.'}</code>
          </pre>
        )}
        {/* Manual Code Input */}
        <div className="mt-6">
          <label className="block text-sm font-medium text-gray-700 mb-2">Or enter manual HTML/JSX:</label>
          <textarea
            className="w-full p-3 border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500 text-gray-800 h-56 font-mono text-sm resize-y"
            value={manualCodeInput}
            onChange={(e) => setManualCodeInput(e.target.value)}
          />
        </div>
      </div>
    </div>
  );
}