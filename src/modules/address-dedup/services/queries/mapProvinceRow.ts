import type { ProvinceOption } from "../../types";

type RawRow = Record<string, unknown>;

/** Normalises a raw driver row. `pg` may return `id` as a string, so it is coerced; a non-numeric id becomes 0, as in `mapAnalysisRow`. */
export function mapProvinceRow(raw: RawRow): ProvinceOption {
  const id = Number(raw.id);
  const safeId = Number.isNaN(id) ? 0 : id;
  const name = raw.name === null || raw.name === undefined ? "" : String(raw.name).trim();
  return { id: safeId, name: name === "" ? String(safeId) : name };
}
