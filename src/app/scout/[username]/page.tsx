/**
 * This page should never render — the layout redirects all /scout/* to /player/*.
 * Exists only because Next.js requires a page.tsx for the route to work.
 */
export default function ScoutRedirectPage() {
  return null;
}
