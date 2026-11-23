import type { Dictionary } from '../../../client/i18n'

/** Spanish for the analytics feature. Merged over the admin's own dictionary. */
const strings: Dictionary = {
  "{count} day|{count} days": {"one":"{count} día","other":"{count} días"},
  "{count} view|{count} views": {"one":"{count} visita","other":"{count} visitas"},
  "{count} visitor|{count} visitors": {"one":"{count} visitante","other":"{count} visitantes"},
  "Saved.": "Guardado.",
  "Analytics": "Analítica",
  "Range": "Intervalo",
  "Page views": "Páginas vistas",
  "Daily visitors, summed": "Visitantes diarios, sumados",
  "Views per day": "Visitas por día",
  "{from} to {to} (UTC)": "Del {from} al {to} (UTC)",
  "Views": "Visitas",
  "Visitors": "Visitantes",
  "Top pages": "Páginas principales",
  "No page views yet.": "Aún no hay páginas vistas.",
  "Path": "Ruta",
  "Top referrers": "Principales referentes",
  "No referred visits yet.": "Aún no hay visitas referidas.",
  "Domain": "Dominio",
  "How this is counted": "Cómo se cuenta",
  "No cookies, no stored IP addresses or user agents. A visitor is a hash of their address, browser and a random salt that changes every UTC day and is then deleted, so nobody — including you — can tell who visited, or link one day's visitors to the next. Browsers sending Do Not Track or Global Privacy Control are not counted at all, and neither are known bots.": "Sin cookies, sin direcciones IP ni agentes de usuario almacenados. Un visitante es un hash de su dirección, su navegador y una sal aleatoria que cambia cada día UTC y después se elimina, así que nadie —ni siquiera tú— puede saber quién visitó el sitio ni relacionar los visitantes de un día con los del siguiente. Los navegadores que envían Do Not Track o Global Privacy Control no se cuentan en absoluto, ni tampoco los bots conocidos.",
  "Your front end reports page views with a short snippet: {endpoint}. See {doc}.": "Tu front end informa de las páginas vistas con un fragmento breve: {endpoint}. Consulta {doc}.",
  "Count page views": "Contar páginas vistas",
  "Forget visitor hashes after (hours, 1–24)": "Olvidar los hashes de visitantes tras (horas, 1–24)",
  "Keep daily counts for (days, 0 = forever)": "Conservar los recuentos diarios durante (días, 0 = siempre)",
  "Save": "Guardar",
  "Views and visitors per day": "Visitas y visitantes por día",
  "{day}: {views}, {visitors}": "{day}: {views}, {visitors}"
}

export default strings
