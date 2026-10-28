import { describe, expect, it, vi } from "vitest";
import { withRunSession } from "@/modules/routine-jobs/jobs/shared/transaction";
import type { RunDeps, RunSession } from "@/modules/routine-jobs/jobs/cargar-padrones/types";
import type { DbConfig } from "@/core/types/db";

const PASSWORD = "Run-session-pw!2";
const CONFIG: DbConfig = { host: "db.local", port: "5432", db_name: "gis", user: "gis_user", password: PASSWORD, schema_name: "", table_name: "" };

function sessionOf() {
  const close = vi.fn(async () => undefined);
  const query = vi.fn(async () => ({ rows: [] }));
  return { session: { query, close } as unknown as RunSession, close, query };
}

function depsOf(session: RunSession, openImpl?: () => Promise<RunSession>) {
  const openSession = vi.fn(openImpl ?? (async () => session));
  const deps: RunDeps = { openSession, now: () => 0 };
  return { deps, openSession };
}

describe("withRunSession", () => {
  it("should open the session with the connection config and pass it to the work", async () => {
    const { session } = sessionOf();
    const { deps, openSession } = depsOf(session);
    const work = vi.fn(async (received: RunSession) => (received === session ? "ok" : "otra sesion"));

    const result = await withRunSession(CONFIG, deps, work);

    expect(openSession).toHaveBeenCalledWith(CONFIG);
    expect(work).toHaveBeenCalledWith(session);
    expect(result).toBe("ok");
  });

  it("should close the session after the work succeeds", async () => {
    const { session, close } = sessionOf();
    const { deps } = depsOf(session);

    await withRunSession(CONFIG, deps, async () => "ok");

    expect(close).toHaveBeenCalledTimes(1);
  });

  it("should close the session and rethrow the same error when the work fails without the password", async () => {
    const { session, close } = sessionOf();
    const { deps } = depsOf(session);
    const original = new Error("tabla bloqueada");

    const rejection = await withRunSession(CONFIG, deps, async () => {
      throw original;
    }).catch((error: unknown) => error);

    expect(rejection).toBe(original);
    expect(close).toHaveBeenCalledTimes(1);
  });

  it("should scrub the password from a failing work error and close the session", async () => {
    const { session, close } = sessionOf();
    const { deps } = depsOf(session);

    const rejection = (await withRunSession(CONFIG, deps, async () => {
      throw new Error(`fallo con ${PASSWORD}`);
    }).catch((error: unknown) => error)) as Error;

    expect(rejection.message).toBe("fallo con ***");
    expect(close).toHaveBeenCalledTimes(1);
  });

  it("should pass a non-Error failure through unchanged", async () => {
    const { session } = sessionOf();
    const { deps } = depsOf(session);

    const rejection = await withRunSession(CONFIG, deps, async () => {
      throw "texto suelto";
    }).catch((error: unknown) => error);

    expect(rejection).toBe("texto suelto");
  });

  it("should keep the error untouched when no password is configured", async () => {
    const { session } = sessionOf();
    const { deps } = depsOf(session);
    const noPassword: DbConfig = { ...CONFIG, password: undefined };
    const original = new Error(`mensaje con ${PASSWORD}`);

    const rejection = await withRunSession(noPassword, deps, async () => {
      throw original;
    }).catch((error: unknown) => error);

    expect(rejection).toBe(original);
  });

  it("should report a failed open in Spanish with the password scrubbed and run no work", async () => {
    const { deps } = depsOf(undefined as unknown as RunSession, async () => {
      throw new Error(`autenticación rechazada para ${PASSWORD}`);
    });
    const work = vi.fn(async () => "nunca");

    const rejection = (await withRunSession(CONFIG, deps, work).catch((error: unknown) => error)) as Error;

    expect(rejection.message).toBe("No se pudo abrir la conexión: autenticación rechazada para ***");
    expect(work).not.toHaveBeenCalled();
  });

  it("should still return the work result when closing the session fails", async () => {
    const { session, close } = sessionOf();
    close.mockRejectedValueOnce(new Error("cierre fallido"));
    const { deps } = depsOf(session);

    await expect(withRunSession(CONFIG, deps, async () => "resultado")).resolves.toBe("resultado");
  });
});
