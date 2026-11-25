import type { Dictionary } from '../../../client/i18n/index.ts'

/** Spanish for the mysendbox feature. Merged over the admin's own dictionary. */
const strings: Dictionary = {
  "Newsletters through MySendbox": "Boletines a través de MySendbox",
  "{synced} member(s) in MySendbox, {waiting} waiting for consent, {refused} refused.": "{synced} miembro(s) en MySendbox, {waiting} a la espera de consentimiento, {refused} rechazado(s).",
  "A broadcast would reach {count} now.": "Un envío llegaría ahora a {count}.",
  "No webhook secret: unsubscribes made in MySendbox arrive through the daily check.": "Sin secreto de webhook: las bajas hechas en MySendbox llegan con la comprobación diaria.",
  "From address": "Dirección del remitente",
  "Blank uses your MySendbox workspace's default sender.": "En blanco, se usa el remitente predeterminado de tu espacio de MySendbox.",
  "From name": "Nombre del remitente",
  "Blank uses the newsletter sender name.": "En blanco, se usa el nombre de remitente del boletín.",
  "Consent for members you added or imported": "Consentimiento de los miembros que añadiste o importaste",
  "How they agreed to receive posts by email, in your words. MySendbox records it with each contact. Leave blank and they are not copied, unless a signup form is set.": "Cómo aceptaron recibir las entradas por correo, con tus palabras. MySendbox lo guarda con cada contacto. Si lo dejas en blanco, no se copian, salvo que haya un formulario de alta.",
  "Signup form (frm_…)": "Formulario de alta (frm_…)",
  "Optional. Members without recorded consent are sent this form’s confirmation email instead.": "Opcional. A los miembros sin consentimiento registrado se les envía el correo de confirmación de este formulario.",
  "Audience (aud_…)": "Audiencia (aud_…)",
  "Made for you on first use. Change it only to use another MySendbox list.": "Se crea en el primer uso. Cámbiala solo para usar otra lista de MySendbox.",
  "Copying…": "Copiando…",
  "Copy members to MySendbox": "Copiar miembros a MySendbox",
  "Copies every subscribed member not yet in MySendbox. Safe to run again. Save settings first if you changed consent.": "Copia a todos los miembros suscritos que aún no están en MySendbox. Se puede repetir. Guarda los ajustes antes si cambiaste el consentimiento.",
  "{count} member(s) copied.": "{count} miembro(s) copiado(s).",
  "The copy stopped.": "La copia se detuvo.",
  "Members not copied ({count})": "Miembros no copiados ({count})",
  "draft": "borrador",
  "scheduled": "programado",
  "paused": "en pausa",
  "canceled": "cancelado",
  "MySendbox API key": "Clave de API de MySendbox",
  "MySendbox API URL": "URL de la API de MySendbox",
  "A key with the contacts and broadcasts scopes. Stored encrypted with APP_KEY and never shown again.": "Una clave con los permisos de contactos y envíos. Se guarda cifrada con APP_KEY y no se vuelve a mostrar.",
  "Blank for MySendbox itself.": "En blanco para el propio MySendbox.",
  "Add an API key to send newsletters to members through MySendbox. Save, then reload this page.": "Añade una clave de API para enviar boletines a los miembros a través de MySendbox. Guarda y vuelve a cargar esta página."
}

export default strings
