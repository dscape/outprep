/**
 * Provider-agnostic Postgres connection for the pipeline CLI.
 *
 * Same wrapper as src/lib/db/connection.ts but for the CLI context
 * (runs via tsx, not Next.js). Reads DATABASE_URL from env
 * (loaded by cli.ts's loadEnvFile()).
 */

import postgres from "postgres";

const connectionString = process.env.DATABASE_URL;

const rawSql = connectionString
  ? postgres(connectionString, {
      max: 5,
      idle_timeout: 20,
      connect_timeout: 10,
    })
  : null;

/**
 * Tagged template wrapper that returns `{ rows }` to match the
 * @vercel/postgres API shape used throughout the codebase.
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
 */
export async function sqlTransaction<T>(
  fn: (sql: postgres.TransactionSql) => Promise<T>,
): Promise<T> {
  if (!rawSql) {
    throw new Error("DATABASE_URL is not configured");
  }
  return rawSql.begin(fn) as Promise<T>;
}

/**
 * Graceful shutdown.
 */
export async function closeSql(): Promise<void> {
  if (rawSql) await rawSql.end();
}
