import { readFile } from "node:fs/promises";
import { getWikiSources } from "@/app/wiki/wikiSources";
import { readWikiAsset } from "@/core/wiki/readWikiAsset";
import { buildWikiAssetHeaders } from "@/core/wiki/wikiAssetHeaders";

interface WikiAssetRouteContext {
  params: Promise<{ tool: string; path: string[] }>;
}

function notFoundResponse(): Response {
  return new Response("Not found", { status: 404 });
}

/** Serves an image from a registered tool's wiki content directory. */
export async function GET(_request: Request, context: WikiAssetRouteContext): Promise<Response> {
  const { tool, path: segments } = await context.params;
  const source = getWikiSources().find((candidate) => candidate.toolSlug === tool);
  if (!source) return notFoundResponse();

  const asset = await readWikiAsset(source.contentDir, segments, readFile);
  if (!asset) return notFoundResponse();

  return new Response(new Uint8Array(asset.bytes), {
    status: 200,
    headers: buildWikiAssetHeaders(asset.contentType),
  });
}
