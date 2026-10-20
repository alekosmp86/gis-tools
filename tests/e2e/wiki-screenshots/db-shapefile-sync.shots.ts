import type { Page } from "@playwright/test";
import { test, expect } from "../support/testFixture";
import { takeShot } from "./shot";
import { SOURCE_DB } from "./db-db-sync.mocks";
import {
  buildShapefileZip,
  SHAPEFILE_CONNECTED_MOCKS,
  SHAPEFILE_DEPARTMENT_COLUMN,
  SHAPEFILE_ZIP_NAME,
} from "./db-shapefile-sync.mocks";
import {
  connectDatabase,
  expectHeading,
  shotMain,
  useNeutralMapTiles,
  waitForMapTiles,
} from "./wizardShotHelpers";

const TOOL = "db-shapefile-sync";
const TOOL_URL = "/tools/db-shapefile-sync";

const HEADINGS = {
  connection: "1. Conectar a Base de Datos PostgreSQL",
  upload: "2. Cargar Capa Espacial Shapefile",
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

const FILE_INPUT_LABEL = "Seleccionar archivo Shapefile o GeoJSON";
const UNSUPPORTED_FILE_NAME = "parcelas_actualizadas.txt";
const UNSUPPORTED_FORMAT_MESSAGE = "Formato no soportado. Por favor suba un archivo .zip (SHP+DBF) o .geojson.";
const UNCHECKED_RECORD = "10237";

async function shot(page: Page, name: string): Promise<void> {
  await shotMain(page, TOOL, name);
}

async function uploadShapefile(page: Page): Promise<void> {
  await page.getByLabel(FILE_INPUT_LABEL).setInputFiles({
    name: SHAPEFILE_ZIP_NAME,
    mimeType: "application/zip",
    buffer: buildShapefileZip(),
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

async function loadShapefile(page: Page): Promise<void> {
  await goToUpload(page);
  await uploadShapefile(page);
  await expect(page.getByText(SHAPEFILE_ZIP_NAME).first()).toBeVisible();
  await expect(page.getByText("VISTA PREVIA ESPACIAL DE CAPA VECTORIAL")).toBeVisible();
}

async function goToSuidMapping(page: Page): Promise<void> {
  await loadShapefile(page);
  await page.getByRole("button", { name: BUTTONS.toSuid }).click();
  await expectHeading(page, HEADINGS.suid);
  await page.getByRole("button", { name: "padron", exact: true }).click();
  await page.getByRole("button", { name: "gid", exact: true }).click();
  for (const attribute of COMPARED_ATTRIBUTES) {
    await page.getByRole("checkbox", { name: attribute, exact: true }).check();
  }
  await page
    .locator("[class*='mappingRow']")
    .filter({ has: page.getByRole("checkbox", { name: "departamento", exact: true }) })
    .locator("select")
    .selectOption(SHAPEFILE_DEPARTMENT_COLUMN);
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

test.describe("Wiki screenshots: db-shapefile-sync", () => {
  test.beforeEach(async ({ page, mockBackend }) => {
    await mockBackend(SHAPEFILE_CONNECTED_MOCKS);
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

  test("03-carga-shapefile", async ({ page }) => {
    await goToUpload(page);
    await shot(page, "03-carga-shapefile");
  });

  test("04-shapefile-cargado", async ({ page }) => {
    await loadShapefile(page);
    await waitForMapTiles(page);
    await shot(page, "04-shapefile-cargado");
  });

  test("05-vista-previa-mapa", async ({ page }) => {
    await loadShapefile(page);
    const mapSection = page.locator("[class*='mapSection']");
    await expect(mapSection.locator("[data-rendered-count]")).not.toHaveAttribute("data-rendered-count", "0");
    await waitForMapTiles(page);
    await takeShot(page, { tool: TOOL, name: "05-vista-previa-mapa", target: mapSection });
  });

  test("06-catalogo-cartografico", async ({ page }) => {
    await goToUpload(page);
    await page.getByRole("tab", { name: /Catálogo Cartográfico/ }).click();
    await page.getByRole("button", { name: /Catastro Nacional de Parcelas/ }).click();
    await expect(page.getByText("parcelas_montevideo.zip")).toBeVisible();
    await shot(page, "06-catalogo-cartografico");
  });

  test("07-mapeo-suid", async ({ page }) => {
    await goToSuidMapping(page);
    await shot(page, "07-mapeo-suid");
  });

  test("08-parametros", async ({ page }) => {
    await goToParameters(page);
    await shot(page, "08-parametros");
  });

  test("09-resultados-resumen", async ({ page }) => {
    await goToResults(page);
    await shot(page, "09-resultados-resumen");
  });

  test("10-seleccion-registros", async ({ page }) => {
    await goToResults(page);
    await page.getByRole("checkbox", { name: `Seleccionar registro ${UNCHECKED_RECORD}` }).uncheck();
    const table = page.locator("[class*='tableContainer']").first();
    await expect(table.getByText("seleccionados")).toBeVisible();
    await takeShot(page, { tool: TOOL, name: "10-seleccion-registros", target: table });
  });

  test("11-mapa-discrepancias", async ({ page }) => {
    await goToResults(page);
    await page.getByRole("button", { name: /Mapa de Discrepancias Espaciales/i }).click();
    await expect(page.getByRole("combobox", { name: /Seleccionar mapa base/i })).toBeVisible();
    await expect(page.locator("[data-rendered-count]")).not.toHaveAttribute("data-rendered-count", "0");
    await waitForMapTiles(page);
    await shot(page, "11-mapa-discrepancias");
  });

  test("12-parches-sql", async ({ page }) => {
    await goToResults(page);
    await page.getByRole("button", { name: /Script SQL PostGIS/ }).click();
    await expect(page.getByRole("heading", { name: "Scripts SQL PostGIS" })).toBeVisible();
    await expect(page.locator("pre").filter({ hasText: "UPDATE" })).toBeVisible();
    await shot(page, "12-parches-sql");
  });

  test("13-parches-ejecutar-modal", async ({ page }) => {
    await goToResults(page);
    await page.getByRole("button", { name: /Script SQL PostGIS/ }).click();
    await page.getByRole("button", { name: "Ejecutar en BD" }).click();
    const title = page.getByText("Confirmación de Ejecución en Base de Datos");
    await expect(title).toBeVisible();
    await page.getByLabel("Contraseña de PostgreSQL").fill(SOURCE_DB.password);
    const modal = title.locator("xpath=ancestor::div[contains(@class,'overlay')][1]/div[1]");
    await takeShot(page, { tool: TOOL, name: "13-parches-ejecutar-modal", target: modal });
  });

  test("14-error-archivo", async ({ page }) => {
    await goToUpload(page);
    await page.getByLabel(FILE_INPUT_LABEL).setInputFiles({
      name: UNSUPPORTED_FILE_NAME,
      mimeType: "text/plain",
      buffer: Buffer.from("sin datos espaciales"),
    });
    await expect(page.getByText(UNSUPPORTED_FORMAT_MESSAGE)).toBeVisible();
    await shot(page, "14-error-archivo");
  });
});
