import { test, expect } from "../support/testFixture";
import { SAMPLE_CSV_CONTENT } from "../fixtures/sampleFiles";
import { connectDb } from "../support/wizardSteps";

test.describe("Herramienta: Sincronización DB vs. Archivo CSV (/tools/db-csv-sync)", () => {
  test.beforeEach(async ({ mockBackend }) => {
    await mockBackend();
  });

  test("debe cargar la vista inicial con el paso 1 activo y el avance bloqueado", async ({ page }) => {
    await page.goto("/tools/db-csv-sync");

    // Verificar encabezado y pasos del wizard
    await expect(
      page.getByRole("heading", { name: "Sincronización de Datos DB vs. Archivo CSV" })
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "1. Conectar a Base de Datos PostgreSQL" })
    ).toBeVisible();

    // El botón "Continuar al Paso 2" debe estar deshabilitado inicialmente
    const nextButton = page.getByRole("button", { name: "Continuar al Paso 2" });
    await expect(nextButton).toBeVisible();
    await expect(nextButton).toBeDisabled();
  });

  test("debe bloquear la conexión y mostrar mensaje de validación con campos vacíos", async ({ page }) => {
    await page.goto("/tools/db-csv-sync");

    // Intentar conectar con campos vacíos
    await page.getByRole("button", { name: "Conectar y Obtener Columnas" }).click();

    // Verificar mensaje de alerta de validación
    await expect(
      page.getByText("Por favor ingrese el nombre de la base de datos, usuario y nombre de la tabla.")
    ).toBeVisible();

    // El avance al paso 2 sigue deshabilitado
    await expect(page.getByRole("button", { name: "Continuar al Paso 2" })).toBeDisabled();
  });

  test("debe permitir navegar el flujo completo (Pasos 1 al 5) y retroceder con sus guardas", async ({ page }) => {
    await page.goto("/tools/db-csv-sync");

    // --- PASO 1: Conexión a Base de Datos ---
    await connectDb(page);

    // Ahora el botón debe habilitarse y avanzar al paso 2
    const nextToStep2 = page.getByRole("button", { name: "Continuar al Paso 2" });
    await expect(nextToStep2).toBeEnabled();
    await nextToStep2.click();

    // --- PASO 2: Carga de CSV ---
    await expect(
      page.getByRole("heading", { name: "2. Cargar Archivo de Datos CSV" })
    ).toBeVisible();

    // Guarda: Sin archivo cargado, el avance al paso 3 está deshabilitado
    const nextToStep3 = page.getByRole("button", { name: "Continuar al Paso 3" });
    await expect(nextToStep3).toBeDisabled();

    // Probar retroceso al paso 1:
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

    // Cargar archivo CSV
    await page.getByLabel("Seleccionar archivo CSV").setInputFiles({
      name: "parcelas.csv",
      mimeType: "text/csv",
      buffer: Buffer.from(SAMPLE_CSV_CONTENT),
    });

    // Validar que el archivo fue cargado y se visualiza su resumen
    await expect(page.getByText("parcelas.csv")).toBeVisible();
    await expect(nextToStep3).toBeEnabled();
    await nextToStep3.click();

    // --- PASO 3: Mapeo SUID ---
    await expect(
      page.getByRole("heading", { name: "3. Configuración de SUID y Campos a Comparar" })
    ).toBeVisible();

    // Probar retroceso al paso 2
    await page.getByRole("button", { name: "Volver al Paso 2" }).click();
    await expect(
      page.getByRole("heading", { name: "2. Cargar Archivo de Datos CSV" })
    ).toBeVisible();
    await page.getByRole("button", { name: "Continuar al Paso 3" }).click();

    // Avanzar al paso 4
    const nextToStep4 = page.getByRole("button", {
      name: "Continuar a Parámetros de Sincronización",
    });
    await expect(nextToStep4).toBeEnabled();
    await nextToStep4.click();

    // --- PASO 4: Parámetros Avanzados ---
    await expect(
      page.getByRole("heading", { name: "4. Parámetros Avanzados de Sincronización" })
    ).toBeVisible();

    // Probar retroceso al paso 3
    await page.getByRole("button", { name: "Volver al Paso 3: Mapeo SUID" }).click();
    await expect(
      page.getByRole("heading", { name: "3. Configuración de SUID y Campos a Comparar" })
    ).toBeVisible();
    await page.getByRole("button", { name: "Continuar a Parámetros de Sincronización" }).click();

    // Iniciar análisis y comparación hacia paso 5
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

    // Botón para retroceder al paso 4
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
