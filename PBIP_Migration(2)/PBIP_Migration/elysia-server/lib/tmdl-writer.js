// elysia-server/lib/tmdl-writer.js
/**
 * tmdl-writer.js
 * Emit a minimal TMDL model to support placeholder bindings.
 *
 * We create:
 *  - A database with a single table "Placeholders"
 *  - A few columns (Revenue, Count, Text) so card/placeholder visuals can bind.
 *
 * References:
 *  - TMDL code-first model authoring (preview docs)   [1](https://community.fabric.microsoft.com/t5/Desktop/power-BI-rest-API-with-python/td-p/1953492)
 *  - pbi-tools supports TMDL for compile               [2](https://www.microsoft.com/en-us/power-platform/products/power-bi/downloads)
 */

import { writeFileSync } from 'node:fs'
import { resolve, join } from 'node:path'

export function writeTmdlModel({ modelDir, projectName, pages }) {
  const tmdl = `
model
  name: "${projectName}Model"
  culture: "en-US"

table "Placeholders"
  dataCategory: None

  column "PlaceholderRevenue"
    dataType: double

  column "PlaceholderCount"
    dataType: int64

  column "PlaceholderText"
    dataType: string

  measure "Revenue"
    expression: "SUM ( 'Placeholders'[PlaceholderRevenue] )"
    formatString: "\\$ #,0"

  measure "Count"
    expression: "SUM ( 'Placeholders'[PlaceholderCount] )"
    formatString: "#,0"
`.trim() + '\n'

  // TMDL files are typically saved as .tmdl
  const file = resolve(join(modelDir, 'model.tmdl'))
  writeFileSync(file, tmdl, 'utf-8')
  return file
}