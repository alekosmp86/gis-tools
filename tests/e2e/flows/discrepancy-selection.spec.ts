import type { Page } from "@playwright/test";
import { test, expect } from "../support/testFixture";
import type { MockBackendOptions } from "../support/mockBackend";
import { connectDb } from "../support/wizardSteps";
import { CSV_CONNECTED_MOCKS, CSV_CONTENT, CSV_FILE_NAME } from "../wiki-screenshots/db-csv-sync.mocks";
import {
  buildChunk,
  buildColumnsResponse,
  buildNdjsonStream,
  type ColumnSpec,
} from "../wiki-screenshots/db-db-sync.mocks";

const TOOL_URL = "/tools/db-csv-sync";
const COMPARED_ATTRIBUTES = ["departamento", "localidad", "area_m2", "uso_suelo"];

const ATTRIBUTE_RECORDS = ["10235", "10237"];
const GEOMETRY_RECORD = "10238";
const INSERT_RECORD = "10241";
const SELECTABLE_RECORDS = [...ATTRIBUTE_RECORDS, GEOMETRY_RECORD, INSERT_RECORD];
const NON_SELECTABLE_RECORDS = ["10234", "10236", "10239", "10240"];
const SELECTABLE_COUNT = SELECTABLE_RECORDS.length;
const WHERE_BY_RECORD: Record<string, string> = {
  "10235": '"gid" = 2',
  "10237": '"gid" = 4',
  "10238": '"gid" = 5',
};
const UPDATE_COUNT = ATTRIBUTE_RECORDS.length + 1;

const UNKEYED_TITLE = "Sin clave primaria: no se puede actualizar de forma segura";
const EMPTY_SELECTION_MESSAGE =
  "No hay registros seleccionados. Seleccione registros en la tabla de discrepancias para generar el script.";

const KPI_NAMES = [
  /Total Evaluados/i,
  /Coincidencias/i,
  /Solo en Base de Datos/i,
  /Solo en Archivo CSV/i,
  /Discrepancias Atributos/i,
];

async function uploadCsv(page: Page, content: string): Promise<void> {
  await page.getByLabel("Seleccionar archivo CSV").setInputFiles({
    name: CSV_FILE_NAME,
    mimeType: "text/csv",
    buffer: Buffer.from(content),
  });
  await expect(page.getByText(CSV_FILE_NAME).first()).toBeVisible();
}

async function goToResults(page: Page, csvContent: string = CSV_CONTENT): Promise<void> {
  await page.goto(TOOL_URL);
  await connectDb(page, { database: "catastro_origen", user: "lector_catastro", table: "parcelas" });
  await page.getByRole("button", { name: "Continuar al Paso 2" }).click();
  await uploadCsv(page, csvContent);
  await page.getByRole("button", { name: "Continuar al Paso 3" }).click();
  await page.getByRole("button", { name: "padron", exact: true }).click();
  await page.getByRole("button", { name: "gid", exact: true }).click();
  for (const attribute of COMPARED_ATTRIBUTES) {
    await page.getByRole("checkbox", { name: attribute, exact: true }).check();
  }
  await page.getByRole("checkbox", { name: /Comparar forma y coordenadas/ }).check();
  await page.getByRole("button", { name: "Continuar a Parámetros de Sincronización" }).click();
  await page.getByRole("button", { name: "Iniciar Análisis y Comparación" }).click();
  await expect(
    page.getByRole("heading", { name: "5. Resultados de Análisis y Discrepancias" })
  ).toBeVisible();
  await expect(page.getByRole("button", { name: /Total Evaluados/i })).toBeVisible();
}

function recordCheckbox(page: Page, suid: string) {
  return page.getByRole("checkbox", { name: `Seleccionar registro ${suid}`, exact: true });
}

function counter(page: Page, selected: number, total: number) {
  return page.getByText(new RegExp(`\\b${selected} de ${total} seleccionados`));
}

async function kpiSnapshot(page: Page): Promise<string[]> {
  const texts: string[] = [];
  for (const name of KPI_NAMES) {
    texts.push((await page.getByRole("button", { name }).first().innerText()).replace(/\s+/g, " "));
  }
  return texts;
}

async function openSqlTab(page: Page): Promise<void> {
  await page.getByRole("button", { name: /Script SQL PostGIS/i }).click();
  await expect(page.getByRole("heading", { name: "Scripts SQL PostGIS" })).toBeVisible();
}

async function openTableTab(page: Page): Promise<void> {
  await page.getByRole("button", { name: /Tabla de Discrepancias/i }).click();
  await expect(page.getByRole("table")).toBeVisible();
}

