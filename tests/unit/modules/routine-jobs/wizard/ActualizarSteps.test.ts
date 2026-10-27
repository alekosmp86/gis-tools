import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { ActualizarTablesStep } from "@/modules/routine-jobs/ui/steps/ActualizarTablesStep";
import { ActualizarOptionsStep } from "@/modules/routine-jobs/ui/steps/ActualizarOptionsStep";
import { ActualizarReviewStep } from "@/modules/routine-jobs/ui/steps/ActualizarReviewStep";
import { ActualizarResultStep } from "@/modules/routine-jobs/ui/steps/ActualizarResultStep";
import { buildActualizarReportView } from "@/modules/routine-jobs/ui/actualizarPadronReportView";
import type { ActualizarPadronRunSnapshot } from "@/modules/routine-jobs/ui/actualizarPadronRunStore";
import { plannedStepLabels } from "@/modules/routine-jobs/jobs/actualizar-padron/domain/plannedSteps";
import { buttonAttributes, isDisabledAttributes, openingTags, withoutValueAttributes } from "./wizardFixtures";
import {
  ACTUALIZAR_SECRET,
  actualizarJobOf,
  actualizarRequestOf,
  actualizarResultOf,
  actualizarSnapshotOf,
} from "./actualizarFixtures";

const START_MS = 1_000_000;
const ELAPSED_125_SECONDS = START_MS + 125_000;
const listItemsOf = (html: string): string[] => html.match(/<li\b[^>]*>[\s\S]*?<\/li>/g) ?? [];
const COUNTER_PATTERN = /\b\d+\s*\/\s*\d+\b/;

describe("ActualizarTablesStep", () => {
  type Props = React.ComponentProps<typeof ActualizarTablesStep>;

  function render(overrides: Partial<Props> = {}): string {
    const props: Props = {
      stagingSchema: "bdj_carto",
      workSchema: "carto",
      cartoSchema: "carto_cat",
      tables: { staging: "", work: "", padron: "", province: "", locality: "", type: "" },
      excluded: { staging: [], work: [], padron: [], province: [], locality: [], type: [] },
      onSchemaChange: vi.fn(),
      onTableChange: vi.fn(),
      loadTables: vi.fn().mockResolvedValue({ schemaExists: true, tables: [] }),
      checkColumns: vi.fn().mockResolvedValue([]),
      blockingReason: null,
      catalogError: null,
      ...overrides,
    };
    return renderToStaticMarkup(React.createElement(ActualizarTablesStep, props));
  }

  it("AP-29: should render the staging and work schema fields with their current values", () => {
    const html = render({ stagingSchema: "bdj_carto", workSchema: "carto_test" });

    expect(html).toContain("Esquema de origen");
    expect(html).toContain("Esquema de trabajo");
    expect(html).toContain('value="bdj_carto"');
    expect(html).toContain('value="carto_test"');
  });

  it("AP-29: should render the five table selectors with their Spanish labels", () => {
    const html = render();

    expect(html).toContain("Tabla de origen");
    expect(html).toContain("Tabla de trabajo");
    expect(html).toContain("Tabla padrón");
    expect(html).toContain("Tabla de provincias");
    expect(html).toContain("Tabla de localidades");
  });

  it("AP-29: should render the optional type table selector with its Spanish label", () => {
    expect(render()).toContain("Tabla de tipos de unidad (opcional)");
  });

  it("AP-29: should render the three schema fields with their Spanish labels and the carto value", () => {
    const html = render({ stagingSchema: "bdj_carto", workSchema: "carto_test", cartoSchema: "carto_cat" });

    expect(html).toContain("Esquema de origen");
    expect(html).toContain("Esquema de trabajo");
    expect(html).toContain("Esquema de carto");
    expect(html).toContain('value="carto_cat"');
  });

  it("AP-29: should show one hint paragraph after the schema fields and before the table selectors", () => {
    const html = render();
    const beforeSelectors = html.slice(0, html.indexOf("<select"));

    expect(beforeSelectors).toMatch(/<p[^>]*>[^<]{20,}<\/p>/);
    expect(beforeSelectors).toContain("Esquema de carto");
  });

  it("AP-29: should render exactly one table selector per table", () => {
    expect(render().split("<select").length - 1).toBe(6);
  });

  it("AP-29: should keep the chosen tables visible in their selectors", () => {
    const html = render({
      tables: { staging: "stg", work: "padron_trabajo", padron: "padron", province: "province", locality: "cadastral_locality", type: "tipo_loc" },
    });

    expect(html).toContain('value="stg"');
    expect(html).toContain('value="padron_trabajo"');
    expect(html).toContain('value="cadastral_locality"');
  });

  it("AP-29: should show the blocking reason when there is one", () => {
    const html = render({ blockingReason: "Las cinco tablas deben ser distintas." });

    expect(html).toContain("Las cinco tablas deben ser distintas.");
  });

  it("AP-29: should show the catalog error inside an alert region", () => {
    const html = render({ catalogError: "Servidor no disponible." });

    expect(html).toContain('role="alert"');
    expect(html).toContain("Servidor no disponible.");
  });

  it("AP-32: should not use inline styles", () => {
    expect(render()).not.toMatch(/\sstyle=/);
  });
});

