import { WatchedSourceKind } from "../types";
import type { WatchedSource } from "../types";

export function isDirectSource(source: WatchedSource): boolean {
  return source.kind === WatchedSourceKind.DIRECT_URL;
}
