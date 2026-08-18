import { createContext, useContext } from 'react'

interface ThemeStyles {
  bg: string
  text: string
  muted: string
  border: string
  card: string
  btn: string
  btnHover: string
  btnSecondary: string
}

interface ThemeContextType {
  t: ThemeStyles
  dark: boolean
  setDark: (dark: boolean) => void
}

export const ThemeContext = createContext<ThemeContextType | null>(null)

export const useTheme = () => {
  const context = useContext(ThemeContext)
  if (!context) throw new Error('useTheme must be used within ThemeProvider')
  return context
}
