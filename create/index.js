#!/usr/bin/env node

/**
 * @basicbenframework/create
 *
 * Creates a new project from the BasicBen CMS.
 *
 * Usage:
 *   npx @basicbenframework/create my-app
 *   npx @basicbenframework/create my-app --ref v0.5.1
 *
 * ## Why this downloads instead of bundling
 *
 * It used to ship a copy of the CMS inside the package, written at publish
 * time. That copy went stale the moment the CMS changed, and staleness here is
 * not a missing feature — the published 0.5.0 scaffolder handed people a CMS
 * that threw a TypeError on any post with a featured image, long after the
 * repository had fixed it. A snapshot released on a different cadence from the
 * thing it snapshots will always drift; the only question is how far.
 *
 * So there is no copy. This fetches the repository at run time, which cannot be
 * stale by construction, and removes the bundling step, the second release and
 * the second place for the CMS to exist.
 *
 * The cost is that creating a project needs network access and GitHub to be
 * reachable — already true of the `npm install` that follows it.
 */

import { mkdirSync, writeFileSync, readFileSync, rmSync, existsSync, renameSync, readdirSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { execFileSync } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { tmpdir } from 'node:os'

const REPO = 'BasicBenFramework/basicben'

/**
 * Paths that belong to the repository rather than to a project made from it.
 *
 * `create` is this package: a project does not contain its own scaffolder. The
 * rest is repository plumbing — CI, the release script, the end-to-end smoke
 * test — which a new project has no use for.
 */
const NOT_YOURS = new Set([
  'create',
  '.github',
  'PUBLISH.md',
  'TESTING.md',
  'package-lock.json'
])

const bold = (s) => `\x1b[1m${s}\x1b[0m`
const green = (s) => `\x1b[32m${s}\x1b[0m`
const cyan = (s) => `\x1b[36m${s}\x1b[0m`
const yellow = (s) => `\x1b[33m${s}\x1b[0m`
const red = (s) => `\x1b[31m${s}\x1b[0m`
const dim = (s) => `\x1b[2m${s}\x1b[0m`

async function main() {
  const args = process.argv.slice(2)

  if (args.includes('--help') || args.includes('-h') || args.length === 0) {
    showHelp()
    process.exit(0)
  }

  const projectName = args[0]

  if (!projectName || projectName.startsWith('-')) {
    console.error(`\n${red('Error:')} Please provide a project name.\n`)
    console.log(`  ${cyan('npx @basicbenframework/create')} ${dim('<project-name>')}\n`)
    process.exit(1)
  }

  if (!/^[a-z0-9-_]+$/i.test(projectName)) {
    console.error(`\n${red('Error:')} Project name can only contain letters, numbers, dashes, and underscores.\n`)
    process.exit(1)
  }

  // A branch, tag or commit. `main` is the current CMS; pin it if you would
  // rather a new project not move when the repository does.
  const refFlag = args.indexOf('--ref')
  const ref = refFlag === -1 ? 'main' : args[refFlag + 1]

  if (refFlag !== -1 && !ref) {
    console.error(`\n${red('Error:')} --ref needs a branch, tag or commit.\n`)
    process.exit(1)
  }

  const projectDir = resolve(process.cwd(), projectName)

  if (existsSync(projectDir)) {
    console.error(`\n${red('Error:')} Directory "${projectName}" already exists.\n`)
    process.exit(1)
  }

  console.log()
  console.log(`${bold('Creating a new BasicBen app')} in ${cyan(projectDir)}`)
  console.log(dim(`from ${REPO}@${ref}`))
  console.log()

  const work = join(tmpdir(), `basicben-create-${randomBytes(6).toString('hex')}`)
  mkdirSync(work, { recursive: true })

  try {
    await download(ref, work)
    place(work, projectDir)
    configure(projectDir, projectName)
  } catch (error) {
    // A half-written directory is worse than none: the next attempt would
    // refuse to run because the path already exists.
    rmSync(projectDir, { recursive: true, force: true })
    console.error(`\n${red('Error:')} ${error.message}\n`)
    process.exit(1)
  } finally {
    rmSync(work, { recursive: true, force: true })
  }

  console.log(`${green('✓')} Project created successfully!`)
  console.log()
  console.log(bold('Next steps:'))
  console.log()
  console.log(`  ${cyan('cd')} ${projectName}`)
  console.log(`  ${cyan('npm install')}`)
  console.log(`  ${cyan('npm run migrate')}`)
  console.log(`  ${cyan('npm run dev')}`)
  console.log()
  console.log(dim('The first account you register becomes the admin.'))
  console.log()
}

/** Fetch and unpack the repository at `ref`. */
async function download(ref, work) {
  const url = `https://codeload.github.com/${REPO}/tar.gz/${encodeURIComponent(ref)}`

  let response

  try {
    response = await fetch(url, { redirect: 'follow' })
  } catch (error) {
    throw new Error(`Could not reach GitHub — ${error.message}`)
  }

  if (!response.ok) {
    throw response.status === 404
      ? new Error(`No branch, tag or commit named "${ref}" in ${REPO}.`)
      : new Error(`Could not download ${REPO}@${ref} — GitHub returned ${response.status}.`)
  }

  const archive = join(work, 'cms.tar.gz')
  writeFileSync(archive, Buffer.from(await response.arrayBuffer()))

  const unpacked = join(work, 'src')
  mkdirSync(unpacked, { recursive: true })

  // GitHub nests everything under `owner-repo-sha/`, hence the strip. `tar` is
  // present on macOS, Linux and Windows 10+ — a weaker assumption than the one
  // npm itself makes.
  try {
    execFileSync('tar', ['-xzf', archive, '-C', unpacked, '--strip-components=1'], { stdio: 'pipe' })
  } catch {
    throw new Error('Could not unpack the download — is `tar` on your PATH?')
  }
}

/** Move the repository into place, minus the parts that are not a project. */
function place(work, projectDir) {
  const source = join(work, 'src')

  mkdirSync(projectDir, { recursive: true })

  for (const entry of readdirSync(source)) {
    if (NOT_YOURS.has(entry)) continue
    renameSync(join(source, entry), join(projectDir, entry))
  }

  // The repository carries this undotted because npm strips dotfiles from
  // published packages. Nothing strips anything here, but the name still has to
  // be corrected for git to honour it.
  const undotted = join(projectDir, 'gitignore')

  if (existsSync(undotted)) renameSync(undotted, join(projectDir, '.gitignore'))
}

/** Name the project and give it an environment it can start with. */
function configure(projectDir, projectName) {
  const pkgPath = join(projectDir, 'package.json')
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'))

  // The repository's own package.json, renamed — not rebuilt from a list here.
  // That list was a second copy of the scripts and dependencies, and it drifted
  // from the real one exactly as you would expect a second copy to.
  pkg.name = projectName
  pkg.version = '0.1.0'
  pkg.private = true
  delete pkg.description

  writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n')

  // Likewise the environment: .env.example is the documented one, so the only
  // thing added is the key, which has to be generated per project.
  const examplePath = join(projectDir, '.env.example')
  const example = existsSync(examplePath) ? readFileSync(examplePath, 'utf-8') : 'APP_KEY=\n'

  writeFileSync(
    join(projectDir, '.env'),
    example.replace(/^APP_KEY=.*$/m, `APP_KEY=${randomBytes(32).toString('hex')}`)
  )
}

function showHelp() {
  console.log(`
${bold('create-basicben')} — start a project from the BasicBen CMS

${bold('Usage')}
  ${cyan('npx @basicbenframework/create')} ${dim('<project-name>')}

${bold('Options')}
  ${dim('--ref <ref>')}   branch, tag or commit to take (default: main)
  ${dim('--help')}        show this

${bold('What you get')}
  The CMS from ${REPO}: posts, pages, media, an
  admin UI and a headless content API. It is downloaded rather than bundled,
  so it is never a stale copy.

  ${yellow('This is your project.')} It has no link back to the repository. To track
  the CMS and pull fixes instead, fork it:

    ${cyan(`git clone https://github.com/${REPO}.git my-app`)}
`)
}

main()
