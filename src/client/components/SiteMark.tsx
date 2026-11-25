import { Logo } from './Logo.tsx'
import type { SiteBrand } from '../hooks/useSite.ts'

/**
 * The site's logo (Settings → Site Identity), or BasicBen's mark until one is
 * set. Sized by `className`; the image keeps its own proportions.
 */
export function SiteMark({ site, className = 'w-10 h-10' }: { site: SiteBrand | null; className?: string }) {
  if (site?.logo_url) {
    return <img src={site.logo_url} alt="" className={`${className} object-contain`} />
  }
  return <Logo className={className} />
}