describe("ActualizarOptionsStep", () => {
  type Props = React.ComponentProps<typeof ActualizarOptionsStep>;

  function render(overrides: Partial<Props> = {}): string {
    const props: Props = { options: { clearMode: "delete" }, typeTableChosen: false, onChange: vi.fn(), ...overrides };
    return renderToStaticMarkup(React.createElement(ActualizarOptionsStep, props));
  }

  const nonChoiceInputsOf = (html: string): string[] =>
    openingTags(html, "input").filter((tag) => !/type="(radio|checkbox)"/.test(tag));

  it("AP-30: should show the Tipo de localidad text field only when a type table is chosen", () => {
    expect(render({ typeTableChosen: true })).toContain("Tipo de localidad");
    expect(render({ typeTableChosen: false })).not.toContain("Tipo de localidad");
  });

  it("AP-30: should show the default LOCALIDAD CATASTRAL when the locality type is not set", () => {
    const html = render({ options: { clearMode: "delete" }, typeTableChosen: true });

    expect(html).toContain('value="LOCALIDAD CATASTRAL"');
  });

  it("AP-30: should show the locality type chosen in the options", () => {
    const html = render({ options: { clearMode: "delete", localityType: "LOCALIDAD RURAL" }, typeTableChosen: true });

    expect(html).toContain('value="LOCALIDAD RURAL"');
    expect(html).not.toContain('value="LOCALIDAD CATASTRAL"');
  });

  it("AP-30: should render the locality type as the only free-text input", () => {
    expect(nonChoiceInputsOf(render({ typeTableChosen: true }))).toHaveLength(1);
  });

  it("AP-30: should not render the locality type input when no type table is chosen", () => {
    expect(nonChoiceInputsOf(render({ typeTableChosen: false }))).toHaveLength(0);
  });

  it("AP-30: should offer the DELETE and TRUNCATE clear modes as radio choices", () => {
    const radios = openingTags(render(), "input").filter((tag) => tag.includes('type="radio"'));

    expect(radios).toHaveLength(2);
    expect(radios.some((tag) => tag.includes('value="delete"'))).toBe(true);
    expect(radios.some((tag) => tag.includes('value="truncate"'))).toBe(true);
  });

  it("AP-30: should check the radio of the current clear mode", () => {
    const radios = openingTags(render({ options: { clearMode: "truncate" } }), "input").filter((tag) =>
      tag.includes('type="radio"'),
    );

    expect(radios.find((tag) => tag.includes('value="truncate"'))).toMatch(/\schecked=""/);
    expect(radios.find((tag) => tag.includes('value="delete"'))).not.toMatch(/\schecked=""/);
  });

  it("AP-30: should show the TRUNCATE privilege note only when TRUNCATE is chosen", () => {
    const withDelete = render({ options: { clearMode: "delete" } });
    const withTruncate = render({ options: { clearMode: "truncate" } });

    expect(withDelete).not.toMatch(/privilegio TRUNCATE/);
    expect(withTruncate).toMatch(/privilegio TRUNCATE/);
  });

  it("AP-30: should offer no checkbox, repair toggle or sequence option", () => {
    const html = render();

    expect(openingTags(html, "input").some((tag) => tag.includes('type="checkbox"'))).toBe(false);
    expect(html).not.toMatch(/Reparar|secuencias/);
  });

  it("AP-32: should not use inline styles", () => {
    expect(render()).not.toMatch(/\sstyle=/);
  });
});

