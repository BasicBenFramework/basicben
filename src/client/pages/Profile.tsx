import { useState, FormEvent, ChangeEvent } from 'react'
import { useAuth } from '@basicbenframework/core/client'
import { PageHeader } from '../components/PageHeader'
import { Card } from '../components/Card'
import { Input } from '../components/Input'
import { Button } from '../components/Button'
import { api } from '../../helpers/api'
import { useToast } from '../contexts/ToastContext'

interface ProfileResponse {
  user: {
    id: number
    name: string
    email: string
  }
}

export function Profile() {
  const { user, setUser } = useAuth()
  const toast = useToast()
  const [form, setForm] = useState({ name: user?.name || '', email: user?.email || '' })
  const [pwForm, setPwForm] = useState({ currentPassword: '', newPassword: '' })
  const [loading, setLoading] = useState(false)

  const updateProfile = async (e: FormEvent) => {
    e.preventDefault()
    setLoading(true)
    try {
      const data = await api<ProfileResponse>('/api/profile', { method: 'PUT', body: JSON.stringify(form) })
      setUser(data.user)
      toast.success('Profile updated')
    } catch (err) {
      toast.error((err as Error).message)
    } finally {
      setLoading(false)
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
          <h2 className="font-medium mb-2">Edit Profile</h2>
          <Input placeholder="Name" required value={form.name} onChange={(e: ChangeEvent<HTMLInputElement>) => setForm({ ...form, name: e.target.value })} />
          <Input type="email" placeholder="Email" required value={form.email} onChange={(e: ChangeEvent<HTMLInputElement>) => setForm({ ...form, email: e.target.value })} />
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
