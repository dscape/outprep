/**
 * Browser-safe game slug generation.
 * Mirrors the pipeline's generateGameSlug() logic without Node.js dependencies.
 */

function slugify(str: string): string {
  return str
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

function parseLastName(name: string): string {
  const commaIdx = name.indexOf(",");
  if (commaIdx === -1) return name.trim();
  return name.slice(0, commaIdx).trim();
}

/**
 * Generate a game page slug from PGN header data.
 *
 * Format: {event-slug}[-r{round}]-{year}/{white-lastname}-{whiteFideId}-vs-{black-lastname}-{blackFideId}
 * Fallback: {white-lastname}-{whiteFideId}-vs-{black-lastname}-{blackFideId}
 */
export function generateGameSlug(
  whiteName: string,
  blackName: string,
  event: string | null,
  date: string | null,
  round: string | null,
  whiteFideId: string,
  blackFideId: string
): string {
  const wLast = parseLastName(whiteName);
  const bLast = parseLastName(blackName);
  const matchup = slugify(`${wLast} ${whiteFideId} vs ${bLast} ${blackFideId}`);

  if (event && date) {
    const year = date.split(".")[0] || "";
    const eventWords = event.split(/\s+/).slice(0, 6).join(" ");
    const eventParts = [eventWords];

    if (round && round !== "?" && round !== "-") {
      eventParts.push("r" + round.replace(/\./g, "-"));
    }
    if (year) eventParts.push(year);

    return `${slugify(eventParts.join(" "))}/${matchup}`;
  }

  return matchup;
}
