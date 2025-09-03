// src/components/ChartRenderer.jsx
'use client';

import React, { useEffect, useRef } from 'react';
import { renderChartsFromData, registerECharts } from '../lib/chartUtils';

// Register ECharts components once when this module is loaded
registerECharts();

// MODIFIED: Accepted rootDomElement as a prop
export default function ChartRenderer({ generatedWireframe, dataSet, schema, rootDomElement }) {
  const chartInstancesRef = useRef([]);

  // Re-render charts whenever the generated DOM or data changes
  useEffect(() => {
    // Ensure both wireframe and rootDomElement are available before trying to render charts
    if (!generatedWireframe || !rootDomElement) {
      chartInstancesRef.current.forEach((c) => c?.dispose?.()); // Clean up if condition is no longer met
      chartInstancesRef.current = [];
      return;
    }

    // MODIFIED: Pass rootDomElement to renderChartsFromData
    renderChartsFromData(dataSet, schema, chartInstancesRef, rootDomElement);

    // Dispose charts on unmount or on re-render to prevent memory leaks
    return () => {
      chartInstancesRef.current.forEach((c) => c?.dispose?.());
      chartInstancesRef.current = [];
    };
  }, [generatedWireframe, dataSet, schema, rootDomElement]); // MODIFIED: Add rootDomElement to dependencies

  return null; // This component doesn't render any DOM itself, only manages ECharts instances
}