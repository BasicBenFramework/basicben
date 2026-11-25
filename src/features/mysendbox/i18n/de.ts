import type { Dictionary } from '../../../client/i18n/index.ts'

/** German for the mysendbox feature. Merged over the admin's own dictionary. */
const strings: Dictionary = {
  "Newsletters through MySendbox": "Newsletter über MySendbox",
  "{synced} member(s) in MySendbox, {waiting} waiting for consent, {refused} refused.": "{synced} Mitglied(er) in MySendbox, {waiting} warten auf Einwilligung, {refused} abgelehnt.",
  "A broadcast would reach {count} now.": "Ein Versand würde jetzt {count} erreichen.",
  "No webhook secret: unsubscribes made in MySendbox arrive through the daily check.": "Kein Webhook-Geheimnis: Abmeldungen in MySendbox kommen über die tägliche Prüfung an.",
  "From address": "Absenderadresse",
  "Blank uses your MySendbox workspace's default sender.": "Leer bedeutet Standardabsender Ihres MySendbox-Workspace.",
  "From name": "Absendername",
  "Blank uses the newsletter sender name.": "Leer bedeutet Absendername des Newsletters.",
  "Consent for members you added or imported": "Einwilligung für Mitglieder, die Sie hinzugefügt oder importiert haben",
  "How they agreed to receive posts by email, in your words. MySendbox records it with each contact. Leave blank and they are not copied, unless a signup form is set.": "Wie sie zugestimmt haben, Beiträge per E-Mail zu erhalten, in Ihren Worten. MySendbox speichert dies bei jedem Kontakt. Bleibt das Feld leer, werden sie nicht kopiert, außer es ist ein Anmeldeformular festgelegt.",
  "Signup form (frm_…)": "Anmeldeformular (frm_…)",
  "Optional. Members without recorded consent are sent this form’s confirmation email instead.": "Optional. Mitglieder ohne erfasste Einwilligung erhalten stattdessen die Bestätigungs-E-Mail dieses Formulars.",
  "Audience (aud_…)": "Zielgruppe (aud_…)",
  "Made for you on first use. Change it only to use another MySendbox list.": "Wird bei der ersten Verwendung angelegt. Nur ändern, um eine andere MySendbox-Liste zu verwenden.",
  "Copying…": "Wird kopiert…",
  "Copy members to MySendbox": "Mitglieder zu MySendbox kopieren",
  "Copies every subscribed member not yet in MySendbox. Safe to run again. Save settings first if you changed consent.": "Kopiert alle abonnierten Mitglieder, die noch nicht in MySendbox sind. Kann gefahrlos wiederholt werden. Speichern Sie zuerst die Einstellungen, wenn Sie die Einwilligung geändert haben.",
  "{count} member(s) copied.": "{count} Mitglied(er) kopiert.",
  "The copy stopped.": "Das Kopieren wurde abgebrochen.",
  "Members not copied ({count})": "Nicht kopierte Mitglieder ({count})",
  "draft": "Entwurf",
  "scheduled": "geplant",
  "paused": "pausiert",
  "canceled": "abgebrochen",
  "MySendbox API key": "MySendbox-API-Schlüssel",
  "MySendbox API URL": "MySendbox-API-URL",
  "A key with the contacts and broadcasts scopes. Stored encrypted with APP_KEY and never shown again.": "Ein Schlüssel mit den Berechtigungen für Kontakte und Versände. Wird mit APP_KEY verschlüsselt gespeichert und nie wieder angezeigt.",
  "Blank for MySendbox itself.": "Leer für MySendbox selbst.",
  "Add an API key to send newsletters to members through MySendbox. Save, then reload this page.": "Fügen Sie einen API-Schlüssel hinzu, um Newsletter über MySendbox an Mitglieder zu senden. Speichern Sie und laden Sie diese Seite dann neu."
}

export default strings
