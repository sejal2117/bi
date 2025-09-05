// elysia-server/lib/pbip-writer.js
/**
 * PBIP writer (schema-correct for Desktop preview)
 *
 * Emits:
 *   <runDir>/<Project>.pbip
 *   {
 *     "$schema": "https://developer.microsoft.com/json-schemas/fabric/pbip/pbipProperties/1.0.0/schema.json",
 *     "version": "1.0",
 *     "artifacts": [ { "report": { "path": "<Project>.Report" } } ],
 *     "settings": { "enableAutoRecovery": true }
 *   }
 *
 *   <runDir>/<Project>.Report/
 *     definition.pbir        -> ONLY datasetReference (+ version + $schema)
 *     RegisteredResources/theme.json  (optional helper)
 *     .pbi/localSettings.json         (now schema-correct)
 *     definition/                      (PBIR folder present; we keep empty for now)
 *
 *   <runDir>/<Project>.SemanticModel/
 *     model.tmdl             -> minimal TMDL (if withModel = true)
 *
 * References:
 *  - PBIP: .pbip is a pointer to Report; Desktop links the official pbip schema.  [4](https://pypi.org/project/pbi-tools/)
 *  - PBIR: definition.pbir must include datasetReference (byPath/byConnection).  [1](https://pypi.org/project/pbip-tools/)
 *  - Report localSettings schema exists under item-schemas/report/localSettings-1.0.json.  [2](https://github.com/microsoft/powerbi-desktop-samples/blob/main/item-schemas/README.md)
 */

import { writeFileSync, mkdirSync } from 'node:fs'
import { resolve, join } from 'node:path'
import { writeTmdlModel } from './tmdl-writer.js'

const ensure = (d) => { mkdirSync(d, { recursive: true }) }
const jwrite = (p, o) => writeFileSync(p, JSON.stringify(o, null, 2), 'utf-8')

// --- PBIP root (.pbip) ---
function writePbipRoot({ rootDir, projectName }) {
  const pbipObj = {
    "$schema": "https://developer.microsoft.com/json-schemas/fabric/pbip/pbipProperties/1.0.0/schema.json",
    "version": "1.0",
    "artifacts": [
      { "report": { "path": `${projectName}.Report` } }
    ],
    "settings": {
      "enableAutoRecovery": true
    }
  }
  const pbipPath = resolve(join(rootDir, `${projectName}.pbip`))
  jwrite(pbipPath, pbipObj)
  return pbipPath
}

// --- PBIR definition.pbir (minimal & valid) ---
function writeDefinitionPbir({ reportDir, projectName }) {
  const defObj = {
    "$schema": "https://developer.microsoft.com/json-schemas/fabric/item/report/definitionProperties/1.0.0/schema.json",
    "version": "4.0",
    "datasetReference": {
      "byPath": { "path": `../${projectName}.SemanticModel` }  // NOTE: forward slashes, relative
    }
  }
  const defPath = resolve(join(reportDir, 'definition.pbir'))
  jwrite(defPath, defObj)
  return defPath
}

// --- Report localSettings.json (in .pbi/) ---
// Keep it conservative & valid; Desktop can populate signature later.
// This file IS required by Desktop in PBIP projects.  [1](https://pypi.org/project/pbip-tools/)
function writeLocalSettings({ reportDir }) {
  const pbi = resolve(join(reportDir, '.pbi'))
  ensure(pbi)
  const obj = {
    "$schema": "https://developer.microsoft.com/json-schemas/fabric/item/report/localSettings/1.0.0/schema.json",
    "version": "1.0",
    // optional fields - keep null so Desktop can overwrite safely:
    "securityBindingsSignature": null
  }
  jwrite(resolve(join(pbi, 'localSettings.json')), obj)
}

// --- Optional RegisteredResources/theme.json ---
function writeTheme({ reportDir, theme }) {
  const rr = resolve(join(reportDir, 'RegisteredResources'))
  ensure(rr)
  jwrite(resolve(join(rr, 'theme.json')), theme || { name: 'Wireframe Theme' })
}

// --- PBIR definition/ folder (present; empty for now) ---
function ensureDefinitionFolder({ reportDir }) {
  const defFolder = resolve(join(reportDir, 'definition'))
  ensure(defFolder)
  return defFolder
}

// PUBLIC
export function createPbipProject({ rootDir, projectName, pages = [], theme, withModel = true }) {
  const started = Date.now()
  try {
    const reportDir = resolve(join(rootDir, `${projectName}.Report`))
    const modelDir  = resolve(join(rootDir, `${projectName}.SemanticModel`))
    ensure(reportDir)
    if (withModel) ensure(modelDir)

    const pbipPath = writePbipRoot({ rootDir, projectName })
    const defPath  = writeDefinitionPbir({ reportDir, projectName })
    ensureDefinitionFolder({ reportDir })
    writeLocalSettings({ reportDir })    // <-- fixed here
    writeTheme({ reportDir, theme })

    if (withModel) {
      writeTmdlModel({ modelDir, projectName, pages })
    }

    return {
      ok: true,
      durationMs: Date.now() - started,
      meta: { projectName, reportDir, modelDir, pbipPath, defPath }
    }
  } catch (e) {
    return { ok: false, durationMs: Date.now() - started, error: String(e) }
  }
}