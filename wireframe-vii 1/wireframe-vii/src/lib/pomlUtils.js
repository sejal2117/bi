// src/lib/pomlUtils.js

// POML fallback template (content derived from Code 2, but corrected)
export const DEFAULT_DASHBOARD_POML = `
<poml>
  <role>
    You are an expert UI prototyper who generates clean, modern dashboard HTML/JSX using only Tailwind CSS.
  </role>
  <task>
    Generate a dark-themed analytics dashboard based on the user's instructions.
    Return only HTML/JSX (no html/head/body, scripts, markdown, or comments).
    
    <cp caption="Dashboard Structure">
      The dashboard should have the following distinct sections, clearly separated:
      I. Overview & KPIs
      II. Trend & Volume Analysis
      III. Breakdown & Distribution
      IV. Performance & Comparison
      V. Interactivity & Global Filters
    </cp>
    
    <cp caption="Chart Container IDs">
      Use ONLY container \`div\`s (no canvas/svg) for charts. Ensure the following IDs are present on \`div\` elements:
      <list>
        <item>\`goalProgressGauge\`</item>
        <item>\`dualAxisLineChart\`</item>
        <item>\`stackedAreaChart\`</item>
        <item>\`horizontalBarChart\`</item>
        <item>\`treemapChart\`</item>
        <item>\`regionalSalesChart\`</item>
        <item>\`scatterPlot\`</item>
      </list>
      For KPI mini-trends, generate empty \`div\` elements with IDs:
      <list>
        <item>\`kpiRevenueTrend\`</item>
        <item>\`kpiUnitsTrend\`</item>
        <item>\`kpiAOVTrend\`</item>
        <item>\`kpiCacTrend\`</item>
      </list>
      These KPI mini-trend divs should have a height of \`h-16\` (64px) and no placeholder text.
    </cp>
    
    <cp caption="Styling Guidelines">
      Use Tailwind-styled \`select\`, \`input\`, and \`button\` elements for filters.
      Make select elements responsive (e.g., \`w-full sm:w-auto md:w-48\`).
      Start with a single root container (e.g., \`<div className="dashboard-container">\`).
      Use headings and consistent spacing throughout the layout.
      Avoid placeholder text inside chart divs; they should be empty.
      End exactly at the closing tag of the root container.
    </cp>
    <cp caption="User Instructions">
      {{USER_INSTRUCTIONS}}
    </cp>
    <output-format>
      Return only the HTML/JSX code, nothing else.
    </output-format>
  </task>
</poml>
`.trim();

// Lightweight "compile" shim (no pomljs runtime)
export function compilePomlToTextShim(rawPoml, userText) {
  let s = rawPoml.replace('{{USER_INSTRUCTIONS}}', userText ?? '');
  s = s
    .replace(/<role>\s*([\s\S]*?)\s*<\/role>/gi, (_m, g1) => `Role:\n${g1.trim()}\n\n`)
    .replace(/<task>\s*([\s\S]*?)\s*<\/task>/gi, (_m, g1) => `Task:\n${g1.trim()}\n\n`)
    .replace(/<cp\s+caption="([^"]+)"\s*>\s*([\s\S]*?)\s*<\/cp>/gi, (_m, caption, body) => {
      const text = body.replace(/<\/?[^>]+>/g, '').trim();
      return `${caption}:\n${text}\n\n`;
    })
    .replace(/<\/?output-format>/gi, '')
    .replace(/<\/?list>/gi, '')
    .replace(/<\/?item>/gi, '\n- ')
    .replace(/<\/?blockquote>/gi, '')
    .replace(/<\/?code>/gi, '`')
    .replace(/<\/?poml>/gi, '')
    .replace(/<\/?[^>]+>/g, '');
  return s.trim();
}

// Ensure all required chart containers exist (client-side version)
export function ensureRequiredContainers(html) {
  const ids = [
    'goalProgressGauge','dualAxisLineChart','stackedAreaChart','horizontalBarChart',
    'treemapChart','regionalSalesChart','scatterPlot','kpiRevenueTrend','kpiUnitsTrend','kpiAOVTrend',
    'kpiCacTrend'
  ];
  let out = html || '';
  ids.forEach(id => {
    if (!out.includes(`id="${id}"`)) {
      out += `<div id="${id}" class="w-full h-80"></div>`;
    }
  });
  return out;
}