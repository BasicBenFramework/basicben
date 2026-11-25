import type { Dictionary } from '../../../client/i18n/index.ts'

/** German for the analytics feature. Merged over the admin's own dictionary. */
const strings: Dictionary = {
  "{count} day|{count} days": {"one":"{count} Tag","other":"{count} Tage"},
  "{count} view|{count} views": {"one":"{count} Aufruf","other":"{count} Aufrufe"},
  "{count} visitor|{count} visitors": {"one":"{count} Besucher","other":"{count} Besucher"},
  "Saved.": "Gespeichert.",
  "Analytics": "Statistiken",
  "Range": "Zeitraum",
  "Page views": "Seitenaufrufe",
  "Daily visitors, summed": "Tägliche Besucher, summiert",
  "Views per day": "Aufrufe pro Tag",
  "{from} to {to} (UTC)": "{from} bis {to} (UTC)",
  "Views": "Aufrufe",
  "Visitors": "Besucher",
  "Top pages": "Meistbesuchte Seiten",
  "No page views yet.": "Noch keine Seitenaufrufe.",
  "Path": "Pfad",
  "Top referrers": "Häufigste Verweisquellen",
  "No referred visits yet.": "Noch keine Besuche über Verweise.",
  "Domain": "Domain",
  "How this is counted": "So wird gezählt",
  "No cookies, no stored IP addresses or user agents. A visitor is a hash of their address, browser and a random salt that changes every UTC day and is then deleted, so nobody — including you — can tell who visited, or link one day's visitors to the next. Browsers sending Do Not Track or Global Privacy Control are not counted at all, and neither are known bots.": "Keine Cookies, keine gespeicherten IP-Adressen oder User-Agents. Ein Besucher ist ein Hash aus Adresse, Browser und einem zufälligen Salt, der sich jeden UTC-Tag ändert und danach gelöscht wird – so kann niemand, auch Sie nicht, erkennen, wer die Website besucht hat, oder die Besucher eines Tages mit denen des nächsten verknüpfen. Browser, die Do Not Track oder Global Privacy Control senden, werden gar nicht gezählt, ebenso wenig bekannte Bots.",
  "Your front end reports page views with a short snippet: {endpoint}. See {doc}.": "Ihr Frontend meldet Seitenaufrufe mit einem kurzen Code-Schnipsel: {endpoint}. Siehe {doc}.",
  "Count page views": "Seitenaufrufe zählen",
  "Forget visitor hashes after (hours, 1–24)": "Besucher-Hashes vergessen nach (Stunden, 1–24)",
  "Keep daily counts for (days, 0 = forever)": "Tageszahlen aufbewahren für (Tage, 0 = unbegrenzt)",
  "Save": "Speichern",
  "Views and visitors per day": "Aufrufe und Besucher pro Tag",
  "{day}: {views}, {visitors}": "{day}: {views}, {visitors}"
}

export default strings
