import type { Page } from "@playwright/test";
import { test, expect } from "../support/testFixture";
import { takeShot } from "./shot";
import {
  CONNECTED_MOCKS,
  SOURCE_DB,
  TARGET_DB,
  buildProfilesSeedScript,
} from "./db-db-sync.mocks";

const TOOL = "db-db-sync";
const TOOL_URL = "/tools/db-db-sync";

const HEADINGS = {
  source: "1. Configurar Base de Datos Origen (DB 1)",
  target: "2. Configurar Base de Datos Destino (DB 2)",
  mode: "3. Modo de Sincronización",
  suid: /4\. Configuración de SUID/,
  parameters: /5\. Parámetros Avanzados/,
  results: /6\. Resultados de Análisis/,
  columnMapping: "4. Mapeo de Columnas Origen a Destino",
  fullReplace: "5. Reemplazo Completo de la Tabla Destino",
};

const COMPARED_ATTRIBUTES = ["departamento", "localidad", "area_m2", "uso_suelo"];

const BUTTONS = {
  connect: "Conectar y Obtener Columnas",
  toTarget: "Continuar al Paso 2",
  toMode: "Continuar al Paso 3",
  toSuid: "Continuar a Mapeo SUID",
  toParameters: "Continuar a Parámetros de Sincronización",
  analyze: "Iniciar Análisis y Comparación",
  toColumnMapping: "Continuar a Mapeo de Columnas",
  toFullReplace: "Continuar a Reemplazo Completo",
  runReplace: "Vaciar destino y recargar desde origen",
};

interface ConnectionData {
  host: string;
  database: string;
  user: string;
  password: string;
  table: string;
}

async function shot(page: Page, name: string): Promise<void> {
  await page.evaluate(() => window.scrollTo(0, 0));
  await takeShot(page, { tool: TOOL, name, target: page.locator("main") });
}

async function expectHeading(page: Page, name: string | RegExp): Promise<void> {
  await expect(page.getByRole("heading", { name })).toBeVisible();
}

async function connect(page: Page, connection: ConnectionData): Promise<void> {
  await page.getByLabel("Host / Servidor").fill(connection.host);
  await page.getByLabel("Nombre de Base de Datos").fill(connection.database);
  await page.getByLabel("Usuario").fill(connection.user);
  await page.getByLabel("Contraseña (no se guarda)").fill(connection.password);
  await page.getByLabel("Nombre de la Tabla").fill(connection.table);
  await page.getByRole("button", { name: BUTTONS.connect }).click();
  await expect(page.getByText("Conexión establecida con éxito")).toBeVisible();
}

async function connectSource(page: Page): Promise<void> {
  await page.goto(TOOL_URL);
  await expectHeading(page, HEADINGS.source);
  await connect(page, SOURCE_DB);
}

async function goToTarget(page: Page): Promise<void> {
  await connectSource(page);
  await page.getByRole("button", { name: BUTTONS.toTarget }).click();
  await expectHeading(page, HEADINGS.target);
}

async function connectTarget(page: Page): Promise<void> {
  await goToTarget(page);
  await connect(page, TARGET_DB);
}

async function goToModeStep(page: Page): Promise<void> {
  await connectTarget(page);
  await page.getByRole("button", { name: BUTTONS.toMode }).click();
  await expectHeading(page, HEADINGS.mode);
}

async function goToSuidMapping(page: Page): Promise<void> {
  await goToModeStep(page);
  await page.getByRole("button", { name: BUTTONS.toSuid }).click();
  await expectHeading(page, HEADINGS.suid);
  await page.getByRole("button", { name: "padron", exact: true }).click();
  await page.getByRole("button", { name: "gid", exact: true }).click();
  for (const attribute of COMPARED_ATTRIBUTES) {
    await page.getByRole("checkbox", { name: attribute }).check();
  }
}

async function goToParameters(page: Page): Promise<void> {
  await goToSuidMapping(page);
  await page.getByRole("button", { name: BUTTONS.toParameters }).click();
  await expectHeading(page, HEADINGS.parameters);
}

async function goToResults(page: Page): Promise<void> {
  await goToParameters(page);
  await page.getByRole("button", { name: BUTTONS.analyze }).click();
  await expectHeading(page, HEADINGS.results);
  await expect(page.getByRole("button", { name: /Total Evaluados/i })).toBeVisible();
}

