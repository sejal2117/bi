/**
 * server.js
 * =======================================================================================
 * Elysia (Bun) Orchestrator for a local, agentized Power BI pipeline + Wireframe Export.
 *
 * FEATURES
 *  - OpenAPI + Scalar UI docs at /openapi  (raw spec at /openapi/json)
 *  - Validation/Build endpoints for PBIP projects:
 *      • /validate  → pbi-tools.core compile + pbip-tools clean + pbixray/rules (merged inline)
 *      • /deploy    → pbipy post-deploy ops (e.g., refresh)
 *      • /refresh/:datasetId → trigger dataset refresh
 *  - Agent endpoints (Legacy Extractor, Field Mapper, Logic Translator, Layout, Generator, Validator)
 *  - Full pipeline runner /pipeline/run (executes all agents end-to-end)
 *  - Wireframe → PBIP (PBIR + optional TMDL) export:
 *      • POST /wireframe/export            → JSON result (PBIP + optional compiled PBIT/PBIX)
 *      • POST /wireframe/export/stream     → POST-streamed events (generate → validate → compile)
 *      • POST /wireframe/open-in-desktop   → Windows helper to launch PBIDesktop on PBIP folder
 *      • GET  /files/download?path=<abs>   → Secure download of PBIT/PBIX artifacts from workspace
 *
 * RUNTIME
 *  - Bun + Elysia (JS modules)
 *  - Python scripts live in ../python (pbipy, pbixray, pbi_core hook, etc.)
 *  - Workspace runs created under ../workspace/runs
 *
 * ENV VARS (optional)
 *  - PORT=3001
 *  - PBIP_REPO_PATH=../sample-pbip
 *  - PYTHON_CMD=python
 *  - PBI_TOOLS_CMD=pbi-tools.core                   (must be on PATH for compile)
 *  - MD_GUIDE_PATH=../SAP_BO_to_PowerBI_Migration_Guide.md
 *  - RULES_PATH=../python/rules.yaml                (custom migration rules)
 *  - PBI_DESKTOP_EXE="C:\Program Files\Microsoft Power BI Desktop\bin\PBIDesktop.exe" (Windows)
 *
 * NOTES
 *  - PBIX output is only supported for *thin* reports; projects with a model must be compiled to PBIT.
 *  - PBIR (enhanced report format) is *preview* and validated by Power BI Desktop on open.
 *  - Wireframe export keeps PBIR usage conservative and places Theme JSON in RegisteredResources.
 * =======================================================================================
 */

import { Elysia, t } from 'elysia'
import { openapi } from '@elysiajs/openapi'
import { cors } from '@elysiajs/cors'
import { spawnSync } from 'node:child_process'
import {
  existsSync, mkdirSync, rmSync, cpSync,
  readFileSync
} from 'node:fs'
import { resolve, join } from 'node:path'
import os from 'node:os'

// Local libs (PBIP writers & PBIR validator)
import { createPbipProject } from './lib/pbip-writer.js'
import { validatePbirProject } from './lib/pbir-validator.js'

// --------------------------------------------------------------------------------------
// Paths & Config
// --------------------------------------------------------------------------------------

const ROOT           = resolve(import.meta.dir)                         // like __dirname (Bun)
const PY_DIR         = resolve(join(ROOT, '../python'))
const WORKSPACE_DIR  = resolve(join(ROOT, '../workspace'))
const RUNS_DIR       = resolve(join(WORKSPACE_DIR, 'runs'))

const PORT           = process.env.PORT || 3001
const PBIP_REPO_PATH = resolve(process.env.PBIP_REPO_PATH || join(ROOT, '../sample-pbip'))
const PYTHON         = process.env.PYTHON_CMD || 'python'
const PBI_TOOLS_CMD  = process.env.PBI_TOOLS_CMD || 'pbi-tools.core'    // must be on PATH
const MD_GUIDE_PATH  = resolve(process.env.MD_GUIDE_PATH || join(ROOT, '../SAP_BO_to_PowerBI_Migration_Guide.md'))
const RULES_PATH     = process.env.RULES_PATH ? resolve(process.env.RULES_PATH) : ''

// --------------------------------------------------------------------------------------
// Utilities
// --------------------------------------------------------------------------------------

