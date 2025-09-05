import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import GridLayout from 'react-grid-layout'
import 'react-grid-layout/css/styles.css'
import 'react-resizable/css/styles.css'

/**
 * Wireframe → PBIP canvas
 * Fixes in this version:
 *  - API base: uses NEXT_PUBLIC_API_URL (default http://localhost:3001) so /wireframe/export/stream hits Elysia.
 *  - Selection: draggable area limited to .drag-handle; body marked .no-drag; onClick selects.
 *  - SSE: robust error handling; if status != 200 or stream breaks, we stop "Building…" and log error.
 */

const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001'

const COLS = 24
const ROW = 32
const WIDTH = 1200
const MARGIN = [8, 8]
const COL_W = (WIDTH - MARGIN[0] * (COLS + 1)) / COLS

const DEFAULT_THEME = {
  name: 'Wireframe Theme',
  dataColors: ['#4e79a7', '#f28e2b', '#e15759', '#76b7b2', '#59a14f', '#edc948'],
  background: '#ffffff',
  foreground: '#1f2937',
  visualStyles: {
    card: { titleColor: '#6b7280', valueColor: '#111827', background: '#ffffff' },
    chart: { axisColor: '#6b7280', gridColor: '#e5e7eb' }
  }
}

const BUILT_IN_TEMPLATES = [
  {
    name: 'Executive Overview',
    theme: DEFAULT_THEME,
    items: [
      { i: 'header', x: 1, y: 0, w: 22, h: 3, type: 'shape:rectangle', title: 'Header' },
      { i: 'kpi1', x: 1, y: 4, w: 6, h: 4, type: 'card', title: 'Revenue', binding: '[PlaceholderRevenue]' },
      { i: 'kpi2', x: 8, y: 4, w: 6, h: 4, type: 'card', title: 'Orders', binding: '[Count]' },
      { i: 'bar1', x: 1, y: 9, w: 11, h: 8, type: 'chart:bar', title: 'Sales by Region' },
      { i: 'line1', x: 13, y: 9, w: 10, h: 8, type: 'chart:line', title: 'Trend' }
    ]
  }
]

const START_TEMPLATE = BUILT_IN_TEMPLATES[0]
const newId = (p = 'id') => `${p}-${Math.random().toString(36).slice(2, 8)}`
const clamp = (n, min, max) => Math.max(min, Math.min(max, n))
const gx = (x) => Math.round(x * COL_W + MARGIN[0] * (x + 1))
const gy = (y) => Math.round(y * ROW + MARGIN[1] * (y + 1))