async function goToColumnMapping(page: Page): Promise<void> {
  await goToModeStep(page);
  await page.getByText("Reemplazo completo", { exact: true }).click();
  await page.getByRole("button", { name: BUTTONS.toColumnMapping }).click();
  await expectHeading(page, HEADINGS.columnMapping);
}

async function goToFullReplace(page: Page): Promise<void> {
  await goToColumnMapping(page);
  await page.getByRole("button", { name: BUTTONS.toFullReplace }).click();
  await expectHeading(page, HEADINGS.fullReplace);
}

async function fillReplaceConfirmation(page: Page): Promise<void> {
  await page.getByLabel(/Para confirmar, escriba/).fill("public.parcelas");
  await page.getByLabel(/Contraseña de PostgreSQL del destino/).fill(TARGET_DB.password);
}

test.describe("Wiki screenshots: db-db-sync", () => {
  test.beforeEach(async ({ mockBackend }) => {
    await mockBackend(CONNECTED_MOCKS);
  });

  test("01-inicio", async ({ page }) => {
    await page.goto(TOOL_URL);
    await expectHeading(page, HEADINGS.source);
    await shot(page, "01-inicio");
  });

  test("02-origen-conectado", async ({ page }) => {
    await connectSource(page);
    await shot(page, "02-origen-conectado");
  });

  test("03-perfiles-busqueda", async ({ page }) => {
    const seed = buildProfilesSeedScript();
    await page.addInitScript(({ key, value }) => window.localStorage.setItem(key, value), seed);
    await page.goto(TOOL_URL);
    await expectHeading(page, HEADINGS.source);
    await page.getByRole("button", { name: "Cargar perfil guardado" }).click();
    await page.getByLabel("Buscar conexión guardada").fill("catastro");
    await expect(page.getByRole("listbox").getByText("Pruebas local")).toHaveCount(0);
    await shot(page, "03-perfiles-busqueda");
  });

  test("04-destino-conectado", async ({ page }) => {
    await connectTarget(page);
    await shot(page, "04-destino-conectado");
  });

  test("05-modo-sincronizacion", async ({ page }) => {
    await goToModeStep(page);
    await shot(page, "05-modo-sincronizacion");
  });

  test("06-mapeo-suid", async ({ page }) => {
    await goToSuidMapping(page);
    await shot(page, "06-mapeo-suid");
  });

  test("07-parametros", async ({ page }) => {
    await goToParameters(page);
    await shot(page, "07-parametros");
  });

  test("08-resultados-resumen", async ({ page }) => {
    await goToResults(page);
    await shot(page, "08-resultados-resumen");
  });

  test("09-parches-sql", async ({ page }) => {
    await goToResults(page);
    await page.getByRole("button", { name: /Script SQL PostGIS/ }).click();
    await expect(page.getByRole("heading", { name: "Scripts SQL PostGIS" })).toBeVisible();
    await shot(page, "09-parches-sql");
  });

  test("10-reemplazo-mapeo-columnas", async ({ page }) => {
    await goToColumnMapping(page);
    await shot(page, "10-reemplazo-mapeo-columnas");
  });

  test("11-reemplazo-confirmacion", async ({ page }) => {
    await goToFullReplace(page);
    await fillReplaceConfirmation(page);
    await expect(page.getByRole("button", { name: BUTTONS.runReplace })).toBeEnabled();
    await shot(page, "11-reemplazo-confirmacion");
  });

  test("12-reemplazo-resultado", async ({ page }) => {
    await goToFullReplace(page);
    await fillReplaceConfirmation(page);
    await page.getByRole("button", { name: BUTTONS.runReplace }).click();
    await expect(page.getByText("Reemplazo completado")).toBeVisible();
    await shot(page, "12-reemplazo-resultado");
  });

  test("13-parches-ejecutar-modal", async ({ page }) => {
    await goToResults(page);
    await page.getByRole("button", { name: /Script SQL PostGIS/ }).click();
    await page.getByRole("button", { name: "Ejecutar en BD" }).click();
    const title = page.getByText("Confirmación de Ejecución en Base de Datos");
    await expect(title).toBeVisible();
    await page.getByLabel("Contraseña de PostgreSQL").fill(TARGET_DB.password);
    const modal = title.locator("xpath=ancestor::div[contains(@class,'overlay')][1]/div[1]");
    await takeShot(page, { tool: TOOL, name: "13-parches-ejecutar-modal", target: modal });
  });
});
