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
import { addDictionaries, type Dictionary } from '../i18n/index.ts'
import type { FeatureManifest } from '../../host/manifest.ts'
import type { ConfigStatus } from '../components/admin/ConfigField.tsx'

export interface AdminFeature {
  name: string
  register(admin: AdminHost): void
}

/** Named places in core screens that features may add to. */
export type SlotName = 'post.editor.sidebar' | 'settings.reading'

/**
 * What the post editor gives a `post.editor.sidebar` fill.
 *
 * `values` holds the post's `visibility` and whatever fields fills have set
 * this session; `onChange` sets them, and the editor sends them with the next
 * save (posts only). Core does not know what they mean: the server-side half
 * of the feature does, through the `post.creating` / `post.updating` filters.
 */
export interface PostEditorSidebarProps {
  kind: 'post' | 'page'
  /** Null until the post is first saved. */
  postId: number | null
  /** The post as loaded, or null for a new one. */
  record: Record<string, unknown> | null
  values: Record<string, unknown>
  disabled: boolean
  onChange(changes: Record<string, unknown>): void
}

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
let enabled: FeatureManifest[] = []

/**
 * Register the site's enabled features: their admin halves, and the manifests
 * of every enabled feature (one without an admin half still has menu facts).
 * Called once by src/main.tsx, before the route table and the menu are built.
 */
export function registerAdminFeatures(features: AdminFeature[], manifests: FeatureManifest[]): void {
  enabled = [...manifests]
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

/**
 * What the Settings page gives a `settings.reading` fill, rendered after the
 * Reading card. `values` is every stored setting plus what fills have changed;
 * `onChange` changes them, and the page saves them with its own. Only keys a
 * feature defined (host.settings.define) are accepted by the server.
 */
export interface SettingsSectionProps {
  values: Record<string, string>
  onChange(changes: Record<string, string>): void
  /** Where each value the environment can also set comes from (helpers/config.ts). */
  config?: ConfigStatus[]
  /** Which secret settings are saved. Their values are never sent. */
  secrets?: Record<string, boolean>
}

/** Whether any feature fills a slot. */
export function hasFills(name: SlotName): boolean {
  return (fills.get(name)?.length ?? 0) > 0
}

/** The manifests of the features this site enables, in list order. */
export function enabledManifests(): FeatureManifest[] {
  return enabled
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
