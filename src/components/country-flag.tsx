import { fideToIso } from "../../packages/fide-pipeline/src/federation-codes";

/** Convert a 2-letter ISO country code to its emoji flag via Regional Indicator Symbols. */
function isoToEmoji(iso: string): string {
  return [...iso.toUpperCase()]
    .map((c) => String.fromCodePoint(0x1f1e6 + c.charCodeAt(0) - 65))
    .join("");
}

interface CountryFlagProps {
  federation: string;
  showCode?: boolean;
  className?: string;
}

export function CountryFlag({
  federation,
  showCode = false,
  className,
}: CountryFlagProps) {
  const iso = fideToIso(federation);
  if (!iso) {
    return showCode ? <span className={className}>{federation}</span> : null;
  }

  const emoji = isoToEmoji(iso);
  return (
    <span className={className} title={federation}>
      {emoji}
      {showCode && <span className="ml-1">{federation}</span>}
    </span>
  );
}
