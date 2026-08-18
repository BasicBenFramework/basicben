import { useTheme } from '../ThemeContext'
import { Logo } from '../Logo'
import type { User } from '../../../types'

interface MobileNavProps {
  user: User | null
  navigate: (path: string) => void
  onClose: () => void
  logout: () => void
}

export function MobileNav({ user, navigate, onClose, logout }: MobileNavProps) {
  const { t } = useTheme()

  const handleNav = (view: string) => {
    navigate(view)
    onClose()
  }

  const handleLogout = () => {
    logout()
    onClose()
  }

  return (
    <div className={`fixed inset-0 z-50 ${t.bg} ${t.text}`}>
      <div className="flex flex-col h-full">
        <div className={`flex items-center justify-between h-14 px-6 border-b ${t.border}`}>
          <span className="flex items-center gap-2 font-semibold">
            <Logo className="w-5 h-5" />
            <span>BasicBen</span>
          </span>
          <button
            onClick={onClose}
            className={`p-2 rounded-lg ${t.card} transition`}
            aria-label="Close menu"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-4">
          <div className="space-y-1">
            <button
              onClick={() => handleNav('/')}
              className={`w-full text-left px-4 py-3 rounded-lg ${t.card} hover:opacity-80 transition`}
            >
              Home
            </button>
            <button
              onClick={() => handleNav('/docs')}
              className={`w-full text-left px-4 py-3 rounded-lg ${t.card} hover:opacity-80 transition`}
            >
              Docs
            </button>
          </div>

          {user ? (
            <>
              <div className={`my-4 border-t ${t.border}`} />
              <p className={`px-4 py-2 text-xs font-medium uppercase tracking-wider ${t.muted}`}>Account</p>
              <div className="space-y-1">
                <button
                  onClick={() => handleNav('/feed')}
                  className={`w-full text-left px-4 py-3 rounded-lg ${t.card} hover:opacity-80 transition`}
                >
                  Feed
                </button>
                <button
                  onClick={() => handleNav('/posts')}
                  className={`w-full text-left px-4 py-3 rounded-lg ${t.card} hover:opacity-80 transition`}
                >
                  My Posts
                </button>
                <button
                  onClick={() => handleNav('/profile')}
                  className={`w-full text-left px-4 py-3 rounded-lg ${t.card} hover:opacity-80 transition`}
                >
                  Profile
                </button>
              </div>
              <div className={`my-4 border-t ${t.border}`} />
              <button
                onClick={handleLogout}
                className={`w-full text-left px-4 py-3 rounded-lg ${t.btnSecondary} transition`}
              >
                Log out
              </button>
            </>
          ) : (
            <>
              <div className={`my-4 border-t ${t.border}`} />
              <div className="space-y-2">
                <button
                  onClick={() => handleNav('/login')}
                  className={`w-full px-4 py-3 rounded-lg ${t.btnSecondary} transition`}
                >
                  Sign in
                </button>
                <button
                  onClick={() => handleNav('/register')}
                  className={`w-full px-4 py-3 rounded-lg ${t.btn} ${t.btnHover} transition`}
                >
                  Get started
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
