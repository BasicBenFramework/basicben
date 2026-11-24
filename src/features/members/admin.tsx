import type { AdminFeature } from '../../client/host'
import MembersPage from './MembersPage'
import PostAccessBox from './PostAccessBox'

const members: AdminFeature = {
  name: 'members',
  register(admin) {
    admin.page('/admin/members', MembersPage)
    // Who may read the post, and the request to email it. Posts only.
    admin.fill('post.editor.sidebar', PostAccessBox)
    admin.dictionaries({ es: () => import('./i18n/es') })
  }
}

export default members
