import { afterEach, describe, expect, it, vi } from "vitest";
import { createJobProfileStorage, type JobSetup } from "@/modules/routine-jobs/ui/jobProfileStorage";

const KEY = "routine-jobs.cargar-padrones.profiles.v1";
const PASSWORD = "s3cret-pw";

const setup = (overrides: Partial<JobSetup> = {}): JobSetup => ({
  host: "db.local",
  port: "5432",
  db_name: "gis",
  user: "carto",
  schema: "carto",
  ruralTable: "rural",
  urbanoTable: "urbano",
  targetTable: "destino",
  options: { repair: true, clearMode: "delete", resetSequences: true },
  ...overrides,
});

class MemoryStorage {
  readonly data = new Map<string, string>();
  readonly writes: string[] = [];
  getItem(key: string): string | null {
    return this.data.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    this.writes.push(value);
    this.data.set(key, value);
  }
}

const throwingStorage = (reads: boolean, writes: boolean) => ({
  getItem(): string | null {
    if (reads) throw new Error("SecurityError");
    return null;
  },
  setItem(): void {
    if (writes) throw new Error("QuotaExceededError");
  },
});

const seeded = (raw: string): MemoryStorage => {
  const storage = new MemoryStorage();
  storage.data.set(KEY, raw);
  return storage;
};

afterEach(() => {
  vi.useRealTimers();
});

