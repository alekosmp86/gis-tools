import type { Page } from "@playwright/test";
import { test, expect } from "../support/testFixture";
import { takeShot } from "./shot";
import { expectHeading, shotMain } from "./wizardShotHelpers";
import {
  buildConnectionProfilesSeed,
  DESA_CONNECTION,
  INDICATOR_FILES,
  IndicatorsScenario,
  mockIndicatorsApi,
  mockShpApi,
  SHP_FILE,
  SHP_JOB_ID_VALUE,
  SHP_JOB_MEMORY_KEY,
  SHP_LOGS,
  SHP_PLAN_BLOCKED,
  SHP_PLAN_READY,
  SHP_STATUS_GATE_FAILED,
  SHP_STATUS_RUNNING,
  SHP_STATUS_SUCCEEDED,
  SHP_STATUS_TEST_SUCCEEDED,
  type IndicatorsScenarioData,
  type ShpScenario,
} from "./coverage-loads.mocks";

const TOOL = "coverage-loads";
const TOOL_URL = "/tools/m/coverage-loads";

const HEADINGS = {
  connection: "Conexión a la base de datos",
  files: "Archivos de indicadores",
  review: "Revisión del plan de carga",
  indicatorsResult: "Resultado de la carga",
  shpPick: "Archivo SHP",
  shpRunning: "Carga en curso: public.lte",
  shpResult: "Resultado de la carga",
  finalResult: "Resultado",
};

const STAGE_TABS = {
  indicators: /Indicadores LTE/,
  shp: /Cargas SHP/,
  result: /Resultado/,
};

const SHP_SCENARIOS = {
  running: { plan: SHP_PLAN_READY, status: SHP_STATUS_RUNNING, log: SHP_LOGS.running },
  succeeded: { plan: SHP_PLAN_READY, status: SHP_STATUS_SUCCEEDED, log: SHP_LOGS.finished },
  testSucceeded: { plan: SHP_PLAN_READY, status: SHP_STATUS_TEST_SUCCEEDED, log: SHP_LOGS.finished },
  failed: { plan: SHP_PLAN_READY, status: SHP_STATUS_GATE_FAILED, log: SHP_LOGS.failed },
  blocked: { plan: SHP_PLAN_BLOCKED, status: SHP_STATUS_RUNNING, log: SHP_LOGS.running },
} satisfies Record<string, ShpScenario>;

const SHP_CONFIRMATION = /Confirmo que se reemplazará todo el contenido de public\.lte/;

async function shot(page: Page, name: string): Promise<void> {
  await shotMain(page, TOOL, name);
}

async function fillConnection(page: Page): Promise<void> {
  await page.getByLabel("Servidor", { exact: true }).fill(DESA_CONNECTION.host);
  await page.getByLabel("Base de datos", { exact: true }).fill(DESA_CONNECTION.database);
  await page.getByLabel("Usuario", { exact: true }).fill(DESA_CONNECTION.user);
  await page.getByLabel("Contraseña", { exact: true }).fill(DESA_CONNECTION.password);
}

async function openWorkflow(page: Page): Promise<void> {
  await page.goto(TOOL_URL);
  await page.getByRole("radio", { name: /Cobertura/ }).check();
  await expectHeading(page, HEADINGS.connection);
}

async function confirmConnection(page: Page): Promise<void> {
  await openWorkflow(page);
  await fillConnection(page);
  await page.getByRole("button", { name: "Continuar" }).click();
  await expectHeading(page, HEADINGS.files);
}

async function openStage(page: Page, tab: RegExp): Promise<void> {
  await page.getByRole("navigation", { name: "Pasos de la carga" }).getByRole("button", { name: tab }).click();
}

async function chooseIndicatorFiles(page: Page): Promise<void> {
  await page.locator("input[type=file][accept='.csv']").setInputFiles(INDICATOR_FILES);
  await expect(page.getByText(INDICATOR_FILES[1].name)).toBeVisible();
}

async function reviewIndicators(page: Page, scenario: IndicatorsScenarioData): Promise<void> {
  await mockIndicatorsApi(page, scenario);
  await confirmConnection(page);
  await chooseIndicatorFiles(page);
  await page.getByRole("button", { name: "Revisar plan de carga" }).click();
  await expectHeading(page, HEADINGS.review);
}

