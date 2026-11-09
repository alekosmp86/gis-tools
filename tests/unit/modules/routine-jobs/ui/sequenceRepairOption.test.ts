import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import {
  initialWizardState as initialActualizarState,
  toStartRequest as toActualizarStartRequest,
  wizardReducer as actualizarReducer,
} from "@/modules/routine-jobs/ui/actualizarPadronWizardState";
import {
  initialWizardStateFor as initialLocalidadesStateFor,
  localidadesWizardReducer,
  toStartRequest as toLocalidadesStartRequest,
} from "@/modules/routine-jobs/ui/cargarLocalidadesWizardState";
import { RunPhase } from "@/modules/routine-jobs/ui/jobRunStore";
import { ActualizarReviewStep } from "@/modules/routine-jobs/ui/steps/ActualizarReviewStep";
import { LocalidadesReviewStep } from "@/modules/routine-jobs/ui/steps/LocalidadesReviewStep";
import { SEQUENCE_REPAIR_LABEL, SequenceRepairField } from "@/modules/routine-jobs/ui/steps/SequenceRepairField";
import { UnidadReviewStep } from "@/modules/routine-jobs/ui/steps/UnidadReviewStep";
import { initialUnidadWizardStateFor, toUnidadStartRequest, unidadWizardReducer } from "@/modules/routine-jobs/ui/unidadTerritorialWizardState";

const CONNECTION = { host: "db.local", port: "5432", db_name: "gis", user: "gis_user", password: "Seq-pw!1" };
const NOOP = (): void => undefined;

const summaryRowOf = (markup: string): string => {
  const match = new RegExp(`<dt>${SEQUENCE_REPAIR_LABEL}</dt><dd>([^<]*)</dd>`).exec(markup);
  return match ? match[1] : "";
};

const localidadesState = () => initialLocalidadesStateFor({ phase: RunPhase.IDLE } as never, { connection: CONNECTION });
const unidadState = () => initialUnidadWizardStateFor({ phase: RunPhase.IDLE } as never, { connection: CONNECTION });
const actualizarState = () => ({ ...initialActualizarState(), connection: CONNECTION });

describe("wizard state repairSequences (SQ-8)", () => {
  it("should default repairSequences to false in the cargar-localidades wizard", () => {
    expect(localidadesState().options.repairSequences).toBe(false);
  });

  it("should default repairSequences to false in the unidad-territorial wizard", () => {
    expect(unidadState().options.repairSequences).toBe(false);
  });

  it("should default repairSequences to false in the actualizar-padron wizard", () => {
    expect(actualizarState().options.repairSequences).toBe(false);
  });

  it.each([true, false])("should store repairSequences=%s from an optionsChanged action in the cargar-localidades wizard", (value) => {
    const next = localidadesWizardReducer(localidadesState(), { type: "optionsChanged", patch: { repairSequences: value } });

    expect(next.options.repairSequences).toBe(value);
    expect(next.options.updateGeometries).toBe(localidadesState().options.updateGeometries);
  });

  it.each([true, false])("should store repairSequences=%s from an optionsChanged action in the unidad-territorial wizard", (value) => {
    const next = unidadWizardReducer(unidadState(), { type: "optionsChanged", patch: { repairSequences: value } });

    expect(next.options.repairSequences).toBe(value);
    expect(next.options.linkAddressMaster).toBe(unidadState().options.linkAddressMaster);
  });

  it.each([true, false])("should store repairSequences=%s from an optionsChanged action in the actualizar-padron wizard", (value) => {
    const next = actualizarReducer(actualizarState(), { type: "optionsChanged", patch: { repairSequences: value } });

    expect(next.options.repairSequences).toBe(value);
    expect(next.options.linkAddressMaster).toBe(actualizarState().options.linkAddressMaster);
  });
});

describe("start request carries repairSequences (SQ-1, SQ-8)", () => {
  it.each([true, false])("should send options.repairSequences=%s in the cargar-localidades start request", (value) => {
    const state = localidadesWizardReducer(localidadesState(), { type: "optionsChanged", patch: { repairSequences: value } });

    expect(toLocalidadesStartRequest(state, { dryRun: true }).options.repairSequences).toBe(value);
    expect(toLocalidadesStartRequest(state, { dryRun: false }).options.repairSequences).toBe(value);
  });

  it("should send options.repairSequences=false in an untouched cargar-localidades start request", () => {
    expect(toLocalidadesStartRequest(localidadesState(), { dryRun: true }).options.repairSequences).toBe(false);
  });

  it.each([true, false])("should send options.repairSequences=%s in the unidad-territorial start request", (value) => {
    const state = unidadWizardReducer(unidadState(), { type: "optionsChanged", patch: { repairSequences: value } });

    expect(toUnidadStartRequest(state, { dryRun: true }).options.repairSequences).toBe(value);
    expect(toUnidadStartRequest(state, { dryRun: false }).options.repairSequences).toBe(value);
  });

  it("should send options.repairSequences=false in an untouched unidad-territorial start request", () => {
    expect(toUnidadStartRequest(unidadState(), { dryRun: true }).options.repairSequences).toBe(false);
  });

  it.each([true, false])("should send options.repairSequences=%s in the actualizar-padron start request", (value) => {
    const state = actualizarReducer(actualizarState(), { type: "optionsChanged", patch: { repairSequences: value } });

    expect(toActualizarStartRequest(state, { dryRun: true }).options.repairSequences).toBe(value);
  });

  it("should send options.repairSequences=false in an untouched actualizar-padron start request", () => {
    expect(toActualizarStartRequest(actualizarState(), { dryRun: true }).options.repairSequences).toBe(false);
  });
});

