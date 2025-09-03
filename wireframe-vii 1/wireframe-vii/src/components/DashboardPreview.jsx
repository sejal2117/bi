// src/components/DashboardPreview.jsx
'use client';

import React from 'react';
import { exportAsImage, exportAsPDF } from '../lib/exportUtils';
import { ensureRequiredContainers } from '../lib/pomlUtils';
import ChartRenderer from './ChartRenderer';

export default function DashboardPreview({ generatedWireframe, dataSet, schema }) {
  const wireframeContainerRef = React.useRef(null);

  // Function to prepare HTML before rendering/exporting
  const getRenderableHtml = () => {
    // Client-side ensureRequiredContainers for any edge cases not caught server-side
    // and to add the default height if not already present.
    return ensureRequiredContainers(generatedWireframe);
  };

  const handleExportImage = (type) => {
    if (wireframeContainerRef.current) {
      exportAsImage(type, wireframeContainerRef.current);
    }
  };

  const handleExportPDF = () => {
    if (wireframeContainerRef.current) {
      exportAsPDF(wireframeContainerRef.current);
    }
  };

  return (
    <div className="bg-gray-900 p-6 rounded-lg shadow-xl flex flex-col">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-xl font-bold text-gray-200">Dashboard Preview</h2>
        <div className="flex gap-2">
          <button onClick={() => handleExportImage('png')} className="py-1.5 px-3 bg-indigo-600 hover:bg-indigo-700 text-white rounded text-sm">PNG</button>
          <button onClick={() => handleExportImage('jpeg')} className="py-1.5 px-3 bg-indigo-600 hover:bg-indigo-700 text-white rounded text-sm">JPG</button>
          <button onClick={handleExportPDF} className="py-1.5 px-3 bg-indigo-600 hover:bg-indigo-700 text-white rounded text-sm">PDF</button>
        </div>
      </div>
      <div className="flex-grow border border-gray-700 p-4 rounded-md overflow-auto bg-gray-800 flex items-start justify-center min-h-[500px]">
        {generatedWireframe ? (
          <>
            <div id="wireframeContainer" ref={wireframeContainerRef} className="w-full max-w-full" dangerouslySetInnerHTML={{ __html: getRenderableHtml() }} />
            {/* MODIFIED: Pass wireframeContainerRef.current to ChartRenderer */}
            <ChartRenderer generatedWireframe={generatedWireframe} dataSet={dataSet} schema={schema} rootDomElement={wireframeContainerRef.current} />
          </>
        ) : (
          <p className="text-center text-gray-400 py-20 text-lg">
            Upload metadata & generate data, then click <strong>Generate Dashboard</strong> to see it here.
          </p>
        )}
      </div>
    </div>
  );
}