// src/app/page.jsx
'use client';

import React, { useState } from 'react';
import DashboardControls from '../components/DashboardControls';
import DashboardPreview from '../components/DashboardPreview';

export default function Home() {
  // --- UI State ---
  const [generatedWireframe, setGeneratedWireframe] = useState('');
  const [showCode, setShowCode] = useState(true);
  const [userImagePrompt, setUserImagePrompt] = useState(
    'Design a modern and interactive dashboard for "Product Sales Performance" with a dark theme...'
  );
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [metadataText, setMetadataText] = useState('');
  const [schema, setSchema] = useState(null);
  const [dataSet, setDataSet] = useState(null);
  const [rowsPerTable, setRowsPerTable] = useState(250);
  const [usePoml, setUsePoml] = useState(true);
  const [pomlTemplate, setPomlTemplate] = useState('');
  const [manualCodeInput, setManualCodeInput] = useState('');

  return (
    <div className="flex flex-col min-h-screen bg-gray-950">
      <header className="py-6 px-4 md:px-8 bg-gray-900 text-white shadow-lg">
        <h1 className="text-3xl font-extrabold text-center mb-2 tracking-wide">Dashboard Prototyper ✨</h1>
        <p className="text-center text-gray-300 text-lg">
          Generate UI mockups with Next.js + Tailwind. Align charts with your metadata-driven mock data.
        </p>
      </header>
      <main className="flex-grow container mx-auto p-4 md:p-8 flex flex-col gap-8">
        <DashboardControls
          generatedWireframe={generatedWireframe}
          setGeneratedWireframe={setGeneratedWireframe}
          loading={loading}
          setLoading={setLoading}
          error={error}
          setError={setError}
          userImagePrompt={userImagePrompt}
          setUserImagePrompt={setUserImagePrompt}
          pomlTemplate={pomlTemplate}
          setPomlTemplate={setPomlTemplate}
          usePoml={usePoml}
          setUsePoml={setUsePoml}
          metadataText={metadataText}
          setMetadataText={setMetadataText}
          schema={schema}
          setSchema={setSchema} // Pass setter as well if schema can be updated from controls
          dataSet={dataSet}
          setDataSet={setDataSet} // Pass setter as well if dataSet can be updated from controls
          rowsPerTable={rowsPerTable}
          setRowsPerTable={setRowsPerTable}
          manualCodeInput={manualCodeInput}
          setManualCodeInput={setManualCodeInput}
          showCode={showCode}
          setShowCode={setShowCode}
        />
        <DashboardPreview
          generatedWireframe={generatedWireframe}
          dataSet={dataSet}
          schema={schema}
        />
      </main>
      <footer className="py-4 px-4 md:px-8 bg-gray-900 text-white mt-8 text-center text-sm">
        <p className="text-gray-400">Powered by Next.js, Tailwind CSS, ECharts, and a Python data generator.</p>
      </footer>
    </div>
  );
}