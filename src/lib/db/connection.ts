/**
 * Provider-agnostic Postgres connection.
 *
 * Uses the 'postgres' (porsager) package which works with any Postgres host
 * (Neon, Supabase, Railway, local Docker, etc.). Zero vendor lock-in.
 *
 * Exports a `sql` tagged template wrapper that returns `{ rows }` to match
 * the @vercel/postgres API shape — so all existing query callsites stay unchanged.
 *
 * DATABASE_URL should be a standard connection string:
 *   postgres://user:pass@host:5432/dbname?sslmode=require
 */

import postgres from "postgres";

const connectionString = process.env.DATABASE_URL;

/**
 * Raw postgres client instance.
 * Only created if DATABASE_URL is set (null during build or local dev without Docker).
 */
const rawSql = connectionString
  ? postgres(connectionString, {
      max: 10,
      idle_timeout: 20,
      connect_timeout: 10,
    })
  : null;

/**
 * Tagged template wrapper that returns `{ rows }` to match the
 * @vercel/postgres API shape used throughout the codebase.
 *
 * Usage (unchanged from before):
 *   const { rows } = await sql`SELECT * FROM players WHERE slug = ${slug}`;
 */
export function sql(
  strings: TemplateStringsArray,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ...values: any[]
): Promise<{ rows: Record<string, unknown>[] }> {
  if (!rawSql) {
    throw new Error("DATABASE_URL is not configured");
  }
  return rawSql(strings, ...values).then((result) => ({
    rows: Array.from(result) as Record<string, unknown>[],
  }));
}

/**
 * Execute a function inside a database transaction.
 * Auto-commits on success, auto-rolls back on error.
 *
 * Replaces the manual BEGIN/COMMIT/ROLLBACK pattern:
 *   await sqlTransaction(async (tx) => {
 *     await tx`INSERT INTO ...`;
 *     await tx`INSERT INTO ...`;
 *   });
 */
export async function sqlTransaction<T>(
  // postgres.TransactionSql loses call signatures due to TypeScript's Omit behavior.
  // Using postgres.Sql preserves the tagged template literal call signature for callers.
  fn: (sql: postgres.Sql) => T | Promise<T>,
): Promise<T> {
  if (!rawSql) {
    throw new Error("DATABASE_URL is not configured");
  }
  return rawSql.begin(
    fn as unknown as (sql: postgres.TransactionSql) => T | Promise<T>,
  ) as Promise<T>;
}

/**
 * Graceful shutdown — call from process exit handlers if needed.
 */
export async function closeSql(): Promise<void> {
  if (rawSql) await rawSql.end();
}
