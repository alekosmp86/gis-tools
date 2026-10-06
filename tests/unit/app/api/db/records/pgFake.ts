import { vi } from "vitest";

export type Responder = (sql: string, params: unknown[] | undefined) => unknown;

export class FakeClient {
  static instances: FakeClient[] = [];
  static responder: Responder = () => ({ rows: [] });
  static connectError: unknown = undefined;

  config: Record<string, unknown>;
  connect = vi.fn(async () => {
    if (FakeClient.connectError !== undefined) throw FakeClient.connectError;
  });
  end = vi.fn(async () => undefined);
  sqls: string[] = [];
  query = vi.fn(async (sql: string, params?: unknown[]) => {
    this.sqls.push(sql);
    return FakeClient.responder(sql, params);
  });

  constructor(config: Record<string, unknown>) {
    this.config = config;
    FakeClient.instances.push(this);
  }

  static reset() {
    FakeClient.instances = [];
    FakeClient.responder = () => ({ rows: [] });
    FakeClient.connectError = undefined;
  }
}

export interface ColumnRow {
  column_name: string;
  data_type: string;
  udt_name?: string;
  full_data_type?: string;
}

export interface DbScript {
  columns?: ColumnRow[];
  find?: number | null | Error;
  fallback?: number | null | Error;
  count?: number;
  dataRows?: unknown[];
  dataRowCount?: number | null;
  dataError?: unknown;
  fetchBatches?: unknown[][];
  fetchError?: unknown;
}

export const DEFAULT_COLUMNS: ColumnRow[] = [
  { column_name: "id", data_type: "integer", udt_name: "int4", full_data_type: "integer" },
  { column_name: "name", data_type: "text", udt_name: "text", full_data_type: "text" },
];

const sridResult = (v: number | null | Error | undefined) => {
  if (v instanceof Error) throw v;
  return { rows: v === undefined ? [] : [{ srid: v }] };
};

export function script(s: DbScript = {}): Responder {
  const batches = [...(s.fetchBatches ?? [])];
  return (sql) => {
    const t = sql.trim();
    if (t.includes("information_schema.columns")) return { rows: s.columns ?? DEFAULT_COLUMNS };
    if (t.includes("Find_SRID")) return sridResult(s.find);
    if (t.startsWith("SELECT ST_SRID(")) return sridResult(s.fallback);
    if (t.includes("COUNT(*)")) return { rows: [{ total: s.count ?? 0 }] };
    if (t.startsWith("BEGIN") || t.startsWith("DECLARE") || t.startsWith("CLOSE") || t.startsWith("COMMIT")) {
      return { rows: [] };
    }
    if (t.startsWith("FETCH")) {
      if (s.fetchError !== undefined) throw s.fetchError;
      return { rows: batches.shift() ?? [] };
    }
    if (s.dataError !== undefined) throw s.dataError;
    const rows = s.dataRows ?? [];
    return { rows, rowCount: s.dataRowCount === undefined ? rows.length : s.dataRowCount };
  };
}

export const geomColumns = (type = "geometry(MultiPolygon,5381)"): ColumnRow[] => [
  ...DEFAULT_COLUMNS,
  { column_name: "geom", data_type: "USER-DEFINED", udt_name: "geometry", full_data_type: type },
];

export const jsonReq = (body: unknown) =>
  new Request("http://x", { method: "POST", body: JSON.stringify(body) });
