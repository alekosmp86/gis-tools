import { handleCsvUpload } from "@/core/services/server/csvReplace/csvReplaceHandlers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function POST(request: Request) {
  return handleCsvUpload(request);
}