describe("ActualizarReviewStep", () => {
  type Props = React.ComponentProps<typeof ActualizarReviewStep>;

  function render(overrides: Partial<Props> = {}): string {
    const props: Props = {
      request: actualizarRequestOf(),
      confirmation: { password: "", workTableLabel: "" },
      canDryRun: false,
      canRun: false,
      busy: false,
      runBlockedReason: null,
      onConfirmationChange: vi.fn(),
      onDryRun: vi.fn(),
      onRun: vi.fn(),
      ...overrides,
    };
    return renderToStaticMarkup(React.createElement(ActualizarReviewStep, props));
  }

  const disabledOf = (html: string, label: string): boolean => {
    const attributes = buttonAttributes(html, label);
    if (attributes === null) throw new Error(`${label} button not found`);
    return isDisabledAttributes(attributes);
  };

  describe("summary", () => {
    it("AP-31: should list the five tables and the schemas", () => {
      const html = render({
        request: actualizarRequestOf({
          stagingTable: "t_stg",
          workTable: "t_trabajo",
          padronTable: "t_padron",
          provinceTable: "t_prov",
          localityTable: "t_loc",
        }),
      });

      for (const table of ["t_stg", "t_trabajo", "t_padron", "t_prov", "t_loc", "bdj_carto", "carto"]) {
        expect(html, table).toContain(table);
      }
    });

    it("AP-31: should name DELETE or TRUNCATE as the clear mode", () => {
      expect(render({ request: actualizarRequestOf({ options: { clearMode: "delete" } }) })).toContain("DELETE");
      expect(render({ request: actualizarRequestOf({ options: { clearMode: "truncate" } }) })).toContain("TRUNCATE");
    });

    it("AP-31: should warn that the work table is overwritten and that the padron is not modified", () => {
      const html = render({ request: actualizarRequestOf({ workTable: "t_trabajo" }) });

      expect(html).toContain("t_trabajo");
      expect(html).toMatch(/no se modifica/i);
    });

    it("AP-31: should list the carto schema next to the staging and work schemas", () => {
      const html = render({ request: actualizarRequestOf({ cartoSchema: "carto_cat" }) });

      for (const schema of ["bdj_carto", "carto", "carto_cat"]) {
        expect(html, schema).toContain(schema);
      }
    });

    it("AP-31: should list the type table and the locality type when a type table is selected", () => {
      const html = render({
        request: actualizarRequestOf({
          typeTable: "t_tipo",
          options: { clearMode: "delete", localityType: "LOCALIDAD RURAL" },
        }),
      });

      expect(html).toContain("t_tipo");
      expect(html).toContain("LOCALIDAD RURAL");
    });

    it("AP-31: should not list a type table or a locality type when no type table is selected", () => {
      const html = render({
        request: actualizarRequestOf({ options: { clearMode: "delete", localityType: "LOCALIDAD RURAL" } }),
      });

      expect(html).not.toContain("LOCALIDAD RURAL");
    });

    it("AP-24: should never print the password in the summary", () => {
      const html = withoutValueAttributes(render({ request: actualizarRequestOf() }));

      expect(html).not.toContain(ACTUALIZAR_SECRET);
    });
  });

  describe("confirmation fields", () => {
    it("AP-31: should ask for the password as a password field", () => {
      const passwordInputs = openingTags(render(), "input").filter((tag) => tag.includes('type="password"'));

      expect(passwordInputs).toHaveLength(1);
    });

    it("AP-31: should ask to type the work table name again", () => {
      expect(render()).toContain("Vuelva a escribir el nombre de la tabla de trabajo");
    });

    it("AP-31: should never render the typed password as an input value", () => {
      const html = render({ confirmation: { password: ACTUALIZAR_SECRET, workTableLabel: "" } });

      expect(html).not.toContain(`value="${ACTUALIZAR_SECRET}"`);
    });
  });

  describe("buttons", () => {
    it("AP-31: should enable the dry run only when it can run", () => {
      expect(disabledOf(render({ canDryRun: true }), "Analizar sin cargar")).toBe(false);
      expect(disabledOf(render({ canDryRun: false }), "Analizar sin cargar")).toBe(true);
    });

    it("AP-31: should enable the real run only when it is confirmed", () => {
      expect(disabledOf(render({ canRun: true }), "Actualizar tabla de trabajo")).toBe(false);
      expect(disabledOf(render({ canRun: false }), "Actualizar tabla de trabajo")).toBe(true);
    });

    it("AP-31: should disable both runs while a job is busy", () => {
      const html = render({ canDryRun: true, canRun: true, busy: true });

      expect(disabledOf(html, "Analizar sin cargar")).toBe(true);
      expect(disabledOf(html, "Actualizar tabla de trabajo")).toBe(true);
    });

    it("AP-31: should disable both runs when the wizard reports a blocking reason", () => {
      const html = render({ canDryRun: true, canRun: true, runBlockedReason: "Indique el servidor (host)." });

      expect(disabledOf(html, "Analizar sin cargar")).toBe(true);
      expect(disabledOf(html, "Actualizar tabla de trabajo")).toBe(true);
      expect(html).toContain("Indique el servidor (host).");
    });

    it("AP-32: should not use inline styles", () => {
      expect(render()).not.toMatch(/\sstyle=/);
    });
  });
});