const ensureDir = (d) => { if (!existsSync(d)) mkdirSync(d, { recursive: true }) }
const nowId     = () => new Date().toISOString().replace(/[:.]/g, '-')
const ok        = (code) => code === 0

/**
 * Spawn a shell command *synchronously* and capture output, for simple orchestration.
 * Returns an object with name, command, exitCode, durationMs, stdout, stderr.
 */
function runStepSync(name, cmd, opts = {}) {
  const started = Date.now()
  const p = spawnSync(cmd, { shell: true, cwd: ROOT, env: process.env, encoding: 'utf-8', ...opts })
  return {
    name,
    command: cmd,
    exitCode: p.status,
    durationMs: Date.now() - started,
    stdout: (p.stdout || '').slice(-80_000), // cap large buffers for API response safety
    stderr: (p.stderr || '').slice(-80_000)
  }
}

// --------------------------------------------------------------------------------------
// Elysia App + OpenAPI (Scalar UI at /openapi; raw spec at /openapi/json)
// --------------------------------------------------------------------------------------

const app = new Elysia()
  .use(cors({
    origin: ['http://localhost:3000', 'http://127.0.0.1:3000'],
    methods: ['GET', 'POST', 'OPTIONS']
  }))
  .use(openapi({
    documentation: {
      info: {
        title: 'PBIP Orchestrator + Wireframe Export (Local)',
        version: '0.5.0',
        description: [
          'Local, no-Docker pipeline for PBIP validation/build, agent orchestration, and PBIR/TMDL wireframe export.',
          'Scalar UI at /openapi; raw OpenAPI JSON at /openapi/json.'
        ].join(' ')
      }
    },
    path: '/openapi'
  }))

// --------------------------------------------------------------------------------------
// HEALTH
// --------------------------------------------------------------------------------------

  .get('/health', () => ({
    ok: true,
    pbiToolsCmd : PBI_TOOLS_CMD,
    pythonDir   : PY_DIR,
    runsDir     : RUNS_DIR,
    pbipRepo    : PBIP_REPO_PATH
  }), { detail: { summary: 'Health check' } })

// --------------------------------------------------------------------------------------
// VALIDATE: Compile & run validation (merged rules inline)
// --------------------------------------------------------------------------------------

  .post('/validate', ({ body }) => {
    const {
      usePbiCore  = true,
      outName     = 'build-output',
      thinReport  = false,
      extraChecks = []
    } = body || {}

    if (!existsSync(PBIP_REPO_PATH)) {
      return { ok: false, error: `PBIP path not found: ${PBIP_REPO_PATH}` }
    }

    const steps = []

    // Optional: pbi_core prebuild hook (writes hints / can be extended to real TMDL edits)
    if (usePbiCore) {
      const cmd = [
        PYTHON, `"${join(PY_DIR, 'prebuild_model.py')}"`,
        `--pbip "${PBIP_REPO_PATH}"`,
        `--guide "${MD_GUIDE_PATH}"`
      ].join(' ')
      steps.push(runStepSync('pbi_core_prebuild', cmd))
    }

    // Compile (PBIX only for thin; PBIT for models)
    const format = thinReport ? 'PBIX' : 'PBIT'
    const artifactPath = resolve(join(ROOT, `${outName}.${format.toLowerCase()}`))
    const compileCmd = [PBI_TOOLS_CMD, `compile "${PBIP_REPO_PATH}" "${artifactPath}" ${format}`].join(' ')
    const compileStep = runStepSync('pbi_tools_compile', compileCmd)
    steps.push(compileStep)

    // PBIP hygiene (json-clean)
    const cleanCmd = [PYTHON, `"${join(PY_DIR, 'run_clean.py')}"`, `--pbip "${PBIP_REPO_PATH}"`].join(' ')
    steps.push(runStepSync('pbip_tools_clean', cleanCmd))

    if (!ok(compileStep.exitCode)) {
      return { ok: false, error: 'Compile failed', artifact: { path: artifactPath, format }, steps }
    }

    // Orchestrator validation (pbixray + migration rules)
    const pbixCandidate = resolve(join(ROOT, `${outName}.pbix`))
    const pbitCandidate = artifactPath
    const flags = (extraChecks || []).join(',')
    const orchestratorCmd = [
      PYTHON, `"${join(PY_DIR, 'validate_orchestrator.py')}"`,
      `--pbix "${pbixCandidate}"`,
      `--pbit "${pbitCandidate}"`,
      `--extra-checks "${flags}"`,
      `--run-rules true`,
      RULES_PATH ? `--rules "${RULES_PATH}"` : '',
      MD_GUIDE_PATH ? `--md-guide "${MD_GUIDE_PATH}"` : ''
    ].filter(Boolean).join(' ')
    const orch = runStepSync('validate_orchestrator', orchestratorCmd)
    let orchestrator = null
    try { orchestrator = JSON.parse(orch.stdout || '{}') } catch {}

    steps.push(orch)

    return {
      ok: ok(compileStep.exitCode) && ok(orch.exitCode),
      artifact   : { path: artifactPath, format },
      orchestrator,
      steps
    }
  }, {
    body: t.Object({
      usePbiCore : t.Optional(t.Boolean()),
      outName    : t.Optional(t.String()),
      thinReport : t.Optional(t.Boolean()),
      extraChecks: t.Optional(t.Array(t.String()))
    }),
    detail: { summary: 'Compile PBIP and validate (merged rules inline)' }
  })

