import type { Dictionary } from '../../index.ts'

/**
 * The post and page editor and what it is built from: the Markdown editor,
 * the media and snippet pickers, term pickers, access box, pagination, and the
 * hooks behind them. Strings already in another group (e.g. 'Draft',
 * 'Loading…') are not repeated here.
 */
const strings: Dictionary = {
  // Headings and the main button
  'Edit post': '编辑文章',
  'Edit page': '编辑页面',
  'Edit {type}': '编辑{type}',
  'New post': '新建文章',
  'New page': '新建页面',
  'New {type}': '新建{type}',
  'Create': '创建',
  'Schedule': '定时发布',
  'Submit for review': '提交审核',
  'Save draft': '保存草稿',
  'Failed to save post': '保存文章失败',
  'Failed to save page': '保存页面失败',
  'Failed to save {type}': '保存{type}失败',

  // Edit lock and autosave
  '{name} has taken over editing this post. Your unsaved changes are still on screen, but cannot be saved unless you take it back.':
    '{name} 已接管此文章的编辑。你未保存的更改仍显示在屏幕上，但除非你重新接管，否则无法保存。',
  '{name} is editing this post. You can read it, but saving is paused so neither of you overwrites the other.':
    '{name} 正在编辑此文章。你可以查看，但保存已暂停，以免双方互相覆盖。',
  '{name} has finished editing. Reload to see their changes and start editing.':
    '{name} 已完成编辑。重新加载以查看其更改并开始编辑。',
  'Take over': '接管',
  'Back to posts': '返回文章列表',
  'Reload and edit': '重新加载并编辑',
  'The other editor': '另一位编辑者',
  'Someone else': '其他人',
  'Someone else is editing this post': '其他人正在编辑此文章',
  'There is an autosave of this post from {date} that is newer than the saved version.':
    '此文章有一个 {date} 的自动保存版本，比已保存的版本更新。',
  'Restore it': '恢复',
  'Autosaved {time}': '已于 {time} 自动保存',

  // Revisions
  'Revisions': '修订版本',
  'Replace the current text with the version from {date}? The current text is kept as a revision.':
    '用 {date} 的版本替换当前文本？当前文本将保留为一个修订版本。',
  'Could not restore that revision': '无法恢复该修订版本',

  // Main fields
  'Enter post title': '输入文章标题',
  'Enter page title': '输入页面标题',
  'Enter {type} title': '输入{type}标题',
  'post-url-slug': 'post-url-slug',
  'page-url-slug': 'page-url-slug',
  '{type}-url-slug': '{type}-url-slug',
  'from the title': '根据标题生成',
  'Write your content here. Markdown is supported.': '在此撰写内容，支持 Markdown。',
  'Written for you from the content if you leave this blank': '留空则根据内容自动生成',

  // SEO and social cards
  'SEO Settings': 'SEO 设置',
  'Meta Title': 'Meta 标题',
  'Meta Description': 'Meta 描述',
  'SEO title': 'SEO 标题',
  'SEO description': 'SEO 描述',
  'Canonical URL': '规范 URL',
  'Only if this was first published somewhere else': '仅当此内容首发于其他地方时填写',
  'Ask search engines not to index this post': '要求搜索引擎不索引此文章',
  'Ask search engines not to index this page': '要求搜索引擎不索引此页面',
  'Ask search engines not to index this {type}': '要求搜索引擎不索引此{type}',
  'Social cards': '社交卡片',
  'Open Graph title': 'Open Graph 标题',
  'Open Graph description': 'Open Graph 描述',
  'Twitter / X title': 'Twitter / X 标题',
  'Twitter / X description': 'Twitter / X 描述',
  'Falls back to the SEO title': '留空则使用 SEO 标题',
  'Falls back to the SEO description': '留空则使用 SEO 描述',
  'Falls back to the Open Graph title': '留空则使用 Open Graph 标题',
  'Falls back to the Open Graph description': '留空则使用 Open Graph 描述',

  // Publish box
  'Published (an editor publishes)': '已发布（由编辑发布）',
  'Publish on': '发布时间',
  'Scheduled — goes live {date}.': '已定时，将于 {date} 发布。',
  'Already live.': '已上线。',
  'Blank publishes now. A future date schedules it.': '留空则立即发布；填写未来日期则定时发布。',
  'Unchanged': '不变',
  'Me': '我',

  // Categories and tags
  'category': '分类',
  'tag': '标签',
  'Could not create that category. It may already exist.': '无法创建该分类，它可能已存在。',
  'Could not add those tags.': '无法添加这些标签。',
  'Remove {name}': '移除{name}',
  'Search or add a {noun}': '搜索或添加{noun}',
  'No matches for “{query}”.': '没有与“{query}”匹配的结果。',
  '+ Add “{name}”': '+ 添加“{name}”',

  // Content model panels
  '{type} details': '{type}详情',
  'Could not add that {term}.': '无法添加该{term}。',
  'No {terms} yet.': '还没有{terms}。',

  'Sending…': '发送中…',
  'Readable by: {level}. This site no longer offers that level, so the body is withheld from every reader.':
    '可阅读者：{level}。本站已不再提供该级别，因此正文对所有读者隐藏。',

  // Featured image and media
  '+ Set featured image': '+ 设置特色图片',
  'A featured image has to be an image.': '特色图片必须是图片文件。',
  'Replace': '替换',
  'No media files yet. Upload some!': '还没有媒体文件。上传一些吧！',
  'Loading more…': '加载更多…',
  'Media library': '媒体库',
  'Close': '关闭',
  'No media yet — upload or drop a file here.': '还没有媒体。上传文件或将文件拖放到此处。',
  'Could not start the upload.': '无法开始上传。',
  'Storage refused the upload ({status}).': '存储拒绝了上传（{status}）。',
  'The upload could not reach storage.': '上传无法连接到存储。',
  'The upload could not be confirmed.': '无法确认上传。',
  'The update returned no media.': '更新未返回任何媒体。',

  // Snippets
  'Insert snippet': '插入片段',
  'Search snippets': '搜索片段',
  'No snippets yet. Add them under Snippets in the admin menu.': '还没有片段。请在后台菜单的“片段”中添加。',
  'No snippet matches that search.': '没有符合搜索条件的片段。',

  // Pagination
  '{first}–{last} of {total} {noun}': '第 {first}–{last} 项，共 {total} {noun}',
  'Page {page} of {pages}': '第 {page} 页，共 {pages} 页',
  'Previous': '上一页',
  'Next': '下一页',
  'items': '项',
  'comments': '条评论',
  'members': '位会员',
  'users': '位用户',
  'redirects': '条重定向',

  // Markdown editor
  'Bold (⌘B)': '粗体 (⌘B)',
  'bold text': '粗体文本',
  'Italic (⌘I)': '斜体 (⌘I)',
  'italic text': '斜体文本',
  'Strikethrough': '删除线',
  'struck out': '删除线文本',
  'Code': '代码',
  'code': '代码',
  'Heading': '标题',
  'Quote': '引用',
  'Quoted': '引用文本',
  'Bulleted list': '无序列表',
  'Numbered list': '有序列表',
  'Item': '列表项',
  'Link (⌘K)': '链接 (⌘K)',
  'link text': '链接文本',
  'Insert media': '插入媒体',
  'Write': '编写',
  'Preview failed: {message}': '预览失败：{message}',
  'Nothing to preview yet.': '暂无可预览的内容。',
  'Markdown supported — headings, lists, links, tables, and fenced code. HTML is shown as text rather than rendered.':
    '支持 Markdown：标题、列表、链接、表格和代码块。HTML 将显示为文本，不会被渲染。',

  // Visibility: public or private (migration 043)
  'Visibility': '可见性',
  'Public': '公开',
  'Only its author, editors and admins see it, here in the admin. It is left out of the site, the API, feeds, the sitemap and search.':
    '仅其作者、编辑和管理员可在后台查看。它不会出现在站点、API、订阅源、站点地图和搜索中。',
  'Only people who can edit pages see it, here in the admin. It is left out of the site, the API, feeds, the sitemap and search.':
    '仅有页面编辑权限的人可在后台查看。它不会出现在站点、API、订阅源、站点地图和搜索中。',

  // Social card images
  'Open Graph image': 'Open Graph 图片',
  'Twitter / X image': 'Twitter / X 图片',
  'Falls back to the featured image.': '留空则使用特色图片。',
  'Falls back to the Open Graph image.': '留空则使用 Open Graph 图片。',
  'A social card image has to be an image.': '社交卡片图片必须是图片文件。',
  'Choose image': '选择图片',
  'or paste the URL of a library image': '或粘贴媒体库中图片的 URL',
  'Use URL': '使用 URL',
  'Looking…': '查找中…',
  'That URL is not an image in the media library. Upload it first, then choose it here.':
    '该 URL 不是媒体库中的图片。请先上传，再在此处选择。',
  'Could not look that URL up.': '无法查找该 URL。'
}

export default strings
