#!/usr/bin/env node

/**
 * Admin CLI for managing online player ↔ FIDE player links.
 *
 * Usage:
 *   npx tsx packages/fide-pipeline/src/admin-links.ts pending
 *   npx tsx packages/fide-pipeline/src/admin-links.ts approve <linkId> [--notes "..."]
 *   npx tsx packages/fide-pipeline/src/admin-links.ts reject <linkId> [--notes "..."]
 *   npx tsx packages/fide-pipeline/src/admin-links.ts revoke <linkId> [--notes "..."]
 *   npx tsx packages/fide-pipeline/src/admin-links.ts list <fideId>
 */

import { Command } from "commander";
import { sql } from "./db";

const program = new Command();
program.name("admin-links").description("Manage online ↔ FIDE player links");

program
  .command("pending")
  .description("List pending link suggestions")
  .option("-l, --limit <n>", "max results", "50")
  .action(async (opts) => {
    const { rows } = await sql`
      SELECT l.id, l.suggested_by, l.suggested_at,
             op.platform, op.username,
             p.fide_id, p.name AS player_name
      FROM online_player_links l
      JOIN online_players op ON op.id = l.online_player_id
      JOIN players p ON p.id = l.player_id
      WHERE l.status = 'pending'
      ORDER BY l.suggested_at DESC
      LIMIT ${parseInt(opts.limit)}
    `;
    if (rows.length === 0) {
      console.log("No pending suggestions.");
      return;
    }
    console.log(`\n${rows.length} pending suggestion(s):\n`);
    for (const r of rows) {
      console.log(
        `  [${r.id}] ${r.username} (${r.platform}) → ${r.player_name} (FIDE ${r.fide_id})` +
          `  — suggested by ${r.suggested_by ?? "unknown"} at ${r.suggested_at}`,
      );
    }
    console.log("");
  });

for (const action of ["approve", "reject", "revoke"] as const) {
  program
    .command(`${action} <linkId>`)
    .description(`${action.charAt(0).toUpperCase() + action.slice(1)} a link suggestion`)
    .option("-n, --notes <text>", "reviewer notes")
    .action(async (linkId: string, opts: { notes?: string }) => {
      const id = parseInt(linkId);
      if (isNaN(id)) {
        console.error("Invalid link ID");
        process.exit(1);
      }
      const status = action === "approve" ? "approved" : action === "reject" ? "rejected" : "revoked";
      const { rows } = await sql`
        UPDATE online_player_links
        SET status = ${status},
            reviewed_by = 'cli',
            reviewed_at = NOW(),
            notes = ${opts.notes ?? null}
        WHERE id = ${id}
        RETURNING id
      `;
      if (rows.length === 0) {
        console.error(`Link ${id} not found.`);
        process.exit(1);
      }
      console.log(`Link ${id} ${status}.`);
    });
}

program
  .command("list <fideId>")
  .description("List all links for a FIDE player")
  .action(async (fideId: string) => {
    const { rows } = await sql`
      SELECT l.id, l.status, l.suggested_at, l.reviewed_at, l.notes,
             op.platform, op.username,
             p.name AS player_name
      FROM online_player_links l
      JOIN online_players op ON op.id = l.online_player_id
      JOIN players p ON p.id = l.player_id
      WHERE p.fide_id = ${fideId}
      ORDER BY l.suggested_at DESC
    `;
    if (rows.length === 0) {
      console.log(`No links for FIDE ID ${fideId}.`);
      return;
    }
    console.log(`\nLinks for FIDE ${fideId} (${rows[0].player_name}):\n`);
    for (const r of rows) {
      const reviewed = r.reviewed_at ? ` — reviewed ${r.reviewed_at}` : "";
      const notes = r.notes ? ` (${r.notes})` : "";
      console.log(
        `  [${r.id}] ${r.username} (${r.platform}) — ${r.status}${reviewed}${notes}`,
      );
    }
    console.log("");
  });

program.parseAsync().then(() => process.exit(0));