// --------------------------------------------------------------------------------------
// DEPLOY: pbipy ops (e.g., refresh)
// --------------------------------------------------------------------------------------

  .post('/deploy', ({ body }) => {
    const {
      artifact    = 'build-output',
      format      = 'PBIT',
      workspaceId = '',
      datasetId   = '',
      refreshAfter= true
    } = body || {}

    const artifactPath = resolve(join(ROOT, `${artifact}.${format.toLowerCase()}`))
    const cmd = [
      PYTHON, `"${join(PY_DIR, 'post_deploy.py')}"`,
      `--workspace-id "${workspaceId}"`,
      `--dataset-id "${datasetId}"`,
      `--artifact "${artifactPath}"`,
      `--format "${format}"`,
      `--refresh-after "${refreshAfter ? 'true' : 'false'}"`
    ].join(' ')
    const step = runStepSync('pbipy_post_deploy', cmd)
    return { ok: ok(step.exitCode), step }
  }, {
    body: t.Object({
      artifact   : t.Optional(t.String()),
      format     : t.Optional(t.Union([t.Literal('PBIT'), t.Literal('PBIX')])),
      workspaceId: t.Optional(t.String()),
      datasetId  : t.Optional(t.String()),
      refreshAfter: t.Optional(t.Boolean())
    }),
    detail: { summary: 'Post-deploy operations via pbipy (refresh, params, etc.)' }
  })

// --------------------------------------------------------------------------------------
// REFRESH: trigger dataset refresh quickly
// --------------------------------------------------------------------------------------

  .post('/refresh/:datasetId', ({ params }) => {
    const cmd = [PYTHON, `"${join(PY_DIR, 'refresh_dataset.py')}"`, `--dataset-id "${params.datasetId}"`].join(' ')
    const step = runStepSync('pbipy_refresh', cmd)
    return { ok: ok(step.exitCode), step }
  }, {
    params: t.Object({ datasetId: t.String() }),
    detail: { summary: 'Trigger dataset refresh via pbipy' }
  })

