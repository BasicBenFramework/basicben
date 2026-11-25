import type { Dictionary } from '../../../client/i18n/index.ts'

/** French for the analytics feature. Merged over the admin's own dictionary. */
const strings: Dictionary = {
  "{count} day|{count} days": {"one":"{count} jour","other":"{count} jours"},
  "{count} view|{count} views": {"one":"{count} vue","other":"{count} vues"},
  "{count} visitor|{count} visitors": {"one":"{count} visiteur","other":"{count} visiteurs"},
  "Saved.": "Enregistré.",
  "Analytics": "Statistiques",
  "Range": "Période",
  "Page views": "Pages vues",
  "Daily visitors, summed": "Visiteurs quotidiens, additionnés",
  "Views per day": "Vues par jour",
  "{from} to {to} (UTC)": "Du {from} au {to} (UTC)",
  "Views": "Vues",
  "Visitors": "Visiteurs",
  "Top pages": "Pages les plus vues",
  "No page views yet.": "Aucune page vue pour l’instant.",
  "Path": "Chemin",
  "Top referrers": "Principaux référents",
  "No referred visits yet.": "Aucune visite référée pour l’instant.",
  "Domain": "Domaine",
  "How this is counted": "Comment c’est compté",
  "No cookies, no stored IP addresses or user agents. A visitor is a hash of their address, browser and a random salt that changes every UTC day and is then deleted, so nobody — including you — can tell who visited, or link one day's visitors to the next. Browsers sending Do Not Track or Global Privacy Control are not counted at all, and neither are known bots.": "Aucun cookie, aucune adresse IP ni aucun user agent stockés. Un visiteur est un hash de son adresse, de son navigateur et d’un sel aléatoire qui change chaque jour UTC puis est supprimé : personne, pas même vous, ne peut savoir qui a visité le site ni relier les visiteurs d’un jour à ceux du lendemain. Les navigateurs qui envoient Do Not Track ou Global Privacy Control ne sont pas comptés du tout, pas plus que les robots connus.",
  "Your front end reports page views with a short snippet: {endpoint}. See {doc}.": "Votre front end signale les pages vues avec un court extrait de code : {endpoint}. Consultez {doc}.",
  "Count page views": "Compter les pages vues",
  "Forget visitor hashes after (hours, 1–24)": "Oublier les hashs des visiteurs après (heures, 1–24)",
  "Keep daily counts for (days, 0 = forever)": "Conserver les décomptes quotidiens pendant (jours, 0 = toujours)",
  "Save": "Enregistrer",
  "Views and visitors per day": "Vues et visiteurs par jour",
  "{day}: {views}, {visitors}": "{day} : {views}, {visitors}"
}

export default strings
