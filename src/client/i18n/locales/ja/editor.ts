import type { Dictionary } from '../../index.ts'

/**
 * The post and page editor and what it is built from: the Markdown editor,
 * the media and snippet pickers, term pickers, access box, pagination, and the
 * hooks behind them. Strings already in another group (e.g. 'Draft',
 * 'Loading…') are not repeated here.
 */
const strings: Dictionary = {
  // Headings and the main button
  'Edit post': '投稿を編集',
  'Edit page': '固定ページを編集',
  'Edit {type}': '{type}を編集',
  'New post': '新規投稿',
  'New page': '新規固定ページ',
  'New {type}': '{type}を新規追加',
  'Create': '作成',
  'Schedule': '予約',
  'Submit for review': 'レビューを依頼',
  'Save draft': '下書きを保存',
  'Failed to save post': '投稿を保存できませんでした',
  'Failed to save page': '固定ページを保存できませんでした',
  'Failed to save {type}': '{type}を保存できませんでした',

  // Edit lock and autosave
  '{name} has taken over editing this post. Your unsaved changes are still on screen, but cannot be saved unless you take it back.':
    '{name}がこの投稿の編集を引き継ぎました。未保存の変更は画面に残っていますが、編集を引き継ぎ直さない限り保存できません。',
  '{name} is editing this post. You can read it, but saving is paused so neither of you overwrites the other.':
    '{name}がこの投稿を編集中です。閲覧はできますが、互いの変更を上書きしないよう保存は一時停止されています。',
  '{name} has finished editing. Reload to see their changes and start editing.':
    '{name}が編集を終了しました。再読み込みすると変更内容が表示され、編集を開始できます。',
  'Take over': '編集を引き継ぐ',
  'Back to posts': '投稿一覧に戻る',
  'Reload and edit': '再読み込みして編集',
  'The other editor': 'もう一人の編集者',
  'Someone else': '別のユーザー',
  'Someone else is editing this post': '別のユーザーがこの投稿を編集中です',
  'There is an autosave of this post from {date} that is newer than the saved version.':
    'この投稿には、保存済みのバージョンより新しい {date} の自動保存があります。',
  'Restore it': '復元する',
  'Autosaved {time}': '{time} に自動保存',

  // Revisions
  'Revisions': 'リビジョン',
  'Replace the current text with the version from {date}? The current text is kept as a revision.':
    '現在のテキストを {date} のバージョンに置き換えますか？現在のテキストはリビジョンとして保存されます。',
  'Could not restore that revision': 'そのリビジョンを復元できませんでした',

  // Main fields
  'Enter post title': '投稿のタイトルを入力',
  'Enter page title': '固定ページのタイトルを入力',
  'Enter {type} title': '{type}のタイトルを入力',
  'post-url-slug': 'post-url-slug',
  'page-url-slug': 'page-url-slug',
  '{type}-url-slug': '{type}-url-slug',
  'from the title': 'タイトルから生成',
  'Write your content here. Markdown is supported.': 'ここに本文を入力します。Markdown が使えます。',
  'Written for you from the content if you leave this blank': '空欄の場合は本文から自動で作成されます',

  // SEO and social cards
  'SEO Settings': 'SEO 設定',
  'Meta Title': 'メタタイトル',
  'Meta Description': 'メタディスクリプション',
  'SEO title': 'SEO タイトル',
  'SEO description': 'SEO ディスクリプション',
  'Canonical URL': '正規 URL',
  'Only if this was first published somewhere else': 'ほかの場所で最初に公開した場合のみ',
  'Ask search engines not to index this post': 'この投稿をインデックスしないよう検索エンジンに求める',
  'Ask search engines not to index this page': 'この固定ページをインデックスしないよう検索エンジンに求める',
  'Ask search engines not to index this {type}': 'この{type}をインデックスしないよう検索エンジンに求める',
  'Social cards': 'ソーシャルカード',
  'Open Graph title': 'Open Graph タイトル',
  'Open Graph description': 'Open Graph ディスクリプション',
  'Twitter / X title': 'Twitter / X タイトル',
  'Twitter / X description': 'Twitter / X ディスクリプション',
  'Falls back to the SEO title': '空欄の場合は SEO タイトルを使用',
  'Falls back to the SEO description': '空欄の場合は SEO ディスクリプションを使用',
  'Falls back to the Open Graph title': '空欄の場合は Open Graph タイトルを使用',
  'Falls back to the Open Graph description': '空欄の場合は Open Graph ディスクリプションを使用',

  // Publish box
  'Published (an editor publishes)': '公開済み (編集者が公開)',
  'Publish on': '公開日時',
  'Scheduled — goes live {date}.': '予約済み — {date} に公開されます。',
  'Already live.': '公開済みです。',
  'Blank publishes now. A future date schedules it.': '空欄の場合はすぐに公開されます。未来の日時を指定すると公開予約になります。',
  'Unchanged': '変更なし',
  'Me': '自分',

  // Categories and tags
  'category': 'カテゴリー',
  'tag': 'タグ',
  'Could not create that category. It may already exist.': 'そのカテゴリーを作成できませんでした。すでに存在する可能性があります。',
  'Could not add those tags.': 'それらのタグを追加できませんでした。',
  'Remove {name}': '{name}を削除',
  'Search or add a {noun}': '{noun}を検索または追加',
  'No matches for “{query}”.': '「{query}」に一致するものはありません。',
  '+ Add “{name}”': '+「{name}」を追加',

  // Content model panels
  '{type} details': '{type}の詳細',
  'Could not add that {term}.': 'その{term}を追加できませんでした。',
  'No {terms} yet.': 'まだ{terms}がありません。',

  'Sending…': '送信中…',
  'Readable by: {level}. This site no longer offers that level, so the body is withheld from every reader.':
    '閲覧できるユーザー: {level}。このサイトではこのレベルを提供していないため、本文はすべての読者に非表示になっています。',

  // Featured image and media
  '+ Set featured image': '+ アイキャッチ画像を設定',
  'A featured image has to be an image.': 'アイキャッチ画像には画像ファイルを指定してください。',
  'Replace': '置き換え',
  'No media files yet. Upload some!': 'まだメディアファイルがありません。アップロードしましょう。',
  'Loading more…': 'さらに読み込み中…',
  'Media library': 'メディアライブラリ',
  'Close': '閉じる',
  'No media yet — upload or drop a file here.': 'まだメディアがありません。ここにファイルをアップロードするか、ドロップしてください。',
  'Could not start the upload.': 'アップロードを開始できませんでした。',
  'Storage refused the upload ({status}).': 'ストレージがアップロードを拒否しました ({status})。',
  'The upload could not reach storage.': 'アップロードがストレージに届きませんでした。',
  'The upload could not be confirmed.': 'アップロードを確認できませんでした。',
  'The update returned no media.': '更新結果にメディアが含まれていませんでした。',

  // Snippets
  'Insert snippet': 'スニペットを挿入',
  'Search snippets': 'スニペットを検索',
  'No snippets yet. Add them under Snippets in the admin menu.': 'まだスニペットがありません。管理メニューの「スニペット」から追加してください。',
  'No snippet matches that search.': '検索条件に一致するスニペットはありません。',

  // Pagination
  '{first}–{last} of {total} {noun}': '{noun} {total} 件中 {first}–{last} 件',
  'Page {page} of {pages}': '{page} / {pages} ページ',
  'Previous': '前へ',
  'Next': '次へ',
  'items': '項目',
  'comments': 'コメント',
  'members': 'メンバー',
  'users': 'ユーザー',
  'redirects': 'リダイレクト',

  // Markdown editor
  'Bold (⌘B)': '太字 (⌘B)',
  'bold text': '太字のテキスト',
  'Italic (⌘I)': '斜体 (⌘I)',
  'italic text': '斜体のテキスト',
  'Strikethrough': '取り消し線',
  'struck out': '取り消し線のテキスト',
  'Code': 'コード',
  'code': 'コード',
  'Heading': '見出し',
  'Quote': '引用',
  'Quoted': '引用文',
  'Bulleted list': '箇条書きリスト',
  'Numbered list': '番号付きリスト',
  'Item': '項目',
  'Link (⌘K)': 'リンク (⌘K)',
  'link text': 'リンクテキスト',
  'Insert media': 'メディアを挿入',
  'Write': '編集',
  'Preview failed: {message}': 'プレビューに失敗しました: {message}',
  'Nothing to preview yet.': 'プレビューする内容がまだありません。',
  'Markdown supported — headings, lists, links, tables, and fenced code. HTML is shown as text rather than rendered.':
    'Markdown が使えます (見出し、リスト、リンク、表、コードブロック)。HTML はレンダリングされず、テキストとして表示されます。',

  // Visibility: public or private (migration 043)
  'Visibility': '公開状態',
  'Public': '公開',
  'Only its author, editors and admins see it, here in the admin. It is left out of the site, the API, feeds, the sitemap and search.':
    'この管理画面で、投稿者、編集者、管理者のみが閲覧できます。サイト、API、フィード、サイトマップ、検索には表示されません。',
  'Only people who can edit pages see it, here in the admin. It is left out of the site, the API, feeds, the sitemap and search.':
    'この管理画面で、固定ページを編集できるユーザーのみが閲覧できます。サイト、API、フィード、サイトマップ、検索には表示されません。',

  // Social card images
  'Open Graph image': 'Open Graph 画像',
  'Twitter / X image': 'Twitter / X 画像',
  'Falls back to the featured image.': '空欄の場合はアイキャッチ画像を使用します。',
  'Falls back to the Open Graph image.': '空欄の場合は Open Graph 画像を使用します。',
  'A social card image has to be an image.': 'ソーシャルカードの画像には画像ファイルを指定してください。',
  'Choose image': '画像を選択',
  'or paste the URL of a library image': 'またはライブラリ内の画像の URL を貼り付け',
  'Use URL': 'URL を使用',
  'Looking…': '検索中…',
  'That URL is not an image in the media library. Upload it first, then choose it here.':
    'その URL はメディアライブラリ内の画像ではありません。先にアップロードしてから、ここで選択してください。',
  'Could not look that URL up.': 'その URL を照会できませんでした。',
  "The whole title in search results. Blank uses the title followed by the site name.": "検索結果に表示されるタイトル全体です。空欄の場合はタイトルの後にサイト名が付きます。",
  "Blank uses the start of the page.": "空欄の場合はページの冒頭を使用します。",
  "Blank uses the excerpt.": "空欄の場合は抜粋を使用します。",
  "{count} / {limit}": "{count} / {limit}",
  "{count} / {limit} — may be cut off": "{count} / {limit} — 途中で切れる可能性があります"
}

export default strings
