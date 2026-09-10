import { test, expect } from "../support/testFixture";
import { SAMPLE_GEOJSON_CONTENT } from "../fixtures/sampleFiles";
import { connectDb } from "../support/wizardSteps";

test.describe("Herramienta: Sincronización DB vs. Shapefile (/tools/db-shapefile-sync)", () => {
  test.beforeEach(async ({ mockBackend }) => {
    await mockBackend();
  });

  test("debe cargar la vista inicial con el paso 1 activo y el avance bloqueado", async ({ page }) => {
    await page.goto("/tools/db-shapefile-sync");

    await expect(
      page.getByRole("heading", { name: "Sincronización de Datos DB vs. Shapefile" })
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "1. Conectar a Base de Datos PostgreSQL" })
    ).toBeVisible();

    const nextButton = page.getByRole("button", { name: "Continuar al Paso 2" });
    await expect(nextButton).toBeVisible();
    await expect(nextButton).toBeDisabled();
  });

  test("debe validar credenciales requeridas y bloquear avance en paso 1", async ({ page }) => {
    await page.goto("/tools/db-shapefile-sync");

    await page.getByRole("button", { name: "Conectar y Obtener Columnas" }).click();

    await expect(
      page.getByText("Por favor ingrese el nombre de la base de datos, usuario y nombre de la tabla.")
    ).toBeVisible();

    await expect(page.getByRole("button", { name: "Continuar al Paso 2" })).toBeDisabled();
  });

  test("debe permitir navegar el flujo completo (Pasos 1 al 5) y retroceder con sus guardas", async ({ page }) => {
    await page.goto("/tools/db-shapefile-sync");

    // --- PASO 1: Conexión ---
    await connectDb(page);

    const nextToStep2 = page.getByRole("button", { name: "Continuar al Paso 2" });
    await expect(nextToStep2).toBeEnabled();
    await nextToStep2.click();

    // --- PASO 2: Carga de Shapefile / GeoJSON ---
    await expect(
      page.getByRole("heading", { name: "2. Cargar Capa Espacial Shapefile" })
    ).toBeVisible();

    // Guarda: Sin archivo cargado, botón deshabilitado
    const nextToStep3 = page.getByRole("button", { name: "Continuar al Paso 3" });
    await expect(nextToStep3).toBeDisabled();

    // Probar retroceso al paso 1
    await page.getByRole("button", { name: "Volver al Paso 1" }).click();
    await expect(
      page.getByRole("heading", { name: "1. Conectar a Base de Datos PostgreSQL" })
    ).toBeVisible();

    // Caracterización del comportamiento actual (D4 / G6):
    // El botón "Continuar al Paso 2" permanece habilitado en el padre, pero el formulario
    // hijo se desmontó y perdió su isConnected interno. Al hacer clic, proceed() no avanza y se queda en el paso 1.
    await expect(nextToStep2).toBeEnabled();
    await nextToStep2.click();
    await expect(
      page.getByRole("heading", { name: "1. Conectar a Base de Datos PostgreSQL" })
    ).toBeVisible();

    // Reconectar para rearmar el formulario y avanzar al paso 2
    await connectDb(page);
    await nextToStep2.click();

    // Cargar archivo GeoJSON
    await page.getByLabel("Seleccionar archivo Shapefile o GeoJSON").setInputFiles({
      name: "parcelas.geojson",
      mimeType: "application/geo+json",
      buffer: Buffer.from(SAMPLE_GEOJSON_CONTENT),
    });

    // Validar carga
    await expect(page.getByText("parcelas.geojson")).toBeVisible();
    await expect(nextToStep3).toBeEnabled();
    await nextToStep3.click();

    // --- PASO 3: Mapeo SUID ---
    await expect(
      page.getByRole("heading", { name: "3. Configuración de SUID y Campos a Comparar" })
    ).toBeVisible();

    // Probar retroceso al paso 2
    await page.getByRole("button", { name: "Volver al Paso 2" }).click();
    await expect(
      page.getByRole("heading", { name: "2. Cargar Capa Espacial Shapefile" })
    ).toBeVisible();
    await page.getByRole("button", { name: "Continuar al Paso 3" }).click();

    // Avanzar al paso 4
    const nextToStep4 = page.getByRole("button", {
      name: "Continuar a Parámetros de Sincronización",
    });
    await expect(nextToStep4).toBeEnabled();
    await nextToStep4.click();

    // --- PASO 4: Parámetros ---
    await expect(
      page.getByRole("heading", { name: "4. Parámetros Avanzados de Sincronización" })
    ).toBeVisible();

    // Probar retroceso al paso 3
    await page.getByRole("button", { name: "Volver al Paso 3: Mapeo SUID" }).click();
    await expect(
      page.getByRole("heading", { name: "3. Configuración de SUID y Campos a Comparar" })
    ).toBeVisible();
    await page.getByRole("button", { name: "Continuar a Parámetros de Sincronización" }).click();

    // Avanzar al paso 5
    const nextToStep5 = page.getByRole("button", {
      name: "Iniciar Análisis y Comparación",
    });
    await expect(nextToStep5).toBeEnabled();
    await nextToStep5.click();

    // --- PASO 5: Resultados ---
    await expect(
      page.getByRole("heading", { name: "5. Resultados de Análisis y Discrepancias" })
    ).toBeVisible();
    // G1: Verificar que ComparisonResultsView montó su contenido real
    await expect(page.getByRole("button", { name: /Total Evaluados/i })).toBeVisible();

    // Retroceder al paso 4
    const backToStep4 = page.getByRole("button", {
      name: "Volver al Paso 4: Parámetros de Sincronización",
    });
    await expect(backToStep4).toBeVisible();
    await backToStep4.click();
    await expect(
      page.getByRole("heading", { name: "4. Parámetros Avanzados de Sincronización" })
    ).toBeVisible();
  });
});
