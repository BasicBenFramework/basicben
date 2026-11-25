import type { Dictionary } from '../../../client/i18n/index.ts'

/** Simplified Chinese for the analytics feature. Merged over the admin's own dictionary. */
const strings: Dictionary = {
  "{count} day|{count} days": {"other":"{count} 天"},
  "{count} view|{count} views": {"other":"{count} 次浏览"},
  "{count} visitor|{count} visitors": {"other":"{count} 位访客"},
  "Saved.": "已保存。",
  "Analytics": "统计分析",
  "Range": "时间范围",
  "Page views": "页面浏览量",
  "Daily visitors, summed": "每日访客数之和",
  "Views per day": "每日浏览量",
  "{from} to {to} (UTC)": "{from} 至 {to}（UTC）",
  "Views": "浏览量",
  "Visitors": "访客",
  "Top pages": "热门页面",
  "No page views yet.": "还没有页面浏览记录。",
  "Path": "路径",
  "Top referrers": "主要来源",
  "No referred visits yet.": "还没有来自外部链接的访问。",
  "Domain": "域名",
  "How this is counted": "统计方式",
  "No cookies, no stored IP addresses or user agents. A visitor is a hash of their address, browser and a random salt that changes every UTC day and is then deleted, so nobody — including you — can tell who visited, or link one day's visitors to the next. Browsers sending Do Not Track or Global Privacy Control are not counted at all, and neither are known bots.": "不使用 Cookie，不存储 IP 地址或用户代理。访客由其地址、浏览器和一个随机盐值计算出的哈希表示，该盐值每个 UTC 日更换一次并随后删除，因此任何人（包括你）都无法得知谁访问过，也无法将某一天的访客与次日的访客关联。发送 Do Not Track 或 Global Privacy Control 的浏览器完全不计入统计，已知的机器人也不计入。",
  "Your front end reports page views with a short snippet: {endpoint}. See {doc}.": "前端通过一小段代码上报页面浏览：{endpoint}。请参阅 {doc}。",
  "Count page views": "统计页面浏览",
  "Forget visitor hashes after (hours, 1–24)": "访客哈希保留时长（小时，1–24）",
  "Keep daily counts for (days, 0 = forever)": "每日统计保留时长（天，0 = 永久）",
  "Save": "保存",
  "Views and visitors per day": "每日浏览量和访客数",
  "{day}: {views}, {visitors}": "{day}：{views}，{visitors}"
}

export default strings
