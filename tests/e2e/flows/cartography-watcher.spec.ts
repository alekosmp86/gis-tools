import { test, expect } from "../support/testFixture";

test.describe("Módulo: Observador Cartográfico (/tools/m/cartography-watcher)", () => {
  test.beforeEach(async ({ mockBackend }) => {
    await mockBackend();
  });

  test("debe listar fuentes vigiladas y sus estados en el dashboard", async ({ page }) => {
    await page.goto("/tools/m/cartography-watcher");

    // Verificar encabezado de la página
    await expect(
      page.getByRole("heading", { name: "Observador de Actualizaciones Cartográficas" })
    ).toBeVisible();

    // Deben listarse las fuentes configuradas en los fixtures
    await expect(page.getByText("Catastro Nacional de Parcelas")).toBeVisible();
    await expect(page.getByText("Red Vial Nacional")).toBeVisible();

    // Debe mostrar métricas de recursos y novedades
    await expect(page.getByText("Recursos").first()).toBeVisible();
    await expect(page.getByText("Novedades").first()).toBeVisible();
    await expect(page.getByText("Última consulta").first()).toBeVisible();
  });

  test("debe agregar una nueva fuente vigilada desde el formulario", async ({ page }) => {
    await page.goto("/tools/m/cartography-watcher");

    // Llenar formulario de agregar fuente
    const input = page.getByPlaceholder("https://catalogodatos.gub.uy/dataset/...");
    await input.fill("https://catalogodatos.gub.uy/dataset/nueva-fuente-sig");

    await page.getByRole("button", { name: "Vigilar fuente" }).click();

    // Debe aparecer la tarjeta de la nueva fuente agregada con título derivado
    await expect(page.getByText("Fuente nueva-fuente-sig")).toBeVisible();
  });

  test("debe mantener el formulario abierto, conservar la URL ingresada y mostrar el error si el servidor rechaza la edición", async ({
    page,
    mockBackend,
    allowConsoleErrors,
  }) => {
    // Permitir el log de error de red correspondiente a la respuesta 400
    allowConsoleErrors();

    // Configurar respuesta de rechazo del servidor en /sources/update
    await mockBackend({
      watcherUpdate: () => ({
        status: 400,
        body: {
          success: false,
          error: "El catálogo indicado no contiene recursos espaciales válidos.",
        },
      }),
    });

    await page.goto("/tools/m/cartography-watcher");

    // Localizar la tarjeta editable (Red Vial Nacional)
    const card = page.getByRole("article").filter({ hasText: "Red Vial Nacional" });
    await expect(card).toBeVisible();

    // Iniciar edición
    await card.getByRole("button", { name: "Editar" }).click();

    // El formulario de edición debe abrirse dentro de la tarjeta
    const editInput = card.getByLabel("URL o identificador del catálogo");
    await expect(editInput).toBeVisible();

    // Escribir nueva URL que será rechazada por el servidor
    const rejectedUrl = "https://catalogodatos.gub.uy/dataset/red-vial-rechazada";
    await editInput.fill(rejectedUrl);

    // Guardar cambio
    await card.getByRole("button", { name: "Guardar" }).click();

    // CONTRATO CRÍTICO:
    // 1. El formulario debe permanecer abierto (el input sigue visible).
    await expect(editInput).toBeVisible();

    // 2. Debe conservar intacta la URL ingresada por el usuario.
    await expect(editInput).toHaveValue(rejectedUrl);

    // 3. Debe mostrar el mensaje en español retornado por el cliente dentro de la tarjeta.
    // (Nota D4: watcherClient.ts readJson lanza `${context} (HTTP ${status})` en HTTP !ok antes de parsear JSON)
    await expect(
      card.getByText("No se pudo actualizar la fuente (HTTP 400).")
    ).toBeVisible();
  });

  test("debe expandir el árbol del catálogo y filtrar por formato al seleccionar recursos en sync tools", async ({
    page,
  }) => {
    await page.goto("/tools/db-csv-sync");

    // Paso 1: Conexión
    await page.getByLabel("Nombre de Base de Datos").fill("sig_db");
    await page.getByLabel("Usuario").fill("postgres");
    await page.getByLabel("Nombre de la Tabla").fill("parcelas_catastro");
    await page.getByRole("button", { name: "Conectar y Obtener Columnas" }).click();
    await expect(page.getByText("Conexión establecida con éxito")).toBeVisible();
    await page.getByRole("button", { name: "Continuar al Paso 2" }).click();

    // Paso 2: Abrir pestaña de Catálogo Cartográfico del módulo
    const catalogTab = page.getByRole("tab", { name: "Catálogo Cartográfico" });
    await expect(catalogTab).toBeVisible();
    await catalogTab.click();

    // Verificar texto introductorio del selector de catálogo
    await expect(
      page.getByText(
        "Seleccione un archivo publicado en los catálogos vigilados. Se descarga una sola vez y queda en caché para las comparaciones siguientes."
      )
    ).toBeVisible();

    // El grupo debe estar inicialmente colapsado
    const groupHeader = page.getByRole("button", { name: /Catastro Nacional de Parcelas/i });
    await expect(groupHeader).toBeVisible();

    // Al expandir el grupo, debe mostrar los recursos filtrados para CSV
    await groupHeader.click();

    const resourceBtn = page.getByRole("button", { name: /parcelas_montevideo\.csv/i });
    await expect(resourceBtn).toBeVisible();

    // Verificar que recursos de formato no compatible (ZIP) fueron excluidos por el filtro
    await expect(page.getByRole("button", { name: /parcelas_montevideo\.zip/i })).toHaveCount(0);

    // Seleccionar el archivo del catálogo
    await resourceBtn.click();

    // El archivo seleccionado debe procesarse e incorporarse en el paso 2
    await expect(page.getByText("parcelas_montevideo.csv")).toBeVisible();

    // El botón continuar al paso 3 debe habilitarse
    await expect(page.getByRole("button", { name: "Continuar al Paso 3" })).toBeEnabled();
  });
});
