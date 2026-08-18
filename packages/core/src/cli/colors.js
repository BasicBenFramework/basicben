/**
 * Simple ANSI color helpers. No Chalk needed.
 */

const isColorSupported = process.stdout.isTTY && !process.env.NO_COLOR

const code = (open, close) => {
  if (!isColorSupported) return (str) => str
  return (str) => `\x1b[${open}m${str}\x1b[${close}m`
}

export const bold = code(1, 22)
export const dim = code(2, 22)
export const italic = code(3, 23)
export const underline = code(4, 24)

export const red = code(31, 39)
export const green = code(32, 39)
export const yellow = code(33, 39)
export const blue = code(34, 39)
export const magenta = code(35, 39)
export const cyan = code(36, 39)
export const white = code(37, 39)
export const gray = code(90, 39)

// Semantic aliases
export const success = green
export const error = red
export const warn = yellow
export const info = cyan
export const muted = gray
