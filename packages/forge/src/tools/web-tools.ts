/**
 * Web tools for forge agents — search and fetch web content.
 *
 * Provides `forge.web.search()` and `forge.web.fetch()` so agents
 * can look up chess programming papers, documentation, and techniques.
 *
 * Search backend:
 *   - Brave Search API when BRAVE_SEARCH_API_KEY is set
 *   - Falls back to a simple DuckDuckGo HTML scrape otherwise
 *
 * Fetch:
 *   - Retrieves a URL with a browser-like User-Agent
 *   - Strips HTML to markdown-ish plain text
 *   - Truncates to a reasonable token budget
 */

/* ── Public types ──────────────────────────────────────────── */

export interface SearchResult {
  title: string;
  url: string;
  snippet: string;
}

export interface WebTools {
  /** Search the web for relevant information */
  search(query: string): Promise<SearchResult[]>;
  /** Fetch a URL and extract text content (HTML → markdown) */
  fetch(url: string, prompt?: string): Promise<string>;
}

/* ── Constants ─────────────────────────────────────────────── */

const USER_AGENT =
  "Mozilla/5.0 (compatible; OutprepForgeBot/1.0; +https://github.com/outprep)";

const FETCH_TIMEOUT_MS = 15_000;
const MAX_CONTENT_LENGTH = 10_000;
const MAX_SEARCH_RESULTS = 10;

/* ── HTML → text conversion ────────────────────────────────── */

/**
 * Lightweight HTML-to-markdown converter.  No external dependencies —
 * uses regex passes to strip noise and preserve structure.
 */
