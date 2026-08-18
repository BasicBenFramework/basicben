import { useTheme } from '../ThemeContext'
import { NavLink } from '../NavLink'
import { Button } from '../Button'
import { DarkModeToggle } from './DarkModeToggle'
import type { User } from '../../../types'

interface DesktopNavProps {
  user: User | null
  navigate: (path: string) => void
  logout: () => void
}

export function DesktopNav({ user, navigate, logout }: DesktopNavProps) {
  const { t, dark, setDark } = useTheme()

  return (
    <div className="hidden sm:flex items-center gap-2">
      <NavLink onClick={() => navigate('/docs')}>Docs</NavLink>

      <div className={`w-px h-5 mx-1 ${dark ? 'bg-white/20' : 'bg-black/20'}`} />

      <DarkModeToggle dark={dark} setDark={setDark} />

      {user ? (
        <>
          <NavLink onClick={() => navigate('/feed')}>Feed</NavLink>
          <NavLink onClick={() => navigate('/posts')}>My Posts</NavLink>
          <NavLink onClick={() => navigate('/profile')}>Profile</NavLink>
          <Button variant="secondary" onClick={logout} className="px-3 py-1.5">Log out</Button>
        </>
      ) : (
        <>
          <NavLink onClick={() => navigate('/login')}>Sign in</NavLink>
          <Button onClick={() => navigate('/register')} className="px-3 py-1.5">Get started</Button>
        </>
      )}
    </div>
  )
}
