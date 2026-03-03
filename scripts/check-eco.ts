import fs from 'fs';
import { parseAllPGNGames } from '../src/lib/pgn-parser';
import { analyzeOTBGames } from '../src/lib/otb-analyzer';

const raw: string[] = JSON.parse(fs.readFileSync('packages/fide-pipeline/data/processed/games/magnus-carlsen-1503014.json', 'utf8'));
const combinedPgn = raw.join('\n\n');
const games = parseAllPGNGames(combinedPgn);
const profile = analyzeOTBGames(games, 'Carlsen, Magnus');

// Check all bySpeed white openings for missing ECO
for (const [speed, sp] of Object.entries(profile.bySpeed || {})) {
  const white = sp.openings?.white || [];
  const noEco = white.filter((o: any) => !o.eco);
  if (noEco.length > 0) {
    console.log(`${speed}: ${noEco.length} missing ECO`);
    for (const o of noEco) {
      console.log(`  - "${o.name}" (${o.games} games)`);
    }
  }
}

// Check top-level openings too
const topNoEco = (profile.openings?.white || []).filter((o: any) => !o.eco);
if (topNoEco.length > 0) {
  console.log(`top-level: ${topNoEco.length} missing ECO`);
  for (const o of topNoEco) {
    console.log(`  - "${o.name}" (${o.games} games)`);
  }
}

if (topNoEco.length === 0) {
  console.log('All white openings have ECO codes!');
}