async function loadIndicators(page: Page): Promise<void> {
  await reviewIndicators(page, IndicatorsScenario.READY);
  await page.getByRole("button", { name: "Cargar al histórico" }).click();
  await expectHeading(page, HEADINGS.indicatorsResult);
}

async function openShpStage(page: Page, scenario: ShpScenario): Promise<void> {
  await mockShpApi(page, scenario);
  await confirmConnection(page);
  await openStage(page, STAGE_TABS.shp);
  await expectHeading(page, HEADINGS.shpPick);
}

async function chooseShpFile(page: Page): Promise<void> {
  await page.locator("input[type=file][accept='.shp']").setInputFiles(SHP_FILE);
  await expect(page.getByText(/Tabla de destino: public\.lte/)).toBeVisible();
}

async function reviewShp(page: Page, scenario: ShpScenario): Promise<void> {
  await openShpStage(page, scenario);
  await chooseShpFile(page);
  await page.getByRole("button", { name: "Subir y revisar" }).click();
  await expectHeading(page, HEADINGS.review);
  await expect(page.getByText("Filas actuales")).toBeVisible();
}

async function startShpLoad(page: Page, scenario: ShpScenario): Promise<void> {
  await reviewShp(page, scenario);
  await page.getByRole("checkbox", { name: SHP_CONFIRMATION }).check();
  await page.getByRole("button", { name: "Iniciar carga" }).click();
}

async function runShpToResult(page: Page, scenario: ShpScenario): Promise<void> {
  await startShpLoad(page, scenario);
  await expectHeading(page, HEADINGS.shpResult);
}

async function downloadReports(page: Page): Promise<void> {
  for (const name of [/Cobertura LTE por localidad/, /mayor al 50%/, /Novedades de cobertura LTE/]) {
    await page.getByRole("button", { name }).click();
    await expect(page.getByRole("button", { name })).toBeEnabled();
  }
  await expect(page.getByText(/reporte_cobertura_lte_localidad_novedad__\d+\.csv/)).toBeVisible();
}

