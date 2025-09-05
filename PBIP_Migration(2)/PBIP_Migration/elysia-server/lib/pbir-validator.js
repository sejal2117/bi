// elysia-server/lib/pbir-validator.js
import Ajv from 'ajv'
import addFormats from 'ajv-formats'
import { readFileSync, existsSync } from 'node:fs'
import { resolve, join } from 'node:path'

const ajv = new Ajv({ allErrors: true, strict: false })
addFormats(ajv)

// PBIP root
const pbipSchema = {
  type: 'object',
  properties: {
    $schema: { type: 'string' },
    version: { type: 'string' },
    artifacts: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          report: {
            type: 'object',
            properties: { path: { type: 'string' } },
            required: ['path'],
            additionalProperties: false
          }
        },
        required: ['report'],
        additionalProperties: false
      },
      minItems: 1
    },
    settings: { type: 'object' }
  },
  required: ['artifacts'],
  additionalProperties: false
}

// PBIR definition.pbir
const defPbirSchema = {
  type: 'object',
  properties: {
    $schema: { type: 'string' },
    version: { type: 'string' },
    datasetReference: {
      type: 'object',
      properties: {
        byPath: {
          type: 'object',
          properties: { path: { type: 'string' } },
          required: ['path'],
          additionalProperties: false
        },
        byConnection: { type: ['object', 'null'] }
      },
      additionalProperties: false
    }
  },
  required: ['datasetReference'],
  additionalProperties: false
}

// Report localSettings.json (in .pbi/)
const reportLocalSettingsSchema = {
  type: 'object',
  properties: {
    $schema: { type: 'string' },
    version: { type: ['string','null'] },                 // observed value "1.0" in samples
    securityBindingsSignature: { type: ['string','null'] } // optional
  },
  additionalProperties: false
}

const validatePbipRoot  = ajv.compile(pbipSchema)
const validateDefPbir   = ajv.compile(defPbirSchema)
const validateRptLocal  = ajv.compile(reportLocalSettingsSchema)

export function validatePbirProject(projectRoot, projectName) {
  const problems = []

  // PBIP
  try {
    const pbipPath = resolve(join(projectRoot, `${projectName}.pbip`))
    if (!existsSync(pbipPath)) {
      problems.push({ file: `${projectName}.pbip`, error: `Missing: ${pbipPath}` })
    } else {
      const j = JSON.parse(readFileSync(pbipPath, 'utf-8'))
      if (!validatePbipRoot(j)) problems.push({ file: `${projectName}.pbip`, errors: validatePbipRoot.errors })
    }
  } catch (e) {
    problems.push({ file: `${projectName}.pbip`, error: String(e) })
  }

  // PBIR definition
  try {
    const defPath = resolve(join(projectRoot, `${projectName}.Report`, 'definition.pbir'))
    if (!existsSync(defPath)) {
      problems.push({ file: 'definition.pbir', error: `Missing: ${defPath}` })
    } else {
      const j = JSON.parse(readFileSync(defPath, 'utf-8'))
      if (!validateDefPbir(j)) problems.push({ file: 'definition.pbir', errors: validateDefPbir.errors })
    }
  } catch (e) {
    problems.push({ file: 'definition.pbir', error: String(e) })
  }

  // Report .pbi/localSettings.json
  try {
    const lsPath = resolve(join(projectRoot, `${projectName}.Report`, '.pbi', 'localSettings.json'))
    if (!existsSync(lsPath)) {
      problems.push({ file: '.pbi/localSettings.json', error: `Missing: ${lsPath}` })
    } else {
      const j = JSON.parse(readFileSync(lsPath, 'utf-8'))
      if (!validateRptLocal(j)) problems.push({ file: '.pbi/localSettings.json', errors: validateRptLocal.errors })
    }
  } catch (e) {
    problems.push({ file: '.pbi/localSettings.json', error: String(e) })
  }

  return { ok: problems.length === 0, problems }
}