/**
 * German. One file per group of admin screens, so the screens can be
 * translated (and reviewed) independently; later entries win on a clash, but
 * a clash should be the same translation of the same English.
 */
import type { Dictionary } from '../../index.ts'
import layout from './layout.ts'
import content from './content.ts'
import site from './site.ts'
import people from './people.ts'
import editor from './editor.ts'
import auth from './auth.ts'

const de: Dictionary = { ...layout, ...content, ...site, ...people, ...editor, ...auth }

export default de
