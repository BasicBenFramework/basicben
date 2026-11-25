import type { Dictionary } from '../../../client/i18n/index.ts'

/** Portuguese (Brazil) for the mysendbox feature. Merged over the admin's own dictionary. */
const strings: Dictionary = {
  "Newsletters through MySendbox": "Newsletters pelo MySendbox",
  "{synced} member(s) in MySendbox, {waiting} waiting for consent, {refused} refused.": "{synced} membro(s) no MySendbox, {waiting} aguardando consentimento, {refused} recusado(s).",
  "A broadcast would reach {count} now.": "Um disparo alcançaria {count} agora.",
  "No webhook secret: unsubscribes made in MySendbox arrive through the daily check.": "Sem segredo de webhook: os cancelamentos de inscrição feitos no MySendbox chegam pela verificação diária.",
  "From address": "Endereço do remetente",
  "Blank uses your MySendbox workspace's default sender.": "Em branco, usa o remetente padrão do seu workspace do MySendbox.",
  "From name": "Nome do remetente",
  "Blank uses the newsletter sender name.": "Em branco, usa o nome de remetente da newsletter.",
  "Consent for members you added or imported": "Consentimento dos membros que você adicionou ou importou",
  "How they agreed to receive posts by email, in your words. MySendbox records it with each contact. Leave blank and they are not copied, unless a signup form is set.": "Como eles concordaram em receber posts por e-mail, com suas palavras. O MySendbox registra isso em cada contato. Se ficar em branco, eles não são copiados, a menos que haja um formulário de inscrição definido.",
  "Signup form (frm_…)": "Formulário de inscrição (frm_…)",
  "Optional. Members without recorded consent are sent this form’s confirmation email instead.": "Opcional. Os membros sem consentimento registrado recebem, em vez disso, o e-mail de confirmação deste formulário.",
  "Audience (aud_…)": "Público (aud_…)",
  "Made for you on first use. Change it only to use another MySendbox list.": "Criado automaticamente no primeiro uso. Altere apenas para usar outra lista do MySendbox.",
  "Copying…": "Copiando…",
  "Copy members to MySendbox": "Copiar membros para o MySendbox",
  "Copies every subscribed member not yet in MySendbox. Safe to run again. Save settings first if you changed consent.": "Copia todos os membros inscritos que ainda não estão no MySendbox. Pode ser executado novamente com segurança. Salve as configurações antes, se você alterou o consentimento.",
  "{count} member(s) copied.": "{count} membro(s) copiado(s).",
  "The copy stopped.": "A cópia foi interrompida.",
  "Members not copied ({count})": "Membros não copiados ({count})",
  "draft": "rascunho",
  "scheduled": "agendado",
  "paused": "pausado",
  "canceled": "cancelado",
  "MySendbox API key": "Chave de API do MySendbox",
  "MySendbox API URL": "URL da API do MySendbox",
  "A key with the contacts and broadcasts scopes. Stored encrypted with APP_KEY and never shown again.": "Uma chave com os escopos de contatos e disparos. Armazenada criptografada com a APP_KEY e nunca mais exibida.",
  "Blank for MySendbox itself.": "Em branco para o próprio MySendbox.",
  "Add an API key to send newsletters to members through MySendbox. Save, then reload this page.": "Adicione uma chave de API para enviar newsletters aos membros pelo MySendbox. Salve e recarregue esta página."
}

export default strings
