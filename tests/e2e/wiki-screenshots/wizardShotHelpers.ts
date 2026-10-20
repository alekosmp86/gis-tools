import { crc32, deflateSync } from "node:zlib";
import type { Page } from "@playwright/test";
import { expect } from "../support/testFixture";
import { takeShot } from "./shot";

const CONNECT_BUTTON = "Conectar y Obtener Columnas";

export interface ConnectionData {
  host: string;
  database: string;
  user: string;
  password: string;
  table: string;
}

export async function shotMain(page: Page, tool: string, name: string): Promise<void> {
  await page.evaluate(() => window.scrollTo(0, 0));
  await takeShot(page, { tool, name, target: page.locator("main") });
}

export async function expectHeading(page: Page, name: string | RegExp): Promise<void> {
  await expect(page.getByRole("heading", { name })).toBeVisible();
}

export async function connectDatabase(page: Page, connection: ConnectionData): Promise<void> {
  await page.getByLabel("Host / Servidor").fill(connection.host);
  await page.getByLabel("Nombre de Base de Datos").fill(connection.database);
  await page.getByLabel("Usuario").fill(connection.user);
  await page.getByLabel("Contraseña (no se guarda)").fill(connection.password);
  await page.getByLabel("Nombre de la Tabla").fill(connection.table);
  await page.getByRole("button", { name: CONNECT_BUTTON }).click();
  await expect(page.getByText("Conexión establecida con éxito")).toBeVisible();
}

const TILE_SIZE = 256;
const TILE_RGB = [64, 70, 82];
const TILE_URL_PATTERNS = [
  "**tile.openstreetmap.org/**",
  "**server.arcgisonline.com/**",
  "**basemaps.cartocdn.com/**",
];

function buildPngChunk(type: string, data: Buffer): Buffer {
  const header = Buffer.alloc(8);
  header.writeUInt32BE(data.length, 0);
  header.write(type, 4, "ascii");
  const checksum = Buffer.alloc(4);
  checksum.writeUInt32BE(crc32(Buffer.concat([header.subarray(4), data])), 0);
  return Buffer.concat([header, data, checksum]);
}

function buildSolidTilePng(): Buffer {
  const dimensions = Buffer.alloc(13);
  dimensions.writeUInt32BE(TILE_SIZE, 0);
  dimensions.writeUInt32BE(TILE_SIZE, 4);
  dimensions.set([8, 2, 0, 0, 0], 8);
  const scanline = Buffer.from([0, ...Array.from({ length: TILE_SIZE }, () => TILE_RGB).flat()]);
  const pixels = Buffer.concat(Array.from({ length: TILE_SIZE }, () => scanline));
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    buildPngChunk("IHDR", dimensions),
    buildPngChunk("IDAT", deflateSync(pixels)),
    buildPngChunk("IEND", Buffer.alloc(0)),
  ]);
}

export async function useNeutralMapTiles(page: Page): Promise<void> {
  const tile = buildSolidTilePng();
  for (const pattern of TILE_URL_PATTERNS) {
    await page.route(pattern, (route) =>
      route.fulfill({ status: 200, contentType: "image/png", body: tile })
    );
  }
}

export async function waitForMapTiles(page: Page): Promise<void> {
  await expect
    .poll(() =>
      page.evaluate(() => {
        const tiles = Array.from(document.querySelectorAll<HTMLImageElement>(".leaflet-tile"));
        return tiles.length > 0 && tiles.every((tile) => tile.complete && tile.classList.contains("leaflet-tile-loaded") && getComputedStyle(tile).opacity === "1");
      })
    )
    .toBe(true);
  await page.evaluate(() => new Promise((resolve) => setTimeout(resolve, 600)));
}
