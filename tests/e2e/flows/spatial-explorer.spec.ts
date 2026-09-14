import { test, expect } from "../support/testFixture";
import { SAMPLE_GEOJSON_CONTENT } from "../fixtures/sampleFiles";
import { connectDb } from "../support/wizardSteps";

test.describe("Herramienta: Explorador Espacial (/tools/spatial-explorer)", () => {
  test.beforeEach(async ({ mockBackend }) => {
    await mockBackend();
  });

  test("debe permitir alternar entre las pestañas de Archivo y Base de Datos", async ({ page }) => {
    await page.goto("/tools/spatial-explorer");

    // Verificar encabezado principal del explorador
    await expect(
      page.getByRole("heading", { name: "Explorador Espacial" })
    ).toBeVisible();

    // Pestaña inicial por defecto: Archivo Local
    await expect(
      page.getByText("Haga clic o arrastre un archivo espacial aquí")
    ).toBeVisible();

    // Cambiar a la pestaña de Base de Datos PostGIS
    await page.getByRole("button", { name: "Base de Datos PostGIS" }).click();
    await expect(page.getByLabel("Nombre de Base de Datos")).toBeVisible();
    await expect(page.getByRole("button", { name: "Conectar y Obtener Columnas" })).toBeVisible();

    // Volver a la pestaña de Archivo Local
    await page.getByRole("button", { name: "Archivo Local (Shapefile, GeoJSON, CSV)" }).click();
    await expect(
      page.getByText("Haga clic o arrastre un archivo espacial aquí")
    ).toBeVisible();
  });

  test("debe cargar un archivo espacial GeoJSON y renderizar el mapa junto a la tabla de atributos", async ({ page }) => {
    await page.goto("/tools/spatial-explorer");

    // Subir archivo GeoJSON de prueba
    const fileInput = page.locator('input[type="file"]');
    await fileInput.setInputFiles({
      name: "sample.geojson",
      mimeType: "application/geo+json",
      buffer: Buffer.from(SAMPLE_GEOJSON_CONTENT),
    });

    // Validar visualización de metadatos de archivo cargado
    await expect(page.getByText("sample.geojson")).toBeVisible();
    await expect(page.getByText("3 registros", { exact: true })).toBeVisible();

    // Verificar que el mapa WebGL monta y expone el contador de entidades
    const mapElement = page.locator('[data-rendered-count]');
    await expect(mapElement).toBeVisible();
    await expect(mapElement).toHaveAttribute("data-rendered-count", "3");

    // Verificar que la tabla de atributos renderiza las columnas y filas del dataset
    await expect(page.getByRole("columnheader", { name: "suid" })).toBeVisible();
    await expect(page.getByRole("cell", { name: "PAD-001" })).toBeVisible();
    await expect(page.getByRole("cell", { name: "PAD-002" })).toBeVisible();
    await expect(page.getByRole("cell", { name: "PAD-004" })).toBeVisible();
  });

  test("debe conectar a base de datos PostGIS y visualizar registros y geometrías", async ({ page }) => {
    await page.goto("/tools/spatial-explorer");

    // Cambiar a pestaña PostGIS
    await page.getByRole("button", { name: "Base de Datos PostGIS" }).click();

    // Conectar a la base de datos simulada
    await connectDb(page);

    // Proceder a la visualización de la tabla
    const proceedBtn = page.getByRole("button", { name: "Visualizar Tabla en Mapa y Atributos" });
    await expect(proceedBtn).toBeVisible();
    await proceedBtn.click();

    // Verificar montaje de mapa y presencia de metadatos de tabla
    await expect(page.getByText("Metadatos de Tabla PostgreSQL / PostGIS")).toBeVisible();
    const mapElement = page.locator('[data-rendered-count]');
    await expect(mapElement).toBeVisible();

    // Verificar que la tabla de atributos muestre los registros obtenidos
    await expect(page.getByRole("columnheader", { name: "suid" })).toBeVisible();
    await expect(page.getByRole("cell", { name: "PAD-001" })).toBeVisible();
  });

  test("debe sincronizar la selección de fila en la tabla de atributos con el mapa", async ({ page }) => {
    await page.goto("/tools/spatial-explorer");

    // Cargar archivo de prueba
    await page.locator('input[type="file"]').setInputFiles({
      name: "sample.geojson",
      mimeType: "application/geo+json",
      buffer: Buffer.from(SAMPLE_GEOJSON_CONTENT),
    });

    await expect(page.getByRole("cell", { name: "PAD-001" })).toBeVisible();

    // Seleccionar la primera fila en la tabla de atributos
    const firstRowCell = page.getByRole("cell", { name: "PAD-001" });
    await firstRowCell.click();

    // Verificar apertura del popup correspondiente en el mapa
    await expect(page.locator(".maplibregl-popup")).toBeVisible();
    await expect(page.locator(".maplibregl-popup-content")).toContainText("PAD-001");
  });
});
