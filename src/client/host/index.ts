/**
 * The admin half of the feature host (src/host is the server half).
 *
 * A feature's `admin.tsx` registers its pages, slot fills and translations
 * here. Its menu entries come from its manifest, which the server reads too,
 * so the server's menu and this one cannot disagree.
 *
 * Internal API: it may change in any release.
 */

import { createElement, Fragment, type ComponentType, type ReactNode } from 'react'
import { addDictionaries, type Dictionary } from '../i18n'
import type { FeaturePage } from '../../host/manifest.ts'

export interface AdminFeature {
  name: string
  register(admin: AdminHost): void
}

/** Named places in core screens that features may add to. */
export type SlotName = 'post.editor.sidebar'

export interface AdminHost {
  /** The screen for a page the feature's manifest declares. */
  page(path: string, component: ComponentType<any>): void
  /** Add a component to a named slot in a core screen. */
  fill(slot: SlotName, component: ComponentType<any>): void
  /** The feature's translations, loaded with the admin's own. */
  dictionaries(loaders: Record<string, () => Promise<{ default: Dictionary }>>): void
}

const pages = new Map<string, ComponentType<any>>()
const fills = new Map<SlotName, Array<ComponentType<any>>>()

export function registerAdminFeatures(features: AdminFeature[], manifests: Array<{ name: string; pages?: FeaturePage[] }>): void {
  for (const feature of features) {
    const declared = new Set((manifests.find((m) => m.name === feature.name)?.pages ?? []).map((p) => p.path))

    feature.register({
      page(path, component) {
        // A page with no manifest entry would be a screen with no menu item
        // and no server-side knowledge of it; refuse it while developing.
        if (!declared.has(path)) throw new Error(`${feature.name}: page ${path} is not declared in its manifest`)
        pages.set(path, component)
      },
      fill(slot, component) {
        fills.set(slot, [...(fills.get(slot) ?? []), component])
      },
      dictionaries(loaders) {
        addDictionaries(loaders)
      }
    })
  }
}

export function featurePages(): Array<[string, ComponentType<any>]> {
  return [...pages.entries()]
}

/** Render every fill for a slot, with the props the core screen passes. */
export function Slot({ name, ...props }: { name: SlotName } & Record<string, unknown>): ReactNode {
  const list = fills.get(name) ?? []
  if (!list.length) return null
  return createElement(Fragment, null, ...list.map((Component, index) => createElement(Component, { key: index, ...props })))
}
