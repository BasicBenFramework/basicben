import type { Dictionary } from '../../../client/i18n/index.ts'

/** Japanese for the analytics feature. Merged over the admin's own dictionary. */
const strings: Dictionary = {
  "{count} day|{count} days": {"other":"{count} 日間"},
  "{count} view|{count} views": {"other":"{count} 回の閲覧"},
  "{count} visitor|{count} visitors": {"other":"{count} 人の訪問者"},
  "Saved.": "保存しました。",
  "Analytics": "アクセス解析",
  "Range": "期間",
  "Page views": "ページビュー",
  "Daily visitors, summed": "日別訪問者数の合計",
  "Views per day": "1 日あたりの閲覧数",
  "{from} to {to} (UTC)": "{from}～{to} (UTC)",
  "Views": "閲覧数",
  "Visitors": "訪問者数",
  "Top pages": "人気のページ",
  "No page views yet.": "まだページビューがありません。",
  "Path": "パス",
  "Top referrers": "主な参照元",
  "No referred visits yet.": "まだ参照元からの訪問がありません。",
  "Domain": "ドメイン",
  "How this is counted": "集計方法",
  "No cookies, no stored IP addresses or user agents. A visitor is a hash of their address, browser and a random salt that changes every UTC day and is then deleted, so nobody — including you — can tell who visited, or link one day's visitors to the next. Browsers sending Do Not Track or Global Privacy Control are not counted at all, and neither are known bots.": "Cookie は使わず、IP アドレスやユーザーエージェントも保存しません。訪問者は、アドレス、ブラウザー、ランダムなソルトから作るハッシュで識別します。ソルトは UTC の日付ごとに変わり、その後削除されるため、あなたを含め誰も、誰が訪問したかを知ることも、ある日の訪問者を翌日の訪問者と結び付けることもできません。Do Not Track または Global Privacy Control を送信するブラウザーや既知のボットは、一切集計されません。",
  "Your front end reports page views with a short snippet: {endpoint}. See {doc}.": "フロントエンドは短いコードでページビューを送信します: {endpoint}。詳しくは {doc} を参照してください。",
  "Count page views": "ページビューを集計",
  "Forget visitor hashes after (hours, 1–24)": "訪問者ハッシュの破棄までの時間 (時間、1–24)",
  "Keep daily counts for (days, 0 = forever)": "日別集計の保存期間 (日数、0 = 無期限)",
  "Save": "保存",
  "Views and visitors per day": "1 日あたりの閲覧数と訪問者数",
  "{day}: {views}, {visitors}": "{day}: {views}、{visitors}"
}

export default strings
