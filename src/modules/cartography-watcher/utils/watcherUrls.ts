/**
 * watcherUrls.ts
 * Pure URL parsing, slug extraction, and title formatting for cartography watcher sources.
 */

export function extractSlugFromUrl(url: string): string {
  try {
    const parsed = new URL(url);
    const datasetIndex = parsed.pathname.indexOf("/dataset/");
    if (datasetIndex !== -1) {
      const rest = parsed.pathname.slice(datasetIndex + "/dataset/".length);
      const slug = rest.split("/")[0];
      if (slug) return slug;
    }
  } catch {
    // Fallback below
  }
  return "custom-dataset-" + Date.now();
}

export function formatTitleFromSlug(slug: string): string {
  return slug
    .replace(/^ide-/, "")
    .split("-")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}
