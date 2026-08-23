import { createHash } from "node:crypto";

export interface ExistingEventSlug {
  name: string;
  slug: string;
}

const MAX_SLUG_LENGTH = 120;

/** Generate the canonical URL slug for an event name. */
export function generateEventSlug(eventName: string): string {
  const slug = eventName
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, MAX_SLUG_LENGTH);

  return slug || `event-${eventNameHash(eventName)}`;
}

/**
 * Assign stable, unique slugs to event names without changing existing URLs.
 * Names that normalize to an occupied slug receive a deterministic hash suffix.
 */
export function assignEventSlugs(
  eventNames: string[],
  existingEvents: ExistingEventSlug[],
): Map<string, string> {
  const slugOwner = new Map<string, string>();
  const existingSlugByName = new Map<string, string>();

  for (const event of [...existingEvents].sort((a, b) =>
    a.slug.localeCompare(b.slug),
  )) {
    const existingSlug = existingSlugByName.get(event.name);
    if (existingSlug && existingSlug !== event.slug) {
      throw new Error(`Event name has multiple slugs: ${event.name}`);
    }

    const existingOwner = slugOwner.get(event.slug);
    if (existingOwner && existingOwner !== event.name) {
      throw new Error(`Event slug has multiple owners: ${event.slug}`);
    }

    existingSlugByName.set(event.name, event.slug);
    slugOwner.set(event.slug, event.name);
  }

  const assignments = new Map<string, string>();
  const uniqueNames = [...new Set(eventNames)].sort((a, b) =>
    a.localeCompare(b),
  );

  for (const name of uniqueNames) {
    const existingSlug = existingSlugByName.get(name);
    if (existingSlug) {
      assignments.set(name, existingSlug);
      continue;
    }

    const baseSlug = generateEventSlug(name);
    let slug = baseSlug;
    let attempt = 0;

    while (slugOwner.has(slug) && slugOwner.get(slug) !== name) {
      slug = disambiguateSlug(baseSlug, name, attempt++);
    }

    assignments.set(name, slug);
    slugOwner.set(slug, name);
  }

  return assignments;
}

function disambiguateSlug(
  baseSlug: string,
  eventName: string,
  attempt: number,
): string {
  const suffix = eventNameHash(`${eventName}:${attempt}`);
  const stemLength = MAX_SLUG_LENGTH - suffix.length - 1;
  return `${baseSlug.slice(0, stemLength)}-${suffix}`;
}

function eventNameHash(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 10);
}