// --------------------------------------------------------------------------------------
// AGENTS (standalone endpoints)
// --------------------------------------------------------------------------------------

  .post('/agents/legacy-extract', ({ body }) => {
    const { runId = `run-${nowId()}`, sourceDump = '' } = body || {}
    const runDir    = resolve(join(RUNS_DIR, runId)); ensureDir(runDir)
    const inputsDir = resolve(join(runDir, 'inputs')); ensureDir(inputsDir)
    const out       = resolve(join(inputsDir, 'source_metadata.json'))

    const cmd = [
      PYTHON, `"${join(PY_DIR, 'agents/legacy_extractor.py')}"`,
      `--inputs-dir "${inputsDir}"`,
      sourceDump ? `--source-dump "${resolve(sourceDump)}"` : '',
      `--out "${out}"`
    ].filter(Boolean).join(' ')

    const step = runStepSync('legacy_extractor', cmd)
    return { ok: ok(step.exitCode), runId, out, step }
  }, {
    body: t.Object({ runId: t.Optional(t.String()), sourceDump: t.Optional(t.String()) }),
    detail: { summary: 'Run Legacy Extractor Agent' }
  })

  .post('/agents/map-fields', ({ body }) => {
    const { runId, metadataPath = '', mdGuide = MD_GUIDE_PATH } = body || {}
    if (!runId) return { ok: false, error: 'runId required' }

    const runDir    = resolve(join(RUNS_DIR, runId))
    const inputsDir = resolve(join(runDir, 'inputs'))
    const meta      = metadataPath || resolve(join(inputsDir, 'source_metadata.json'))
    const mapDir    = resolve(join(runDir, 'mapping')); ensureDir(mapDir)
    const out       = resolve(join(mapDir, 'mapping.json'))

    const cmd = [
      PYTHON, `"${join(PY_DIR, 'agents/field_mapper.py')}"`,
      `--metadata "${meta}"`,
      mdGuide ? `--md-guide "${mdGuide}"` : '',
      `--out "${out}"`
    ].filter(Boolean).join(' ')

    const step = runStepSync('field_mapper', cmd)
    return { ok: ok(step.exitCode), runId, out, step }
  }, {
    body: t.Object({ runId: t.String(), metadataPath: t.Optional(t.String()), mdGuide: t.Optional(t.String()) }),
    detail: { summary: 'Run Field Mapper Agent' }
  })

  .post('/agents/translate-logic', ({ body }) => {
    const { runId, mappingPath = '', sqlPath = '' } = body || {}
    if (!runId) return { ok: false, error: 'runId required' }

    const runDir  = resolve(join(RUNS_DIR, runId))
    const mapping = mappingPath || resolve(join(runDir, 'mapping', 'mapping.json'))
    const out     = resolve(join(runDir, 'mapping', 'translated_logic.json'))

    const cmd = [
      PYTHON, `"${join(PY_DIR, 'agents/logic_translator.py')}"`,
      `--mapping "${mapping}"`,
      sqlPath ? `--sql "${resolve(sqlPath)}"` : '',
      `--out "${out}"`
    ].filter(Boolean).join(' ')

    const step = runStepSync('logic_translator', cmd)
    return { ok: ok(step.exitCode), runId, out, step }
  }, {
    body: t.Object({ runId: t.String(), mappingPath: t.Optional(t.String()), sqlPath: t.Optional(t.String()) }),
    detail: { summary: 'Run Logic Translator Agent' }
  })

  .post('/agents/layout', ({ body }) => {
    const { runId, layoutPath = '' } = body || {}
    if (!runId) return { ok: false, error: 'runId required' }

    const runDir  = resolve(join(RUNS_DIR, runId))
    const pbipDir = resolve(join(runDir, 'pbip')); ensureDir(pbipDir)

    // Fresh copy of sample PBIP into run workspace
    if (existsSync(pbipDir)) rmSync(pbipDir, { recursive: true, force: true })
    cpSync(PBIP_REPO_PATH, pbipDir, { recursive: true })

    const cmd = [
      PYTHON, `"${join(PY_DIR, 'agents/layout_agent.py')}"`,
      `--pbip-src "${pbipDir}"`,
      layoutPath ? `--layout "${resolve(layoutPath)}"` : ''
    ].filter(Boolean).join(' ')

    const step = runStepSync('layout_agent', cmd)
    return { ok: ok(step.exitCode), runId, pbipDir, step }
  }, {
    body: t.Object({ runId: t.String(), layoutPath: t.Optional(t.String()) }),
    detail: { summary: 'Run Layout Agent (modifies PBIP in run folder)' }
  })

  .post('/agents/generate', ({ body }) => {
    const { runId, thinReport = false } = body || {}
    if (!runId) return { ok: false, error: 'runId required' }

    const runDir      = resolve(join(RUNS_DIR, runId))
    const pbipDir     = resolve(join(runDir, 'pbip'))
    const artifactsDir= resolve(join(runDir, 'artifacts')); ensureDir(artifactsDir)

    const format      = thinReport ? 'PBIX' : 'PBIT'
    const artifactPath= resolve(join(artifactsDir, `build-output.${format.toLowerCase()}`))

    const cmd = [
      PYTHON, `"${join(PY_DIR, 'agents/bi_generator.py')}"`,
      `--pbip "${pbipDir}"`,
      `--artifact "${artifactPath}"`,
      `--format "${format}"`,
      `--pbi-tools-cmd "${PBI_TOOLS_CMD}"`
    ].join(' ')

    const step = runStepSync('bi_generator', cmd)
    return { ok: ok(step.exitCode), runId, artifact: { path: artifactPath, format }, step }
  }, {
    body: t.Object({ runId: t.String(), thinReport: t.Optional(t.Boolean()) }),
    detail: { summary: 'Run BI Generator Agent (pbi-tools.core compile)' }
  })

  .post('/agents/validate', ({ body }) => {
    const { runId } = body || {}
    if (!runId) return { ok: false, error: 'runId required' }

    const runDir      = resolve(join(RUNS_DIR, runId))
    const artifactsDir= resolve(join(runDir, 'artifacts'))
    const pbix        = resolve(join(artifactsDir, 'build-output.pbix'))
    const pbit        = resolve(join(artifactsDir, 'build-output.pbit'))
    const pbipDir     = resolve(join(runDir, 'pbip'))
    const out         = resolve(join(runDir, 'reports', 'validation_report.json')); ensureDir(resolve(join(runDir, 'reports')))

    const cmd = [
      PYTHON, `"${join(PY_DIR, 'agents/validation_agent.py')}"`,
      existsSync(pbix) ? `--pbix "${pbix}"` : '',
      existsSync(pbit) ? `--pbit "${pbit}"` : '',
      `--pbip "${pbipDir}"`,
      RULES_PATH ? `--rules "${RULES_PATH}"` : '',
      MD_GUIDE_PATH ? `--md-guide "${MD_GUIDE_PATH}"` : '',
      `--out "${out}"`
    ].filter(Boolean).join(' ')

    const step = runStepSync('validation_agent', cmd)
    let report = null
    try { report = JSON.parse(readFileSync(out, 'utf-8')) } catch {}

    return { ok: ok(step.exitCode), runId, reportPath: out, report, step }
  }, {
    body: t.Object({ runId: t.String() }),
    detail: { summary: 'Run Validation Agent (pbixray + rules runner)' }
  })

