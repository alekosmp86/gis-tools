import { test, expect } from "../support/testFixture";
import { SAMPLE_GEOJSON_CONTENT } from "../fixtures/sampleFiles";
import { buildNdjsonStream } from "../fixtures/dbFixtures";
import { connectDb } from "../support/wizardSteps";
import type { Page } from "@playwright/test";

async function navigateToResultsStep(page: Page) {
  await page.goto("/tools/db-shapefile-sync");

  // Paso 1: Conexión
  await connectDb(page);
  await page.getByRole("button", { name: "Continuar al Paso 2" }).click();

  // Paso 2: Carga de GeoJSON
  await page.getByLabel("Seleccionar archivo Shapefile o GeoJSON").setInputFiles({
    name: "parcelas.geojson",
    mimeType: "application/geo+json",
    buffer: Buffer.from(SAMPLE_GEOJSON_CONTENT),
  });
  await expect(page.getByText("parcelas.geojson")).toBeVisible();
  await page.getByRole("button", { name: "Continuar al Paso 3" }).click();

  // Paso 3: Configurar SUID ('suid' en lugar de 'gid') y atributos a comparar
  await expect(
    page.getByRole("heading", { name: "3. Configuración de SUID y Campos a Comparar" })
  ).toBeVisible();

  // Seleccionar 'suid' y deseleccionar 'gid' para que coincidan las claves con el dataset
  await page.getByRole("button", { name: "suid", exact: true }).click();
  await page.getByRole("button", { name: "gid", exact: true }).click();

  // Seleccionar campos compartidos: departamento y codigo mediante checkboxes exactos
  await page.getByRole("checkbox", { name: "departamento", exact: true }).click();
  await page.getByRole("checkbox", { name: "codigo", exact: true }).click();

  await page.getByRole("button", { name: "Continuar a Parámetros de Sincronización" }).click();

  // Paso 4: Parámetros
  await expect(
    page.getByRole("heading", { name: "4. Parámetros Avanzados de Sincronización" })
  ).toBeVisible();
  await page.getByRole("button", { name: "Iniciar Análisis y Comparación" }).click();

  // Paso 5: Resultados
  await expect(
    page.getByRole("heading", { name: "5. Resultados de Análisis y Discrepancias" })
  ).toBeVisible();
}