describe("SequenceRepairField checkbox (SQ-8)", () => {
  it("should render a checked checkbox labelled Ajustar secuencias de destino when repairSequences is on", () => {
    const markup = renderToStaticMarkup(React.createElement(SequenceRepairField, { checked: true, onChange: NOOP }));

    expect(markup).toContain(SEQUENCE_REPAIR_LABEL);
    expect(markup).toMatch(/<input[^>]*type="checkbox"[^>]*checked=""/);
  });

  it("should render an unchecked checkbox when repairSequences is off", () => {
    const markup = renderToStaticMarkup(React.createElement(SequenceRepairField, { checked: false, onChange: NOOP }));

    expect(markup).toMatch(/<input[^>]*type="checkbox"/);
    expect(markup).not.toMatch(/checked=""/);
  });

  it("should explain that UPDATE is required and USAGE is enough when the sequence is already ahead", () => {
    const markup = renderToStaticMarkup(React.createElement(SequenceRepairField, { checked: false, onChange: NOOP }));

    expect(markup).toContain("UPDATE");
    expect(markup).toContain("USAGE");
  });

  it("should call onChange with the new checked value through the checkbox handler", () => {
    const onChange = vi.fn();
    const element = SequenceRepairField({ checked: false, onChange }) as React.ReactElement<{ children: React.ReactElement[] }>;
    const label = element.props.children[0] as React.ReactElement<{ children: React.ReactElement[] }>;
    const input = label.props.children[0] as React.ReactElement<{ onChange: (event: { target: { checked: boolean } }) => void }>;

    input.props.onChange({ target: { checked: true } });

    expect(onChange).toHaveBeenCalledWith(true);
  });
});

describe("Review steps show repairSequences as Sí or No (SQ-8)", () => {
  const withRepair = <T extends { options: { repairSequences: boolean } }>(request: T, repairSequences: boolean): T => ({
    ...request,
    options: { ...request.options, repairSequences },
  });

  it.each([
    [true, "Sí"],
    [false, "No"],
  ])("should show Ajustar secuencias de destino as %s => %s in the cargar-localidades review", (value, text) => {
    const request = withRepair(toLocalidadesStartRequest(localidadesState(), { dryRun: true }), value);

    const markup = renderToStaticMarkup(
      React.createElement(LocalidadesReviewStep, {
        request,
        targets: [],
        canDryRun: true,
        canRun: false,
        busy: false,
        runBlockedReason: null,
        onConfirmationChange: NOOP,
        onDryRun: NOOP,
        onRun: NOOP,
      })
    );

    expect(summaryRowOf(markup)).toBe(text);
  });

  it.each([
    [true, "Sí"],
    [false, "No"],
  ])("should show Ajustar secuencias de destino as %s => %s in the unidad-territorial review", (value, text) => {
    const request = withRepair(toUnidadStartRequest(unidadState(), { dryRun: true }), value);

    const markup = renderToStaticMarkup(
      React.createElement(UnidadReviewStep, {
        request,
        canDryRun: true,
        canRun: false,
        busy: false,
        runBlockedReason: null,
        onConfirmationChange: NOOP,
        onDryRun: NOOP,
        onRun: NOOP,
      })
    );

    expect(summaryRowOf(markup)).toBe(text);
  });

  it.each([
    [true, "Sí"],
    [false, "No"],
  ])("should show Ajustar secuencias de destino as %s => %s in the actualizar-padron review", (value, text) => {
    const request = withRepair(toActualizarStartRequest(actualizarState(), { dryRun: true }), value);

    const markup = renderToStaticMarkup(
      React.createElement(ActualizarReviewStep, {
        request,
        confirmation: { password: "" } as never,
        canAnalyze: true,
        busy: false,
        runBlockedReason: null,
        onConfirmationChange: NOOP,
        onAnalyze: NOOP,
      })
    );

    expect(summaryRowOf(markup)).toBe(text);
  });
});