// --------------------------------------------------------------------------------------
// PIPELINE: Full run end-to-end (agents composition)
// --------------------------------------------------------------------------------------

  .post('/pipeline/run', ({ body }) => {
    const {
      thinReport = false,
      flags      = ['has_date_dimension', 'no_inactive_relationships', 'parameters_present'],
      usePbiCore = true,
      sourceDump = '',
      layoutPath = ''
    } = body || {}

    ensureDir(RUNS_DIR)
    const runId       = `run-${nowId()}`
    const runDir      = resolve(join(RUNS_DIR, runId))
    const inputsDir   = resolve(join(runDir, 'inputs'))
    const mappingDir  = resolve(join(runDir, 'mapping'))
    const pbipDir     = resolve(join(runDir, 'pbip'))
    const artifactsDir= resolve(join(runDir, 'artifacts'))
    const reportsDir  = resolve(join(runDir, 'reports'))
    ;[runDir, inputsDir, mappingDir, pbipDir, artifactsDir, reportsDir].forEach(ensureDir)

    const steps = []

    // 1) Legacy Extractor
    const metaOut = resolve(join(inputsDir, 'source_metadata.json'))
    steps.push(runStepSync('legacy_extractor', [
      PYTHON, `"${join(PY_DIR, 'agents/legacy_extractor.py')}"`,
      `--inputs-dir "${inputsDir}"`,
      sourceDump ? `--source-dump "${resolve(sourceDump)}"` : '',
      `--out "${metaOut}"`
    ].filter(Boolean).join(' ')))
    if (!ok(steps.at(-1).exitCode)) return { ok: false, runId, error: 'legacy_extractor failed', steps }

    // 2) Field Mapper
    const mapOut = resolve(join(mappingDir, 'mapping.json'))
    steps.push(runStepSync('field_mapper', [
      PYTHON, `"${join(PY_DIR, 'agents/field_mapper.py')}"`,
      `--metadata "${metaOut}"`,
      MD_GUIDE_PATH ? `--md-guide "${MD_GUIDE_PATH}"` : '',
      `--out "${mapOut}"`
    ].filter(Boolean).join(' ')))
    if (!ok(steps.at(-1).exitCode)) return { ok: false, runId, error: 'field_mapper failed', steps }

    // 3) Logic Translator
    const logicOut = resolve(join(mappingDir, 'translated_logic.json'))
    steps.push(runStepSync('logic_translator', [
      PYTHON, `"${join(PY_DIR, 'agents/logic_translator.py')}"`,
      `--mapping "${mapOut}"`,
      `--out "${logicOut}"`
    ].join(' ')))
    if (!ok(steps.at(-1).exitCode)) return { ok: false, runId, error: 'logic_translator failed', steps }

    // 4) Layout Agent (copy sample PBIP → run PBIP + apply theme/assets)
    if (existsSync(pbipDir)) rmSync(pbipDir, { recursive: true, force: true })
    cpSync(PBIP_REPO_PATH, pbipDir, { recursive: true })
    steps.push(runStepSync('layout_agent', [
      PYTHON, `"${join(PY_DIR, 'agents/layout_agent.py')}"`,
      `--pbip-src "${pbipDir}"`,
      layoutPath ? `--layout "${resolve(layoutPath)}"` : ''
    ].filter(Boolean).join(' ')))
    if (!ok(steps.at(-1).exitCode)) return { ok: false, runId, error: 'layout_agent failed', steps }

    // 5) BI Generator (compile)
    const format = thinReport ? 'PBIX' : 'PBIT'
    const artifactPath = resolve(join(artifactsDir, `build-output.${format.toLowerCase()}`))
    steps.push(runStepSync('bi_generator', [
      PYTHON, `"${join(PY_DIR, 'agents/bi_generator.py')}"`,
      `--pbip "${pbipDir}"`,
      `--artifact "${artifactPath}"`,
      `--format "${format}"`,
      `--pbi-tools-cmd "${PBI_TOOLS_CMD}"`
    ].join(' ')))
    if (!ok(steps.at(-1).exitCode)) return { ok: false, runId, error: 'bi_generator failed', steps }

    // 6) Validation Agent
    const valOut = resolve(join(reportsDir, 'validation_report.json'))
    const pbixCandidate = resolve(join(artifactsDir, 'build-output.pbix'))
    const pbitCandidate = resolve(join(artifactsDir, 'build-output.pbit'))

    steps.push(runStepSync('validation_agent', [
      PYTHON, `"${join(PY_DIR, 'agents/validation_agent.py')}"`,
      existsSync(pbixCandidate) ? `--pbix "${pbixCandidate}"` : '',
      existsSync(pbitCandidate) ? `--pbit "${pbitCandidate}"` : '',
      `--pbip "${pbipDir}"`,
      RULES_PATH ? `--rules "${RULES_PATH}"` : '',
      MD_GUIDE_PATH ? `--md-guide "${MD_GUIDE_PATH}"` : '',
      `--extra-checks "${(flags || []).join(',')}"`,
      `--out "${valOut}"`
    ].filter(Boolean).join(' ')))

    let validation = null
    try { validation = JSON.parse(readFileSync(valOut, 'utf-8')) } catch {}

    return {
      ok: ok(steps.every(s => s.exitCode === 0)),
      runId,
      artifacts : { path: artifactPath, format },
      validation,
      steps
    }
  }, {
    body: t.Object({
      thinReport: t.Optional(t.Boolean()),
      flags     : t.Optional(t.Array(t.String())),
      usePbiCore: t.Optional(t.Boolean()),
      sourceDump: t.Optional(t.String()),
      layoutPath: t.Optional(t.String())
    }),
    detail: { summary: 'Run the full multi-agent pipeline end-to-end (local)' }
  })

