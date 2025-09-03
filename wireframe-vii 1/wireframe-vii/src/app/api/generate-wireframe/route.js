// app/api/generate-wireframe/route.js
import { NextResponse } from 'next/server';

// Force Node runtime to allow fetch, Buffer, and other Node APIs comfortably.
export const runtime = 'nodejs';

const NVIDIA_API_KEY = process.env.NVIDIA_API_KEY;

// ---- Utilities -------------------------------------------------------------

/**
 * Tight instruction fallback when client-side POML compile isn't provided.
 */
function buildPlainInstructions(userText, hasImage) {
  return `
You are an expert at generating clean, modern, production-quality dashboard HTML/JSX using only Tailwind CSS.

USER INSTRUCTIONS:
${(userText || '').trim()}

STRICT REQUIREMENTS:
- Use a dark Tailwind theme (bg-gray-900/800/700, light text accents).
- Sections (with headings): I. KPIs, II. Trend & Volume, III. Breakdown & Distribution, IV. Performance & Comparison, V. Interactivity & Global Filters.
- Chart containers ONLY (no <canvas>/<svg>): exact IDs
  goalProgressGauge, dualAxisLineChart, stackedAreaChart, horizontalBarChart, treemapChart, regionalSalesChart, scatterPlot.
- KPI tiles must include EMPTY divs with IDs:
  kpiRevenueTrend, kpiUnitsTrend, kpiAOVTrend (each height h-16).
- Filters use Tailwind-styled <select>, <input type="date">, and buttons (responsive widths).
- Return ONLY HTML/JSX from the first tag to the last tag (no prose/markdown/comments).
${hasImage ? 'If an image is provided, align layout and color accents with it.' : 'No image provided; infer layout from text only.'}
  `.trim();
}

/**
 * Build a compact, model-friendly data context from schema + preview rows.
 * Limits total size to keep the prompt light.
 */
function buildDataContext(schema, dataPreview) {
  if (!schema || !Array.isArray(schema.tables) || schema.tables.length === 0) return '';

  const tables = schema.tables.slice(0, 4).map((t) => {
    const fieldList = (t.fields || []).map((f) => f.name).join(', ');
    const sampleRows =
      dataPreview && dataPreview[t.name]
        ? dataPreview[t.name].slice(0, 5) // keep it small
        : [];
    return [
      `TABLE: ${t.name}`,
      `FIELDS: ${fieldList || '(none)'}`,
      sampleRows.length
        ? `SAMPLE: ${JSON.stringify(sampleRows, null, 2)}`
        : `SAMPLE: []`,
    ].join('\n');
  });

  return `
DATA CONTEXT (align visuals to these fields; derive when absent):
${tables.join('\n\n')}

BINDING GUIDANCE:
- dualAxisLineChart: x = month from date-like field (e.g., OrderDate), y1 = revenue (e.g., SaleValue), y2 = units/volume (derive if missing).
- stackedAreaChart: x = month; series = categorical channel-like field (e.g., Category/Channel), value = revenue.
- horizontalBarChart: categories = Top 10 products by revenue (e.g., ProductName); value = revenue.
- treemapChart: product/category contribution by revenue.
- regionalSalesChart: categories = Region; value = revenue.
- scatterPlot: x = price/revenue proxy; y = volume/units (derive if missing).
- Use EXACT container IDs. If a field name is slightly different, map it. NEVER rename the container IDs.
`.trim();
}

/**
 * Extract fenced code block (```html/```jsx/```js) if the model returned one.
 * Otherwise return the full string.
 */
function extractCode(generatedContent) {
  const codeMatch = generatedContent.match(/```(?:html|jsx|js)?\n([\s\S]*?)\n```/);
  if (codeMatch) return codeMatch[1].trim();
  return (generatedContent || '').trim();
}

/**
 * Ensure required containers exist to guarantee ECharts rendering.
 */
