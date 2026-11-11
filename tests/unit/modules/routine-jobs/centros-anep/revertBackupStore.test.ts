import { mkdir, mkdtemp, readdir, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ensureRevertBackupDirectory,
  getRevertBackup,
  registerRevertBackup,
  revertBackupDirectory,
} from "@/modules/routine-jobs/jobs/actualizar-padron/services/revertBackupStore";

const tempRoot = vi.hoisted(() => ({ directory: "" }));

vi.mock("node:os", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:os")>();
  return { ...actual, default: { ...actual, tmpdir: () => tempRoot.directory } };
});

const DAY_MS = 24 * 60 * 60 * 1000;
const NOW = Date.UTC(2026, 9, 30, 12, 0, 0);

describe("revert backup store with padron and centros-anep files (CA-12)", () => {
  let directory: string;

  beforeEach(async () => {
    directory = await mkdtemp(path.join(tmpdir(), "gis-store-"));
    tempRoot.directory = directory;
    await ensureRevertBackupDirectory();
  });

  afterEach(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  const seed = async (name: string, ageDays: number): Promise<void> => {
    const filePath = path.join(revertBackupDirectory(), name);
    await writeFile(filePath, "x");
    const when = new Date(NOW - ageDays * DAY_MS);
    await utimes(filePath, when, when);
  };

  it("should remove expired padron and centros-anep revert files on the next registration and keep fresh and foreign ones", async () => {
    await mkdir(revertBackupDirectory(), { recursive: true });
    await seed("padron-revert-carto-padron-old.sql.gz", 8);
    await seed("centros-anep-revert-carto-t-old.sql.gz", 8);
    await seed("centros-anep-revert-carto-t-new.sql.gz", 1);
    await seed("otro-archivo-old.sql.gz", 8);

    await registerRevertBackup({ filePath: "f", fileName: "f.sql.gz", bytes: 1 }, NOW);

    expect((await readdir(revertBackupDirectory())).sort()).toEqual([
      "centros-anep-revert-carto-t-new.sql.gz",
      "otro-archivo-old.sql.gz",
    ]);
  });

  it("should register a centros-anep backup and return it by its token", async () => {
    const file = { filePath: path.join(revertBackupDirectory(), "centros-anep-revert-a.sql.gz"), fileName: "centros-anep-revert-a.sql.gz", bytes: 9 };

    const token = await registerRevertBackup(file, NOW);

    expect(getRevertBackup(token)).toMatchObject(file);
    expect(getRevertBackup("no-existe")).toBeUndefined();
  });
});
