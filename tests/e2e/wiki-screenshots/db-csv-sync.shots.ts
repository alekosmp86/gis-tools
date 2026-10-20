import type { Page } from "@playwright/test";
import { test, expect } from "../support/testFixture";
import { takeShot } from "./shot";
import { SOURCE_DB } from "./db-db-sync.mocks";
import { CSV_CONNECTED_MOCKS, CSV_CONTENT, CSV_FILE_NAME } from "./db-csv-sync.mocks";
import { connectDatabase, expectHeading, shotMain, useNeutralMapTiles, waitForMapTiles } from "./wizardShotHelpers";

const TOOL = "db-csv-sync";
const TOOL_URL = "/tools/db-csv-sync";

const HEADINGS = {
  connection: "1. Conectar a Base de Datos PostgreSQL",
  upload: "2. Cargar Archivo de Datos CSV",
  suid: "3. Configuración de SUID y Campos a Comparar",
  parameters: "4. Parámetros Avanzados de Sincronización",
  results: "5. Resultados de Análisis y Discrepancias",
};

const COMPARED_ATTRIBUTES = ["departamento", "localidad", "area_m2", "uso_suelo"];

const BUTTONS = {
  toUpload: "Continuar al Paso 2",
  toSuid: "Continuar al Paso 3",
  toParameters: "Continuar a Parámetros de Sincronización",
  analyze: "Iniciar Análisis y Comparación",
};

const FILE_INPUT_LABEL = "Seleccionar archivo CSV";

async function shot(page: Page, name: string): Promise<void> {
  await shotMain(page, TOOL, name);
}

async function uploadCsv(page: Page, content: string): Promise<void> {
  await page.getByLabel(FILE_INPUT_LABEL).setInputFiles({
    name: CSV_FILE_NAME,
    mimeType: "text/csv",
    buffer: Buffer.from(content),
  });
}

async function connectSource(page: Page): Promise<void> {
  await page.goto(TOOL_URL);
  await expectHeading(page, HEADINGS.connection);
  await connectDatabase(page, SOURCE_DB);
}

async function goToUpload(page: Page): Promise<void> {
  await connectSource(page);
  await page.getByRole("button", { name: BUTTONS.toUpload }).click();
  await expectHeading(page, HEADINGS.upload);
}

async function loadCsv(page: Page): Promise<void> {
  await goToUpload(page);
  await uploadCsv(page, CSV_CONTENT);
  await expect(page.getByText(CSV_FILE_NAME).first()).toBeVisible();
  await expect(page.getByText("VISTA PREVIA ESPACIAL DEL ARCHIVO CSV")).toBeVisible();
}

async function goToSuidMapping(page: Page): Promise<void> {
  await loadCsv(page);
  await page.getByRole("button", { name: BUTTONS.toSuid }).click();
  await expectHeading(page, HEADINGS.suid);
  await page.getByRole("button", { name: "padron", exact: true }).click();
  await page.getByRole("button", { name: "gid", exact: true }).click();
  for (const attribute of COMPARED_ATTRIBUTES) {
    await page.getByRole("checkbox", { name: attribute, exact: true }).check();
  }
  await page.getByRole("checkbox", { name: /Comparar forma y coordenadas/ }).check();
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

test.describe("Wiki screenshots: db-csv-sync", () => {
  test.beforeEach(async ({ page, mockBackend }) => {
    await mockBackend(CSV_CONNECTED_MOCKS);
    await useNeutralMapTiles(page);
  });

  test("01-inicio", async ({ page }) => {
    await page.goto(TOOL_URL);
    await expectHeading(page, HEADINGS.connection);
    await shot(page, "01-inicio");
  });

  test("02-base-conectada", async ({ page }) => {
    await connectSource(page);
    await shot(page, "02-base-conectada");
  });

  test("03-carga-csv", async ({ page }) => {
    await goToUpload(page);
    await shot(page, "03-carga-csv");
  });

  test("04-csv-cargado", async ({ page }) => {
    await loadCsv(page);
    await waitForMapTiles(page);
    await shot(page, "04-csv-cargado");
  });

  test("05-vista-previa-mapa", async ({ page }) => {
    await loadCsv(page);
    const mapSection = page.locator("[class*='mapSection']");
    await expect(mapSection.locator("[data-rendered-count]")).not.toHaveAttribute("data-rendered-count", "0");
    await waitForMapTiles(page);
    await takeShot(page, { tool: TOOL, name: "05-vista-previa-mapa", target: mapSection });
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

  test("09-mapa-discrepancias", async ({ page }) => {
    await goToResults(page);
    await page.getByRole("button", { name: /Mapa de Discrepancias Espaciales/i }).click();
    await expect(page.getByRole("combobox", { name: /Seleccionar mapa base/i })).toBeVisible();
    await expect(page.locator("[data-rendered-count]")).not.toHaveAttribute("data-rendered-count", "0");
    await waitForMapTiles(page);
    await shot(page, "09-mapa-discrepancias");
  });

  test("10-parches-sql", async ({ page }) => {
    await goToResults(page);
    await page.getByRole("button", { name: /Script SQL PostGIS/ }).click();
    await expect(page.getByRole("heading", { name: "Scripts SQL PostGIS" })).toBeVisible();
    await shot(page, "10-parches-sql");
  });

  test("11-parches-ejecutar-modal", async ({ page }) => {
    await goToResults(page);
    await page.getByRole("button", { name: /Script SQL PostGIS/ }).click();
    await page.getByRole("button", { name: "Ejecutar en BD" }).click();
    const title = page.getByText("Confirmación de Ejecución en Base de Datos");
    await expect(title).toBeVisible();
    await page.getByLabel("Contraseña de PostgreSQL").fill(SOURCE_DB.password);
    const modal = title.locator("xpath=ancestor::div[contains(@class,'overlay')][1]/div[1]");
    await takeShot(page, { tool: TOOL, name: "11-parches-ejecutar-modal", target: modal });
  });

  test("12-error-archivo", async ({ page }) => {
    await goToUpload(page);
    await uploadCsv(page, "");
    await expect(page.getByText("El archivo CSV está vacío.")).toBeVisible();
    await shot(page, "12-error-archivo");
  });
});
