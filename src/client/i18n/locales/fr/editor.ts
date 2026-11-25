import type { Dictionary } from '../../index.ts'

/**
 * The post and page editor and what it is built from: the Markdown editor,
 * the media and snippet pickers, term pickers, access box, pagination, and the
 * hooks behind them. Strings already in another group (e.g. 'Draft',
 * 'Loading…') are not repeated here.
 */
const strings: Dictionary = {
  // Headings and the main button
  'Edit post': 'Modifier l’article',
  'Edit page': 'Modifier la page',
  'Edit {type}': 'Modifier {type}',
  'New post': 'Nouvel article',
  'New page': 'Nouvelle page',
  'New {type}': 'Ajouter {type}',
  'Create': 'Créer',
  'Schedule': 'Programmer',
  'Submit for review': 'Soumettre pour relecture',
  'Save draft': 'Enregistrer le brouillon',
  'Failed to save post': 'Impossible d’enregistrer l’article',
  'Failed to save page': 'Impossible d’enregistrer la page',
  'Failed to save {type}': 'Impossible d’enregistrer : {type}',

  // Edit lock and autosave
  '{name} has taken over editing this post. Your unsaved changes are still on screen, but cannot be saved unless you take it back.':
    '{name} a pris la main sur cet article. Vos modifications non enregistrées sont toujours à l’écran, mais ne pourront être enregistrées que si vous reprenez la main.',
  '{name} is editing this post. You can read it, but saving is paused so neither of you overwrites the other.':
    '{name} modifie cet article. Vous pouvez le lire, mais l’enregistrement est suspendu pour qu’aucun de vous n’écrase les modifications de l’autre.',
  '{name} has finished editing. Reload to see their changes and start editing.':
    '{name} a terminé ses modifications. Rechargez pour voir ses changements et commencer à modifier.',
  'Take over': 'Prendre la main',
  'Back to posts': 'Retour aux articles',
  'Reload and edit': 'Recharger et modifier',
  'The other editor': 'L’autre éditeur',
  'Someone else': 'Quelqu’un d’autre',
  'Someone else is editing this post': 'Quelqu’un d’autre modifie cet article',
  'There is an autosave of this post from {date} that is newer than the saved version.':
    'Il existe une sauvegarde automatique de cet article du {date}, plus récente que la version enregistrée.',
  'Restore it': 'La restaurer',
  'Autosaved {time}': 'Sauvegarde automatique à {time}',

  // Revisions
  'Revisions': 'Révisions',
  'Replace the current text with the version from {date}? The current text is kept as a revision.':
    'Remplacer le texte actuel par la version du {date} ? Le texte actuel est conservé comme révision.',
  'Could not restore that revision': 'Impossible de restaurer cette révision',

  // Main fields
  'Enter post title': 'Titre de l’article',
  'Enter page title': 'Titre de la page',
  'Enter {type} title': 'Titre ({type})',
  'post-url-slug': 'slug-de-l-article',
  'page-url-slug': 'slug-de-la-page',
  '{type}-url-slug': 'slug-{type}',
  'from the title': 'à partir du titre',
  'Write your content here. Markdown is supported.': 'Rédigez votre contenu ici. Markdown est pris en charge.',
  'Written for you from the content if you leave this blank': 'Généré à partir du contenu si vous laissez ce champ vide',

  // SEO and social cards
  'SEO Settings': 'Réglages SEO',
  'Meta Title': 'Méta-titre',
  'Meta Description': 'Méta-description',
  'SEO title': 'Titre SEO',
  'SEO description': 'Description SEO',
  'Canonical URL': 'URL canonique',
  'Only if this was first published somewhere else': 'Uniquement si le contenu a d’abord été publié ailleurs',
  'Ask search engines not to index this post': 'Demander aux moteurs de recherche de ne pas indexer cet article',
  'Ask search engines not to index this page': 'Demander aux moteurs de recherche de ne pas indexer cette page',
  'Ask search engines not to index this {type}': 'Demander aux moteurs de recherche de ne pas indexer ce contenu ({type})',
  'Social cards': 'Cartes de partage',
  'Open Graph title': 'Titre Open Graph',
  'Open Graph description': 'Description Open Graph',
  'Twitter / X title': 'Titre pour Twitter / X',
  'Twitter / X description': 'Description pour Twitter / X',
  'Falls back to the SEO title': 'Vide, le titre SEO est utilisé',
  'Falls back to the SEO description': 'Vide, la description SEO est utilisée',
  'Falls back to the Open Graph title': 'Vide, le titre Open Graph est utilisé',
  'Falls back to the Open Graph description': 'Vide, la description Open Graph est utilisée',

  // Publish box
  'Published (an editor publishes)': 'Publié (un éditeur le publie)',
  'Publish on': 'Publier le',
  'Scheduled — goes live {date}.': 'Programmé : mise en ligne le {date}.',
  'Already live.': 'Déjà en ligne.',
  'Blank publishes now. A future date schedules it.': 'Vide, la publication est immédiate. Une date future la programme.',
  'Unchanged': 'Inchangé',
  'Me': 'Moi',

  // Categories and tags
  'category': 'catégorie',
  'tag': 'étiquette',
  'Could not create that category. It may already exist.': 'Impossible de créer cette catégorie. Elle existe peut-être déjà.',
  'Could not add those tags.': 'Impossible d’ajouter ces étiquettes.',
  'Remove {name}': 'Retirer {name}',
  'Search or add a {noun}': 'Rechercher ou ajouter : {noun}',
  'No matches for “{query}”.': 'Aucun résultat pour « {query} ».',
  '+ Add “{name}”': '+ Ajouter « {name} »',

  // Content model panels
  '{type} details': 'Détails ({type})',
  'Could not add that {term}.': 'Impossible d’ajouter ce terme ({term}).',
  'No {terms} yet.': 'Aucun élément ({terms}) pour l’instant.',

  'Sending…': 'Envoi…',
  'Readable by: {level}. This site no longer offers that level, so the body is withheld from every reader.':
    'Lisible par : {level}. Ce site ne propose plus ce niveau, le corps est donc masqué pour tous les lecteurs.',

  // Featured image and media
  '+ Set featured image': '+ Définir l’image à la une',
  'A featured image has to be an image.': 'L’image à la une doit être une image.',
  'Replace': 'Remplacer',
  'No media files yet. Upload some!': 'Aucun média pour l’instant. Téléversez-en !',
  'Loading more…': 'Chargement de la suite…',
  'Media library': 'Médiathèque',
  'Close': 'Fermer',
  'No media yet — upload or drop a file here.': 'Aucun média pour l’instant : téléversez ou déposez un fichier ici.',
  'Could not start the upload.': 'Impossible de démarrer le téléversement.',
  'Storage refused the upload ({status}).': 'Le stockage a refusé le téléversement ({status}).',
  'The upload could not reach storage.': 'Le téléversement n’a pas pu atteindre le stockage.',
  'The upload could not be confirmed.': 'Impossible de confirmer le téléversement.',
  'The update returned no media.': 'La mise à jour n’a renvoyé aucun média.',

  // Snippets
  'Insert snippet': 'Insérer un fragment',
  'Search snippets': 'Rechercher des fragments',
  'No snippets yet. Add them under Snippets in the admin menu.': 'Aucun fragment pour l’instant. Ajoutez-en dans Fragments, dans le menu d’administration.',
  'No snippet matches that search.': 'Aucun fragment ne correspond à cette recherche.',

  // Pagination
  '{first}–{last} of {total} {noun}': '{first}–{last} sur {total} {noun}',
  'Page {page} of {pages}': 'Page {page} sur {pages}',
  'Previous': 'Précédent',
  'Next': 'Suivant',
  'items': 'éléments',
  'comments': 'commentaires',
  'members': 'membres',
  'users': 'utilisateurs',
  'redirects': 'redirections',

  // Markdown editor
  'Bold (⌘B)': 'Gras (⌘B)',
  'bold text': 'texte en gras',
  'Italic (⌘I)': 'Italique (⌘I)',
  'italic text': 'texte en italique',
  'Strikethrough': 'Barré',
  'struck out': 'barré',
  'Code': 'Code',
  'code': 'code',
  'Heading': 'Titre',
  'Quote': 'Citation',
  'Quoted': 'Texte cité',
  'Bulleted list': 'Liste à puces',
  'Numbered list': 'Liste numérotée',
  'Item': 'Élément',
  'Link (⌘K)': 'Lien (⌘K)',
  'link text': 'texte du lien',
  'Insert media': 'Insérer un média',
  'Write': 'Rédiger',
  'Preview failed: {message}': 'Échec de l’aperçu : {message}',
  'Nothing to preview yet.': 'Rien à prévisualiser pour l’instant.',
  'Markdown supported — headings, lists, links, tables, and fenced code. HTML is shown as text rather than rendered.':
    'Markdown pris en charge : titres, listes, liens, tableaux et blocs de code. Le HTML est affiché comme texte, sans être interprété.',

  // Visibility: public or private (migration 043)
  'Visibility': 'Visibilité',
  'Public': 'Public',
  'Only its author, editors and admins see it, here in the admin. It is left out of the site, the API, feeds, the sitemap and search.':
    'Visible uniquement par son auteur, les éditeurs et les administrateurs, ici dans l’administration. Exclu du site, de l’API, des flux, du plan du site et de la recherche.',
  'Only people who can edit pages see it, here in the admin. It is left out of the site, the API, feeds, the sitemap and search.':
    'Visible uniquement par les personnes qui peuvent modifier les pages, ici dans l’administration. Exclue du site, de l’API, des flux, du plan du site et de la recherche.',

  // Social card images
  'Open Graph image': 'Image Open Graph',
  'Twitter / X image': 'Image pour Twitter / X',
  'Falls back to the featured image.': 'Vide, l’image à la une est utilisée.',
  'Falls back to the Open Graph image.': 'Vide, l’image Open Graph est utilisée.',
  'A social card image has to be an image.': 'L’image d’une carte de partage doit être une image.',
  'Choose image': 'Choisir une image',
  'or paste the URL of a library image': 'ou collez l’URL d’une image de la médiathèque',
  'Use URL': 'Utiliser l’URL',
  'Looking…': 'Recherche…',
  'That URL is not an image in the media library. Upload it first, then choose it here.':
    'Cette URL n’est pas une image de la médiathèque. Téléversez-la d’abord, puis choisissez-la ici.',
  'Could not look that URL up.': 'Impossible de vérifier cette URL.',
  "The whole title in search results. Blank uses the title followed by the site name.": "Le titre complet dans les résultats de recherche. Vide, le titre suivi du nom du site est utilisé.",
  "Blank uses the start of the page.": "Vide, le début de la page est utilisé.",
  "Blank uses the excerpt.": "Vide, l'extrait est utilisé.",
  "{count} / {limit}": "{count} / {limit}",
  "{count} / {limit} — may be cut off": "{count} / {limit} — risque d’être tronqué"
}

export default strings