test.describe("Wiki screenshots: coverage-loads", () => {
  test.beforeEach(async ({ page }) => {
    const profiles = buildConnectionProfilesSeed();
    await page.addInitScript(({ key, value }) => window.localStorage.setItem(key, value), profiles);
  });

  test("01-conexion", async ({ page }) => {
    await openWorkflow(page);
    await page.getByRole("button", { name: "Cargar perfil guardado" }).click();
    await page.getByRole("option", { name: /hgdesa/ }).click();
    await page.getByLabel("Contraseña", { exact: true }).fill(DESA_CONNECTION.password);
    await shot(page, "01-conexion");
  });

  test("01b-conexion-perfiles", async ({ page }) => {
    await openWorkflow(page);
    await page.getByRole("button", { name: "Cargar perfil guardado" }).click();
    await expect(page.getByRole("option", { name: /hgprod/ })).toBeVisible();
    await shot(page, "01b-conexion-perfiles");
  });

  test("02-conexion-confirmada", async ({ page }) => {
    await confirmConnection(page);
    await shot(page, "02-conexion-confirmada");
  });

  test("03-indicadores-archivos", async ({ page }) => {
    await confirmConnection(page);
    await takeShot(page, { tool: TOOL, name: "03-indicadores-archivos", target: page.getByRole("region", { name: HEADINGS.files }) });
  });

  test("03b-indicadores-archivos-elegidos", async ({ page }) => {
    await confirmConnection(page);
    await chooseIndicatorFiles(page);
    await takeShot(page, { tool: TOOL, name: "03b-indicadores-archivos-elegidos", target: page.getByRole("region", { name: HEADINGS.files }) });
  });

  test("04-indicadores-plan", async ({ page }) => {
    await reviewIndicators(page, IndicatorsScenario.READY);
    await shot(page, "04-indicadores-plan");
  });

  test("05-indicadores-advertencia", async ({ page }) => {
    await reviewIndicators(page, IndicatorsScenario.SHRINK);
    await expect(page.getByRole("checkbox", { name: /Acepto reemplazar un corte/ })).toBeVisible();
    await shot(page, "05-indicadores-advertencia");
  });

  test("06-indicadores-permiso", async ({ page }) => {
    await reviewIndicators(page, IndicatorsScenario.NO_DELETE);
    await expect(page.getByText(/GRANT de un DBA/)).toBeVisible();
    await shot(page, "06-indicadores-permiso");
  });

  test("07-indicadores-resultado", async ({ page }) => {
    await loadIndicators(page);
    await shot(page, "07-indicadores-resultado");
  });

  test("08-geometrias-elegir", async ({ page }) => {
    await openShpStage(page, SHP_SCENARIOS.running);
    await chooseShpFile(page);
    await shot(page, "08-geometrias-elegir");
  });

  test("09-geometrias-revision", async ({ page }) => {
    await reviewShp(page, SHP_SCENARIOS.running);
    await page.getByRole("checkbox", { name: SHP_CONFIRMATION }).check();
    await shot(page, "09-geometrias-revision");
  });

  test("10-geometrias-ejecucion", async ({ page }) => {
    await page.addInitScript(() => Object.defineProperty(Notification, "permission", { get: () => "default" }));
    await startShpLoad(page, SHP_SCENARIOS.running);
    await expectHeading(page, HEADINGS.shpRunning);
    await expect(page.getByText("Fase actual: 62%", { exact: false })).toBeVisible();
    await expect(page.getByLabel("Últimas líneas del registro")).toContainText("114278 de 184320");
    await shot(page, "10-geometrias-ejecucion");
  });

  test("11-geometrias-resultado", async ({ page }) => {
    await runShpToResult(page, SHP_SCENARIOS.succeeded);
    await shot(page, "11-geometrias-resultado");
  });

  test("12-geometrias-prueba-resultado", async ({ page }) => {
    await reviewShp(page, SHP_SCENARIOS.testSucceeded);
    await page.getByRole("radio", { name: /Prueba/ }).check();
    await page.getByRole("button", { name: "Iniciar prueba" }).click();
    await expectHeading(page, HEADINGS.shpResult);
    await expect(page.getByText("Comparación de la prueba", { exact: false })).toBeVisible();
    await shot(page, "12-geometrias-prueba-resultado");
  });

  test("13-geometrias-bloqueado", async ({ page }) => {
    await reviewShp(page, SHP_SCENARIOS.blocked);
    await expect(page.getByRole("button", { name: "Iniciar carga" })).toBeDisabled();
    await shot(page, "13-geometrias-bloqueado");
  });

  test("14-geometrias-fallo", async ({ page }) => {
    await runShpToResult(page, SHP_SCENARIOS.failed);
    await expect(page.getByText("Verificaciones de calidad: no superadas")).toBeVisible();
    await shot(page, "14-geometrias-fallo");
  });

  test("15-resultado", async ({ page }) => {
    await loadIndicators(page);
    await mockShpApi(page, SHP_SCENARIOS.succeeded);
    await openStage(page, STAGE_TABS.shp);
    await chooseShpFile(page);
    await page.getByRole("button", { name: "Subir y revisar" }).click();
    await page.getByRole("checkbox", { name: SHP_CONFIRMATION }).check();
    await page.getByRole("button", { name: "Iniciar carga" }).click();
    await expectHeading(page, HEADINGS.shpResult);
    await openStage(page, STAGE_TABS.result);
    await expectHeading(page, HEADINGS.finalResult);
    await downloadReports(page);
    await shot(page, "15-resultado");
  });

  test("16-barra-estado-global", async ({ page, mockBackend }) => {
    await mockBackend();
    await mockShpApi(page, SHP_SCENARIOS.running);
    await page.addInitScript(
      ({ key, value }) => window.localStorage.setItem(key, value),
      { key: SHP_JOB_MEMORY_KEY, value: SHP_JOB_ID_VALUE }
    );
    await page.goto("/");
    const chip = page.getByRole("status").filter({ hasText: "Carga SHP lte: 45%" });
    await expect(chip).toBeVisible();
    await page.addStyleTag({ content: "main { visibility: hidden !important; }" });
    await takeShot(page, { tool: TOOL, name: "16-barra-estado-global", target: chip });
  });
});