describe("ActualizarResultStep", () => {
  const render = (snapshot: ActualizarPadronRunSnapshot, nowMs = ELAPSED_125_SECONDS): string =>
    renderToStaticMarkup(
      React.createElement(ActualizarResultStep, { snapshot, nowMs, onNewRun: vi.fn(), onBackToReview: vi.fn() }),
    );

  const running = (overrides: Partial<ActualizarPadronRunSnapshot> = {}): ActualizarPadronRunSnapshot =>
    actualizarSnapshotOf({
      phase: "running",
      jobId: "job-42",
      startedAt: START_MS,
      plan: { dryRun: false, clearMode: "delete" },
      job: actualizarJobOf({ startedAt: START_MS }),
      ...overrides,
    });

  describe("idle", () => {
    it("AP-32: should show a hint and no checklist or report", () => {
      const html = render(actualizarSnapshotOf({ phase: "idle" }));

      expect(html.trim().length).toBeGreaterThan(0);
      expect(listItemsOf(html)).toHaveLength(0);
      expect(buttonAttributes(html, "Nueva carga")).toBeNull();
    });
  });

  describe("planned checklist", () => {
    it("AP-32: should list every step the server sent at once, with the current one checked off", () => {
      const steps = ["Validar tablas y columnas", "Contar filas de staging", "Cargar tabla de trabajo", "Generar informe"];
      const html = render(running({ job: actualizarJobOf({ step: "Cargar tabla de trabajo", steps, startedAt: START_MS }) }));
      const rows = listItemsOf(html);

      expect(rows).toHaveLength(steps.length);
      expect(rows.find((item) => item.includes("Cargar tabla de trabajo"))).toMatch(/checkItemCurrent/);
    });

    it("AP-32: should never show a raw current of total counter", () => {
      const html = render(running({ job: actualizarJobOf({ step: "Cargar tabla de trabajo", current: 2, total: 5, startedAt: START_MS }) }));

      expect(html).not.toMatch(COUNTER_PATTERN);
    });

    it("AP-22: should fall back to the planned steps of the run before the server reports any", () => {
      const plan = { dryRun: false, clearMode: "truncate" } as const;
      const html = render(running({ plan, job: actualizarJobOf({ step: null, steps: undefined, startedAt: START_MS }) }));

      expect(listItemsOf(html)).toHaveLength(plannedStepLabels(plan).length);
      expect(html).toContain("Confirmar cambios");
    });

    it("AP-22: should show the rollback step instead of the commit step for a dry run", () => {
      const plan = { dryRun: true, clearMode: "delete" } as const;
      const html = render(running({ plan, job: actualizarJobOf({ step: null, steps: undefined, dryRun: true, startedAt: START_MS }) }));

      expect(html).toContain("Revertir cambios de la simulación");
      expect(html).not.toContain("Confirmar cambios");
    });

    it("AP-32: should show the elapsed time computed from nowMs and the start instant", () => {
      const html = render(running());

      expect(html).toMatch(/2:05|2 min 05 s|2 min 5 s|125 s/);
    });

    it("AP-32: should not print NaN or undefined when the job has no step yet", () => {
      const html = render(running({ job: actualizarJobOf({ step: null, current: undefined, total: undefined, startedAt: START_MS }) }));

      expect(html).not.toMatch(/NaN|undefined/);
    });

    it("AP-32: should label the checklist for assistive technology", () => {
      const tag = openingTags(render(running({ plan: { dryRun: false, clearMode: "delete" } })), "ol")[0] ?? "";

      expect(tag).toMatch(/\saria-label="[^"]+"/);
    });
  });

  describe("done", () => {
    it("AP-32: should show the banner and the report of the finished job", () => {
      const result = actualizarResultOf({ warnings: ["Hay 3 padrones sin geometría."] });
      const html = render(actualizarSnapshotOf({ phase: "done", jobId: "job-42", job: actualizarJobOf({ state: "DONE", result }) }));
      const view = buildActualizarReportView(result);

      expect(html).toContain(view.banners[0].text);
      expect(html).toContain("Hay 3 padrones sin geometría.");
      expect(html).toContain(view.skippedRows[0]?.label ?? "");
    });

    it("AP-17: should show the dry-run banner for an analysis", () => {
      const result = actualizarResultOf({ dryRun: true, tempModified: false });
      const html = render(actualizarSnapshotOf({ phase: "done", job: actualizarJobOf({ state: "DONE", dryRun: true, result }) }));

      expect(html).toContain(buildActualizarReportView(result).banners[0].text);
    });

    it("AP-19: should show the verify-before-retry banner when the outcome is unknown", () => {
      const result = actualizarResultOf({ outcomeUnknown: true, tempModified: false });
      const html = render(actualizarSnapshotOf({ phase: "done", job: actualizarJobOf({ state: "DONE", result }) }));

      expect(html).toMatch(/verific/i);
    });

    it("AP-32: should not throw when a finished job carries no result", () => {
      const renderIt = () => render(actualizarSnapshotOf({ phase: "done", job: actualizarJobOf({ state: "DONE", result: undefined }) }));

      expect(renderIt).not.toThrow();
    });
  });

  describe("failed and unknown", () => {
    it("AP-32: should show the error and offer Nueva carga", () => {
      const html = render(actualizarSnapshotOf({ phase: "failed", error: "Ya hay una actualización en curso para esta tabla." }));

      expect(html).toContain("Ya hay una actualización en curso para esta tabla.");
      expect(buttonAttributes(html, "Nueva carga")).not.toBeNull();
    });

    it("AP-32: should escape an error that contains markup", () => {
      expect(render(actualizarSnapshotOf({ phase: "failed", error: "<script>x</script>" }))).not.toContain("<script>");
    });

    it("AP-33: should name the job id and tell the user to verify the work table when the outcome is unknown", () => {
      const html = render(actualizarSnapshotOf({ phase: "unknown", jobId: "job-77" }));

      expect(html).toContain("job-77");
      expect(html).toMatch(/tabla de trabajo/i);
      expect(html).toMatch(/verific/i);
    });
  });

  describe("back to review", () => {
    it.each([
      ["done", actualizarSnapshotOf({ phase: "done", job: actualizarJobOf({ state: "DONE", result: actualizarResultOf() }) })],
      ["failed", actualizarSnapshotOf({ phase: "failed", error: "Falló." })],
      ["unknown", actualizarSnapshotOf({ phase: "unknown", jobId: "job-1" })],
    ])("AP-32: should offer Volver a Revisar next to Nueva carga when %s", (_name, snapshot) => {
      const html = render(snapshot);

      expect(buttonAttributes(html, "Volver a Revisar")).not.toBeNull();
      expect(buttonAttributes(html, "Nueva carga")).not.toBeNull();
    });

    it.each([
      ["idle", actualizarSnapshotOf({ phase: "idle" })],
      ["running", running()],
    ])("AP-32: should not offer Volver a Revisar while %s", (_name, snapshot) => {
      expect(buttonAttributes(render(snapshot), "Volver a Revisar")).toBeNull();
    });
  });

  describe("every phase", () => {
    it("AP-24: should never render a password input or inline styles", () => {
      const phases: ActualizarPadronRunSnapshot[] = [
        actualizarSnapshotOf({ phase: "idle" }),
        actualizarSnapshotOf({ phase: "starting", startedAt: START_MS }),
        running(),
        actualizarSnapshotOf({ phase: "done", job: actualizarJobOf({ state: "DONE", result: actualizarResultOf() }) }),
        actualizarSnapshotOf({ phase: "failed", error: "Falló." }),
        actualizarSnapshotOf({ phase: "unknown", jobId: "job-1" }),
      ];

      for (const snapshot of phases) {
        const html = render(snapshot);

        expect(openingTags(html, "input").some((tag) => tag.includes('type="password"')), snapshot.phase).toBe(false);
        expect(html, snapshot.phase).not.toMatch(/\sstyle=/);
      }
    });
  });
});
