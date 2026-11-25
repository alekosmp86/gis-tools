import { handleGpkgUpload } from "@/core/services/server/gpkgReplace/gpkgReplaceHandlers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function POST(request: Request) {
  return handleGpkgUpload(request);
}