// --------------------------------------------------------------------------------------
// WIREFRAME → PBIP (PBIR+TMDL) EXPORT (JSON result)
// --------------------------------------------------------------------------------------

  .post('/wireframe/export', ({ body }) => {
    const {
      projectName = `Wireframe-${nowId()}`,
      thinReport  = false,                   // false => include TMDL model → PBIT
      autoCompile = true,
      theme       = { name: "Wireframe Theme", dataColors: ["#4e79a7","#f28e2b","#e15759","#76b7b2"] },
      pages       = []
    } = body || {}

    ensureDir(RUNS_DIR)
    const runId  = `wire-${nowId()}`
    const runDir = resolve(join(RUNS_DIR, runId))
    ensureDir(runDir)

    // 1) Generate PBIP (PBIR + TMDL)
    const gen = createPbipProject({ rootDir: runDir, projectName, pages, theme, withModel: !thinReport })
    const steps = [{ name: 'pbip_writer', command: 'createPbipProject()', exitCode: gen.ok ? 0 : 1,
      durationMs: gen.durationMs, stdout: JSON.stringify(gen.meta), stderr: '' }]

    if (!gen.ok) return { ok: false, error: 'PBIP generation failed', steps }

    const pbipFile = resolve(join(runDir, `${projectName}.pbip`))

    // 2) PBIR validation (AJV, conservative schemas)
    const v = validatePbirProject(runDir, projectName)
    steps.push({
      name: 'pbir_validator',
      command: 'validatePbirProject()',
      exitCode: v.ok ? 0 : 1,
      durationMs: 0,
      stdout: v.ok ? 'OK' : '',
      stderr: v.ok ? '' : JSON.stringify(v.problems)
    })
    if (!v.ok) return { ok: false, note: 'PBIR validation failed (see problems).', pbipDir, steps }

    if (!autoCompile) {
      return { ok: true, note: 'Compilation skipped by request', pbipDir, steps }
    }

   // 3) Skip compile – pbi-tools expects PbixProj, not PBIP  (see docs)
  steps.push({
    name: 'compile_skipped',
    command: 'pbi-tools.core compile (unsupported for PBIP)',
    exitCode: 0, durationMs: 0,
    stdout: 'PBIP generated. Use Power BI Desktop to open and Save As PBIT, or implement a PbixProj generator.',
    stderr: ''
  })
  return {
    ok: true,
    pbipFile,                           // <- return the actual .pbip
    reportDir: resolve(join(runDir, `${projectName}.Report`)),
    modelDir : resolve(join(runDir, `${projectName}.SemanticModel`)),
    steps,
    note: 'Compilation skipped: pbi-tools requires PbixProj sources, not PBIP.'
  }    
  }, {
    body: t.Object({
      projectName: t.Optional(t.String()),
      thinReport : t.Optional(t.Boolean()),
      autoCompile: t.Optional(t.Boolean()),
      theme      : t.Optional(t.Record(t.String(), t.Any())),
      pages      : t.Array(t.Object({
        name   : t.String(),
        visuals: t.Array(t.Object({
          type   : t.String(),
          x      : t.Number(), y: t.Number(), w: t.Number(), h: t.Number(),
          title  : t.Optional(t.String()),
          binding: t.Optional(t.String()) // e.g., "[PlaceholderRevenue]"
        }))
      }))
    }),
    detail: { summary: 'Export a wireframe to PBIP (PBIR+TMDL) and try to compile to PBIT/PBIX' }
  })

