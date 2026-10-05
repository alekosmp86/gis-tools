import { readFile } from "node:fs/promises";
import { test, expect } from "../support/testFixture";
import type { Page, Request } from "@playwright/test";
import { DEDUP_ANALYZE_RESPONSE } from "../fixtures/dedupFixtures";
import { loadAndSelectProvince, mockProvinces } from "../support/dedupProvince";
import {
  DEDUP_NO_REMOVALS_RESPONSE,
  REMOVAL_BLOCKED_SIMULATION,
  REMOVAL_FINGERPRINT,
  REMOVAL_SIMULATION,
  REMOVAL_TARGETS,
  removalExecution,
} from "../fixtures/dedupRemovalFixtures";

const PAGE_URL = "/tools/m/address-dedup";
const ANALYZE_URL = "**/api/m/address-dedup/analyze";
const SIMULATE_URL = "**/api/m/address-dedup/removal/simulate";
const EXECUTE_URL = "**/api/m/address-dedup/removal/execute";
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

interface RemovalCalls {
  readonly simulate: Request[];
  readonly execute: Request[];
}

function recordCalls(page: Page): RemovalCalls {
  const calls: RemovalCalls = { simulate: [], execute: [] };
  page.on("request", (request) => {
    if (request.url().endsWith("/removal/simulate")) calls.simulate.push(request);
    if (request.url().endsWith("/removal/execute")) calls.execute.push(request);
  });
  return calls;
}

async function mockAnalysis(page: Page, response: unknown = DEDUP_ANALYZE_RESPONSE): Promise<void> {
  await page.route(ANALYZE_URL, (route) => route.fulfill({ json: response }));
}

async function runAnalysis(page: Page): Promise<void> {
  await mockProvinces(page);
  await expect(page.getByRole("button", { name: "Analizar duplicados" })).toBeEnabled();
  for (const [label, value] of [
    ["Base de datos", "carto"],
    ["Usuario", "operador"],
    ["Contraseña", "secreto"],
  ] as const) {
    const input = page.getByLabel(label);
    await input.fill(value);
    await expect(input).toHaveValue(value);
  }
  await loadAndSelectProvince(page);
  await page.getByRole("button", { name: "Analizar duplicados" }).click();
  await expect(page.getByRole("tab", { name: "Resumen" })).toHaveAttribute("aria-selected", "true");
}

async function openDialog(page: Page): Promise<void> {
  await page.getByRole("button", { name: "Confirmar y eliminar" }).click();
  await expect(page.getByRole("dialog", { name: "Confirmar y eliminar duplicados" })).toBeVisible();
}

async function fillConfirmation(page: Page): Promise<void> {
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Responsable").fill("Ana Pérez");
  await dialog.getByLabel("Motivo").fill("CGEO-2192 baja de duplicados");
}

async function simulate(page: Page): Promise<void> {
  await fillConfirmation(page);
  await page.getByRole("dialog").getByRole("button", { name: "Simular baja" }).click();
  await expect(page.getByTestId("removal-fingerprint")).toHaveText(REMOVAL_FINGERPRINT);
}

