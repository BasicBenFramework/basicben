import type { Dictionary } from '../../../client/i18n/index.ts'

/** Simplified Chinese for the theme feature. Merged over the admin's own dictionary. */
const strings: Dictionary = {
  "Public site": "公开站点",
  "Render the public site": "渲染公开站点",
  "No — a separate front end (or the built-in app) renders it": "否：由独立前端（或内置应用）渲染",
  "Yes — with the built-in server-rendered theme": "是：使用内置的服务端渲染主题",
  "Serves the home page, posts, pages, archives and custom content types as HTML from this app, with full SEO tags and oEmbed. Takes up to 30 seconds to apply.": "由本应用以 HTML 形式提供首页、文章、页面、归档和自定义内容类型，并包含完整的 SEO 标签和 oEmbed。最多需要 30 秒生效。"
}

export default strings
