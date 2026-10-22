import { handleStart } from "@/core/services/server/shpReplace/shpReplaceHandlers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function POST(request: Request) {
  return handleStart(request);
}
