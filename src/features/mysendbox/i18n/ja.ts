import type { Dictionary } from '../../../client/i18n/index.ts'

/** Japanese for the mysendbox feature. Merged over the admin's own dictionary. */
const strings: Dictionary = {
  "Newsletters through MySendbox": "MySendbox によるニュースレター",
  "{synced} member(s) in MySendbox, {waiting} waiting for consent, {refused} refused.": "MySendbox 登録済みのメンバー {synced} 人、同意待ち {waiting} 人、拒否 {refused} 人。",
  "A broadcast would reach {count} now.": "現在配信すると {count} 人に届きます。",
  "No webhook secret: unsubscribes made in MySendbox arrive through the daily check.": "Webhook シークレットが未設定です。MySendbox で行われた配信停止は、毎日のチェックで反映されます。",
  "From address": "送信元アドレス",
  "Blank uses your MySendbox workspace's default sender.": "空欄の場合は MySendbox ワークスペースのデフォルトの送信者を使用します。",
  "From name": "送信者名",
  "Blank uses the newsletter sender name.": "空欄の場合はニュースレターの送信者名を使用します。",
  "Consent for members you added or imported": "追加またはインポートしたメンバーの同意",
  "How they agreed to receive posts by email, in your words. MySendbox records it with each contact. Leave blank and they are not copied, unless a signup form is set.": "メンバーがメールで投稿を受け取ることにどのように同意したかを、あなたの言葉で記入します。MySendbox は各連絡先とともにこれを記録します。空欄の場合、登録フォームが設定されていない限りメンバーはコピーされません。",
  "Signup form (frm_…)": "登録フォーム (frm_…)",
  "Optional. Members without recorded consent are sent this form’s confirmation email instead.": "任意。同意が記録されていないメンバーには、代わりにこのフォームの確認メールが送信されます。",
  "Audience (aud_…)": "オーディエンス (aud_…)",
  "Made for you on first use. Change it only to use another MySendbox list.": "初回使用時に自動で作成されます。別の MySendbox リストを使う場合のみ変更してください。",
  "Copying…": "コピー中…",
  "Copy members to MySendbox": "メンバーを MySendbox にコピー",
  "Copies every subscribed member not yet in MySendbox. Safe to run again. Save settings first if you changed consent.": "まだ MySendbox にいない購読中のメンバーをすべてコピーします。繰り返し実行しても安全です。同意の内容を変更した場合は、先に設定を保存してください。",
  "{count} member(s) copied.": "{count} 人のメンバーをコピーしました。",
  "The copy stopped.": "コピーが中断されました。",
  "Members not copied ({count})": "コピーされなかったメンバー ({count})",
  "draft": "下書き",
  "scheduled": "予約済み",
  "paused": "一時停止中",
  "canceled": "キャンセル済み",
  "MySendbox API key": "MySendbox の API キー",
  "MySendbox API URL": "MySendbox の API URL",
  "A key with the contacts and broadcasts scopes. Stored encrypted with APP_KEY and never shown again.": "contacts と broadcasts のスコープを持つキーです。APP_KEY で暗号化して保存され、再表示されることはありません。",
  "Blank for MySendbox itself.": "MySendbox 本体を使う場合は空欄にします。",
  "Add an API key to send newsletters to members through MySendbox. Save, then reload this page.": "MySendbox 経由でメンバーにニュースレターを送信するには API キーを追加してください。保存してから、このページを再読み込みしてください。"
}

export default strings