test.describe("Vista Común: ComparisonResultsView (Resultados y Discrepancias)", () => {
  test.beforeEach(async ({ mockBackend }) => {
    await mockBackend();
  });

  test("debe cargar la vista de resultados con pestaña por defecto (Tabla) y KPIs de resumen", async ({
    page,
  }) => {
    await navigateToResultsStep(page);

    // KPIs de resumen
    await expect(page.getByRole("button", { name: /Total Evaluados/i })).toBeVisible();
    await expect(page.getByRole("button", { name: /Coincidencias/i })).toBeVisible();
    await expect(page.getByRole("button", { name: /Solo en Base de Datos/i })).toBeVisible();
    await expect(page.getByRole("button", { name: /Solo en Archivo/i })).toBeVisible();
    await expect(page.getByRole("button", { name: /Discrepancias Atributos/i })).toBeVisible();

    // Tabla de discrepancias activa por defecto
    await expect(page.getByRole("table")).toBeVisible();
    await expect(page.getByRole("columnheader", { name: "SUID" })).toBeVisible();
    await expect(page.getByRole("columnheader", { name: "Tipo de Discrepancia" })).toBeVisible();
  });

  test("debe filtrar los registros en la tabla al hacer clic en las tarjetas KPI", async ({
    page,
  }) => {
    await navigateToResultsStep(page);

    // Inicialmente deben verse los registros discrepantes de la prueba
    // PAD-002 (ATTRIBUTE_MISMATCH), PAD-003 (ONLY_IN_DB), PAD-004 (ONLY_IN_FILE)
    await expect(page.getByRole("cell", { name: "PAD-002" })).toBeVisible();
    await expect(page.getByRole("cell", { name: "PAD-003" })).toBeVisible();
    await expect(page.getByRole("cell", { name: "PAD-004" })).toBeVisible();

    // Filtrar solo por "Solo en Base de Datos"
    await page.getByRole("button", { name: /Solo en Base de Datos/i }).click();

    // Debe mostrar PAD-003 y ocultar los demás
    await expect(page.getByRole("cell", { name: "PAD-003" })).toBeVisible();
    await expect(page.getByRole("cell", { name: "PAD-002" })).toHaveCount(0);
    await expect(page.getByRole("cell", { name: "PAD-004" })).toHaveCount(0);

    // Filtrar por "Discrepancias Atributos"
    await page.getByRole("button", { name: /Discrepancias Atributos/i }).click();
    await expect(page.getByRole("cell", { name: "PAD-002" })).toBeVisible();
    await expect(page.getByRole("cell", { name: "PAD-003" })).toHaveCount(0);
    await expect(page.getByRole("cell", { name: "PAD-004" })).toHaveCount(0);

    // Filtrar por "Solo en Archivo"
    await page.getByRole("button", { name: /Solo en Archivo/i }).click();
    await expect(page.getByRole("cell", { name: "PAD-004" })).toBeVisible();
    await expect(page.getByRole("cell", { name: "PAD-002" })).toHaveCount(0);
    await expect(page.getByRole("cell", { name: "PAD-003" })).toHaveCount(0);

    // Volver a mostrar todos haciendo clic en Total Evaluados
    await page.getByRole("button", { name: /Total Evaluados/i }).click();
    await expect(page.getByRole("cell", { name: "PAD-002" })).toBeVisible();
    await expect(page.getByRole("cell", { name: "PAD-003" })).toBeVisible();
    await expect(page.getByRole("cell", { name: "PAD-004" })).toBeVisible();
  });

  test("debe alternar pestañas entre Tabla y Script SQL, mostrando el parche generado", async ({
    page,
  }) => {
    await navigateToResultsStep(page);

    // Cambiar a la pestaña de Script SQL
    await page.getByRole("button", { name: /Script SQL PostGIS/i }).click();

    // Verificar que el drawer de parches SQL se visualiza con sus pestañas UPDATE e INSERT
    const updateTab = page.getByRole("button", { name: /Script UPDATE/i });
    const insertTab = page.getByRole("button", { name: /Script INSERT/i });
    await expect(updateTab).toBeVisible();
    await expect(insertTab).toBeVisible();

    // Verificar que la vista previa contiene sentencias SQL UPDATE generadas y es visible
    const updatePre = page.locator("pre").filter({ hasText: "UPDATE" });
    await expect(updatePre).toBeVisible();
    await expect(updatePre).toContainText('UPDATE "public"."parcelas_catastro"');
    await expect(updatePre).toContainText("'B2_MODIFIED'");

    // Cambiar a la pestaña Script INSERT y verificar que se torna visible
    await insertTab.click();
    const insertPre = page.locator("pre").filter({ hasText: "INSERT INTO" });
    await expect(insertPre).toBeVisible();
    await expect(insertPre).toContainText('INSERT INTO "public"."parcelas_catastro"');
    await expect(insertPre).toContainText("'PAD-004'");

    // Volver a la pestaña de Tabla
    await page.getByRole("button", { name: /Tabla de Discrepancias/i }).click();
    await expect(page.getByRole("cell", { name: "PAD-002" })).toBeVisible();
  });

  test("debe mostrar el estado de error cuando la consulta de registros falla", async ({
    page,
    mockBackend,
    allowConsoleErrors,
  }) => {
    allowConsoleErrors();

    await mockBackend({
      recordsStatus: 500,
    });

    await navigateToResultsStep(page);

    // La vista debe renderizar el mensaje de alerta de error con código HTTP 500
    await expect(
      page.getByText("Error HTTP (500) al conectar con el servicio de consulta PostGIS.")
    ).toBeVisible();
  });

  test("debe mostrar el estado de carga mientras se consultan registros y luego mostrar el resumen", async ({
    page,
  }) => {
    let releaseStream: () => void = () => {};
    const streamGate = new Promise<void>((resolve) => {
      releaseStream = resolve;
    });

    // Interceptar diferido de /api/db/records/stream
    await page.route("**/api/db/records/stream", async (route) => {
      await streamGate;
      await route.fulfill({
        status: 200,
        headers: {
          "Content-Type": "application/x-ndjson; charset=utf-8",
          "Cache-Control": "no-cache",
        },
        body: buildNdjsonStream(),
      });
    });

    await navigateToResultsStep(page);

    // Verificar que el indicador de carga (barra de progreso o mensaje) está visible mientras el stream está retenido
    await expect(
      page.getByText(/Conectando a base de datos PostgreSQL|Consultando registros PostGIS/i)
    ).toBeVisible();

    // Liberar la respuesta del stream
    releaseStream();

    // Verificar que el estado de carga finaliza y se visualiza el resumen de resultados
    await expect(page.getByRole("button", { name: /Total Evaluados/i })).toBeVisible();
  });
});
