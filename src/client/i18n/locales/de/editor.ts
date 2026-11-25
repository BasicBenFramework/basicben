import type { Dictionary } from '../../index.ts'

/**
 * German for the post and page editor and what it is built from: the Markdown
 * editor, the media and snippet pickers, term pickers, access box, pagination,
 * and the hooks behind them. Strings already in another group (e.g. 'Draft',
 * 'Loading…') are not repeated here.
 */
const strings: Dictionary = {
  // Headings and the main button
  'Edit post': 'Beitrag bearbeiten',
  'Edit page': 'Seite bearbeiten',
  'Edit {type}': '{type} bearbeiten',
  'New post': 'Neuer Beitrag',
  'New page': 'Neue Seite',
  'New {type}': '{type} hinzufügen',
  'Create': 'Erstellen',
  'Schedule': 'Planen',
  'Submit for review': 'Zur Prüfung einreichen',
  'Save draft': 'Entwurf speichern',
  'Failed to save post': 'Der Beitrag konnte nicht gespeichert werden',
  'Failed to save page': 'Die Seite konnte nicht gespeichert werden',
  'Failed to save {type}': 'Speichern fehlgeschlagen: {type}',

  // Edit lock and autosave
  '{name} has taken over editing this post. Your unsaved changes are still on screen, but cannot be saved unless you take it back.':
    '{name} hat die Bearbeitung dieses Beitrags übernommen. Ihre ungespeicherten Änderungen sind noch sichtbar, können aber erst gespeichert werden, wenn Sie die Bearbeitung zurückholen.',
  '{name} is editing this post. You can read it, but saving is paused so neither of you overwrites the other.':
    '{name} bearbeitet diesen Beitrag. Sie können ihn lesen, aber das Speichern ist pausiert, damit niemand die Änderungen des anderen überschreibt.',
  '{name} has finished editing. Reload to see their changes and start editing.':
    '{name} hat die Bearbeitung beendet. Neu laden, um die Änderungen zu sehen und mit der Bearbeitung zu beginnen.',
  'Take over': 'Übernehmen',
  'Back to posts': 'Zurück zu den Beiträgen',
  'Reload and edit': 'Neu laden und bearbeiten',
  'The other editor': 'Die andere Person',
  'Someone else': 'Jemand anderes',
  'Someone else is editing this post': 'Jemand anderes bearbeitet diesen Beitrag',
  'There is an autosave of this post from {date} that is newer than the saved version.':
    'Es gibt eine automatische Speicherung dieses Beitrags vom {date}, die neuer ist als die gespeicherte Version.',
  'Restore it': 'Wiederherstellen',
  'Autosaved {time}': 'Automatisch gespeichert um {time}',

  // Revisions
  'Revisions': 'Versionen',
  'Replace the current text with the version from {date}? The current text is kept as a revision.':
    'Den aktuellen Text durch die Version vom {date} ersetzen? Der aktuelle Text wird als Version aufbewahrt.',
  'Could not restore that revision': 'Diese Version konnte nicht wiederhergestellt werden',

  // Main fields
  'Enter post title': 'Titel des Beitrags',
  'Enter page title': 'Titel der Seite',
  'Enter {type} title': 'Titel ({type})',
  'post-url-slug': 'beitrag-url-slug',
  'page-url-slug': 'seite-url-slug',
  '{type}-url-slug': '{type}-url-slug',
  'from the title': 'aus dem Titel',
  'Write your content here. Markdown is supported.': 'Schreiben Sie hier Ihren Inhalt. Markdown wird unterstützt.',
  'Written for you from the content if you leave this blank': 'Wird aus dem Inhalt erzeugt, wenn Sie dies leer lassen',

  // SEO and social cards
  'SEO Settings': 'SEO-Einstellungen',
  'Meta Title': 'Meta-Titel',
  'Meta Description': 'Meta-Beschreibung',
  'SEO title': 'SEO-Titel',
  'SEO description': 'SEO-Beschreibung',
  'Canonical URL': 'Kanonische URL',
  'Only if this was first published somewhere else': 'Nur, wenn dies zuerst anderswo veröffentlicht wurde',
  'Ask search engines not to index this post': 'Suchmaschinen bitten, diesen Beitrag nicht zu indexieren',
  'Ask search engines not to index this page': 'Suchmaschinen bitten, diese Seite nicht zu indexieren',
  'Ask search engines not to index this {type}': 'Suchmaschinen bitten, diesen Inhalt ({type}) nicht zu indexieren',
  'Social cards': 'Social-Media-Karten',
  'Open Graph title': 'Open-Graph-Titel',
  'Open Graph description': 'Open-Graph-Beschreibung',
  'Twitter / X title': 'Twitter-/X-Titel',
  'Twitter / X description': 'Twitter-/X-Beschreibung',
  'Falls back to the SEO title': 'Wenn leer, wird der SEO-Titel verwendet',
  'Falls back to the SEO description': 'Wenn leer, wird die SEO-Beschreibung verwendet',
  'Falls back to the Open Graph title': 'Wenn leer, wird der Open-Graph-Titel verwendet',
  'Falls back to the Open Graph description': 'Wenn leer, wird die Open-Graph-Beschreibung verwendet',

  // Publish box
  'Published (an editor publishes)': 'Veröffentlicht (ein Redakteur veröffentlicht)',
  'Publish on': 'Veröffentlichen am',
  'Scheduled — goes live {date}.': 'Geplant – wird am {date} veröffentlicht.',
  'Already live.': 'Bereits veröffentlicht.',
  'Blank publishes now. A future date schedules it.': 'Leer veröffentlicht sofort. Ein zukünftiges Datum plant die Veröffentlichung.',
  'Unchanged': 'Unverändert',
  'Me': 'Ich',

  // Categories and tags
  'category': 'Kategorie',
  'tag': 'Schlagwort',
  'Could not create that category. It may already exist.': 'Diese Kategorie konnte nicht erstellt werden. Möglicherweise existiert sie bereits.',
  'Could not add those tags.': 'Diese Schlagwörter konnten nicht hinzugefügt werden.',
  'Remove {name}': '{name} entfernen',
  'Search or add a {noun}': 'Suchen oder hinzufügen: {noun}',
  'No matches for “{query}”.': 'Keine Treffer für „{query}“.',
  '+ Add “{name}”': '+ „{name}“ hinzufügen',

  // Content model panels
  '{type} details': 'Details ({type})',
  'Could not add that {term}.': 'Hinzufügen fehlgeschlagen ({term}).',
  'No {terms} yet.': 'Noch keine Einträge ({terms}).',

  'Sending…': 'Wird gesendet…',
  'Readable by: {level}. This site no longer offers that level, so the body is withheld from every reader.':
    'Lesbar für: {level}. Diese Website bietet diese Stufe nicht mehr an, daher wird der Inhalt allen Lesern vorenthalten.',

  // Featured image and media
  '+ Set featured image': '+ Beitragsbild festlegen',
  'A featured image has to be an image.': 'Ein Beitragsbild muss ein Bild sein.',
  'Replace': 'Ersetzen',
  'No media files yet. Upload some!': 'Noch keine Mediendateien. Laden Sie welche hoch!',
  'Loading more…': 'Weitere werden geladen…',
  'Media library': 'Mediathek',
  'Close': 'Schließen',
  'No media yet — upload or drop a file here.': 'Noch keine Medien – laden Sie eine Datei hoch oder ziehen Sie sie hierher.',
  'Could not start the upload.': 'Der Upload konnte nicht gestartet werden.',
  'Storage refused the upload ({status}).': 'Der Speicher hat den Upload abgelehnt ({status}).',
  'The upload could not reach storage.': 'Der Upload konnte den Speicher nicht erreichen.',
  'The upload could not be confirmed.': 'Der Upload konnte nicht bestätigt werden.',
  'The update returned no media.': 'Die Aktualisierung hat keine Medien zurückgegeben.',

  // Snippets
  'Insert snippet': 'Baustein einfügen',
  'Search snippets': 'Bausteine durchsuchen',
  'No snippets yet. Add them under Snippets in the admin menu.': 'Noch keine Bausteine. Fügen Sie sie unter Bausteine im Verwaltungsmenü hinzu.',
  'No snippet matches that search.': 'Kein Baustein entspricht dieser Suche.',

  // Pagination
  '{first}–{last} of {total} {noun}': '{noun} {first}–{last} von {total}',
  'Page {page} of {pages}': 'Seite {page} von {pages}',
  'Previous': 'Zurück',
  'Next': 'Weiter',
  'items': 'Elemente',
  'comments': 'Kommentare',
  'members': 'Mitglieder',
  'users': 'Benutzer',
  'redirects': 'Weiterleitungen',

  // Markdown editor
  'Bold (⌘B)': 'Fett (⌘B)',
  'bold text': 'fetter Text',
  'Italic (⌘I)': 'Kursiv (⌘I)',
  'italic text': 'kursiver Text',
  'Strikethrough': 'Durchgestrichen',
  'struck out': 'durchgestrichen',
  'Code': 'Code',
  'code': 'Code',
  'Heading': 'Überschrift',
  'Quote': 'Zitat',
  'Quoted': 'Zitierter Text',
  'Bulleted list': 'Aufzählung',
  'Numbered list': 'Nummerierte Liste',
  'Item': 'Element',
  'Link (⌘K)': 'Link (⌘K)',
  'link text': 'Linktext',
  'Insert media': 'Medien einfügen',
  'Write': 'Schreiben',
  'Preview failed: {message}': 'Vorschau fehlgeschlagen: {message}',
  'Nothing to preview yet.': 'Noch nichts für die Vorschau.',
  'Markdown supported — headings, lists, links, tables, and fenced code. HTML is shown as text rather than rendered.':
    'Markdown wird unterstützt – Überschriften, Listen, Links, Tabellen und Codeblöcke. HTML wird als Text angezeigt statt gerendert.',

  // Visibility: public or private (migration 043)
  'Visibility': 'Sichtbarkeit',
  'Public': 'Öffentlich',
  'Only its author, editors and admins see it, here in the admin. It is left out of the site, the API, feeds, the sitemap and search.':
    'Nur der Autor, Redakteure und Administratoren sehen es, hier in der Verwaltung. Es erscheint nicht auf der Website, in der API, in Feeds, in der Sitemap oder in der Suche.',
  'Only people who can edit pages see it, here in the admin. It is left out of the site, the API, feeds, the sitemap and search.':
    'Nur Personen, die Seiten bearbeiten können, sehen es, hier in der Verwaltung. Es erscheint nicht auf der Website, in der API, in Feeds, in der Sitemap oder in der Suche.',

  // Social card images
  'Open Graph image': 'Open-Graph-Bild',
  'Twitter / X image': 'Twitter-/X-Bild',
  'Falls back to the featured image.': 'Wenn leer, wird das Beitragsbild verwendet.',
  'Falls back to the Open Graph image.': 'Wenn leer, wird das Open-Graph-Bild verwendet.',
  'A social card image has to be an image.': 'Ein Social-Media-Kartenbild muss ein Bild sein.',
  'Choose image': 'Bild auswählen',
  'or paste the URL of a library image': 'oder die URL eines Bilds aus der Mediathek einfügen',
  'Use URL': 'URL verwenden',
  'Looking…': 'Wird gesucht…',
  'That URL is not an image in the media library. Upload it first, then choose it here.':
    'Diese URL ist kein Bild in der Mediathek. Laden Sie es zuerst hoch und wählen Sie es dann hier aus.',
  'Could not look that URL up.': 'Diese URL konnte nicht nachgeschlagen werden.'
}

export default strings
