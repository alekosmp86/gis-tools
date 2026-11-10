import { handleStatus } from "@/core/services/server/shpReplace/shpReplaceHandlers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET(request: Request) {
  return handleStatus(request);
}
