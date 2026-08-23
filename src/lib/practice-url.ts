import type { Platform } from "./platform-utils";
import { TIME_RANGES } from "./profile-merge";

interface OpeningPracticeTarget {
  eco: string;
  name: string;
  profiledPlayerColor: "white" | "black";
}

interface PracticeUrlOptions {
  selectedSpeeds: string[];
  availableSpeeds: string[];
  timeRange: string;
  gameCount?: number;
  opening?: OpeningPracticeTarget;
  now?: number;
}

/** Build a play URL while preserving the active scouting filters. */
export function buildPracticeUrl(
  platform: Platform,
  username: string,
  options: PracticeUrlOptions,
): string {
  const params = new URLSearchParams();
  const allAvailableSpeedsSelected =
    options.availableSpeeds.length > 0 &&
    options.selectedSpeeds.length === options.availableSpeeds.length &&
    options.availableSpeeds.every((speed) =>
      options.selectedSpeeds.includes(speed)
    );

  if (options.selectedSpeeds.length > 0 && !allAvailableSpeedsSelected) {
    params.set("speeds", options.selectedSpeeds.join(","));
  }

  if (options.timeRange !== "all") {
    const range = TIME_RANGES.find((entry) => entry.key === options.timeRange);
    if (range?.ms) {
      params.set("since", String((options.now ?? Date.now()) - range.ms));
    }
  }

  if (options.gameCount && options.gameCount > 0) {
    params.set("gameCount", String(options.gameCount));
  }

  const range = TIME_RANGES.find((entry) => entry.key === options.timeRange);
  if (range) params.set("timeRangeLabel", range.label);

  if (options.opening) {
    params.set("eco", options.opening.eco);
    params.set("openingName", options.opening.name);
    params.set("color", options.opening.profiledPlayerColor);
  }

  const prefix = platform === "lichess" ? "" : `${platform}:`;
  const query = params.toString();
  return `/play/${prefix}${encodeURIComponent(username)}${query ? `?${query}` : ""}`;
}
