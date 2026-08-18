import type { AnchorHTMLAttributes, MouseEvent, ReactNode } from 'react'
import { useNavigate } from '@basicbenframework/core/client'

interface LinkProps extends AnchorHTMLAttributes<HTMLAnchorElement> {
  href: string
  children: ReactNode
}

/**
 * An internal link that navigates without reloading the document.
 *
 * The admin was built from plain `<a href>`, so every click tore down the app
 * and fetched the page again: a white flash, the bundle re-parsed, every
 * request re-issued, and any unsaved state gone. On a single-page app that is
 * all avoidable — the router already knows how to swap the view.
 *
 * This stays an `<a>` rather than becoming a button, because the anchor is
 * doing real work beyond the click. It gives the browser something to show in
 * the status bar, something to copy from the context menu, something to open
 * in a new tab, and it tells assistive technology this is a link and where it
 * goes. A button with an onClick has none of that.
 *
 * So the element is unchanged and only the plain left-click is intercepted.
 * Everything that should still reach the browser does:
 *
 *   - modified clicks (cmd, ctrl, shift, alt) — open in a tab or window
 *   - middle-click, and anything that is not the primary button
 *   - a link with a `target`
 *   - a click something upstream has already handled
 *
 * External links pass straight through, so this is safe to use for any href.
 */
export function Link({ href, children, onClick, ...rest }: LinkProps) {
  const navigate = useNavigate()

  const isInternal = href.startsWith('/') && !href.startsWith('//')

  function handleClick(event: MouseEvent<HTMLAnchorElement>) {
    onClick?.(event)

    if (event.defaultPrevented) return
    if (!isInternal) return
    if (rest.target) return

    // `button === 0` is the primary button; the modifiers are the browser's own
    // shortcuts for opening elsewhere. Swallowing either would take away a
    // behaviour the anchor is expected to have.
    if (event.button !== 0) return
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return

    event.preventDefault()
    navigate(href)
  }

  return (
    <a href={href} onClick={handleClick} {...rest}>
      {children}
    </a>
  )
}
