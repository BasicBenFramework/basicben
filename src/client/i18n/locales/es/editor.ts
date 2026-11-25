import type { Dictionary } from '../../index.ts'

/**
 * The post and page editor and what it is built from: the Markdown editor,
 * the media and snippet pickers, term pickers, access box, pagination, and the
 * hooks behind them. Strings already in another group (e.g. 'Draft',
 * 'Loading…') are not repeated here.
 */
const strings: Dictionary = {
  // Headings and the main button
  'Edit post': 'Editar entrada',
  'Edit page': 'Editar página',
  'Edit {type}': 'Editar {type}',
  'New post': 'Nueva entrada',
  'New page': 'Nueva página',
  'New {type}': 'Añadir {type}',
  'Create': 'Crear',
  'Schedule': 'Programar',
  'Submit for review': 'Enviar a revisión',
  'Save draft': 'Guardar borrador',
  'Failed to save post': 'No se pudo guardar la entrada',
  'Failed to save page': 'No se pudo guardar la página',
  'Failed to save {type}': 'No se pudo guardar: {type}',

  // Edit lock and autosave
  '{name} has taken over editing this post. Your unsaved changes are still on screen, but cannot be saved unless you take it back.':
    '{name} ha tomado el control de esta entrada. Tus cambios sin guardar siguen en pantalla, pero no se podrán guardar a menos que recuperes el control.',
  '{name} is editing this post. You can read it, but saving is paused so neither of you overwrites the other.':
    '{name} está editando esta entrada. Puedes leerla, pero el guardado está en pausa para que ninguno sobrescriba los cambios del otro.',
  '{name} has finished editing. Reload to see their changes and start editing.':
    '{name} ha terminado de editar. Recarga para ver sus cambios y empezar a editar.',
  'Take over': 'Tomar el control',
  'Back to posts': 'Volver a las entradas',
  'Reload and edit': 'Recargar y editar',
  'The other editor': 'El otro editor',
  'Someone else': 'Otra persona',
  'Someone else is editing this post': 'Otra persona está editando esta entrada',
  'There is an autosave of this post from {date} that is newer than the saved version.':
    'Hay un guardado automático de esta entrada del {date} más reciente que la versión guardada.',
  'Restore it': 'Restaurarlo',
  'Autosaved {time}': 'Guardado automático a las {time}',

  // Revisions
  'Revisions': 'Revisiones',
  'Replace the current text with the version from {date}? The current text is kept as a revision.':
    '¿Reemplazar el texto actual por la versión del {date}? El texto actual se conserva como revisión.',
  'Could not restore that revision': 'No se pudo restaurar esa revisión',

  // Main fields
  'Enter post title': 'Título de la entrada',
  'Enter page title': 'Título de la página',
  'Enter {type} title': 'Título de {type}',
  'post-url-slug': 'slug-de-la-entrada',
  'page-url-slug': 'slug-de-la-pagina',
  '{type}-url-slug': 'slug-de-{type}',
  'from the title': 'a partir del título',
  'Write your content here. Markdown is supported.': 'Escribe aquí el contenido. Se admite Markdown.',
  'Written for you from the content if you leave this blank': 'Si lo dejas en blanco, se genera a partir del contenido',

  // SEO and social cards
  'SEO Settings': 'Ajustes de SEO',
  'Meta Title': 'Metatítulo',
  'Meta Description': 'Metadescripción',
  'SEO title': 'Título SEO',
  'SEO description': 'Descripción SEO',
  'Canonical URL': 'URL canónica',
  'Only if this was first published somewhere else': 'Solo si se publicó primero en otro sitio',
  'Ask search engines not to index this post': 'Pedir a los buscadores que no indexen esta entrada',
  'Ask search engines not to index this page': 'Pedir a los buscadores que no indexen esta página',
  'Ask search engines not to index this {type}': 'Pedir a los buscadores que no indexen este contenido ({type})',
  'Social cards': 'Tarjetas para redes sociales',
  'Open Graph title': 'Título de Open Graph',
  'Open Graph description': 'Descripción de Open Graph',
  'Twitter / X title': 'Título para Twitter / X',
  'Twitter / X description': 'Descripción para Twitter / X',
  'Falls back to the SEO title': 'Si se deja vacío, se usa el título SEO',
  'Falls back to the SEO description': 'Si se deja vacío, se usa la descripción SEO',
  'Falls back to the Open Graph title': 'Si se deja vacío, se usa el título de Open Graph',
  'Falls back to the Open Graph description': 'Si se deja vacío, se usa la descripción de Open Graph',

  // Publish box
  'Published (an editor publishes)': 'Publicada (la publica un editor)',
  'Publish on': 'Publicar el',
  'Scheduled — goes live {date}.': 'Programada: se publica el {date}.',
  'Already live.': 'Ya publicada.',
  'Blank publishes now. A future date schedules it.': 'En blanco, se publica ahora. Con una fecha futura, se programa.',
  'Unchanged': 'Sin cambios',
  'Me': 'Yo',

  // Categories and tags
  'category': 'categoría',
  'tag': 'etiqueta',
  'Could not create that category. It may already exist.': 'No se pudo crear esa categoría. Puede que ya exista.',
  'Could not add those tags.': 'No se pudieron añadir esas etiquetas.',
  'Remove {name}': 'Quitar {name}',
  'Search or add a {noun}': 'Buscar o añadir {noun}',
  'No matches for “{query}”.': 'No hay coincidencias para “{query}”.',
  '+ Add “{name}”': '+ Añadir “{name}”',

  // Content model panels
  '{type} details': 'Detalles ({type})',
  'Could not add that {term}.': 'No se pudo añadir el término ({term}).',
  'No {terms} yet.': 'Aún no hay {terms}.',

  'Sending…': 'Enviando…',
  'Readable by: {level}. This site no longer offers that level, so the body is withheld from every reader.':
    'Legible para: {level}. Este sitio ya no ofrece ese nivel, así que el cuerpo se oculta a todos los lectores.',

  // Featured image and media
  '+ Set featured image': '+ Establecer imagen destacada',
  'A featured image has to be an image.': 'La imagen destacada tiene que ser una imagen.',
  'Replace': 'Reemplazar',
  'No media files yet. Upload some!': 'Aún no hay archivos multimedia. ¡Sube alguno!',
  'Loading more…': 'Cargando más…',
  'Media library': 'Biblioteca de medios',
  'Close': 'Cerrar',
  'No media yet — upload or drop a file here.': 'Aún no hay medios: sube o suelta un archivo aquí.',
  'Could not start the upload.': 'No se pudo iniciar la subida.',
  'Storage refused the upload ({status}).': 'El almacenamiento rechazó la subida ({status}).',
  'The upload could not reach storage.': 'La subida no pudo llegar al almacenamiento.',
  'The upload could not be confirmed.': 'No se pudo confirmar la subida.',
  'The update returned no media.': 'La actualización no devolvió ningún medio.',

  // Snippets
  'Insert snippet': 'Insertar fragmento',
  'Search snippets': 'Buscar fragmentos',
  'No snippets yet. Add them under Snippets in the admin menu.': 'Aún no hay fragmentos. Añádelos en Fragmentos, en el menú de administración.',
  'No snippet matches that search.': 'Ningún fragmento coincide con esa búsqueda.',

  // Pagination
  '{first}–{last} of {total} {noun}': '{first}–{last} de {total} {noun}',
  'Page {page} of {pages}': 'Página {page} de {pages}',
  'Previous': 'Anterior',
  'Next': 'Siguiente',
  'items': 'elementos',
  'comments': 'comentarios',
  'members': 'miembros',
  'users': 'usuarios',
  'redirects': 'redirecciones',

  // Markdown editor
  'Bold (⌘B)': 'Negrita (⌘B)',
  'bold text': 'texto en negrita',
  'Italic (⌘I)': 'Cursiva (⌘I)',
  'italic text': 'texto en cursiva',
  'Strikethrough': 'Tachado',
  'struck out': 'tachado',
  'Code': 'Código',
  'code': 'código',
  'Heading': 'Encabezado',
  'Quote': 'Cita',
  'Quoted': 'Texto citado',
  'Bulleted list': 'Lista con viñetas',
  'Numbered list': 'Lista numerada',
  'Item': 'Elemento',
  'Link (⌘K)': 'Enlace (⌘K)',
  'link text': 'texto del enlace',
  'Insert media': 'Insertar medio',
  'Write': 'Escribir',
  'Preview failed: {message}': 'Error en la vista previa: {message}',
  'Nothing to preview yet.': 'Aún no hay nada que previsualizar.',
  'Markdown supported — headings, lists, links, tables, and fenced code. HTML is shown as text rather than rendered.':
    'Se admite Markdown: encabezados, listas, enlaces, tablas y bloques de código. El HTML se muestra como texto, no se interpreta.',

  // Visibility: public or private (migration 043)
  'Visibility': 'Visibilidad',
  'Public': 'Público',
  'Only its author, editors and admins see it, here in the admin. It is left out of the site, the API, feeds, the sitemap and search.':
    'Solo la ven su autor, los editores y los administradores, aquí en el panel. Queda fuera del sitio, la API, los feeds, el mapa del sitio y la búsqueda.',
  'Only people who can edit pages see it, here in the admin. It is left out of the site, the API, feeds, the sitemap and search.':
    'Solo la ven quienes pueden editar páginas, aquí en el panel. Queda fuera del sitio, la API, los feeds, el mapa del sitio y la búsqueda.',

  // Social card images
  'Open Graph image': 'Imagen de Open Graph',
  'Twitter / X image': 'Imagen de Twitter / X',
  'Falls back to the featured image.': 'Si se deja vacía, se usa la imagen destacada.',
  'Falls back to the Open Graph image.': 'Si se deja vacía, se usa la imagen de Open Graph.',
  'A social card image has to be an image.': 'La imagen de una tarjeta social tiene que ser una imagen.',
  'Choose image': 'Elegir imagen',
  'or paste the URL of a library image': 'o pega la URL de una imagen de la biblioteca',
  'Use URL': 'Usar URL',
  'Looking…': 'Buscando…',
  'That URL is not an image in the media library. Upload it first, then choose it here.':
    'Esa URL no es una imagen de la biblioteca de medios. Súbela primero y luego elígela aquí.',
  'Could not look that URL up.': 'No se pudo buscar esa URL.',
  "The whole title in search results. Blank uses the title followed by the site name.": "El título completo en los resultados de búsqueda. Si se deja vacío, se usa el título seguido del nombre del sitio.",
  "Blank uses the start of the page.": "Si se deja vacío, se usa el comienzo de la página.",
  "Blank uses the excerpt.": "Si se deja vacío, se usa el extracto.",
  "{count} / {limit}": "{count} / {limit}",
  "{count} / {limit} — may be cut off": "{count} / {limit} — puede cortarse"
}

export default strings
