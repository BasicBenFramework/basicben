import type { Dictionary } from '../../../client/i18n/index.ts'

/** Portuguese (Brazil) for the analytics feature. Merged over the admin's own dictionary. */
const strings: Dictionary = {
  "{count} day|{count} days": {"one":"{count} dia","many":"{count} dias","other":"{count} dias"},
  "{count} view|{count} views": {"one":"{count} visualização","many":"{count} visualizações","other":"{count} visualizações"},
  "{count} visitor|{count} visitors": {"one":"{count} visitante","many":"{count} visitantes","other":"{count} visitantes"},
  "Saved.": "Salvo.",
  "Analytics": "Analytics",
  "Range": "Período",
  "Page views": "Visualizações de página",
  "Daily visitors, summed": "Visitantes diários, somados",
  "Views per day": "Visualizações por dia",
  "{from} to {to} (UTC)": "De {from} a {to} (UTC)",
  "Views": "Visualizações",
  "Visitors": "Visitantes",
  "Top pages": "Páginas mais vistas",
  "No page views yet.": "Ainda não há visualizações de página.",
  "Path": "Caminho",
  "Top referrers": "Principais origens de tráfego",
  "No referred visits yet.": "Ainda não há visitas de referência.",
  "Domain": "Domínio",
  "How this is counted": "Como isso é contado",
  "No cookies, no stored IP addresses or user agents. A visitor is a hash of their address, browser and a random salt that changes every UTC day and is then deleted, so nobody — including you — can tell who visited, or link one day's visitors to the next. Browsers sending Do Not Track or Global Privacy Control are not counted at all, and neither are known bots.": "Sem cookies e sem armazenar endereços IP ou user agents. Um visitante é um hash do endereço, do navegador e de um salt aleatório que muda a cada dia UTC e depois é excluído, então ninguém — nem você — consegue saber quem visitou nem relacionar os visitantes de um dia com os do dia seguinte. Navegadores que enviam Do Not Track ou Global Privacy Control não são contados, nem bots conhecidos.",
  "Your front end reports page views with a short snippet: {endpoint}. See {doc}.": "Seu front-end informa as visualizações de página com um pequeno trecho de código: {endpoint}. Consulte {doc}.",
  "Count page views": "Contar visualizações de página",
  "Forget visitor hashes after (hours, 1–24)": "Descartar hashes de visitantes após (horas, 1–24)",
  "Keep daily counts for (days, 0 = forever)": "Manter as contagens diárias por (dias, 0 = para sempre)",
  "Save": "Salvar",
  "Views and visitors per day": "Visualizações e visitantes por dia",
  "{day}: {views}, {visitors}": "{day}: {views}, {visitors}"
}

export default strings
