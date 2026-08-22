import config from "../../../config/excluded-fide-ids.json";

const ids = config.fideIds.map(String);
for (const id of ids) {
  if (!/^\d+$/.test(id)) {
    throw new Error(`Invalid excluded FIDE ID: ${id}`);
  }
}

export const EXCLUDED_FIDE_IDS = Object.freeze(Array.from(new Set(ids)));
const excludedFideIds = new Set(EXCLUDED_FIDE_IDS);

export function isExcludedFideId(fideId: string | null | undefined): boolean {
  return !!fideId && excludedFideIds.has(fideId);
}

export function hasExcludedFidePlayer(game: {
  whiteFideId?: string | null;
  blackFideId?: string | null;
}): boolean {
  return isExcludedFideId(game.whiteFideId) || isExcludedFideId(game.blackFideId);
}

export function slugContainsExcludedFideId(slug: string): boolean {
  return EXCLUDED_FIDE_IDS.some((id) =>
    new RegExp(`(?:^|[-/])${id}(?:$|-)`).test(slug),
  );
}