// --------------------------------------------------------------------------------------
// WIREFRAME EXPORT (SSE over POST): step-by-step logs (generate → validate → compile)
// --------------------------------------------------------------------------------------

  .post('/wireframe/export/stream', async ({ request }) => {
    const body = await request.json().catch(() => ({}))
    const {
      projectName = `Wireframe-${nowId()}`,
      thinReport  = false,
      theme       = { name: "Wireframe Theme", dataColors: ["#4e79a7","#f28e2b","#e15759","#76b7b2"] },
      pages       = []
    } = body || {}

    ensureDir(RUNS_DIR)
    const runId  = `wire-${nowId()}`
    const runDir = resolve(join(RUNS_DIR, runId))
    ensureDir(runDir)

    const headers = {
      'Content-Type'      : 'text/event-stream',
      'Cache-Control'     : 'no-cache, no-transform',
      'Connection'        : 'keep-alive',
      'X-Accel-Buffering' : 'no'
    }

    // Build a ReadableStream for POST streaming.
    return new Response(new ReadableStream({
      start(controller) {
        const send = (event, data) => {
          const payload = `event: ${event}\n` + `data: ${JSON.stringify(data)}\n\n`
          controller.enqueue(new TextEncoder().encode(payload))
        }

        try {
          // 1) Generate PBIP
          send('step', { name: 'generate', message: 'Generating PBIP (PBIR + TMDL)...' })
          const gen = createPbipProject({
            rootDir: runDir, projectName, pages, theme, withModel: !thinReport
          })
          if (!gen.ok) {
            send('error', { where: 'generate', error: gen.error || 'unknown' })
            send('done', { ok: false })
            controller.close(); return
          }
          const pbipDir = resolve(join(runDir, projectName))
          send('info', { pbipDir, meta: gen.meta })

          // 2) Validate PBIR
          send('step', { name: 'validate', message: 'Validating PBIR & theme...' })
          const v = validatePbirProject(runDir, projectName)
          if (!v.ok) {
            send('error', { where: 'validate', problems: v.problems })
            send('done', { ok: false, pbipDir })
            controller.close(); return
          }
          send('info', { validate: 'ok' })

          // 3) Compile
          const format  = thinReport ? 'PBIX' : 'PBIT'
          const outFile = resolve(join(runDir, `${projectName}.${format.toLowerCase()}`))
          const compileCmd = `${PBI_TOOLS_CMD} compile "${pbipDir}" "${outFile}" ${format}`
          send('step', { name: 'compile', message: compileCmd })
          const result = runStepSync('pbi_tools_compile', compileCmd)
          if (result.stdout) send('log', { stdout: result.stdout })
          if (!ok(result.exitCode)) {
            send('error', { where: 'compile', stderr: result.stderr })
            send('done', { ok: false, pbipDir })
            controller.close(); return
          }

          send('done', { ok: true, artifact: { path: outFile, format }, pbipDir })
          controller.close()
        } catch (e) {
          send('error', { error: String(e && e.stack ? e.stack : e) })
          controller.close()
        }
      }
    }), { headers })
  }, {
    detail: { summary: 'Wireframe export with streaming logs (POST stream)' }
  })

