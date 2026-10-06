import { describe, it, expect, vi } from "vitest";
import { Database } from "lucide-react";
import type { DbConnectionFormRef } from "@/core/types/db";
import { buildDbConnectionStep } from "@/components/tools/db-sync-common/wizardSteps";
import { DbConnectionForm } from "@/ui-kit/components/DbConnectionForm";

const params = (current: DbConnectionFormRef | null, canProceed = true) => ({
  formRef: { current },
  onSuccess: vi.fn(),
  onStatusChange: vi.fn(),
  canProceed,
});

describe("buildDbConnectionStep", () => {
  it("should return step 1 with the expected texts and icon", () => {
    const step = buildDbConnectionStep(params(null));
    expect(step.id).toBe(1);
    expect(step.title).toBe("Base de Datos");
    expect(step.subtitle).toBe("Conexión y Tabla");
    expect(step.cardTitle).toBe("Conectar a Base de Datos PostgreSQL");
    expect(step.cardSubtitle).toBe(
      "Ingrese las credenciales para conectar a la base de datos e inspeccionar la tabla seleccionada."
    );
    expect(step.icon).toBe(Database);
  });

  it.each([true, false])("should pass canProceed=%s through", (value) => {
    expect(buildDbConnectionStep(params(null, value)).canProceed).toBe(value);
  });

  it("should call proceed on the form ref when onNext runs", () => {
    const proceed = vi.fn();
    const step = buildDbConnectionStep(params({ proceed } as unknown as DbConnectionFormRef));
    step.onNext?.();
    expect(proceed).toHaveBeenCalledTimes(1);
  });

  it("should not throw when onNext runs with a null ref", () => {
    const step = buildDbConnectionStep(params(null));
    expect(() => step.onNext?.()).not.toThrow();
  });

  it("should render a DbConnectionForm element wired with ref and callbacks", () => {
    const p = params(null);
    const el = buildDbConnectionStep(p).content as unknown as {
      type: unknown;
      props: Record<string, unknown>;
      ref?: unknown;
    };
    expect(el.type).toBe(DbConnectionForm);
    expect(el.props.onSuccess).toBe(p.onSuccess);
    expect(el.props.onStatusChange).toBe(p.onStatusChange);
    expect(el.props.ref ?? el.ref).toBe(p.formRef);
  });
});
