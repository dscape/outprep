import config from "../../config/excluded-fide-ids.json";

function validateFideIds(value: unknown): string[] {
  if (!Array.isArray(value)) {
    throw new Error("config/excluded-fide-ids.json must contain a fideIds array");
  }

  const ids = value.map(String);
  for (const id of ids) {
    if (!/^\d+$/.test(id)) {
      throw new Error(`Invalid excluded FIDE ID: ${id}`);
    }
  }

  return Array.from(new Set(ids));
}

export const EXCLUDED_FIDE_IDS = Object.freeze(
  validateFideIds(config.fideIds),
);

const excludedFideIds = new Set(EXCLUDED_FIDE_IDS);

export function isExcludedFideId(fideId: string | null | undefined): boolean {
  return !!fideId && excludedFideIds.has(fideId);
}

export function fideIdFromSlug(slug: string): string | null {
  let decoded = slug;
  try {
    decoded = decodeURIComponent(slug);
  } catch {
    // Malformed URL escapes are not valid FIDE slugs.
  }
  const match = decoded.match(/(?:^|-)(\d{4,})$/);
  return match?.[1] ?? null;
}

export function isExcludedFideSlug(slug: string): boolean {
  return isExcludedFideId(fideIdFromSlug(slug));
}

export function hasExcludedFideId(
  whiteFideId: string | null | undefined,
  blackFideId: string | null | undefined,
): boolean {
  return isExcludedFideId(whiteFideId) || isExcludedFideId(blackFideId);
}

export function slugContainsExcludedFideId(slug: string): boolean {
  return EXCLUDED_FIDE_IDS.some((id) =>
    new RegExp(`(?:^|[-/])${id}(?:$|-)`).test(slug),
  );
}