function updatePreview(page: Page) {
  return page.locator("pre").first();
}

function insertPreview(page: Page) {
  return page.locator("pre").nth(1);
}

function countOccurrences(text: string, token: string): number {
  return text.split(token).length - 1;
}

async function expectStatementCountInModal(page: Page, label: string): Promise<void> {
  await page.getByRole("button", { name: "Ejecutar en BD" }).click();
  await expect(page.getByText("Confirmación de Ejecución en Base de Datos")).toBeVisible();
  await expect(page.getByText(label)).toBeVisible();
  await page.getByRole("button", { name: "Cancelar" }).click();
  await expect(page.getByText("Confirmación de Ejecución en Base de Datos")).toHaveCount(0);
}

test.describe("Selección de registros en la tabla de discrepancias (db-csv-sync)", () => {
  test.beforeEach(async ({ mockBackend }) => {
    await mockBackend(CSV_CONNECTED_MOCKS);
  });

  test("debe mostrar un checkbox por registro seleccionable, todos marcados, y generar SQL para todos", async ({
    page,
  }) => {
    await goToResults(page);

    for (const suid of SELECTABLE_RECORDS) {
      await expect(recordCheckbox(page, suid)).toBeChecked();
      await expect(recordCheckbox(page, suid)).toBeEnabled();
    }
    for (const suid of NON_SELECTABLE_RECORDS) {
      await expect(recordCheckbox(page, suid)).toHaveCount(0);
    }
    await expect(page.getByRole("checkbox", { name: /^Seleccionar registro / })).toHaveCount(
      SELECTABLE_COUNT
    );
    await expect(counter(page, SELECTABLE_COUNT, SELECTABLE_COUNT)).toBeVisible();

    await openSqlTab(page);
    await expect(updatePreview(page)).toContainText("UPDATE", { timeout: 15_000 });
    const updateText = (await updatePreview(page).textContent()) ?? "";
    expect(countOccurrences(updateText, "UPDATE ")).toBe(UPDATE_COUNT);
    for (const suid of [...ATTRIBUTE_RECORDS, GEOMETRY_RECORD]) {
      expect(updateText).toContain(WHERE_BY_RECORD[suid]);
    }
    expect(updateText).toContain("'Mixto'");
    expect(updateText).toContain("312.60");
    expect(updateText).toContain("ST_GeomFromGeoJSON");

    await expect(insertPreview(page)).toContainText("INSERT INTO");
    await expect(insertPreview(page)).toContainText(`'${INSERT_RECORD}'`);
    await expectStatementCountInModal(page, `Script UPDATE • ${UPDATE_COUNT} sentencias`);
  });

  test("debe quitar la sentencia UPDATE del registro desmarcado, restaurarla al volver a marcar y mantener los KPI", async ({
    page,
  }) => {
    await goToResults(page);
    const kpiBefore = await kpiSnapshot(page);
    expect(kpiBefore[0]).toContain("8");

    await recordCheckbox(page, "10235").uncheck();
    await expect(recordCheckbox(page, "10235")).not.toBeChecked();
    await expect(counter(page, SELECTABLE_COUNT - 1, SELECTABLE_COUNT)).toBeVisible();
    expect(await kpiSnapshot(page)).toEqual(kpiBefore);

    await openSqlTab(page);
    await expect(updatePreview(page)).toContainText(WHERE_BY_RECORD["10237"], { timeout: 15_000 });
    const partialText = (await updatePreview(page).textContent()) ?? "";
    expect(partialText).not.toContain(WHERE_BY_RECORD["10235"]);
    expect(partialText).toContain(WHERE_BY_RECORD[GEOMETRY_RECORD]);
    expect(countOccurrences(partialText, "UPDATE ")).toBe(UPDATE_COUNT - 1);
    await expect(insertPreview(page)).toContainText(`'${INSERT_RECORD}'`);
    await expectStatementCountInModal(page, `Script UPDATE • ${UPDATE_COUNT - 1} sentencias`);

    await openTableTab(page);
    await recordCheckbox(page, "10235").check();
    await expect(counter(page, SELECTABLE_COUNT, SELECTABLE_COUNT)).toBeVisible();
    expect(await kpiSnapshot(page)).toEqual(kpiBefore);

    await openSqlTab(page);
    await expect(updatePreview(page)).toContainText(WHERE_BY_RECORD["10235"], { timeout: 15_000 });
    const restoredText = (await updatePreview(page).textContent()) ?? "";
    expect(countOccurrences(restoredText, "UPDATE ")).toBe(UPDATE_COUNT);
    await expectStatementCountInModal(page, `Script UPDATE • ${UPDATE_COUNT} sentencias`);
  });

  test("debe deshabilitar las acciones SQL con selección vacía y restaurar la selección por defecto", async ({
    page,
  }) => {
    await goToResults(page);

    await page.getByRole("button", { name: "Limpiar selección" }).click();
    await expect(counter(page, 0, SELECTABLE_COUNT)).toBeVisible();
    for (const suid of SELECTABLE_RECORDS) {
      await expect(recordCheckbox(page, suid)).not.toBeChecked();
    }
    await expect(page.getByRole("button", { name: "Limpiar selección" })).toBeDisabled();

    await openSqlTab(page);
    await expect(page.getByRole("button", { name: "Copiar SQL" })).toBeDisabled();
    await expect(page.getByRole("button", { name: "Descargar .sql" })).toBeDisabled();
    await expect(page.getByRole("button", { name: "Ejecutar en BD" })).toBeDisabled();
    await expect(page.getByText(EMPTY_SELECTION_MESSAGE)).toBeVisible();
    await expect(updatePreview(page)).toHaveText("");
    await expect(insertPreview(page)).toHaveText("");

    await openTableTab(page);
    await page.getByRole("button", { name: "Seleccionar todos (filtro actual)" }).click();
    await expect(counter(page, SELECTABLE_COUNT, SELECTABLE_COUNT)).toBeVisible();
    for (const suid of SELECTABLE_RECORDS) {
      await expect(recordCheckbox(page, suid)).toBeChecked();
    }

    await openSqlTab(page);
    await expect(page.getByText(EMPTY_SELECTION_MESSAGE)).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Copiar SQL" })).toBeEnabled();
    await expect(page.getByRole("button", { name: "Descargar .sql" })).toBeEnabled();
    await expect(page.getByRole("button", { name: "Ejecutar en BD" })).toBeEnabled();
    await expect(updatePreview(page)).toContainText("UPDATE", { timeout: 15_000 });
  });

  test("debe conservar la selección al cambiar de filtro, búsqueda, filas por página y pestaña", async ({
    page,
  }) => {
    await goToResults(page);
    await recordCheckbox(page, "10237").uncheck();
    await expect(counter(page, SELECTABLE_COUNT - 1, SELECTABLE_COUNT)).toBeVisible();
    const kpiBefore = await kpiSnapshot(page);

    await page.getByRole("button", { name: /Discrepancias Atributos/i }).click();
    await expect(page.getByRole("cell", { name: "10235", exact: true })).toBeVisible();
    await expect(recordCheckbox(page, "10238")).toHaveCount(0);
    await expect(recordCheckbox(page, "10237")).not.toBeChecked();
    await expect(recordCheckbox(page, "10235")).toBeChecked();
    await expect(counter(page, SELECTABLE_COUNT - 1, SELECTABLE_COUNT)).toBeVisible();

    await page.getByRole("button", { name: /Total Evaluados/i }).click();
    await expect(recordCheckbox(page, "10237")).not.toBeChecked();

    const searchInput = page.getByPlaceholder("Filtrar por SUID o atributo...");
    await searchInput.fill("10237");
    await expect(recordCheckbox(page, "10235")).toHaveCount(0);
    await expect(recordCheckbox(page, "10237")).not.toBeChecked();
    await searchInput.fill("");
    await expect(recordCheckbox(page, "10235")).toBeChecked();

    await page.getByLabel("Filas por página:").first().selectOption({ index: 0 });
    await expect(recordCheckbox(page, "10237")).not.toBeChecked();

    await openSqlTab(page);
    await expect
      .poll(async () => (await updatePreview(page).textContent()) ?? "", { timeout: 15_000 })
      .toContain("UPDATE");
    expect((await updatePreview(page).textContent()) ?? "").not.toContain(WHERE_BY_RECORD["10237"]);
    await openTableTab(page);

    await expect(recordCheckbox(page, "10237")).not.toBeChecked();
    await expect(recordCheckbox(page, "10235")).toBeChecked();
    await expect(counter(page, SELECTABLE_COUNT - 1, SELECTABLE_COUNT)).toBeVisible();
    expect(await kpiSnapshot(page)).toEqual(kpiBefore);
  });

  test("debe mostrar en el modal de ejecución solo las sentencias de los registros seleccionados", async ({
    page,
  }) => {
    await goToResults(page);
    await recordCheckbox(page, "10235").uncheck();
    await recordCheckbox(page, GEOMETRY_RECORD).uncheck();
    await expect(counter(page, SELECTABLE_COUNT - 2, SELECTABLE_COUNT)).toBeVisible();

    await openSqlTab(page);
    await expect(updatePreview(page)).toContainText(WHERE_BY_RECORD["10237"], { timeout: 15_000 });
    await expect(page.getByRole("button", { name: "Ejecutar en BD" })).toBeEnabled();

    await page.getByRole("button", { name: "Ejecutar en BD" }).click();
    await expect(page.getByText("Confirmación de Ejecución en Base de Datos")).toBeVisible();
    await expect(page.getByText("Script UPDATE • 1 sentencias")).toBeVisible();
    await page.getByRole("button", { name: "Cancelar" }).click();
    await expect(page.getByText("Confirmación de Ejecución en Base de Datos")).toHaveCount(0);

    await page.getByRole("button", { name: /Script INSERT/i }).click();
    await expectStatementCountInModal(page, "Script INSERT • 1 sentencias");
  });
});

