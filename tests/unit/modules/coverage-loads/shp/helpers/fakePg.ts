import { Writable } from "node:stream";
import type { JobPgClient } from "@/modules/coverage-loads/shp/job/pg/createClient.ts";

export interface QueryRecord {
  text: string;
  values: unknown[];
}

export type Responder = (text: string, values: unknown[]) => { rows: unknown[] } | undefined;

export interface FakePg {
  queries: QueryRecord[];
  texts(): string[];
  clients: number;
  ended: number;
  connectError: Error | null;
  copySql: string[];
  copied: Buffer[];
  factory: () => JobPgClient;
  copyIn: () => Writable;
  responder: Responder | null;
}

const ok = (rows: unknown[]): { rows: unknown[] } => ({ rows });

/** Default answers of a healthy server for a 2-record, 2-piece load into `public.lte`. */
function defaultAnswer(text: string): { rows: unknown[] } {
  if (text.includes("pg_backend_pid")) return ok([{ pid: 4242 }]);
  if (text.includes("pg_try_advisory_lock")) return ok([{ locked: true }]);
  if (text.includes("FROM public.shp_stage_lte") && text.includes("AS area")) return ok([{ rows: "2", area: 200 }]);
  if (text.startsWith("SELECT rec, npoints")) return ok([{ rec: 1, npoints: 5 }, { rec: 2, npoints: 5 }]);
  if (text.includes("WITH inserted")) return ok([{ pieces: "2" }]);
  if (text.includes("AS first_id")) return ok([{ first_id: "1", last_id: "2", pieces: "2" }]);
  if (text.includes("WITH repaired")) return ok([{ repaired: "2" }]);
  if (text.includes("WITH removed")) return ok([{ removed: "0" }]);
  if (text.includes("AS invalid_pieces")) return ok([{ pieces: "2", max_vertices: "5", invalid_pieces: "0", vertices: "10", area: 200 }]);
  if (text.startsWith("SELECT count(*)::text AS rows FROM public.lte")) return ok([{ rows: "2" }]);
  if (text.includes("AS pieces") && text.includes("FROM public.lte")) return ok([{ pieces: "3", vertices: "15", area: 250 }]);
  return ok([]);
}

export function createFakePg(): FakePg {
  const fake: FakePg = {
    queries: [],
    texts: () => fake.queries.map((q) => q.text),
    clients: 0,
    ended: 0,
    connectError: null,
    copySql: [],
    copied: [],
    responder: null,
    factory: () => {
      fake.clients += 1;
      return {
        connect: async () => {
          if (fake.connectError) throw fake.connectError;
          return undefined;
        },
        query: async (text: string, values: unknown[] = []) => {
          fake.queries.push({ text, values });
          return fake.responder?.(text, values) ?? defaultAnswer(text);
        },
        end: async () => {
          fake.ended += 1;
        },
        on: () => undefined,
      };
    },
    copyIn: () =>
      new Writable({
        write(chunk: Buffer, _enc, cb) {
          fake.copied.push(Buffer.from(chunk));
          cb();
        },
      }),
  };
  return fake;
}
