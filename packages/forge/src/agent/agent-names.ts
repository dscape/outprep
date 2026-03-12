/**
 * Auto-generated chess grandmaster names for forge agents.
 */

const GRANDMASTER_NAMES = [
  "Tal", "Morphy", "Fischer", "Capablanca", "Alekhine",
  "Botvinnik", "Petrosian", "Spassky", "Karpov", "Kasparov",
  "Anand", "Carlsen", "Kramnik", "Topalov", "Euwe",
  "Smyslov", "Bronstein", "Korchnoi", "Nimzowitsch", "Reshevsky",
  "Fine", "Tartakower", "Rubinstein", "Pillsbury", "Lasker",
  "Steinitz", "Chigorin", "Zukertort", "Anderssen", "Philidor",
];

/**
 * Generate a unique chess grandmaster name for an agent.
 * If all names are taken, appends a number (e.g., "Tal-2").
 */
export function generateAgentName(existingNames: string[]): string {
  const taken = new Set(existingNames.map((n) => n.toLowerCase()));

  // Try to find an unused name
  const shuffled = [...GRANDMASTER_NAMES].sort(() => Math.random() - 0.5);
  for (const name of shuffled) {
    if (!taken.has(name.toLowerCase())) return name;
  }

  // All taken — find the name with the lowest available suffix
  for (let suffix = 2; ; suffix++) {
    for (const name of shuffled) {
      const candidate = `${name}-${suffix}`;
      if (!taken.has(candidate.toLowerCase())) return candidate;
    }
  }
}