export default function Wireframe() {
  const [projectName, setProjectName] = useState('WF_Executive')
  const [thinReport, setThinReport] = useState(false)
  const [theme, setTheme] = useState(START_TEMPLATE.theme)
  const [items, setItems] = useState(START_TEMPLATE.items)
  const [sel, setSel] = useState(new Set())
  const [logs, setLogs] = useState([])
  const [artifact, setArtifact] = useState(null)
  const [pbipDir, setPbipDir] = useState(null)
  const [running, setRunning] = useState(false)

  const [guides, setGuides] = useState({ v: [], h: [] })
  const dragStateRef = useRef(null)
  const shiftDownRef = useRef(false)

  // -------- Templates (SSR-safe) --------
  const [templates, setTemplates] = useState([])
  useEffect(() => {
    try {
      const raw = typeof window !== 'undefined' ? window.localStorage.getItem('wireframeTemplates') : null
      setTemplates(raw ? JSON.parse(raw) : [])
    } catch {}
  }, [])
  const saveTemplates = useCallback((next) => {
    setTemplates(next)
    try {
      if (typeof window !== 'undefined') window.localStorage.setItem('wireframeTemplates', JSON.stringify(next))
    } catch {}
  }, [])

  // -------- Multi-select & shortcuts --------
  const toggleSelect = (id, multi = false) => {
    setSel((prev) => {
      const s = new Set(prev)
      if (multi) { s.has(id) ? s.delete(id) : s.add(id) } else { s.clear(); s.add(id) }
      return s
    })
  }
  useEffect(() => {
    const k = (e) => { if (e.key === 'Shift') shiftDownRef.current = e.type === 'keydown' }
    window.addEventListener('keydown', k); window.addEventListener('keyup', k)
    return () => { window.removeEventListener('keydown', k); window.removeEventListener('keyup', k) }
  }, [])
  useEffect(() => {
    const h = (e) => {
      if (e.key === 'Delete' && sel.size) {
        e.preventDefault()
        setItems((prev) => prev.filter((x) => !sel.has(x.i)))
        setSel(new Set())
      }
    }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [sel])

  // -------- RGL layout mapping --------
  const layout = useMemo(
    () =>
      items.map((it) => ({ i: it.i, x: clamp(it.x, 0, COLS - 1), y: Math.max(0, it.y), w: clamp(it.w, 1, COLS), h: Math.max(1, it.h) })),
    [items]
  )

  // -------- Alignment aids --------
  const computeGuides = (dragItem) => {
    const others = items.filter((x) => x.i !== dragItem.i)
    const vEdges = new Set(), hEdges = new Set()
    others.forEach((o) => {
      vEdges.add(gx(o.x)); vEdges.add(gx(o.x + o.w)); vEdges.add(gx(o.x + o.w / 2))
      hEdges.add(gy(o.y)); hEdges.add(gy(o.y + o.h)); hEdges.add(gy(o.y + o.h / 2))
    })
    const tol = 8
    const candV = [gx(dragItem.x), gx(dragItem.x + dragItem.w), gx(dragItem.x + dragItem.w / 2)]
    const candH = [gy(dragItem.y), gy(dragItem.y + dragItem.h), gy(dragItem.y + dragItem.h / 2)]
    const nearV = [], nearH = []
    for (const c of candV) for (const v of vEdges) if (Math.abs(v - c) <= tol) { nearV.push(v); break }
    for (const c of candH) for (const h of hEdges) if (Math.abs(h - c) <= tol) { nearH.push(h); break }
    setGuides({ v: nearV, h: nearH })
  }
  const snapOnDrop = (item) => {
    const tolPx = 8
    let xPx = gx(item.x), yPx = gy(item.y)
    let bestVX = xPx, bestVd = Infinity, bestHY = yPx, bestHd = Infinity
    const others = items.filter((o) => o.i !== item.i)
    const vEdges = [], hEdges = []
    others.forEach((o) => {
      vEdges.push(gx(o.x), gx(o.x + o.w), gx(o.x + o.w / 2))
      hEdges.push(gy(o.y), gy(o.y + o.h), gy(o.y + o.h / 2))
    })
    for (const v of vEdges) { const d = Math.abs(v - xPx); if (d < bestVd && d <= tolPx) { bestVd = d; bestVX = v } }
    for (const h of hEdges) { const d = Math.abs(h - yPx); if (d < bestHd && d <= tolPx) { bestHd = d; bestHY = h } }
    const toX = Math.round((bestVX - MARGIN[0]) / (COL_W + MARGIN[0]))
    const toY = Math.round((bestHY - MARGIN[1]) / (ROW + MARGIN[1]))
    return { x: clamp(toX, 0, COLS - 1), y: Math.max(0, toY) }
  }

  const onDragStart = (layout, oldItem, newItem) => {
    const bases = {}
    items.forEach((it) => { if (sel.has(it.i)) bases[it.i] = { x: it.x, y: it.y } })
    dragStateRef.current = { bases, active: oldItem.i }
  }
  const onDrag = (layout, oldItem, newItem) => {
    computeGuides(newItem)
    const st = dragStateRef.current
    if (st && sel.has(newItem.i) && sel.size > 1) {
      const dx = newItem.x - st.bases[newItem.i].x
      const dy = newItem.y - st.bases[newItem.i].y
      setItems((prev) =>
        prev.map((it) => (!sel.has(it.i) || it.i === newItem.i ? it : { ...it, x: clamp(st.bases[it.i].x + dx, 0, COLS - 1), y: Math.max(0, st.bases[it.i].y + dy) }))
      )
    }
  }
  const onDragStop = (layout, oldItem, newItem) => {
    setGuides({ v: [], h: [] })
    const snap = snapOnDrop(newItem)
    setItems((prev) => prev.map((it) => (it.i === newItem.i ? { ...it, ...snap } : it)))
    dragStateRef.current = null
  }

  const onResizeStart = (layout, oldItem, newItem) => {
    const bases = {}
    items.forEach((it) => { if (sel.has(it.i)) bases[it.i] = { w: it.w, h: it.h } })
    dragStateRef.current = { bases, active: oldItem.i }
  }
  const onResize = (layout, oldItem, newItem) => {
    if (!shiftDownRef.current) return
    const st = dragStateRef.current
    if (!(st && sel.has(newItem.i) && sel.size > 1)) return
    const dw = newItem.w - st.bases[newItem.i].w
    const dh = newItem.h - st.bases[newItem.i].h
    setItems((prev) =>
      prev.map((it) => (!sel.has(it.i) || it.i === newItem.i ? it : { ...it, w: clamp(st.bases[it.i].w + dw, 1, COLS), h: Math.max(1, st.bases[it.i].h + dh) }))
    )
  }
  const onResizeStop = () => { dragStateRef.current = null }

  // -------- Toolbar add/remove --------
  const addCard = () => { const nid = newId('card'); setItems((p) => [...p, { i: nid, x: 1, y: 1, w: 6, h: 4, type: 'card', title: 'Card', binding: null }]); setSel(new Set([nid])) }
  const addRectangle = () => { const nid = newId('rect'); setItems((p) => [...p, { i: nid, x: 1, y: 1, w: 8, h: 4, type: 'shape:rectangle', title: 'Block' }]); setSel(new Set([nid])) }
  const addBar = () => { const nid = newId('bar'); setItems((p) => [...p, { i: nid, x: 1, y: 1, w: 10, h: 8, type: 'chart:bar', title: 'Bar Chart' }]); setSel(new Set([nid])) }
  const addLine = () => { const nid = newId('line'); setItems((p) => [...p, { i: nid, x: 1, y: 1, w: 10, h: 8, type: 'chart:line', title: 'Line Chart' }]); setSel(new Set([nid])) }
  const removeId = (id) => { setItems((p) => p.filter((x) => x.i !== id)); setSel((s) => { const ns = new Set(s); ns.delete(id); return ns }) }

  // -------- Gallery ops --------
  const saveCurrentAsTemplate = () => { const name = prompt('Template name?'); if (!name) return; saveTemplates([...templates, { name, theme, items }]) }
  const loadTemplate = (t) => { setTheme(t.theme); setItems(t.items); setSel(new Set()) }

  // -------- Theme ops --------
  const setThemeColor = (idx, val) => setTheme((t) => { const arr = [...t.dataColors]; arr[idx] = val; return { ...t, dataColors: arr } })
  const removeThemeColor = (idx) => setTheme((t) => ({ ...t, dataColors: t.dataColors.filter((_, i) => i !== idx) }))

  // -------- Payload for server --------
  const pages = useMemo(
    () => [{ name: 'Executive', visuals: items.map((it) => ({ type: it.type, x: it.x * COL_W, y: it.y * ROW, w: it.w * COL_W, h: it.h * ROW, title: it.title || '', binding: it.binding || null })) }],
    [items]
  )

  // -------- Logs & streaming export --------
  const appendLog = (tag, data) => setLogs((p) => [...p, { ts: new Date().toISOString(), tag, data }])

  const exportWireframe = async () => {
    setRunning(true); setLogs([]); setArtifact(null); setPbipDir(null)

    // POST stream using fetch + ReadableStream to API base
    try {
      const res = await fetch(`${API}/wireframe/export/stream`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectName, thinReport, theme, pages })
      })

      if (!res.ok) {
        appendLog('ERROR', { status: res.status, statusText: res.statusText })
        setRunning(false)
        return
      }
      if (!res.body) {
        // Fallback: try non-stream endpoint
        const j = await res.json().catch(() => null)
        if (j) appendLog('done', j)
        setRunning(false)
        return
      }

      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buf = ''
      while (true) {
        const { value, done } = await reader.read()
        if (done) break
        buf += decoder.decode(value, { stream: true })
        const chunks = buf.split('\n\n')
        buf = chunks.pop() || ''
        for (const c of chunks) {
          const [eventLine = '', dataLine = ''] = c.split('\n')
          const ev = eventLine.replace('event: ', '').trim()
          const dt = dataLine.replace('data: ', '').trim()
          if (!ev) continue
          const payload = dt ? JSON.parse(dt) : {}
          if (ev === 'step' || ev === 'info' || ev === 'log' || ev === 'error') appendLog(ev.toUpperCase(), payload)
          if (ev === 'done') {
            setArtifact(payload.artifact || null)
            setPbipDir(payload.pbipDir || null)
            appendLog('DONE', payload)
          }
        }
      }
    } catch (err) {
      appendLog('ERROR', { message: String(err) })
    } finally {
      setRunning(false)
    }
  }

  const openInDesktop = async () => {
    if (!pbipDir) return
    const res = await fetch(`${API}/wireframe/open-in-desktop`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pbipDir })
    }).then((r) => r.json())
    appendLog('OPEN', res)
  }

  const downloadArtifact = () => {
    if (!artifact?.path) return
    const url = `${API}/files/download?path=${encodeURIComponent(artifact.path)}`
    const a = document.createElement('a')
    a.href = url; a.download = artifact.path.split(/[\\/]/).pop()
    document.body.appendChild(a); a.click(); a.remove()
  }

  // UI helpers
  const labelFor = (t) => (t === 'card' ? 'Card' : t === 'shape:rectangle' ? 'Rectangle' : t === 'chart:bar' ? 'Bar Chart' : t === 'chart:line' ? 'Line Chart' : t)
  const bgFor = (it) => (it.type === 'card' ? theme.visualStyles.card.background : '#ffffff')

  return (
    <div className="h-full w-full grid grid-cols-[360px_1fr_420px] grid-rows-[64px_1fr] bg-slate-50">
      {/* Toolbar */}
      <header className="col-span-3 row-[1] flex items-center gap-4 px-6 border-b bg-white">
        <h1 className="text-lg font-semibold">Wireframe → PBIT</h1>
        <label className="flex items-center gap-2 text-sm">
          <span className="text-slate-600">Project</span>
          <input className="px-2 py-1 rounded border" value={projectName} onChange={(e) => setProjectName(e.target.value)} />
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={thinReport} onChange={(e) => setThinReport(e.target.checked)} />
          <span className="text-slate-600">Thin (PBIX). Uncheck for PBIT (with TMDL).</span>
        </label>
        <div className="ml-auto flex items-center gap-2">
          <button onClick={() => { const nid = newId('card'); setItems((p) => [...p, { i: nid, x: 1, y: 1, w: 6, h: 4, type: 'card', title: 'Card', binding: null }]); setSel(new Set([nid])) }} className="px-3 py-1.5 rounded bg-blue-600 text-white">+ Card</button>
          <button onClick={() => { const nid = newId('rect'); setItems((p) => [...p, { i: nid, x: 1, y: 1, w: 8, h: 4, type: 'shape:rectangle', title: 'Block' }]); setSel(new Set([nid])) }} className="px-3 py-1.5 rounded bg-slate-800 text-white">+ Rectangle</button>
          <button onClick={() => { const nid = newId('bar'); setItems((p) => [...p, { i: nid, x: 1, y: 1, w: 10, h: 8, type: 'chart:bar', title: 'Bar Chart' }]); setSel(new Set([nid])) }} className="px-3 py-1.5 rounded bg-emerald-600 text-white">+ Bar</button>
          <button onClick={() => { const nid = newId('line'); setItems((p) => [...p, { i: nid, x: 1, y: 1, w: 10, h: 8, type: 'chart:line', title: 'Line Chart' }]); setSel(new Set([nid])) }} className="px-3 py-1.5 rounded bg-cyan-600 text-white">+ Line</button>
          <button disabled={running} onClick={exportWireframe} className={`px-4 py-1.5 rounded ${running ? 'bg-slate-300 text-slate-600' : 'bg-green-600 text-white'}`}>{running ? 'Building…' : 'Export'}</button>
          <button disabled={!artifact} onClick={downloadArtifact} className="px-4 py-1.5 rounded bg-amber-600 text-white disabled:opacity-40">Download</button>
          <button disabled={!pbipDir} onClick={openInDesktop} className="px-4 py-1.5 rounded bg-indigo-600 text-white disabled:opacity-40">Open Desktop</button>
        </div>
      </header>

      {/* Left: Gallery + Theme */}
      <aside className="col-[1] row-[2] border-r bg-white p-4 overflow-auto">
        <div className="flex items-center justify-between mb-2">
          <div className="text-sm font-semibold text-slate-700">Template Gallery</div>
          <button onClick={() => { const name = prompt('Template name?'); if (!name) return; saveTemplates([...templates, { name, theme, items }]) }} className="text-xs px-2 py-0.5 rounded bg-slate-100">Save current</button>
        </div>
        <div className="text-xs text-slate-500 mb-1">Built-ins</div>
        <div className="grid grid-cols-2 gap-2 mb-3">
          {BUILT_IN_TEMPLATES.map((t, i) => (
            <button key={i} onClick={() => { setTheme(t.theme); setItems(t.items); setSel(new Set()) }} className="p-2 border rounded hover:bg-slate-50 text-left">
              <div className="text-xs font-medium">{t.name}</div>
              <div className="text-[11px] text-slate-500">{t.items.length} items</div>
            </button>
          ))}
        </div>
        <div className="text-xs text-slate-500 mb-1">Saved</div>
        {templates.length === 0 && <div className="text-xs text-slate-400">No saved templates</div>}
        <div className="grid grid-cols-2 gap-2">
          {templates.map((t, idx) => (
            <div key={idx} className="p-2 border rounded">
              <div className="flex items-center justify-between">
                <div className="text-xs font-medium">{t.name}</div>
                <button className="text-[11px] text-red-600" onClick={() => saveTemplates(templates.filter((_, i) => i !== idx))}>Delete</button>
              </div>
              <div className="text-[11px] text-slate-500 mb-1">{t.items.length} items</div>
              <button className="w-full text-[12px] px-2 py-1 rounded bg-slate-100 hover:bg-slate-200" onClick={() => { setTheme(t.theme); setItems(t.items); setSel(new Set()) }}>Restore</button>
            </div>
          ))}
        </div>

        <div className="mt-6">
          <div className="text-sm font-semibold text-slate-700 mb-2">Theme</div>
          <label className="block mb-3">
            <span className="block text-xs text-slate-500">Name</span>
            <input className="w-full border rounded px-2 py-1" value={theme.name} onChange={(e) => setTheme((t) => ({ ...t, name: e.target.value }))} />
          </label>

          <div className="mb-3">
            <div className="flex items-center justify-between mb-1">
              <span className="text-xs text-slate-500">Palette</span>
              <button onClick={() => setTheme((t) => ({ ...t, dataColors: [...t.dataColors, '#999999'] }))} className="text-xs px-2 py-0.5 rounded bg-slate-100">+ Color</button>
            </div>
            <div className="flex flex-wrap gap-2">
              {theme.dataColors.map((c, i) => (
                <div key={i} className="flex items-center gap-1">
                  <input type="color" value={c} onChange={(e) => setThemeColor(i, e.target.value)} className="w-8 h-8 p-0 rounded border" />
                  <button onClick={() => removeThemeColor(i)} className="text-xs text-slate-500 hover:text-red-600">✕</button>
                </div>
              ))}
            </div>
          </div>
        </div>
      </aside>

      {/* Canvas */}
      <main className="col-[2] row-[2] p-4 overflow-auto">
        <div className="rounded-lg border bg-white p-3 shadow-sm">
          <div className="text-xs text-slate-500 mb-2">
            Drag with the ☰ handle. Align lines appear for edges/centers; release to snap.
            Ctrl/Cmd‑click for multi‑select; drag to group move; Shift‑resize for group resize.
          </div>

          <div className="canvas-grid-bg rounded border relative">
            {/* Guides */}
            {guides.v.map((x, i) => <div key={`v-${i}`} className="absolute top-0 bottom-0 w-px bg-red-500/60 pointer-events-none" style={{ left: x }} />)}
            {guides.h.map((y, i) => <div key={`h-${i}`} className="absolute left-0 right-0 h-px bg-red-500/60 pointer-events-none" style={{ top: y }} />)}

            <GridLayout
              className="layout"
              cols={COLS}
              rowHeight={ROW}
              width={WIDTH}
              margin={MARGIN}
              layout={layout}
              onLayoutChange={(next) => setItems((prev) => prev.map((it) => { const n = next.find((k) => k.i === it.i); return n ? { ...it, ...n } : it }))}
              draggableHandle=".drag-handle"
              draggableCancel=".no-drag"
              onDragStart={onDragStart}
              onDrag={onDrag}
              onDragStop={onDragStop}
              onResizeStart={onResizeStart}
              onResize={onResize}
              onResizeStop={onResizeStop}
              compactType={null}
            >
              {items.map((it) => (
                <div
                  key={it.i}
                  className={`rounded shadow-sm border bg-white overflow-hidden ${sel.has(it.i) ? 'ring-2 ring-blue-500' : ''}`}
                  onClick={(e) => { e.stopPropagation(); toggleSelect(it.i, e.metaKey || e.ctrlKey) }}
                >
                  <div className="drag-handle h-8 px-2 bg-slate-800 text-white flex items-center justify-between cursor-move select-none">
                    <div className="flex items-center gap-2">
                      <span className="text-xs">☰</span>
                      <span className="text-xs">{labelFor(it.type)}</span>
                    </div>
                    <button className="text-xs px-2 py-0.5 bg-slate-700 hover:bg-red-600 rounded" onMouseDown={(e) => e.stopPropagation()} onClick={(e) => { e.stopPropagation(); removeId(it.i) }}>
                      ✕
                    </button>
                  </div>

                  <div className="p-2 no-drag" style={{ background: bgFor(it) }}>
                    {renderBody(it, theme)}
                  </div>
                </div>
              ))}
            </GridLayout>
          </div>
        </div>
      </main>

      {/* Right: Properties & Logs */}
      <aside className="col-[3] row-[2] border-l bg-white p-4 overflow-auto">
        <div className="mb-4">
          <div className="text-sm font-semibold text-slate-700 mb-2">Properties</div>
          {sel.size === 1 ? (
            <ItemProperties
              key={[...sel][0]}
              item={items.find((i) => i.i === [...sel][0])}
              onChange={(patch) => setItems((prev) => prev.map((x) => (x.i === [...sel][0] ? { ...x, ...patch } : x)))}
            />
          ) : sel.size > 1 ? (
            <div className="text-xs text-slate-500">Multiple selected ({sel.size}). Drag to group move; Shift‑resize for group resize.</div>
          ) : (
            <div className="text-xs text-slate-500">Select an item to edit its properties.</div>
          )}
        </div>

        <div>
          <div className="text-sm font-semibold text-slate-700 mb-2">Logs</div>
          <pre className="text-xs bg-slate-50 border rounded p-2 max-h-[52vh] overflow-auto">
            {logs.map((l, i) => `[${l.ts}] ${l.tag}: ${JSON.stringify(l.data)}\n`)}
          </pre>
          {artifact && (
            <div className="mt-3 text-xs">
              <div className="font-medium text-slate-700">Artifact</div>
              <div><code>{artifact.path}</code> ({artifact.format})</div>
            </div>
          )}
          {pbipDir && (
            <div className="mt-2 text-xs">
              <div className="font-medium text-slate-700">PBIP Folder</div>
              <div><code>{pbipDir}</code></div>
            </div>
          )}
        </div>
      </aside>
    </div>
  )
}