function ensureRequiredContainers(html) {
  const ids = [
    'goalProgressGauge',
    'dualAxisLineChart',
    'stackedAreaChart',
    'horizontalBarChart',
    'treemapChart',
    'regionalSalesChart',
    'scatterPlot',
    'kpiRevenueTrend',
    'kpiUnitsTrend',
    'kpiAOVTrend',
  ];
  let out = html || '';
  ids.forEach((id) => {
    if (!out.includes(`id="${id}"`)) {
      out += `\n<div id="${id}" class="w-full h-80"></div>`;
    }
  });
  return out;
}

/**
 * If the result is not HTML-like, wrap in <pre> so preview doesn't blow up.
 */
function coerceHtml(finalCode) {
  const looksLikeHtml = /<\s*(div|section|main|header|article|ul|ol|h[1-6]|form)\b/i.test(finalCode);
  if (!looksLikeHtml) {
    return `<pre class="text-sm whitespace-pre-wrap">${finalCode
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')}</pre>`;
  }
  return finalCode;
}

// ---- Route Handler ---------------------------------------------------------

export async function POST(request) {
  try {
    const {
      image,
      textPrompt,
      compiledInstructions, // optional (from client-side shim/compile)
      dataSchema,           // optional schema: { tables: [{ name, fields: [{name,tags?}] }...] }
      dataPreview,          // optional { [tableName]: rows[] } – a small slice
    } = await request.json();

    if (!textPrompt || !textPrompt.trim()) {
      return NextResponse.json(
        { error: 'Text prompt is mandatory. Please provide instructions to the AI.' },
        { status: 400 }
      );
    }
    if (!NVIDIA_API_KEY) {
      return NextResponse.json(
        { error: 'NVIDIA_API_KEY not set in environment variables. Check your .env.local file.' },
        { status: 500 }
      );
    }

    // Build instructions = (compiled POML || strict fallback) + data context block if provided
    const baseInstr =
      (compiledInstructions && compiledInstructions.trim()) ||
      buildPlainInstructions(textPrompt, !!image);

    const dataBlock = buildDataContext(dataSchema, dataPreview);
    const instructions = dataBlock ? `${baseInstr}\n\n${dataBlock}` : baseInstr;

    // --- Call NVIDIA NIM (Chat Completions) ---
    // Keep your model and endpoint
    const NVIDIA_NIM_MODEL_ID = 'meta/llama-4-maverick-17b-128e-instruct';
    const NIM_API_URL = 'https://integrate.api.nvidia.com/v1/chat/completions';

    const messagesContent = [{ type: 'text', text: instructions }];
    if (image) {
      messagesContent.push({ type: 'image_url', image_url: { url: image } });
    }

    const requestBody = {
      model: NVIDIA_NIM_MODEL_ID,
      messages: [{ role: 'user', content: messagesContent }],
      max_tokens: 2048,
      temperature: 0.1,
    };

    const response = await fetch(NIM_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${NVIDIA_API_KEY}`,
      },
      body: JSON.stringify(requestBody),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`NVIDIA API Error: ${response.status} - ${errorText}`);
      throw new Error(`NVIDIA API request failed: ${response.status} ${response.statusText}. Details: ${errorText}`);
    }

    const data = await response.json();
    const generatedContent = data.choices?.[0]?.message?.content;
    if (!generatedContent) {
      console.error('NVIDIA API returned no content:', JSON.stringify(data, null, 2));
      throw new Error('Failed to get content from NVIDIA API response. Check API response structure.');
    }

    // Extract HTML/JSX, post-process to guarantee chart containers
    let finalCode = extractCode(generatedContent);
    finalCode = ensureRequiredContainers(finalCode);
    finalCode = coerceHtml(finalCode);

    return NextResponse.json({ wireframeCode: finalCode });
  } catch (error) {
    console.error('API Error in /api/generate-wireframe:', error);
    return NextResponse.json({ error: error.message || 'Internal Server Error' }, { status: 500 });
  }
}