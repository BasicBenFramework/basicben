import type { Dictionary } from '../../../client/i18n/index.ts'

/** Simplified Chinese for the mysendbox feature. Merged over the admin's own dictionary. */
const strings: Dictionary = {
  "Newsletters through MySendbox": "通过 MySendbox 发送邮件通讯",
  "{synced} member(s) in MySendbox, {waiting} waiting for consent, {refused} refused.": "MySendbox 中有 {synced} 位会员，{waiting} 位等待同意，{refused} 位已拒绝。",
  "A broadcast would reach {count} now.": "现在群发将送达 {count} 人。",
  "No webhook secret: unsubscribes made in MySendbox arrive through the daily check.": "未设置 Webhook 密钥：在 MySendbox 中的退订将通过每日检查同步。",
  "From address": "发件人地址",
  "Blank uses your MySendbox workspace's default sender.": "留空则使用你的 MySendbox 工作区的默认发件人。",
  "From name": "发件人名称",
  "Blank uses the newsletter sender name.": "留空则使用邮件通讯的发件人名称。",
  "Consent for members you added or imported": "你添加或导入的会员的同意说明",
  "How they agreed to receive posts by email, in your words. MySendbox records it with each contact. Leave blank and they are not copied, unless a signup form is set.": "用你自己的话说明他们如何同意通过邮件接收文章。MySendbox 会将其与每个联系人一起记录。留空则不会复制这些会员，除非设置了注册表单。",
  "Signup form (frm_…)": "注册表单（frm_…）",
  "Optional. Members without recorded consent are sent this form’s confirmation email instead.": "可选。没有同意记录的会员将改为收到此表单的确认邮件。",
  "Audience (aud_…)": "受众（aud_…）",
  "Made for you on first use. Change it only to use another MySendbox list.": "首次使用时自动创建。仅在需要使用其他 MySendbox 列表时才更改。",
  "Copying…": "复制中…",
  "Copy members to MySendbox": "将会员复制到 MySendbox",
  "Copies every subscribed member not yet in MySendbox. Safe to run again. Save settings first if you changed consent.": "复制所有尚未在 MySendbox 中的已订阅会员。可以安全地重复运行。如果更改了同意说明，请先保存设置。",
  "{count} member(s) copied.": "已复制 {count} 位会员。",
  "The copy stopped.": "复制已中止。",
  "Members not copied ({count})": "未复制的会员（{count}）",
  "draft": "草稿",
  "scheduled": "已定时",
  "paused": "已暂停",
  "canceled": "已取消",
  "MySendbox API key": "MySendbox API 密钥",
  "MySendbox API URL": "MySendbox API URL",
  "A key with the contacts and broadcasts scopes. Stored encrypted with APP_KEY and never shown again.": "具有联系人和群发权限范围的密钥。使用 APP_KEY 加密存储，不会再次显示。",
  "Blank for MySendbox itself.": "使用 MySendbox 官方服务时请留空。",
  "Add an API key to send newsletters to members through MySendbox. Save, then reload this page.": "添加 API 密钥，即可通过 MySendbox 向会员发送邮件通讯。保存后请重新加载此页面。"
}

export default strings