function ItemProperties({ item, onChange }) {
  if (!item) return null
  const isCard = item.type === 'card'
  return (
    <div className="space-y-2">
      <div className="text-xs text-slate-500">ID: <code>{item.i}</code></div>
      <label className="block">
        <span className="block text-xs text-slate-500">Title</span>
        <input className="w-full border rounded px-2 py-1" value={item.title || ''} onChange={(e) => onChange({ title: e.target.value })} />
      </label>
      {isCard && (
        <label className="block">
          <span className="block text-xs text-slate-500">Binding</span>
          <input className="w-full border rounded px-2 py-1" value={item.binding || ''} onChange={(e) => onChange({ binding: e.target.value })} />
        </label>
      )}
      <div className="grid grid-cols-4 gap-2 text-xs">
        <div><span className="text-slate-500">x</span><div className="border rounded px-2 py-1 bg-slate-50">{item.x}</div></div>
        <div><span className="text-slate-500">y</span><div className="border rounded px-2 py-1 bg-slate-50">{item.y}</div></div>
        <div><span className="text-slate-500">w</span><div className="border rounded px-2 py-1 bg-slate-50">{item.w}</div></div>
        <div><span className="text-slate-500">h</span><div className="border rounded px-2 py-1 bg-slate-50">{item.h}</div></div>
      </div>
    </div>
  )
}

