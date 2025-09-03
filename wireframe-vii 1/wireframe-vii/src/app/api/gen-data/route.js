import { NextRequest, NextResponse } from 'next/server';
import { spawn } from 'node:child_process';

function tryParseJsonLike(input) {
  try { return JSON.parse(input); } catch { return null; }
}

// Fallback parser for Qlik-like exports (not strict JSON).
function parseQlikMetadataLoose(text) {
  // Heuristics: capture "tables name <TableName>" blocks and "fields name <FieldName>" lines.
  const tables = [];
  const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);

  // Find all field lines
  const fields = [];
  for (const l of lines) {
    // Example: name SaleValue ... tags $numeric $integer
    const nameMatch = l.match(/^name\s+([A-Za-z0-9_\-$]+)\s/i);
    if (nameMatch && /fields/i.test(text)) {
      // Try to find tags on the same line
      const tagMatch = l.match(/tags\s+(.+)$/i);
      const tags = tagMatch ? tagMatch[1].split(/\s+/) : [];
      fields.push({ name: nameMatch[1], tags });
    }
  }

  // Find a table name (there may be multiple; add all)
  const tableNameRegex = /tables\s+name\s+([A-Za-z0-9_\-$\s]+)/ig;
  let m;
  const seen = new Set();
  while ((m = tableNameRegex.exec(text)) !== null) {
    const raw = (m[1] || '').trim();
    if (!raw) continue;
    // take first token before whitespace that isn't system table
    const tname = raw.split(/\s+/)[0];
    if (!seen.has(tname) && !tname.startsWith('$$SysTable')) {
      seen.add(tname);
      tables.push({ name: tname, fields: [] });
    }
  }

  // If we found no tables, create a generic one
  if (tables.length === 0) {
    tables.push({ name: 'Final_Data', fields: [] });
  }

  // If we have no fields extracted, add common BI fields as hints
  const fset = fields.length ? fields : [
    { name: 'OrderID' }, { name: 'OrderDate', tags: ['$date'] },
    { name: 'Region' }, { name: 'Country' },
    { name: 'ProductName' }, { name: 'SaleValue', tags: ['$numeric'] }
  ];

  // Attach fields to each non-system table
  return { tables: tables.map(t => ({ ...t, fields: fset })) };
}

function normalizeSchema(parsed) {
  // If it already looks like { tables: [...] }, keep it.
  if (parsed && Array.isArray(parsed.tables)) {
    return { tables: parsed.tables.map((t) => ({
      name: String(t.name || 'Table1'),
      fields: (t.fields || []).map((f) => ({ name: String(f.name), tags: f.tags || [] }))
    })) };
  }
  // If Qlik-esque loose format
  return parseQlikMetadataLoose(typeof parsed === 'string' ? parsed : '');
}

function jsFallbackGenerator(schema, rowsPerTable) {
  function inferType(f) {
    const n = f.name.toLowerCase();
    const tags = (f.tags || []).join(' ').toLowerCase();
    if (tags.includes('$date') || /date|year/.test(n)) return 'date';
    if (tags.includes('$numeric') || tags.includes('$integer')) return 'number';
    return 'text';
  }

  function synth(ftype, name) {
    const n = name.toLowerCase();
    if (ftype === 'date') {
      const start = Date.now() - 730 * 86400000; // ~2 years
      const d = new Date(start + Math.random() * 730 * 86400000);
      return d.toISOString().slice(0, 10);
    }
    if (ftype === 'number') {
      if (/(price|amount|revenue|sale|value)/.test(n)) return +(10 + Math.random() * 1990).toFixed(2);
      if (/(qty|units|count)/.test(n)) return Math.floor(1 + Math.random() * 5000);
      return +((Math.random() * 1000).toFixed(2));
    }
    if (/region/.test(n)) return ['North America', 'Europe', 'Asia', 'South America', 'Africa', 'Oceania'][Math.floor(Math.random() * 6)];
    if (/country/.test(n)) return ['USA', 'Canada', 'UK', 'Germany', 'France', 'India', 'Japan', 'Brazil', 'Australia', 'South Africa'][Math.floor(Math.random() * 10)];
    if (/product|name/.test(n)) return ['Product A', 'Product B', 'Product C', 'Product D', 'Product E', 'Product F', 'Product G', 'Product H', 'Product I', 'Product J'][Math.floor(Math.random() * 10)];
    if (/category/.test(n)) return ['Online', 'Retail', 'Wholesale', 'Direct Sales'][Math.floor(Math.random() * 4)];
    return `${name}_${Math.floor(1000 + Math.random() * 9000)}`;
  }

  const data = {};
  for (const t of schema.tables) {
    const typed = t.fields.map(f => ({ name: f.name, type: inferType(f) }));
    data[t.name] = Array.from({ length: rowsPerTable }).map(() => {
      const row = {};
      typed.forEach(f => row[f.name] = synth(f.type, f.name));
      return row;
    });
  }
  return data;
}

export async function POST(req) {
  try {
    const { metadataText, rowsPerTable = 250 } = await req.json();

    if (!metadataText || typeof metadataText !== 'string') {
      return NextResponse.json({ error: 'metadataText (string) is required' }, { status: 400 });
    }

    // 1) Try JSON parse; else treat as loose Qlik export.
    const parsed = tryParseJsonLike(metadataText) ?? metadataText;
    const schema = normalizeSchema(parsed);

    // 2) Try Python script first
    const py = spawn(process.platform === 'win32' ? 'python' : 'python3', ['scripts/gen_mock_data.py']);
    const payload = JSON.stringify({ schema, rowsPerTable });

    const result = await new Promise((resolve) => {
      let stdout = '', stderr = '';
      py.stdout.on('data', (d) => (stdout += d.toString()));
      py.stderr.on('data', (d) => (stderr += d.toString()));

      py.on('close', (code) => {
        if (code === 0) {
          try { resolve({ ok: true, out: JSON.parse(stdout) }); }
          catch (e) { resolve({ ok: false, err: 'Python JSON parse failed: ' + e.message }); }
        } else {
          resolve({ ok: false, err: `Python exited ${code}: ${stderr}` });
        }
      });

      py.stdin.write(payload);
      py.stdin.end();
    });

    let data;
    let used = 'python';

    if (result.ok && result.out?.data) {
      data = result.out.data;
    } else {
      // Fallback to JS generation
      data = jsFallbackGenerator(schema, rowsPerTable);
      used = 'js-fallback';
    }

    return NextResponse.json({ schema, data, generator: used });

  } catch (e) {
    return NextResponse.json({ error: e?.message || 'Failed to generate data' }, { status: 500 });
  }
}