/**
 * IndexedDB-based persistent cache for client-side Stockfish eval results.
 *
 * Evals computed in the browser stay in the browser — never sent to the server.
 * This replaces sessionStorage for eval caching, surviving tab closes and restarts.
 *
 * DB: "outprep-evals", object store: "evals"
 * Key: `${platform}:${gameId}:${username}`
 */

import type { GameEvalData } from "../types";

const DB_NAME = "outprep-evals";
const DB_VERSION = 1;
const STORE_NAME = "evals";

export interface StoredEval {
  platform: string;
  gameId: string;
  username: string;
  playerColor: "white" | "black";
  moves: string;
  evals: number[];
  evalMode: string;
  createdAt: number;
}

function makeKey(platform: string, gameId: string, username: string): string {
  return `${platform}:${gameId}:${username.toLowerCase()}`;
}

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

/**
 * Retrieve stored evals for a set of game IDs.
 * Returns a Map of gameId → GameEvalData for games that have cached evals.
 */
export async function getStoredEvals(
  platform: string,
  username: string,
  gameIds: string[],
): Promise<Map<string, GameEvalData>> {
  const result = new Map<string, GameEvalData>();
  if (gameIds.length === 0) return result;

  try {
    const db = await openDB();
    const tx = db.transaction(STORE_NAME, "readonly");
    const store = tx.objectStore(STORE_NAME);

    const promises = gameIds.map(
      (gameId) =>
        new Promise<void>((resolve) => {
          const key = makeKey(platform, gameId, username);
          const req = store.get(key);
          req.onsuccess = () => {
            const val = req.result as StoredEval | undefined;
            if (val) {
              result.set(gameId, {
                moves: val.moves,
                playerColor: val.playerColor,
                evals: val.evals,
              });
            }
            resolve();
          };
          req.onerror = () => resolve(); // Skip failed lookups
        }),
    );

    await Promise.all(promises);
    db.close();
  } catch {
    // IndexedDB unavailable — return empty map
  }

  return result;
}

/**
 * Store a batch of eval results in IndexedDB.
 */
export async function storeEvals(
  platform: string,
  username: string,
  evals: Array<{ gameId: string; data: GameEvalData; evalMode: string }>,
): Promise<void> {
  if (evals.length === 0) return;

  try {
    const db = await openDB();
    const tx = db.transaction(STORE_NAME, "readwrite");
    const store = tx.objectStore(STORE_NAME);

    for (const entry of evals) {
      const key = makeKey(platform, entry.gameId, username);
      const stored: StoredEval = {
        platform,
        gameId: entry.gameId,
        username: username.toLowerCase(),
        playerColor: entry.data.playerColor,
        moves: entry.data.moves,
        evals: entry.data.evals,
        evalMode: entry.evalMode,
        createdAt: Date.now(),
      };
      store.put(stored, key);
    }

    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });

    db.close();
  } catch {
    // IndexedDB write failure — non-fatal
  }
}
