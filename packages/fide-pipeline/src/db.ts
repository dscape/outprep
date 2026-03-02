/**
 * Provider-agnostic Postgres connection for the pipeline CLI.
 *
 * Same wrapper as src/lib/db/connection.ts but for the CLI context
 * (runs via tsx, not Next.js). Reads DATABASE_URL from env
 * (loaded by cli.ts's loadEnvFile()).
 */

import postgres from "postgres";

let rawSql: postgres.Sql | null = null;

function getRawSql(): postgres.Sql {
  if (!rawSql) {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) {
      throw new Error("DATABASE_URL is not configured");
    }
    rawSql = postgres(connectionString, {
      max: 5,
      idle_timeout: 20,
      connect_timeout: 10,
    });
  }
  return rawSql;
}

/**
 * Tagged template wrapper that returns `{ rows }` to match the
 * @vercel/postgres API shape used throughout the codebase.
 */
export function sql(
  strings: TemplateStringsArray,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ...values: any[]
): Promise<{ rows: Record<string, unknown>[] }> {
  return getRawSql()(strings, ...values).then((result) => ({
    rows: Array.from(result) as Record<string, unknown>[],
  }));
}

/**
 * Execute a function inside a database transaction.
 * Auto-commits on success, auto-rolls back on error.
 */
export async function sqlTransaction<T>(
  // postgres.TransactionSql loses call signatures due to TypeScript's Omit behavior.
  // Using postgres.Sql preserves the tagged template literal call signature for callers.
  fn: (sql: postgres.Sql) => T | Promise<T>,
): Promise<T> {
  return getRawSql().begin(
    fn as unknown as (sql: postgres.TransactionSql) => T | Promise<T>,
  ) as Promise<T>;
}

/**
 * Graceful shutdown.
 */
export async function closeSql(): Promise<void> {
  if (rawSql) {
    await rawSql.end();
    rawSql = null;
  }
}
