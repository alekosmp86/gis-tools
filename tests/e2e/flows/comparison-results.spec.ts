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
    // H4: Ajustar texto exacto para descriptor de shapefile
    await expect(page.getByRole("button", { name: "Solo en Archivo Shapefile" })).toBeVisible();
    await expect(page.getByRole("button", { name: /Discrepancias Atributos/i })).toBeVisible();

    // H3 (ronda 3): el conteo mostrado en cada tarjeta debe corresponder al dato real de resumen,
    // no solo probar que la tarjeta existe. Fixture: PAD-001 coincide, PAD-002 tiene discrepancia
    // de atributos, PAD-003 solo en BD, PAD-004 solo en archivo — 4 registros evaluados en total.
    await expect(
      page.getByRole("button", { name: /Total Evaluados/i }).getByText("4", { exact: true })
    ).toBeVisible();
    await expect(
      page
        .getByRole("button", { name: /Solo en Base de Datos/i })
        .getByText("1", { exact: true })
    ).toBeVisible();
    await expect(
      page
        .getByRole("button", { name: "Solo en Archivo Shapefile" })
        .getByText("1", { exact: true })
    ).toBeVisible();
    await expect(
      page
        .getByRole("button", { name: /Discrepancias Atributos/i })
        .getByText("1", { exact: true })
    ).toBeVisible();

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

    // Filtrar por "Solo en Archivo Shapefile"
    await page.getByRole("button", { name: "Solo en Archivo Shapefile" }).click();
    await expect(page.getByRole("cell", { name: "PAD-004" })).toBeVisible();
    await expect(page.getByRole("cell", { name: "PAD-002" })).toHaveCount(0);
    await expect(page.getByRole("cell", { name: "PAD-003" })).toHaveCount(0);

    // Volver a mostrar todos haciendo clic en Total Evaluados
    await page.getByRole("button", { name: /Total Evaluados/i }).click();
    await expect(page.getByRole("cell", { name: "PAD-002" })).toBeVisible();
    await expect(page.getByRole("cell", { name: "PAD-003" })).toBeVisible();
    await expect(page.getByRole("cell", { name: "PAD-004" })).toBeVisible();
  });

  // H4 (ronda 3): la búsqueda de texto libre nunca se había ejercitado. Su estado
  // (searchQuery/onSearchChange) se enhebra desde ComparisonResultsView a través de
  // DiscrepanciesTable hasta el encabezado de la tabla — exactamente el cableado que una
  // descomposición puede romper sin que ninguna otra prueba lo note.
  test("debe filtrar la tabla mediante el campo de búsqueda de texto libre", async ({ page }) => {
    await navigateToResultsStep(page);

    const searchInput = page.getByPlaceholder("Filtrar por SUID o atributo...");
    await expect(page.getByRole("cell", { name: "PAD-002" })).toBeVisible();
    await expect(page.getByRole("cell", { name: "PAD-003" })).toBeVisible();
    await expect(page.getByRole("cell", { name: "PAD-004" })).toBeVisible();

    await searchInput.fill("PAD-004");
    await expect(page.getByRole("cell", { name: "PAD-004" })).toBeVisible();
    await expect(page.getByRole("cell", { name: "PAD-002" })).toHaveCount(0);
    await expect(page.getByRole("cell", { name: "PAD-003" })).toHaveCount(0);

    await searchInput.fill("");
    await expect(page.getByRole("cell", { name: "PAD-002" })).toBeVisible();
    await expect(page.getByRole("cell", { name: "PAD-003" })).toBeVisible();
    await expect(page.getByRole("cell", { name: "PAD-004" })).toBeVisible();
  });

  test("debe alternar pestañas entre Tabla y Script SQL, mostrando el parche generado con exclusión mutua", async ({
    page,
  }) => {
    await navigateToResultsStep(page);

    // Cambiar a la pestaña de Script SQL
    await page.getByRole("button", { name: /Script SQL PostGIS/i }).click();

    // H1: La tabla de discrepancias debe quedar oculta al activar la pestaña SQL
    await expect(page.getByRole("table")).toBeHidden();

    // Verificar que el drawer de parches SQL se visualiza con sus pestañas UPDATE e INSERT
    const updateTab = page.getByRole("button", { name: /Script UPDATE/i });
    const insertTab = page.getByRole("button", { name: /Script INSERT/i });
    await expect(updateTab).toBeVisible();
    await expect(insertTab).toBeVisible();

    // H1: Verificar que la vista previa UPDATE es visible y la INSERT está oculta
    const updatePre = page.locator("pre").filter({ hasText: "UPDATE" });
    const insertPre = page.locator("pre").filter({ hasText: "INSERT INTO" });
    await expect(updatePre).toBeVisible();
    await expect(insertPre).toBeHidden();
    await expect(updatePre).toContainText('UPDATE "public"."parcelas_catastro"');
    await expect(updatePre).toContainText("'B2_MODIFIED'");

    // H1: Cambiar a la pestaña Script INSERT y verificar que se torna visible mientras UPDATE se oculta
    await insertTab.click();
    await expect(insertPre).toBeVisible();
    await expect(updatePre).toBeHidden();
    await expect(insertPre).toContainText('INSERT INTO "public"."parcelas_catastro"');
    await expect(insertPre).toContainText("'PAD-004'");

    // Volver a la pestaña de Tabla y verificar que vuelve a estar visible mientras las previews SQL quedan ocultas
    await page.getByRole("button", { name: /Tabla de Discrepancias/i }).click();
    await expect(page.getByRole("table")).toBeVisible();
    await expect(updatePre).toBeHidden();
    await expect(insertPre).toBeHidden();
    await expect(page.getByRole("cell", { name: "PAD-002" })).toBeVisible();
  });

  test("debe alternar a la pestaña de Mapa, visualizar el contenedor y mostrar estado vacío con filtro sin geometrías", async ({
    page,
  }) => {
    await navigateToResultsStep(page);

    // H2: Cambiar a la pestaña de Mapa de Discrepancias
    await page.getByRole("button", { name: /Mapa de Discrepancias Espaciales/i }).click();

    // El contenedor del mapa debe estar visible y la tabla debe estar oculta.
    // El selector de mapa base es exclusivo del panel del mapa (a diferencia del texto de la
    // pestaña, que coincide también con su propia etiqueta), así que es la prueba inequívoca.
    await expect(page.getByRole("combobox", { name: /Seleccionar mapa base/i })).toBeVisible();
    await expect(page.getByRole("table")).toBeHidden();

    // Comprobar que el mapa ajustó su vista a la extensión real de las discrepancias (D1/D2)
    // Las discrepancias en el fixture están en latitud ~ -34.85 (fuera de la vista inicial por defecto en -32.5)
    const mapContainer = page.locator("[data-rendered-count]");
    await expect(mapContainer).toHaveAttribute("data-rendered-count", "3");
    const centerLatitude = Number(await mapContainer.getAttribute("data-center-lat"));
    expect(centerLatitude).toBeLessThan(-34.0);

    // Filtrar por "Solo en Base de Datos" (PAD-003 tiene geom null, por lo que la colección queda vacía)
    await page.getByRole("button", { name: /Solo en Base de Datos/i }).click();

    // Debe mostrar la alerta informativa de estado vacío para el mapa
    await expect(
      page.getByText("No se encontraron discrepancias para el filtro seleccionado.")
    ).toBeVisible();
  });

  test("debe preservar la posición de la cámara del usuario al alternar entre pestañas y revisitar el mapa", async ({
    page,
  }) => {
    await navigateToResultsStep(page);

    // 1. Alternar a la pestaña de Mapa en primera visita
    await page.getByRole("button", { name: /Mapa de Discrepancias Espaciales/i }).click();
    const mapContainer = page.locator("[data-rendered-count]");
    await expect(mapContainer).toHaveAttribute("data-rendered-count", "3");
    const fittedLatitude = Number(await mapContainer.getAttribute("data-center-lat"));

    // 2. Simular un desplazamiento manual real del usuario (arrastre del mapa con el mouse)
    await mapContainer.scrollIntoViewIfNeeded();
    const mapBox = await mapContainer.boundingBox();
    if (!mapBox) throw new Error("No se pudo obtener el área del mapa para simular el arrastre.");
    const startX = mapBox.x + mapBox.width * 0.25;
    const startY = mapBox.y + mapBox.height * 0.25;
    await page.mouse.move(startX, startY);
    await page.mouse.down();
    await page.mouse.move(startX + 150, startY + 150, { steps: 10 });
    await page.mouse.up();

    await expect
      .poll(async () => Number(await mapContainer.getAttribute("data-center-lat")))
      .not.toBeCloseTo(fittedLatitude, 2);
    const shiftedLatitude = Number(await mapContainer.getAttribute("data-center-lat"));

    // 3. Volver a la pestaña de Tabla
    await page.getByRole("button", { name: /Tabla de Discrepancias/i }).click();
    await expect(page.getByRole("table")).toBeVisible();

    // 4. Regresar a la pestaña de Mapa
    await page.getByRole("button", { name: /Mapa de Discrepancias Espaciales/i }).click();
    await expect(mapContainer).toBeVisible();

    // 5. Verificar que la cámara preservó la posición manual y no reajustó la extensión (D3)
    const revisitedLatitude = Number(await mapContainer.getAttribute("data-center-lat"));
    expect(revisitedLatitude).toBeCloseTo(shiftedLatitude, 2);
  });

  test("debe permitir ejecutar el script SQL en base de datos y marcar la pestaña como ejecutada", async ({
    page,
  }) => {
    await navigateToResultsStep(page);

    // H7: Cambiar a pestaña de Script SQL
    await page.getByRole("button", { name: /Script SQL PostGIS/i }).click();

    // Abrir modal de confirmación de ejecución
    await page.getByRole("button", { name: /Ejecutar en BD/i }).click();

    // Ingresar contraseña en el modal
    await page.getByLabel("Contraseña de PostgreSQL").fill("secret123");

    // Iniciar ejecución por lotes
    await page.getByRole("button", { name: /Iniciar Ejecución por Lotes/i }).click();

    // Verificar resumen de ejecución exitosa
    const finishBtn = page.getByRole("button", { name: /Finalizar y Actualizar Resultados/i });
    await expect(finishBtn).toBeVisible();
    await finishBtn.click();

    // El marcador (Ejecutado) debe reflejarse en la pestaña correspondiente
    await expect(page.getByRole("button", { name: /Script UPDATE \(Ejecutado\)/i })).toBeVisible();
  });

  test("debe mostrar el estado de error cuando la consulta de registros falla", async ({
    page,
    mockBackend,
    allowConsoleErrors,
  }) => {
    allowConsoleErrors(/Failed to load resource/);

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

    // H5: Verificar exactamente la rama ProgressBar que realmente renderiza (sin alternancia regex)
    await expect(
      page.getByText("Conectando a base de datos PostgreSQL...")
    ).toBeVisible();
    await expect(page.getByText("0%")).toBeVisible();

    // Liberar la respuesta del stream
    releaseStream();

    // Verificar que el estado de carga finaliza y se visualiza el resumen de resultados
    await expect(page.getByRole("button", { name: /Total Evaluados/i })).toBeVisible();
  });
});
