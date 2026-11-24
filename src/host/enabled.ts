/**
 * Which features a site runs: `features` in basicben.config.js, checked
 * against the features the CMS ships.
 *
 * The server, the admin build and defineSite all read the list through this,
 * so a misspelt name stops the build or the boot instead of quietly leaving a
 * feature off. No runtime imports beyond the manifests (plain data), so the
 * Vite config can use it too.
 */
import manifests from '../features.manifest.ts'
import type { FeatureManifest } from './manifest.ts'

export function enabledFeatureNames(given: unknown, known: Record<string, FeatureManifest> = manifests): string[] {
  if (given === undefined) {
    console.warn(
      '[basicben] No `features` in basicben.config.js, so none are enabled: the bare core. ' +
        `List the ones the site uses, from: ${Object.keys(known).join(', ')}.`
    )
    return []
  }
  if (!Array.isArray(given) || given.some((name) => typeof name !== 'string')) {
    throw new Error('`features` in basicben.config.js must be a list of feature names')
  }

  const seen = new Set<string>()
  let last: string | null = null
  for (const name of given as string[]) {
    if (!Object.hasOwn(known, name)) {
      throw new Error(`Unknown feature "${name}" in basicben.config.js. The CMS has: ${Object.keys(known).join(', ')}`)
    }
    if (seen.has(name)) throw new Error(`Feature "${name}" is listed twice in basicben.config.js`)
    if (last && !known[name].mountLast) {
      throw new Error(`Feature "${last}" must be listed after "${name}": its routes catch whatever is mounted after them`)
    }
    if (known[name].mountLast) last = name
    seen.add(name)
  }
  return [...given] as string[]
}

/** The manifests of the given features, in list order. */
export function manifestsFor(names: string[], known: Record<string, FeatureManifest> = manifests): FeatureManifest[] {
  return names.flatMap((name) => (known[name] ? [known[name]] : []))
}