// --------------------------------------------------------------------------------------
// WIREFRAME: Open PBIP in Power BI Desktop (Windows only)
// --------------------------------------------------------------------------------------

  .post('/wireframe/open-in-desktop', async ({ request }) => {
    const { pbipDir } = await request.json().catch(() => ({}))
    if (!pbipDir) return { ok: false, error: 'pbipDir required' }
    if (os.platform() !== 'win32') return { ok: false, error: 'Windows only' }

    const exe = process.env.PBI_DESKTOP_EXE
      || `C:\\Program Files\\Microsoft Power BI Desktop\\bin\\PBIDesktop.exe`
    const cmd = `"${exe}" "${target}"`
    const step = runStepSync('open_in_desktop', cmd, { stdio: 'ignore', windowsHide: true })

    // PBIDesktop may return before the UI shows up; we report the attempt
    return { ok: true, cmd, exitCode: step.exitCode }
  }, {
    body: t.Object({ pbipDir: t.String() }),
    detail: { summary: 'Launch Power BI Desktop with the PBIP folder (Windows)' }
  })

// --------------------------------------------------------------------------------------
// DOWNLOAD: serve artifacts (PBIT/PBIX) securely from workspace
// --------------------------------------------------------------------------------------

  .get('/files/download', ({ query, set }) => {
    const filePath = query.path || ''
    const abs = resolve(filePath)
    // allow only files under workspace directory
    if (!abs.startsWith(WORKSPACE_DIR)) {
      set.status = 400
      return { ok: false, error: 'Invalid path' }
    }
    if (!existsSync(abs)) {
      set.status = 404
      return { ok: false, error: 'Not found' }
    }
    const name = abs.split(/[\\/]/).pop()
    set.headers['Content-Disposition'] = `attachment; filename="${name}"`
    return new Response(Bun.file(abs))
  }, {
    query: t.Object({ path: t.String() }),
    detail: { summary: 'Download artifact (PBIT/PBIX) from workspace' }
  })

// --------------------------------------------------------------------------------------
// Listen
// --------------------------------------------------------------------------------------

  .listen(PORT)

console.log(`Elysia API running at http://localhost:${PORT}`)
console.log(`OpenAPI (Scalar UI):   http://localhost:${PORT}/openapi`)
console.log(`Raw OpenAPI JSON:       http://localhost:${PORT}/openapi/json`)
console.log(`Runs workspace:         ${RUNS_DIR}`)