const UNKEYED_COLUMN_SPECS: ColumnSpec[] = [
  { name: "gid", type: "integer", nullable: false, defaultValue: "nextval('parcelas_gid_seq'::regclass)", primaryKey: true },
  { name: "padron", type: "character varying(20)", nullable: false },
  { name: "departamento", type: "character varying(50)" },
  { name: "localidad", type: "character varying(80)" },
  { name: "area_m2", type: "numeric(12,2)" },
  { name: "uso_suelo", type: "character varying(40)" },
  { name: "geom", type: "geometry(Polygon,4326)" },
];

function square(west: number, south: number): Array<[number, number]> {
  const side = 0.003;
  return [
    [west, south],
    [west, south + side],
    [west + side, south + side],
    [west + side, south],
    [west, south],
  ];
}

function wkt(ring: Array<[number, number]>): string {
  return `POLYGON((${ring.map(([x, y]) => `${x} ${y}`).join(", ")}))`;
}

const SHARED_PADRON = "30001";
const FIRST_RING = square(-56.1, -34.8);
const SECOND_RING = square(-56.0, -34.8);

const UNKEYED_DB_ROWS = [
  { gid: null, padron: SHARED_PADRON, departamento: "Montevideo", localidad: "Pocitos", area_m2: "100.00", uso_suelo: "Residencial", geom: JSON.stringify({ type: "Polygon", coordinates: [FIRST_RING] }) },
  { gid: null, padron: SHARED_PADRON, departamento: "Montevideo", localidad: "Cordón", area_m2: "200.00", uso_suelo: "Residencial", geom: JSON.stringify({ type: "Polygon", coordinates: [SECOND_RING] }) },
];

