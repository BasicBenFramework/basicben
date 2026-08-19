import { useState, useEffect, FormEvent, ChangeEvent, useRef } from 'react'
import { useAuth } from '@basicbenframework/core/client'
import { PageHeader } from '../components/PageHeader'
import { Card } from '../components/Card'
import { Input } from '../components/Input'
import { Textarea } from '../components/Textarea'
import { Button } from '../components/Button'
import { Avatar } from '../components/Avatar'
import { api } from '../../helpers/api'
import { useMediaLibrary } from '../hooks/useMediaLibrary'
import { useToast } from '../contexts/ToastContext'
import { useTheme } from '../components/ThemeContext'

/**
 * The account and the author profile, which are the same record.
 *
 * Everything below the address is what a reader sees: the biography under a
 * byline, the link on an author archive, the face beside a post. The account
 * half — the password, the role — stays where it was.
 */
interface ProfileUser {
  id: number
  name: string
  email: string
  slug?: string | null
  bio?: string | null
  website?: string | null
  avatar_id?: number | null
  avatar_url?: string | null
}

interface ProfileResponse {
  user: ProfileUser
}

export function Profile() {
  const { user, setUser } = useAuth()
  const toast = useToast()
  const { t } = useTheme()
  const library = useMediaLibrary()
  const fileInput = useRef<HTMLInputElement>(null)

  const [form, setForm] = useState({
    name: user?.name || '',
    email: user?.email || '',
    slug: '',
    website: '',
    bio: ''
  })
  const [avatar, setAvatar] = useState<{ id: number | null; url: string | null }>({
    id: null,
    url: null
  })
  const [pwForm, setPwForm] = useState({ currentPassword: '', newPassword: '' })
  const [loading, setLoading] = useState(false)
  const [uploading, setUploading] = useState(false)

  // `useAuth` carries the name and the address and nothing else, so the profile
  // is fetched rather than assumed — otherwise the first save would post empty
  // strings over a biography the user had already written.
  useEffect(() => {
    api<ProfileResponse>('/api/profile')
      .then(data => {
        setForm({
          name: data.user.name || '',
          email: data.user.email || '',
          slug: data.user.slug || '',
          website: data.user.website || '',
          bio: data.user.bio || ''
        })
        setAvatar({ id: data.user.avatar_id ?? null, url: data.user.avatar_url ?? null })
      })
      .catch(() => {
        // The form still works from what the session knows; a failed profile
        // read should not leave the page blank.
      })
  }, [])

  const updateProfile = async (e: FormEvent) => {
    e.preventDefault()
    setLoading(true)
    try {
      const data = await api<ProfileResponse>('/api/profile', {
        method: 'PUT',
        body: JSON.stringify({ ...form, avatar_id: avatar.id })
      })
      setUser({ ...user, ...data.user })
      setForm(prev => ({ ...prev, slug: data.user.slug || prev.slug }))
      toast.success('Profile updated')
    } catch (err) {
      toast.error((err as Error).message)
    } finally {
      setLoading(false)
    }
  }

  /**
   * Upload a picture and use it.
   *
   * The same three-step upload the media library runs — sign, PUT to storage,
   * confirm — because an avatar is a media row like any other and a second
   * upload path would drift from this one the first time either changed.
   */
  const chooseAvatar = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    event.target.value = ''

    if (!file) return

    setUploading(true)
    try {
      const [uploaded] = await library.upload([file])

      if (!uploaded) throw new Error('The upload did not complete.')

      setAvatar({ id: uploaded.id, url: uploaded.url || uploaded.path })
      toast.success('Picture uploaded — save to keep it')
    } catch (err) {
      toast.error((err as Error).message)
    } finally {
      setUploading(false)
    }
  }

  const changePassword = async (e: FormEvent) => {
    e.preventDefault()
    setLoading(true)
    try {
      await api('/api/profile/password', { method: 'PUT', body: JSON.stringify(pwForm) })
      setPwForm({ currentPassword: '', newPassword: '' })
      toast.success('Password changed')
    } catch (err) {
      toast.error((err as Error).message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="max-w-md mx-auto space-y-6">
      <PageHeader title="Profile" />

      <Card>
        <form onSubmit={updateProfile} className="space-y-3">
          <h2 className="font-medium mb-2">Author profile</h2>

          <div className="flex items-center gap-3">
            <Avatar name={form.name} src={avatar.url} size="lg" />
            <div className="space-y-1">
              <input
                ref={fileInput}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={chooseAvatar}
              />
              <div className="flex gap-2">
                <Button type="button" onClick={() => fileInput.current?.click()} disabled={uploading}>
                  {uploading ? 'Uploading...' : avatar.url ? 'Change picture' : 'Add picture'}
                </Button>
                {avatar.url && (
                  <Button type="button" onClick={() => setAvatar({ id: null, url: null })}>
                    Remove
                  </Button>
                )}
              </div>
              <p className={`text-xs ${t.muted}`}>Shown on every post you write.</p>
            </div>
          </div>

          <Input placeholder="Name" required value={form.name} onChange={(e: ChangeEvent<HTMLInputElement>) => setForm({ ...form, name: e.target.value })} />
          <Input type="email" placeholder="Email" required value={form.email} onChange={(e: ChangeEvent<HTMLInputElement>) => setForm({ ...form, email: e.target.value })} />

          {/* The author archive segment. Blank asks for one derived from the
              name, which is how it was set at registration. */}
          <Input
            placeholder="Profile URL — leave blank to use your name"
            value={form.slug}
            onChange={(e: ChangeEvent<HTMLInputElement>) => setForm({ ...form, slug: e.target.value })}
          />
          <Input
            type="url"
            placeholder="Website"
            value={form.website}
            onChange={(e: ChangeEvent<HTMLInputElement>) => setForm({ ...form, website: e.target.value })}
          />
          <Textarea
            rows={4}
            placeholder="A short biography, shown under your byline"
            value={form.bio}
            onChange={(e: ChangeEvent<HTMLTextAreaElement>) => setForm({ ...form, bio: e.target.value })}
          />

          <Button type="submit" disabled={loading} className="w-full">{loading ? '...' : 'Save'}</Button>
        </form>
      </Card>

      <Card>
        <form onSubmit={changePassword} className="space-y-3">
          <h2 className="font-medium mb-2">Change Password</h2>
          <Input type="password" placeholder="Current password" required value={pwForm.currentPassword} onChange={(e: ChangeEvent<HTMLInputElement>) => setPwForm({ ...pwForm, currentPassword: e.target.value })} />
          <Input type="password" placeholder="New password" required minLength={8} value={pwForm.newPassword} onChange={(e: ChangeEvent<HTMLInputElement>) => setPwForm({ ...pwForm, newPassword: e.target.value })} />
          <Button type="submit" disabled={loading} className="w-full">{loading ? '...' : 'Change Password'}</Button>
        </form>
      </Card>
    </div>
  )
}