function renderBody(it, theme) {
  if (it.type === 'card') {
    return (
      <div className="h-full grid place-items-center">
        <div className="text-center">
          <div className="text-sm" style={{ color: theme.visualStyles.card.titleColor }}>{it.title || 'Card'}</div>
          <div className="text-xl font-semibold" style={{ color: theme.visualStyles.card.valueColor }}>{it.binding || '[Unbound]'}</div>
        </div>
      </div>
    )
  }
  if (it.type === 'chart:bar') {
    return (
      <div className="h-full w-full grid grid-rows-6 gap-1">
        {[...Array(6)].map((_, i) => (
          <div key={i} className="h-4 flex items-center gap-2">
            <div className="w-20 text-[11px] text-slate-500">Cat {i + 1}</div>
            <div className="flex-1 h-3 bg-slate-100 rounded overflow-hidden">
              <div className="h-full rounded" style={{ width: `${20 + i * 12}%`, background: theme.dataColors[i % theme.dataColors.length] }} />
            </div>
          </div>
        ))}
      </div>
    )
  }
  if (it.type === 'chart:line') {
    return (
      <div className="h-48 border border-dashed rounded relative overflow-hidden" style={{ borderColor: theme.visualStyles.chart.gridColor }}>
        {[...Array(4)].map((_, i) => <div key={i} className="absolute left-0 right-0 h-px" style={{ top: `${(i + 1) * 20}%`, background: theme.visualStyles.chart.gridColor }} />)}
        <svg viewBox="0 0 200 100" className="w-full h-full p-2">
          <polyline fill="none" stroke={theme.dataColors[0]} strokeWidth="2" points="0,80 30,60 60,65 90,40 120,45 150,20 200,35" />
          {[0, 30, 60, 90, 120, 150, 200].map((x, idx) => <circle key={idx} cx={x} cy={[80, 60, 65, 40, 45, 20, 35][idx]} r="2" fill={theme.dataColors[0]} />)}
        </svg>
      </div>
    )
  }
  return <div className="h-full border-2 border-dashed border-slate-300 rounded grid place-items-center text-slate-400">{it.title || 'Rectangle'}</div>
}

/* POST-able SSE polyfill via fetch + ReadableStream (server sends "event:..\\ndata:..\\n\\n") */
function EventSourcePolyfill() { /* not used in this version */ }