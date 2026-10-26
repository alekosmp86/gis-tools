import type { JobOptions } from "./clientTypes";

export interface JobSetup {
  host: string;
  port: string;
  db_name: string;
  user: string;
  schema: string;
  ruralTable: string;
  urbanoTable: string;
  targetTable: string;
  options: JobOptions;
}

export interface JobProfile {
  name: string;
  savedAt: number;
  setup: JobSetup;
}

export interface JobProfileStorage {
  list(): JobProfile[];
  save(name: string, setup: JobSetup): JobProfile[];
  remove(name: string): JobProfile[];
}

export type KeyValueStorage = Pick<Storage, "getItem" | "setItem">;

const JOB_PROFILE_STORAGE_KEY = "routine-jobs.cargar-padrones.profiles.v1";
const STORAGE_VERSION = 1;
const CLEAR_MODES: readonly string[] = ["delete", "truncate"];
const TEXT_FIELDS = ["host", "port", "db_name", "user", "schema", "ruralTable", "urbanoTable", "targetTable"] as const;

type JsonRecord = Record<string, unknown>;

const isRecord = (value: unknown): value is JsonRecord =>
  typeof value === "object" && value !== null && !Array.isArray(value);

function isJobOptions(value: unknown): value is JobOptions {
  return (
    isRecord(value) &&
    typeof value.repair === "boolean" &&
    typeof value.resetSequences === "boolean" &&
    typeof value.clearMode === "string" &&
    CLEAR_MODES.includes(value.clearMode)
  );
}

function isJobSetup(value: unknown): value is JobSetup {
  return (
    isRecord(value) &&
    TEXT_FIELDS.every((field) => typeof value[field] === "string") &&
    isJobOptions(value.options)
  );
}

function copySetup(setup: JobSetup): JobSetup {
  return {
    host: setup.host,
    port: setup.port,
    db_name: setup.db_name,
    user: setup.user,
    schema: setup.schema,
    ruralTable: setup.ruralTable,
    urbanoTable: setup.urbanoTable,
    targetTable: setup.targetTable,
    options: {
      repair: setup.options.repair,
      clearMode: setup.options.clearMode,
      resetSequences: setup.options.resetSequences,
    },
  };
}

function isStoredProfile(value: unknown): value is JobProfile {
  return (
    isRecord(value) &&
    typeof value.name === "string" &&
    value.name.trim() !== "" &&
    typeof value.savedAt === "number" &&
    isJobSetup(value.setup)
  );
}

const sortByName = (profiles: JobProfile[]): JobProfile[] =>
  [...profiles].sort((left, right) => left.name.localeCompare(right.name, "es"));

function parseStored(raw: string | null): JobProfile[] {
  if (!raw) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!isRecord(parsed) || parsed.version !== STORAGE_VERSION || !Array.isArray(parsed.profiles)) return [];
  return sortByName(
    parsed.profiles
      .filter(isStoredProfile)
      .map((profile) => ({ name: profile.name, savedAt: profile.savedAt, setup: copySetup(profile.setup) })),
  );
}

export function createJobProfileStorage(storage: KeyValueStorage | null): JobProfileStorage {
  let memory: JobProfile[] = [];

  const read = (): JobProfile[] => {
    if (!storage) return memory;
    try {
      return parseStored(storage.getItem(JOB_PROFILE_STORAGE_KEY));
    } catch {
      return [];
    }
  };

  const write = (profiles: JobProfile[]): void => {
    if (!storage) {
      memory = profiles;
      return;
    }
    try {
      storage.setItem(JOB_PROFILE_STORAGE_KEY, JSON.stringify({ version: STORAGE_VERSION, profiles }));
    } catch {
      // Storage may be full or blocked; the profiles stay usable for this session only.
    }
  };

  return {
    list: () => read(),

    save(name, setup) {
      const trimmed = name.trim();
      if (trimmed === "") return read();
      const profile: JobProfile = { name: trimmed, savedAt: Date.now(), setup: copySetup(setup) };
      const next = sortByName([...read().filter((existing) => existing.name !== trimmed), profile]);
      write(next);
      return next;
    },

    remove(name) {
      const current = read();
      const next = current.filter((profile) => profile.name !== name.trim());
      if (next.length !== current.length) write(next);
      return next;
    },
  };
}

export function browserJobProfileStorage(): KeyValueStorage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}