describe("jobProfileStorage", () => {
  describe("list", () => {
    it("AC-22: should return an empty list when nothing is stored", () => {
      const profiles = createJobProfileStorage(new MemoryStorage());

      expect(profiles.list()).toEqual([]);
    });

    it("AC-22: should return the stored profiles sorted by name", () => {
      const storage = new MemoryStorage();
      const profiles = createJobProfileStorage(storage);
      profiles.save("gamma", setup());
      profiles.save("alfa", setup());
      profiles.save("beta", setup());

      expect(createJobProfileStorage(storage).list().map((profile) => profile.name)).toEqual([
        "alfa",
        "beta",
        "gamma",
      ]);
    });
  });

  describe("save", () => {
    it("AC-22: should persist a versioned payload under the documented key", () => {
      const storage = new MemoryStorage();
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2026-03-01T10:00:00Z"));

      createJobProfileStorage(storage).save("Mensual", setup());

      const stored = JSON.parse(storage.data.get(KEY) ?? "null") as Record<string, unknown>;
      expect(stored).toEqual({
        version: 1,
        profiles: [{ name: "Mensual", savedAt: new Date("2026-03-01T10:00:00Z").getTime(), setup: setup() }],
      });
    });

    it("AC-22: should return the profile list including the new profile", () => {
      const profiles = createJobProfileStorage(new MemoryStorage());

      const result = profiles.save("Mensual", setup());

      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({ name: "Mensual", setup: setup() });
      expect(typeof result[0].savedAt).toBe("number");
    });

    it("AC-22: should replace a profile saved with the same name", () => {
      const profiles = createJobProfileStorage(new MemoryStorage());
      profiles.save("Mensual", setup({ schema: "viejo" }));

      const result = profiles.save("Mensual", setup({ schema: "nuevo" }));

      expect(result).toHaveLength(1);
      expect(result[0].setup.schema).toBe("nuevo");
      expect(profiles.list()[0].setup.schema).toBe("nuevo");
    });

    it("AC-22: should treat names as case-sensitive", () => {
      const profiles = createJobProfileStorage(new MemoryStorage());
      profiles.save("Mensual", setup());

      const result = profiles.save("mensual", setup());

      expect(result.map((profile) => profile.name).sort()).toEqual(["Mensual", "mensual"]);
    });

    it("AC-22: should trim the name and replace the trimmed profile", () => {
      const profiles = createJobProfileStorage(new MemoryStorage());
      profiles.save("Mensual", setup({ schema: "viejo" }));

      const result = profiles.save("  Mensual  ", setup({ schema: "nuevo" }));

      expect(result).toHaveLength(1);
      expect(result[0].name).toBe("Mensual");
      expect(result[0].setup.schema).toBe("nuevo");
    });

    it("AC-22: should reject an empty name by returning the list unchanged and writing nothing", () => {
      const storage = new MemoryStorage();
      const profiles = createJobProfileStorage(storage);
      profiles.save("Mensual", setup());
      const writesBefore = storage.writes.length;

      const result = profiles.save("", setup());

      expect(result.map((profile) => profile.name)).toEqual(["Mensual"]);
      expect(storage.writes).toHaveLength(writesBefore);
    });

    it("AC-22: should reject a whitespace-only name by returning the list unchanged", () => {
      const profiles = createJobProfileStorage(new MemoryStorage());

      expect(profiles.save("   \t ", setup())).toEqual([]);
      expect(profiles.list()).toEqual([]);
    });

    it("AC-22: should never persist the password even when the setup object carries one", () => {
      const storage = new MemoryStorage();
      const withPassword = { ...setup(), password: PASSWORD } as JobSetup;

      const result = createJobProfileStorage(storage).save("Mensual", withPassword);

      const raw = storage.data.get(KEY) ?? "";
      expect(raw).not.toContain(PASSWORD);
      expect(raw).not.toContain("password");
      expect(JSON.stringify(result)).not.toContain(PASSWORD);
      expect(JSON.stringify(createJobProfileStorage(storage).list())).not.toContain(PASSWORD);
    });

    it("AC-22: should not alias the caller's setup object", () => {
      const profiles = createJobProfileStorage(new MemoryStorage());
      const original = setup();
      profiles.save("Mensual", original);

      original.schema = "mutado";

      expect(profiles.list()[0].setup.schema).toBe("carto");
    });

    it("AC-22: should round trip options such as truncate", () => {
      const storage = new MemoryStorage();
      const options = { repair: false, clearMode: "truncate", resetSequences: false } as const;

      createJobProfileStorage(storage).save("Sin reparar", setup({ options }));

      expect(createJobProfileStorage(storage).list()[0].setup.options).toEqual(options);
    });
  });

  describe("remove", () => {
    it("AC-22: should remove the named profile and persist the change", () => {
      const storage = new MemoryStorage();
      const profiles = createJobProfileStorage(storage);
      profiles.save("alfa", setup());
      profiles.save("beta", setup());

      const result = profiles.remove("alfa");

      expect(result.map((profile) => profile.name)).toEqual(["beta"]);
      expect(createJobProfileStorage(storage).list().map((profile) => profile.name)).toEqual(["beta"]);
    });

    it("AC-22: should leave the list unchanged when the name does not exist", () => {
      const profiles = createJobProfileStorage(new MemoryStorage());
      profiles.save("alfa", setup());

      expect(profiles.remove("ghost").map((profile) => profile.name)).toEqual(["alfa"]);
    });

    it("AC-22: should be case-sensitive when removing", () => {
      const profiles = createJobProfileStorage(new MemoryStorage());
      profiles.save("alfa", setup());

      expect(profiles.remove("ALFA")).toHaveLength(1);
    });

    it("AC-22: should return an empty list when removing from empty storage", () => {
      expect(createJobProfileStorage(new MemoryStorage()).remove("alfa")).toEqual([]);
    });
  });

  describe("corrupt or unexpected stored data", () => {
    const cases: [string, string][] = [
      ["malformed JSON", "{not json"],
      ["an empty string", ""],
      ["JSON null", "null"],
      ["a JSON array", "[]"],
      ["a JSON string", '"hello"'],
      ["a wrong version", JSON.stringify({ version: 2, profiles: [{ name: "x", savedAt: 1, setup: setup() }] })],
      ["a missing version", JSON.stringify({ profiles: [{ name: "x", savedAt: 1, setup: setup() }] })],
      ["profiles that is not an array", JSON.stringify({ version: 1, profiles: "nope" })],
      ["profiles with only malformed entries", JSON.stringify({ version: 1, profiles: [1, null, { name: 5 }] })],
      [
        "an entry whose setup is incomplete",
        JSON.stringify({ version: 1, profiles: [{ name: "x", savedAt: 1, setup: { host: "h" } }] }),
      ],
    ];

    it.each(cases)("AC-22: should list nothing and not throw for %s", (_label, raw) => {
      const profiles = createJobProfileStorage(seeded(raw));

      expect(profiles.list()).toEqual([]);
    });

    it("AC-22: should recover by saving over corrupt data with a valid versioned payload", () => {
      const storage = seeded("{not json");

      const result = createJobProfileStorage(storage).save("Mensual", setup());

      expect(result.map((profile) => profile.name)).toEqual(["Mensual"]);
      expect(JSON.parse(storage.data.get(KEY) ?? "null")).toMatchObject({ version: 1 });
      expect(createJobProfileStorage(storage).list()).toHaveLength(1);
    });

    it("AC-22: should not throw when removing with corrupt data", () => {
      expect(createJobProfileStorage(seeded("{not json")).remove("x")).toEqual([]);
    });
  });

  describe("failing storage", () => {
    it("AC-22: should list nothing when reading throws", () => {
      const profiles = createJobProfileStorage(throwingStorage(true, false));

      expect(profiles.list()).toEqual([]);
    });

    it("AC-22: should not throw on save when reading and writing throw", () => {
      const profiles = createJobProfileStorage(throwingStorage(true, true));

      const result = profiles.save("Mensual", setup());

      expect(Array.isArray(result)).toBe(true);
    });

    it("AC-22: should not throw on save when only writing throws and keep the result usable", () => {
      const profiles = createJobProfileStorage(throwingStorage(false, true));

      const result = profiles.save("Mensual", setup());

      expect(result.map((profile) => profile.name)).toEqual(["Mensual"]);
      expect(result[0].setup).toEqual(setup());
    });

    it("AC-22: should not throw on remove when writing throws", () => {
      const profiles = createJobProfileStorage(throwingStorage(false, true));

      expect(() => profiles.remove("x")).not.toThrow();
    });
  });

  describe("without storage", () => {
    it("AC-22: should work in memory when storage is null", () => {
      const profiles = createJobProfileStorage(null);

      const saved = profiles.save("Mensual", setup());

      expect(saved.map((profile) => profile.name)).toEqual(["Mensual"]);
      expect(profiles.list().map((profile) => profile.name)).toEqual(["Mensual"]);
      expect(profiles.remove("Mensual")).toEqual([]);
      expect(profiles.list()).toEqual([]);
    });

    it("AC-22: should not share memory between two null-storage instances", () => {
      const first = createJobProfileStorage(null);
      first.save("Mensual", setup());

      expect(createJobProfileStorage(null).list()).toEqual([]);
    });

    it("AC-22: should still reject an empty name when storage is null", () => {
      expect(createJobProfileStorage(null).save(" ", setup())).toEqual([]);
    });
  });
});
