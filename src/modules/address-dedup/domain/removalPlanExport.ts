import type { RemovalPlanTarget } from "../removalTypes";
import { CSV_LINE_BREAK, escapeCsvCell } from "./export";

const PLAN_CSV_HEADER = "urn,fuente";
const FINGERPRINT_PREFIX_LENGTH = 8;

/** One urn per line, ready to paste into a ticket or a query. */
export function buildTargetUrnText(targets: ReadonlyArray<RemovalPlanTarget>): string {
  return targets.map((target) => target.urn).join("\n");
}

/** RFC 4180 like the module's other CSV: header, CRLF after every line, cells quoted when needed. */
export function buildRemovalPlanCsv(targets: ReadonlyArray<RemovalPlanTarget>): string {
  const lines = targets.map((target) => `${escapeCsvCell(target.urn)},${escapeCsvCell(target.fuente)}`);
  return [PLAN_CSV_HEADER, ...lines].join(CSV_LINE_BREAK) + CSV_LINE_BREAK;
}

export function buildRemovalPlanFilename(provinceId: number, fingerprint: string): string {
  return `address-dedup-removal-plan-${provinceId}-${fingerprint.slice(0, FINGERPRINT_PREFIX_LENGTH)}.csv`;
}