function htmlToText(html: string): string {
  let text = html;

  // Remove scripts, styles, nav, header, footer, aside elements
  text = text.replace(/<script[\s\S]*?<\/script>/gi, "");
  text = text.replace(/<style[\s\S]*?<\/style>/gi, "");
  text = text.replace(/<nav[\s\S]*?<\/nav>/gi, "");
  text = text.replace(/<header[\s\S]*?<\/header>/gi, "");
  text = text.replace(/<footer[\s\S]*?<\/footer>/gi, "");
  text = text.replace(/<aside[\s\S]*?<\/aside>/gi, "");
  text = text.replace(/<noscript[\s\S]*?<\/noscript>/gi, "");
  text = text.replace(/<svg[\s\S]*?<\/svg>/gi, "");

  // Convert headings
  text = text.replace(/<h1[^>]*>([\s\S]*?)<\/h1>/gi, "\n# $1\n");
  text = text.replace(/<h2[^>]*>([\s\S]*?)<\/h2>/gi, "\n## $1\n");
  text = text.replace(/<h3[^>]*>([\s\S]*?)<\/h3>/gi, "\n### $1\n");
  text = text.replace(/<h4[^>]*>([\s\S]*?)<\/h4>/gi, "\n#### $1\n");
  text = text.replace(/<h5[^>]*>([\s\S]*?)<\/h5>/gi, "\n##### $1\n");
  text = text.replace(/<h6[^>]*>([\s\S]*?)<\/h6>/gi, "\n###### $1\n");

  // Convert links: <a href="url">text</a> → [text](url)
  text = text.replace(/<a\s[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi, "[$2]($1)");

  // Convert emphasis
  text = text.replace(/<(strong|b)[^>]*>([\s\S]*?)<\/\1>/gi, "**$2**");
  text = text.replace(/<(em|i)[^>]*>([\s\S]*?)<\/\1>/gi, "*$2*");
  text = text.replace(/<code[^>]*>([\s\S]*?)<\/code>/gi, "`$1`");

  // Convert list items
  text = text.replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, "- $1\n");

  // Convert paragraphs and line breaks
  text = text.replace(/<br\s*\/?>/gi, "\n");
  text = text.replace(/<\/p>/gi, "\n\n");
  text = text.replace(/<\/div>/gi, "\n");
  text = text.replace(/<\/tr>/gi, "\n");
  text = text.replace(/<\/td>/gi, " | ");
  text = text.replace(/<\/th>/gi, " | ");

  // Convert pre/code blocks
  text = text.replace(/<pre[^>]*>([\s\S]*?)<\/pre>/gi, "\n```\n$1\n```\n");

  // Convert blockquotes
  text = text.replace(/<blockquote[^>]*>([\s\S]*?)<\/blockquote>/gi, "\n> $1\n");

  // Strip remaining HTML tags
  text = text.replace(/<[^>]+>/g, "");

  // Decode common HTML entities
  text = text.replace(/&amp;/g, "&");
  text = text.replace(/&lt;/g, "<");
  text = text.replace(/&gt;/g, ">");
  text = text.replace(/&quot;/g, '"');
  text = text.replace(/&#039;/g, "'");
  text = text.replace(/&apos;/g, "'");
  text = text.replace(/&nbsp;/g, " ");
  text = text.replace(/&#(\d+);/g, (_, code) =>
    String.fromCharCode(parseInt(code, 10)),
  );

  // Collapse whitespace
  text = text.replace(/[ \t]+/g, " ");
  text = text.replace(/\n{3,}/g, "\n\n");
  text = text.trim();

  return text;
}

/* ── Brave Search ──────────────────────────────────────────── */

interface BraveWebResult {
  title?: string;
  url?: string;
  description?: string;
}

async function searchBrave(
  query: string,
  apiKey: string,
): Promise<SearchResult[]> {
  const url = `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=${MAX_SEARCH_RESULTS}`;

  const response = await fetch(url, {
    headers: {
      Accept: "application/json",
      "Accept-Encoding": "gzip",
      "X-Subscription-Token": apiKey,
    },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });

  if (!response.ok) {
    throw new Error(
      `Brave Search API returned ${response.status}: ${response.statusText}`,
    );
  }

  const data = (await response.json()) as {
    web?: { results?: BraveWebResult[] };
  };
  const results = data.web?.results ?? [];

  return results
    .filter(
      (r): r is Required<Pick<BraveWebResult, "title" | "url">> & BraveWebResult =>
        Boolean(r.title && r.url),
    )
    .slice(0, MAX_SEARCH_RESULTS)
    .map((r) => ({
      title: r.title,
      url: r.url,
      snippet: r.description ?? "",
    }));
}

/* ── DuckDuckGo fallback ───────────────────────────────────── */

async function searchDuckDuckGo(query: string): Promise<SearchResult[]> {
  // Use the DuckDuckGo HTML search page and parse results.
  // This is a best-effort fallback — no API key required.
  const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;

  const response = await fetch(url, {
    headers: { "User-Agent": USER_AGENT },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });

  if (!response.ok) {
    throw new Error(
      `DuckDuckGo search returned ${response.status}: ${response.statusText}`,
    );
  }

  const html = await response.text();
  const results: SearchResult[] = [];

  // Parse result blocks: <a class="result__a" href="...">title</a>
  // and <a class="result__snippet" ...>snippet</a>
  const resultBlocks = html.split(/class="result\s/);

  for (const block of resultBlocks.slice(1)) {
    // Extract URL from result__a link
    const urlMatch = block.match(
      /class="result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/,
    );
    if (!urlMatch) continue;

    let resultUrl = urlMatch[1];
    const title = urlMatch[2].replace(/<[^>]+>/g, "").trim();

    // DuckDuckGo wraps URLs in a redirect — extract the real URL
    const uddgMatch = resultUrl.match(/uddg=([^&]+)/);
    if (uddgMatch) {
      resultUrl = decodeURIComponent(uddgMatch[1]);
    }

    // Extract snippet
    const snippetMatch = block.match(
      /class="result__snippet"[^>]*>([\s\S]*?)<\/a>/,
    );
    const snippet = snippetMatch
      ? snippetMatch[1].replace(/<[^>]+>/g, "").trim()
      : "";

    if (title && resultUrl) {
      results.push({ title, url: resultUrl, snippet });
    }

    if (results.length >= MAX_SEARCH_RESULTS) break;
  }

  return results;
}

/* ── URL fetcher ───────────────────────────────────────────── */

async function fetchUrl(url: string): Promise<string> {
  const response = await fetch(url, {
    headers: {
      "User-Agent": USER_AGENT,
      Accept: "text/html,application/xhtml+xml,text/plain,application/json",
    },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    redirect: "follow",
  });

  if (!response.ok) {
    throw new Error(`Fetch failed: ${response.status} ${response.statusText}`);
  }

  const contentType = response.headers.get("content-type") ?? "";
  const raw = await response.text();

  // If it's already plain text or JSON, return as-is (truncated)
  if (
    contentType.includes("text/plain") ||
    contentType.includes("application/json")
  ) {
    return raw.slice(0, MAX_CONTENT_LENGTH);
  }

  // HTML → text
  const text = htmlToText(raw);
  return text.slice(0, MAX_CONTENT_LENGTH);
}

/* ── Factory ───────────────────────────────────────────────── */

export function createWebTools(): WebTools {
  return {
    async search(query: string): Promise<SearchResult[]> {
      if (!query || query.trim().length === 0) {
        throw new Error("Search query cannot be empty");
      }

      const braveKey = process.env.BRAVE_SEARCH_API_KEY;

      try {
        if (braveKey) {
          return await searchBrave(query, braveKey);
        }
        return await searchDuckDuckGo(query);
      } catch (err) {
        const message =
          err instanceof Error ? err.message : String(err);
        // If Brave fails and we have a key, try DuckDuckGo as fallback
        if (braveKey) {
          console.warn(
            `[forge.web.search] Brave Search failed (${message}), falling back to DuckDuckGo`,
          );
          try {
            return await searchDuckDuckGo(query);
          } catch (fallbackErr) {
            const fallbackMessage =
              fallbackErr instanceof Error
                ? fallbackErr.message
                : String(fallbackErr);
            throw new Error(
              `Web search failed: Brave (${message}), DuckDuckGo (${fallbackMessage})`,
            );
          }
        }
        throw new Error(`Web search failed: ${message}`);
      }
    },

    async fetch(url: string, _prompt?: string): Promise<string> {
      if (!url || url.trim().length === 0) {
        throw new Error("URL cannot be empty");
      }

      // Basic URL validation
      try {
        new URL(url);
      } catch {
        throw new Error(`Invalid URL: ${url}`);
      }

      try {
        return await fetchUrl(url);
      } catch (err) {
        const message =
          err instanceof Error ? err.message : String(err);
        throw new Error(
          `Failed to fetch ${url}: ${message}`,
        );
      }
    },
  };
}