test.describe("Módulo: Duplicados de Direcciones, eliminación confirmada", () => {
  test.beforeEach(async ({ page }) => {
    await mockAnalysis(page);
    await page.goto(PAGE_URL);
  });

  test("debe ofrecer la acción solo en el resumen y no llamar a ningún endpoint de baja al abrir el diálogo", async ({
    page,
  }) => {
    const calls = recordCalls(page);
    await runAnalysis(page);

    await openDialog(page);

    await expect(page.getByRole("dialog").getByRole("button", { name: "Simular baja" })).toBeDisabled();
    await expect(page.getByRole("button", { name: "Ejecutar eliminación" })).toHaveCount(0);
    expect(calls.simulate).toHaveLength(0);
    expect(calls.execute).toHaveLength(0);
  });

  test("debe exigir responsable y motivo antes de poder simular", async ({ page }) => {
    await runAnalysis(page);
    await openDialog(page);
    const simulateButton = page.getByRole("dialog").getByRole("button", { name: "Simular baja" });

    await page.getByRole("dialog").getByLabel("Responsable").fill("Ana Pérez");
    await expect(simulateButton).toBeDisabled();

    await page.getByRole("dialog").getByLabel("Motivo").fill("   ");
    await expect(simulateButton).toBeDisabled();

    await page.getByRole("dialog").getByLabel("Motivo").fill("CGEO-2192");
    await expect(simulateButton).toBeEnabled();
  });

  test("debe simular, mostrar el plan y solo entonces permitir ejecutar, en dos pasos separados", async ({ page }) => {
    await page.route(SIMULATE_URL, (route) => route.fulfill({ json: REMOVAL_SIMULATION }));
    let executedOperationId = "";
    await page.route(EXECUTE_URL, (route) => {
      const body = route.request().postDataJSON() as { operationId: string };
      executedOperationId = body.operationId;
      return route.fulfill({ json: removalExecution(body.operationId) });
    });
    const calls = recordCalls(page);
    await runAnalysis(page);
    await openDialog(page);

    await simulate(page);

    expect(calls.simulate).toHaveLength(1);
    expect(calls.execute).toHaveLength(0);
    await expect(page.getByTestId("removal-total")).toHaveText("4");
    await expect(page.getByText("Pasos manuales pendientes")).toBeVisible();
    await expect(page.getByText(/Solr/).first()).toBeVisible();
    const executeButton = page.getByRole("button", { name: "Ejecutar eliminación" });
    await expect(executeButton).toBeEnabled();

    await executeButton.click();

    await expect(page.getByTestId("removal-operation")).toHaveText(executedOperationId);
    expect(calls.execute).toHaveLength(1);
    await expect(page.getByText("Baja ejecutada")).toBeVisible();
    await expect(page.getByText("Pasos manuales pendientes")).toBeVisible();
    await expect(page.getByRole("button", { name: "Ejecutar eliminación" })).toHaveCount(0);
  });

  test("debe enviar al ejecutar la huella simulada, la confirmación y ninguna lista de direcciones", async ({ page }) => {
    await page.route(SIMULATE_URL, (route) => route.fulfill({ json: REMOVAL_SIMULATION }));
    await page.route(EXECUTE_URL, (route) => {
      const body = route.request().postDataJSON() as { operationId: string };
      return route.fulfill({ json: removalExecution(body.operationId) });
    });
    const calls = recordCalls(page);
    await runAnalysis(page);
    await openDialog(page);
    await simulate(page);

    await page.getByRole("button", { name: "Ejecutar eliminación" }).click();
    await expect(page.getByText("Baja ejecutada")).toBeVisible();

    const body = calls.execute[0].postDataJSON() as Record<string, unknown>;
    expect(body).toMatchObject({
      expectedFingerprint: REMOVAL_FINGERPRINT,
      responsable: "Ana Pérez",
      motivo: "CGEO-2192 baja de duplicados",
      provinceId: 7,
    });
    expect(String(body.operationId)).toMatch(UUID_PATTERN);
    expect(Object.keys(body).sort()).toEqual([
      "connection",
      "expectedFingerprint",
      "motivo",
      "operationId",
      "protectedSiblingRemovesLone",
      "provinceId",
      "responsable",
    ]);
    expect(JSON.stringify(calls.simulate[0].postDataJSON())).not.toContain("urn");
  });

  test("debe listar las URN a eliminar en el paso de revisión, con conteo, copia y descarga", async ({
    page,
    context,
  }) => {
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    await page.route(SIMULATE_URL, (route) => route.fulfill({ json: REMOVAL_SIMULATION }));
    const calls = recordCalls(page);
    await runAnalysis(page);
    await openDialog(page);
    await expect(page.getByLabel("Lista de URN a eliminar")).toHaveCount(0);

    await simulate(page);

    const list = page.getByLabel("Lista de URN a eliminar");
    await expect(list).toBeVisible();
    await expect(list).toHaveAttribute("readonly", "");
    await expect(page.getByTestId("removal-targets-count")).toHaveText(await page.getByTestId("removal-total").innerText());
    const shown = (await list.inputValue()).split("\n").map((line) => line.split("\t")[0]);
    expect(shown).toEqual(REMOVAL_TARGETS.map((target) => target.urn));
    await expect(page.getByRole("button", { name: "Copiar URN" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Descargar CSV" })).toBeVisible();
    expect(calls.execute).toHaveLength(0);

    await page.getByRole("button", { name: "Copiar URN" }).click();
    await expect(page.getByRole("button", { name: "URN copiados" })).toBeVisible();
    const clipboardText = await page.evaluate(() => navigator.clipboard.readText());
    expect(clipboardText.replace(/\r\n/g, "\n")).toBe(
      REMOVAL_TARGETS.map((target) => target.urn).join("\n")
    );

    const [download] = await Promise.all([
      page.waitForEvent("download"),
      page.getByRole("button", { name: "Descargar CSV" }).click(),
    ]);
    expect(download.suggestedFilename()).toBe(`address-dedup-removal-plan-7-${REMOVAL_FINGERPRINT.slice(0, 8)}.csv`);
    const content = await readFile((await download.path()) ?? "", "utf-8");
    expect(content).toBe(
      ["urn,fuente", ...REMOVAL_TARGETS.map((target) => `${target.urn},${target.fuente}`)].join("\r\n") + "\r\n"
    );
    expect(calls.execute).toHaveLength(0);
  });

  test("debe limitar la longitud de responsable y motivo en el formulario", async ({ page }) => {
    await runAnalysis(page);
    await openDialog(page);

    await expect(page.getByRole("dialog").getByLabel("Responsable")).toHaveAttribute("maxlength", "120");
    await expect(page.getByRole("dialog").getByLabel("Motivo")).toHaveAttribute("maxlength", "1000");
  });

  test("no debe permitir ejecutar un plan con bloqueos y debe explicar cada uno", async ({ page }) => {
    await page.route(SIMULATE_URL, (route) => route.fulfill({ json: REMOVAL_BLOCKED_SIMULATION }));
    const calls = recordCalls(page);
    await runAnalysis(page);
    await openDialog(page);

    await simulate(page);

    await expect(page.getByText("cgeo:Antel:address:id:102", { exact: true })).toBeVisible();
    await expect(page.getByText("El maestro lo comparte otra dirección")).toBeVisible();
    await expect(page.getByRole("button", { name: "Ejecutar eliminación" })).toBeDisabled();
    expect(calls.execute).toHaveLength(0);
  });

  test("debe mostrar el rechazo del servidor y permitir volver a simular", async ({ page, allowConsoleErrors }) => {
    allowConsoleErrors(/Failed to load resource/);
    await page.route(SIMULATE_URL, (route) => route.fulfill({ json: REMOVAL_SIMULATION }));
    await page.route(EXECUTE_URL, (route) =>
      route.fulfill({
        status: 409,
        json: { success: false, error: "Cambió el alcance o los datos de la baja. Simular y confirmar nuevamente." },
      })
    );
    await runAnalysis(page);
    await openDialog(page);
    await simulate(page);

    await page.getByRole("button", { name: "Ejecutar eliminación" }).click();

    await expect(page.getByText(/Simular y confirmar nuevamente/)).toBeVisible();
    await expect(page.getByText("Baja ejecutada")).toHaveCount(0);

    await page.getByRole("button", { name: "Volver a simular" }).click();
    await expect(page.getByRole("dialog").getByRole("button", { name: "Simular baja" })).toBeEnabled();
    await expect(page.getByRole("button", { name: "Ejecutar eliminación" })).toHaveCount(0);
  });

  test("debe poder cancelar tras simular sin ejecutar nada", async ({ page }) => {
    await page.route(SIMULATE_URL, (route) => route.fulfill({ json: REMOVAL_SIMULATION }));
    const calls = recordCalls(page);
    await runAnalysis(page);
    await openDialog(page);
    await simulate(page);

    await page.getByRole("button", { name: "Cerrar" }).click();

    await expect(page.getByRole("dialog")).toHaveCount(0);
    expect(calls.execute).toHaveLength(0);
  });

  test("debe pedir de nuevo responsable y motivo al reabrir el diálogo", async ({ page }) => {
    await page.route(SIMULATE_URL, (route) => route.fulfill({ json: REMOVAL_SIMULATION }));
    await runAnalysis(page);
    await openDialog(page);
    await simulate(page);
    await page.getByRole("button", { name: "Cerrar" }).click();

    await openDialog(page);

    await expect(page.getByRole("dialog").getByLabel("Responsable")).toHaveValue("");
    await expect(page.getByRole("dialog").getByRole("button", { name: "Simular baja" })).toBeDisabled();
  });
});

test.describe("Módulo: Duplicados de Direcciones, reanálisis tras la eliminación", () => {
  async function mockSequencedAnalysis(page: Page): Promise<Request[]> {
    const analyzeCalls: Request[] = [];
    await page.route(ANALYZE_URL, (route) => {
      analyzeCalls.push(route.request());
      return route.fulfill({
        json: analyzeCalls.length === 1 ? DEDUP_ANALYZE_RESPONSE : DEDUP_NO_REMOVALS_RESPONSE,
      });
    });
    return analyzeCalls;
  }

  test("debe reanalizar con los mismos parámetros al cerrar el resumen de una baja ejecutada", async ({ page }) => {
    const analyzeCalls = await mockSequencedAnalysis(page);
    await page.route(SIMULATE_URL, (route) => route.fulfill({ json: REMOVAL_SIMULATION }));
    await page.route(EXECUTE_URL, (route) => {
      const body = route.request().postDataJSON() as { operationId: string };
      return route.fulfill({ json: removalExecution(body.operationId) });
    });
    await page.goto(PAGE_URL);
    await runAnalysis(page);
    await openDialog(page);
    await simulate(page);
    await page.getByRole("button", { name: "Ejecutar eliminación" }).click();
    await expect(page.getByText("Baja ejecutada")).toBeVisible();
    expect(analyzeCalls).toHaveLength(1);

    await page.getByRole("dialog").getByRole("button", { name: "Cerrar" }).last().click();

    await expect(page.getByText("El análisis no tiene filas a eliminar.")).toBeVisible();
    expect(analyzeCalls).toHaveLength(2);
    expect(analyzeCalls[1].postDataJSON()).toEqual(analyzeCalls[0].postDataJSON());
    await expect(page.getByRole("tab", { name: "Resumen" })).toHaveAttribute("aria-selected", "true");
    await expect(page.getByRole("dialog")).toHaveCount(0);
  });

  test("no debe reanalizar al cancelar desde la revisión del plan", async ({ page }) => {
    const analyzeCalls = await mockSequencedAnalysis(page);
    await page.route(SIMULATE_URL, (route) => route.fulfill({ json: REMOVAL_SIMULATION }));
    await page.goto(PAGE_URL);
    await runAnalysis(page);
    await openDialog(page);
    await simulate(page);

    await page.getByRole("button", { name: "Cerrar" }).click();

    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Confirmar y eliminar" })).toBeEnabled();
    expect(analyzeCalls).toHaveLength(1);
  });

  test("no debe reanalizar al cerrar tras un rechazo del servidor al ejecutar", async ({ page, allowConsoleErrors }) => {
    allowConsoleErrors(/Failed to load resource/);
    const analyzeCalls = await mockSequencedAnalysis(page);
    await page.route(SIMULATE_URL, (route) => route.fulfill({ json: REMOVAL_SIMULATION }));
    await page.route(EXECUTE_URL, (route) =>
      route.fulfill({ status: 409, json: { success: false, error: "Cambió el alcance o los datos de la baja." } })
    );
    await page.goto(PAGE_URL);
    await runAnalysis(page);
    await openDialog(page);
    await simulate(page);
    await page.getByRole("button", { name: "Ejecutar eliminación" }).click();
    await expect(page.getByText(/Cambió el alcance/)).toBeVisible();

    await page.getByRole("button", { name: "Cerrar" }).click();

    await expect(page.getByRole("dialog")).toHaveCount(0);
    expect(analyzeCalls).toHaveLength(1);
  });
});

test.describe("Módulo: Duplicados de Direcciones, sin filas a eliminar", () => {
  test("debe deshabilitar la acción cuando el análisis no tiene filas a eliminar", async ({ page }) => {
    await mockAnalysis(page, DEDUP_NO_REMOVALS_RESPONSE);
    await page.goto(PAGE_URL);

    await runAnalysis(page);

    await expect(page.getByRole("button", { name: "Confirmar y eliminar" })).toBeDisabled();
    await expect(page.getByText("El análisis no tiene filas a eliminar.")).toBeVisible();
  });
});
