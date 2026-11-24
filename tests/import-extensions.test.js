/**
 * Every relative import under src/ names its file, extension and all.
 *
 * Vite resolves `../models/Post`; plain Node does not, and neither does a
 * compiled copy of this code in lib/ (`npm run build:lib`), which is what Node
 * loads once the CMS is a package. tsc's rewriteRelativeImportExtensions turns
 * `./Post.ts` into `./Post.js` and leaves an extensionless specifier as it is,
 * so one would break only in the compiled copy. This keeps them out.
 *
 * It parses with TypeScript, so specifiers inside strings and code samples on
 * the docs pages are not counted.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { createRequire } from 'node:module'

const ROOT = join(import.meta.dirname, '..')
const ts = createRequire(import.meta.url)('typescript')
const HAS_EXTENSION = /\.(ts|tsx|js|mjs|css|json)$/

function sources(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) sources(path, out)
    else if (/\.tsx?$/.test(name) && !name.endsWith('.d.ts')) out.push(path)
  }
  return out
}

test('relative imports under src/ carry their extension', () => {
  const missing = []

  for (const file of sources(join(ROOT, 'src'))) {
    const text = readFileSync(file, 'utf-8')
    const kind = file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS
    const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, kind)

    const check = (literal) => {
      if (!literal || !ts.isStringLiteral(literal)) return
      const spec = literal.text
      if (/^\.{1,2}\//.test(spec) && !spec.includes('?') && !HAS_EXTENSION.test(spec)) {
        missing.push(`${relative(ROOT, file)}: ${spec}`)
      }
    }
    const visit = (node) => {
      if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier) check(node.moduleSpecifier)
      else if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) check(node.arguments[0])
      else if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument)) check(node.argument.literal)
      ts.forEachChild(node, visit)
    }
    visit(source)
  }

  assert.deepEqual(missing, [], `Add the extension (.ts or .tsx):\n  ${missing.join('\n  ')}`)
})
