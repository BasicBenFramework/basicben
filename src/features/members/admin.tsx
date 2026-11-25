import type { AdminFeature } from '../../client/host/index.ts'
import MembersPage from './MembersPage.tsx'
import PostAccessBox from './PostAccessBox.tsx'

const members: AdminFeature = {
  name: 'members',
  register(admin) {
    admin.page('/admin/members', MembersPage)
    // Who may read the post, and the request to email it. Posts only.
    admin.fill('post.editor.sidebar', PostAccessBox)
    admin.dictionaries({
      de: () => import('./i18n/de.ts'),
      es: () => import('./i18n/es.ts'),
      fr: () => import('./i18n/fr.ts'),
      pt: () => import('./i18n/pt.ts'),
      ja: () => import('./i18n/ja.ts'),
      zh: () => import('./i18n/zh.ts')
    })
  }
}

export default members
