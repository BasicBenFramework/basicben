import { useT } from '../../client/i18n'
import type { SettingsSectionProps } from '../../client/host'

const hint = { color: 'var(--fg-muted)', fontSize: '0.875rem', marginTop: '0.25rem' }

/**
 * Whether this app renders the public site. Off by default, so a site using
 * its own front end (or the SPA) sees no change; the PUBLIC_THEME environment
 * variable overrides this either way.
 */
export default function ThemeSettingsCard({ values, onChange }: SettingsSectionProps) {
  const { t } = useT()

  return (
    <div className="admin-card">
      <h3 className="admin-card-title">{t('Public site')}</h3>
      <div className="admin-form-group">
        <label className="admin-label" htmlFor="public_theme">{t('Render the public site')}</label>
        <select id="public_theme" name="public_theme" value={values.public_theme ?? ''} onChange={e => onChange({ public_theme: e.target.value })} className="admin-input">
          <option value="">{t('No — a separate front end (or the built-in app) renders it')}</option>
          <option value="ssr">{t('Yes — with the built-in server-rendered theme')}</option>
        </select>
        <p style={hint}>
          {t('Serves the home page, posts, pages, archives and custom content types as HTML from this app, with full SEO tags and oEmbed. Takes up to 30 seconds to apply.')}
        </p>
      </div>
    </div>
  )
}