const UNKEYED_CSV = [
  "padron,departamento,localidad,area_m2,uso_suelo,geom",
  `${SHARED_PADRON},Montevideo,Pocitos,100.00,Residencial,"${wkt(FIRST_RING)}"`,
  `${SHARED_PADRON},Montevideo,Cordón,200.00,Comercial,"${wkt(SECOND_RING)}"`,
].join("\n") + "\n";

const UNKEYED_MOCKS: MockBackendOptions = {
  columns: buildColumnsResponse("parcelas", UNKEYED_DB_ROWS.length, UNKEYED_COLUMN_SPECS),
  recordsStream: buildNdjsonStream(
    {
      type: "META",
      totalCount: UNKEYED_DB_ROWS.length,
      columnTypes: Object.fromEntries(UNKEYED_COLUMN_SPECS.map((spec) => [spec.name, spec.type])),
      detectedSrid: 4326,
    },
    buildChunk(UNKEYED_DB_ROWS)
  ),
  execute: { success: true, affectedRows: 1, message: "Ejecución exitosa." },
};

test.describe("Selección de registros: registros emparejados sin clave primaria", () => {
  test("debe deshabilitar el checkbox de un registro emparejado sin clave primaria y excluirlo del SQL", async ({
    page,
    mockBackend,
  }) => {
    await mockBackend(UNKEYED_MOCKS);
    await goToResults(page, UNKEYED_CSV);

    const blocked = recordCheckbox(page, SHARED_PADRON);
    await expect(blocked.first()).toBeVisible();
    await expect(blocked).toHaveCount(1);
    await expect(blocked).toBeDisabled();
    await expect(blocked).not.toBeChecked();
    await expect(blocked).toHaveAttribute("title", UNKEYED_TITLE);
    await expect(counter(page, 0, 0)).toBeVisible();

    await openSqlTab(page);
    await expect(page.getByRole("button", { name: "Ejecutar en BD" })).toBeDisabled();
    await expect(page.getByText(EMPTY_SELECTION_MESSAGE)).toBeVisible();
  });
});
