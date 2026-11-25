import type { Dictionary } from '../../index.ts'

/**
 * The post and page editor and what it is built from: the Markdown editor,
 * the media and snippet pickers, term pickers, access box, pagination, and the
 * hooks behind them. Strings already in another group (e.g. 'Draft',
 * 'Loading…') are not repeated here.
 */
const strings: Dictionary = {
  // Headings and the main button
  'Edit post': 'Editar post',
  'Edit page': 'Editar página',
  'Edit {type}': 'Editar {type}',
  'New post': 'Novo post',
  'New page': 'Nova página',
  'New {type}': 'Adicionar {type}',
  'Create': 'Criar',
  'Schedule': 'Agendar',
  'Submit for review': 'Enviar para revisão',
  'Save draft': 'Salvar rascunho',
  'Failed to save post': 'Não foi possível salvar o post',
  'Failed to save page': 'Não foi possível salvar a página',
  'Failed to save {type}': 'Não foi possível salvar: {type}',

  // Edit lock and autosave
  '{name} has taken over editing this post. Your unsaved changes are still on screen, but cannot be saved unless you take it back.':
    '{name} assumiu a edição deste post. Suas alterações não salvas continuam na tela, mas só poderão ser salvas se você retomar a edição.',
  '{name} is editing this post. You can read it, but saving is paused so neither of you overwrites the other.':
    '{name} está editando este post. Você pode lê-lo, mas o salvamento está pausado para que ninguém sobrescreva as alterações do outro.',
  '{name} has finished editing. Reload to see their changes and start editing.':
    '{name} terminou de editar. Recarregue para ver as alterações e começar a editar.',
  'Take over': 'Assumir a edição',
  'Back to posts': 'Voltar aos posts',
  'Reload and edit': 'Recarregar e editar',
  'The other editor': 'O outro editor',
  'Someone else': 'Outra pessoa',
  'Someone else is editing this post': 'Outra pessoa está editando este post',
  'There is an autosave of this post from {date} that is newer than the saved version.':
    'Há um salvamento automático deste post de {date} mais recente que a versão salva.',
  'Restore it': 'Restaurar',
  'Autosaved {time}': 'Salvo automaticamente às {time}',

  // Revisions
  'Revisions': 'Revisões',
  'Replace the current text with the version from {date}? The current text is kept as a revision.':
    'Substituir o texto atual pela versão de {date}? O texto atual é mantido como revisão.',
  'Could not restore that revision': 'Não foi possível restaurar essa revisão',

  // Main fields
  'Enter post title': 'Título do post',
  'Enter page title': 'Título da página',
  'Enter {type} title': 'Título ({type})',
  'post-url-slug': 'slug-do-post',
  'page-url-slug': 'slug-da-pagina',
  '{type}-url-slug': 'slug-de-{type}',
  'from the title': 'a partir do título',
  'Write your content here. Markdown is supported.': 'Escreva seu conteúdo aqui. Markdown é suportado.',
  'Written for you from the content if you leave this blank': 'Se ficar em branco, é gerado a partir do conteúdo',

  // SEO and social cards
  'SEO Settings': 'Configurações de SEO',
  'Meta Title': 'Metatítulo',
  'Meta Description': 'Metadescrição',
  'SEO title': 'Título SEO',
  'SEO description': 'Descrição SEO',
  'Canonical URL': 'URL canônica',
  'Only if this was first published somewhere else': 'Somente se foi publicado primeiro em outro lugar',
  'Ask search engines not to index this post': 'Pedir aos mecanismos de busca que não indexem este post',
  'Ask search engines not to index this page': 'Pedir aos mecanismos de busca que não indexem esta página',
  'Ask search engines not to index this {type}': 'Pedir aos mecanismos de busca que não indexem este conteúdo ({type})',
  'Social cards': 'Cartões para redes sociais',
  'Open Graph title': 'Título do Open Graph',
  'Open Graph description': 'Descrição do Open Graph',
  'Twitter / X title': 'Título para Twitter / X',
  'Twitter / X description': 'Descrição para Twitter / X',
  'Falls back to the SEO title': 'Se ficar vazio, usa o título SEO',
  'Falls back to the SEO description': 'Se ficar vazio, usa a descrição SEO',
  'Falls back to the Open Graph title': 'Se ficar vazio, usa o título do Open Graph',
  'Falls back to the Open Graph description': 'Se ficar vazio, usa a descrição do Open Graph',

  // Publish box
  'Published (an editor publishes)': 'Publicado (um editor publica)',
  'Publish on': 'Publicar em',
  'Scheduled — goes live {date}.': 'Agendado — será publicado em {date}.',
  'Already live.': 'Já publicado.',
  'Blank publishes now. A future date schedules it.': 'Em branco, publica agora. Uma data futura agenda a publicação.',
  'Unchanged': 'Sem alterações',
  'Me': 'Eu',

  // Categories and tags
  'category': 'categoria',
  'tag': 'tag',
  'Could not create that category. It may already exist.': 'Não foi possível criar essa categoria. Talvez ela já exista.',
  'Could not add those tags.': 'Não foi possível adicionar essas tags.',
  'Remove {name}': 'Remover {name}',
  'Search or add a {noun}': 'Pesquisar ou adicionar: {noun}',
  'No matches for “{query}”.': 'Nenhum resultado para “{query}”.',
  '+ Add “{name}”': '+ Adicionar “{name}”',

  // Content model panels
  '{type} details': 'Detalhes ({type})',
  'Could not add that {term}.': 'Não foi possível adicionar o termo ({term}).',
  'No {terms} yet.': 'Ainda não há {terms}.',

  'Sending…': 'Enviando…',
  'Readable by: {level}. This site no longer offers that level, so the body is withheld from every reader.':
    'Visível para: {level}. Este site não oferece mais esse nível, então o corpo fica oculto para todos os leitores.',

  // Featured image and media
  '+ Set featured image': '+ Definir imagem destacada',
  'A featured image has to be an image.': 'A imagem destacada precisa ser uma imagem.',
  'Replace': 'Substituir',
  'No media files yet. Upload some!': 'Ainda não há arquivos de mídia. Envie alguns!',
  'Loading more…': 'Carregando mais…',
  'Media library': 'Biblioteca de mídia',
  'Close': 'Fechar',
  'No media yet — upload or drop a file here.': 'Ainda não há mídia — envie ou solte um arquivo aqui.',
  'Could not start the upload.': 'Não foi possível iniciar o upload.',
  'Storage refused the upload ({status}).': 'O armazenamento recusou o upload ({status}).',
  'The upload could not reach storage.': 'O upload não conseguiu chegar ao armazenamento.',
  'The upload could not be confirmed.': 'Não foi possível confirmar o upload.',
  'The update returned no media.': 'A atualização não retornou nenhuma mídia.',

  // Snippets
  'Insert snippet': 'Inserir trecho',
  'Search snippets': 'Pesquisar trechos',
  'No snippets yet. Add them under Snippets in the admin menu.': 'Ainda não há trechos. Adicione-os em Trechos, no menu do painel.',
  'No snippet matches that search.': 'Nenhum trecho corresponde a essa pesquisa.',

  // Pagination
  '{first}–{last} of {total} {noun}': '{first}–{last} de {total} {noun}',
  'Page {page} of {pages}': 'Página {page} de {pages}',
  'Previous': 'Anterior',
  'Next': 'Próxima',
  'items': 'itens',
  'comments': 'comentários',
  'members': 'membros',
  'users': 'usuários',
  'redirects': 'redirecionamentos',

  // Markdown editor
  'Bold (⌘B)': 'Negrito (⌘B)',
  'bold text': 'texto em negrito',
  'Italic (⌘I)': 'Itálico (⌘I)',
  'italic text': 'texto em itálico',
  'Strikethrough': 'Tachado',
  'struck out': 'tachado',
  'Code': 'Código',
  'code': 'código',
  'Heading': 'Título',
  'Quote': 'Citação',
  'Quoted': 'Texto citado',
  'Bulleted list': 'Lista com marcadores',
  'Numbered list': 'Lista numerada',
  'Item': 'Item',
  'Link (⌘K)': 'Link (⌘K)',
  'link text': 'texto do link',
  'Insert media': 'Inserir mídia',
  'Write': 'Escrever',
  'Preview failed: {message}': 'Falha na pré-visualização: {message}',
  'Nothing to preview yet.': 'Ainda não há nada para pré-visualizar.',
  'Markdown supported — headings, lists, links, tables, and fenced code. HTML is shown as text rather than rendered.':
    'Markdown suportado — títulos, listas, links, tabelas e blocos de código. O HTML é exibido como texto, não é renderizado.',

  // Visibility: public or private (migration 043)
  'Visibility': 'Visibilidade',
  'Public': 'Público',
  'Only its author, editors and admins see it, here in the admin. It is left out of the site, the API, feeds, the sitemap and search.':
    'Somente o autor, os editores e os administradores o veem, aqui no painel. Fica de fora do site, da API, dos feeds, do sitemap e da busca.',
  'Only people who can edit pages see it, here in the admin. It is left out of the site, the API, feeds, the sitemap and search.':
    'Somente quem pode editar páginas a vê, aqui no painel. Fica de fora do site, da API, dos feeds, do sitemap e da busca.',

  // Social card images
  'Open Graph image': 'Imagem do Open Graph',
  'Twitter / X image': 'Imagem para Twitter / X',
  'Falls back to the featured image.': 'Se ficar vazia, usa a imagem destacada.',
  'Falls back to the Open Graph image.': 'Se ficar vazia, usa a imagem do Open Graph.',
  'A social card image has to be an image.': 'A imagem de um cartão social precisa ser uma imagem.',
  'Choose image': 'Escolher imagem',
  'or paste the URL of a library image': 'ou cole a URL de uma imagem da biblioteca',
  'Use URL': 'Usar URL',
  'Looking…': 'Procurando…',
  'That URL is not an image in the media library. Upload it first, then choose it here.':
    'Essa URL não é uma imagem da biblioteca de mídia. Envie-a primeiro e depois escolha-a aqui.',
  'Could not look that URL up.': 'Não foi possível consultar essa URL.'
}

export default strings
