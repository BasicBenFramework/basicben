import type { Dictionary } from '../../../client/i18n/index.ts'

/** French for the mysendbox feature. Merged over the admin's own dictionary. */
const strings: Dictionary = {
  "Newsletters through MySendbox": "Newsletters via MySendbox",
  "{synced} member(s) in MySendbox, {waiting} waiting for consent, {refused} refused.": "{synced} membre(s) dans MySendbox, {waiting} en attente de consentement, {refused} refusé(s).",
  "A broadcast would reach {count} now.": "Un envoi atteindrait maintenant {count} personne(s).",
  "No webhook secret: unsubscribes made in MySendbox arrive through the daily check.": "Aucun secret de webhook : les désabonnements faits dans MySendbox arrivent avec la vérification quotidienne.",
  "From address": "Adresse de l’expéditeur",
  "Blank uses your MySendbox workspace's default sender.": "Vide, l’expéditeur par défaut de votre espace MySendbox est utilisé.",
  "From name": "Nom de l’expéditeur",
  "Blank uses the newsletter sender name.": "Vide, le nom d’expéditeur de la newsletter est utilisé.",
  "Consent for members you added or imported": "Consentement des membres ajoutés ou importés",
  "How they agreed to receive posts by email, in your words. MySendbox records it with each contact. Leave blank and they are not copied, unless a signup form is set.": "Comment ils ont accepté de recevoir les articles par e-mail, dans vos propres mots. MySendbox l’enregistre avec chaque contact. Si ce champ reste vide, ils ne sont pas copiés, sauf si un formulaire d’inscription est défini.",
  "Signup form (frm_…)": "Formulaire d’inscription (frm_…)",
  "Optional. Members without recorded consent are sent this form’s confirmation email instead.": "Facultatif. Les membres sans consentement enregistré reçoivent à la place l’e-mail de confirmation de ce formulaire.",
  "Audience (aud_…)": "Audience (aud_…)",
  "Made for you on first use. Change it only to use another MySendbox list.": "Créée automatiquement à la première utilisation. Ne la modifiez que pour utiliser une autre liste MySendbox.",
  "Copying…": "Copie…",
  "Copy members to MySendbox": "Copier les membres vers MySendbox",
  "Copies every subscribed member not yet in MySendbox. Safe to run again. Save settings first if you changed consent.": "Copie tous les membres abonnés qui ne sont pas encore dans MySendbox. Peut être relancé sans risque. Enregistrez d’abord les réglages si vous avez modifié le consentement.",
  "{count} member(s) copied.": "{count} membre(s) copié(s).",
  "The copy stopped.": "La copie s’est arrêtée.",
  "Members not copied ({count})": "Membres non copiés ({count})",
  "draft": "brouillon",
  "scheduled": "programmé",
  "paused": "en pause",
  "canceled": "annulé",
  "MySendbox API key": "Clé d’API MySendbox",
  "MySendbox API URL": "URL de l’API MySendbox",
  "A key with the contacts and broadcasts scopes. Stored encrypted with APP_KEY and never shown again.": "Une clé avec les autorisations contacts et envois. Stockée chiffrée avec APP_KEY et plus jamais affichée.",
  "Blank for MySendbox itself.": "Vide pour MySendbox lui-même.",
  "Add an API key to send newsletters to members through MySendbox. Save, then reload this page.": "Ajoutez une clé d’API pour envoyer des newsletters aux membres via MySendbox. Enregistrez, puis rechargez cette page."
}

export default strings
