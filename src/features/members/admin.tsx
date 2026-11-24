import type { AdminFeature } from '../../client/host/index.ts'
import MembersPage from './MembersPage.tsx'
import PostAccessBox from './PostAccessBox.tsx'

const members: AdminFeature = {
  name: 'members',
  register(admin) {
    admin.page('/admin/members', MembersPage)
    // Who may read the post, and the request to email it. Posts only.
    admin.fill('post.editor.sidebar', PostAccessBox)
    admin.dictionaries({ es: () => import('./i18n/es.ts') })
  }
}

export default members
