/**
 * Maps opening family names to Lichess puzzle training URLs.
 *
 * Lichess offers opening-specific puzzle training at
 * https://lichess.org/training/{Slug}.  This module converts our opening
 * names into the slug format Lichess expects and validates them against
 * a known set of available training pages.
 */

/** Convert an opening family name to a Lichess training slug. */
function toLichessSlug(familyName: string): string {
  return familyName
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "") // strip diacritics (Grünfeld → Grunfeld)
    .replace(/'/g, "")               // remove apostrophes (King's → Kings)
    .replace(/\s+/g, "_");           // spaces → underscores
}

/** Known valid Lichess training opening slugs (scraped from lichess.org/training/openings). */
const VALID_SLUGS = new Set([
  "Alekhine_Defense",
  "Amar_Opening",
  "Amazon_Attack",
  "Anderssens_Opening",
  "Barnes_Defense",
  "Barnes_Opening",
  "Benko_Gambit",
  "Benko_Gambit_Accepted",
  "Benko_Gambit_Declined",
  "Benoni_Defense",
  "Bird_Opening",
  "Bishops_Opening",
  "Blackmar-Diemer_Gambit",
  "Blackmar-Diemer_Gambit_Accepted",
  "Blackmar-Diemer_Gambit_Declined",
  "Blumenfeld_Countergambit",
  "Bogo-Indian_Defense",
  "Borg_Defense",
  "Canard_Opening",
  "Caro-Kann_Defense",
  "Carr_Defense",
  "Catalan_Opening",
  "Center_Game",
  "Center_Game_Accepted",
  "Clemenz_Opening",
  "Czech_Defense",
  "Danish_Gambit",
  "Danish_Gambit_Accepted",
  "Danish_Gambit_Declined",
  "Duras_Gambit",
  "Dutch_Defense",
  "East_Indian_Defense",
  "Elephant_Gambit",
  "English_Defense",
  "English_Opening",
  "Englund_Gambit",
  "Englund_Gambit_Declined",
  "Four_Knights_Game",
  "French_Defense",
  "Fried_Fox_Defense",
  "Goldsmith_Defense",
  "Grob_Opening",
  "Grunfeld_Defense",
  "Gunderam_Defense",
  "Hippopotamus_Defense",
  "Horwitz_Defense",
  "Hungarian_Opening",
  "Indian_Defense",
  "Italian_Game",
  "Kadas_Opening",
  "Kangaroo_Defense",
  "Kings_Gambit",
  "Kings_Gambit_Accepted",
  "Kings_Gambit_Declined",
  "Kings_Indian_Attack",
  "Kings_Indian_Defense",
  "Kings_Knight_Opening",
  "Kings_Pawn_Game",
  "Kings_Pawn_Opening",
  "Lasker_Simul_Special",
  "Latvian_Gambit",
  "Latvian_Gambit_Accepted",
  "Lemming_Defense",
  "Lion_Defense",
  "London_System",
  "Mexican_Defense",
  "Mieses_Opening",
  "Mikenas_Defense",
  "Modern_Defense",
  "Neo-Grunfeld_Defense",
  "Nimzo-Indian_Defense",
  "Nimzo-Larsen_Attack",
  "Nimzowitsch_Defense",
  "Old_Indian_Defense",
  "Owen_Defense",
  "Paleface_Attack",
  "Petrovs_Defense",
  "Philidor_Defense",
  "Pirc_Defense",
  "Polish_Defense",
  "Polish_Opening",
  "Ponziani_Opening",
  "Portuguese_Opening",
  "Pseudo_Queens_Indian_Defense",
  "Pterodactyl_Defense",
  "Queens_Gambit",
  "Queens_Gambit_Accepted",
  "Queens_Gambit_Declined",
  "Queens_Indian_Accelerated",
  "Queens_Indian_Defense",
  "Queens_Pawn_Game",
  "Rapport-Jobava_System",
  "Rat_Defense",
  "Reti_Opening",
  "Richter-Veresov_Attack",
  "Robatsch_Defense",
  "Rubinstein_Opening",
  "Ruy_Lopez",
  "Saragossa_Opening",
  "Scandinavian_Defense",
  "Scotch_Game",
  "Semi-Slav_Defense",
  "Semi-Slav_Defense_Accepted",
  "Sicilian_Defense",
  "Slav_Defense",
  "Slav_Indian",
  "Sodium_Attack",
  "St_George_Defense",
  "Tarrasch_Defense",
  "Three_Knights_Opening",
  "Torre_Attack",
  "Trompowsky_Attack",
  "Van_Geet_Opening",
  "Vant_Kruijs_Opening",
  "Vienna_Game",
  "Wade_Defense",
  "Ware_Defense",
  "Ware_Opening",
  "Yusupov-Rubinstein_System",
  "Zukertort_Opening",
]);

/**
 * Get the Lichess puzzle training URL for an opening, or null if unavailable.
 *
 * Accepts either a full opening name ("Sicilian Defense: Dragon Variation")
 * or an already-extracted family name ("Sicilian Defense").
 */
export function getLichessTrainingUrl(openingName: string): string | null {
  const colonIdx = openingName.indexOf(":");
  const family =
    colonIdx > 0 ? openingName.substring(0, colonIdx).trim() : openingName.trim();
  const slug = toLichessSlug(family);
  if (VALID_SLUGS.has(slug)) {
    return `https://lichess.org/training/${slug}`;
  }
  return null;
}
