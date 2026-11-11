import { describe, expect, it } from "vitest";
import {
  assertShapefileZip,
  checkShapefileParts,
  findSourceWithDirectUrl,
  hasZipSignature,
  listZipEntryNames,
  parseDirectUrl,
} from "@/modules/cartography-watcher/domain/directUrl";
import { isDirectSource } from "@/modules/cartography-watcher/domain/sourceKind";
import { MISSING_PRJ_WARNING } from "@/modules/cartography-watcher/constants";
import { WatchedSourceKind } from "@/modules/cartography-watcher/types";
import type { WatchedSource } from "@/modules/cartography-watcher/types";
import { buildShapefileZip, buildZip } from "./support/zipFixtures";

const ANEP_URL =
  "https://mapas.ide.uy/geoserver-vectorial/INE_NO_SEGURO_CLON_NS/wfs?service=WFS&version=1.0.0&request=GetFeature&typeName=INE_NO_SEGURO_CLON_NS:centros_anep_2&outputFormat=SHAPE-ZIP";

function source(overrides: Partial<WatchedSource>): WatchedSource {
  return {
    id: "s",
    title: "S",
    datasetSlug: "s",
    portalHost: "h",
    isDefault: false,
    ...overrides,
  };
}

describe("parseDirectUrl", () => {
  it("should accept the ANEP https URL and return its host", () => {
    const parsed = parseDirectUrl(ANEP_URL);
    expect(parsed.url).toBe(ANEP_URL);
    expect(parsed.host).toBe("mapas.ide.uy");
  });

  it("should accept http and keep the port in the host", () => {
    expect(parseDirectUrl("http://localhost:8080/x.zip").host).toBe("localhost:8080");
  });

  it("should trim surrounding whitespace", () => {
    expect(parseDirectUrl("  https://a.example/x  ").url).toBe("https://a.example/x");
  });

  it("should accept an upper-case scheme", () => {
    expect(parseDirectUrl("HTTPS://a.example/x").host).toBe("a.example");
  });

  it.each(["file:///etc/passwd", "ftp://a.example/x.zip", "data:text/plain,hola", "javascript:alert(1)"])(
    "should refuse the scheme of %s with a Spanish message",
    (bad) => {
      expect(() => parseDirectUrl(bad)).toThrow(/http:\/\/ o https:\/\//);
    }
  );

  it.each(["", "   "])("should refuse an empty url %j", (empty) => {
    expect(() => parseDirectUrl(empty)).toThrow(/vacía/);
  });

  it.each(["not a url", "://nohost"])("should refuse malformed %j", (bad) => {
    expect(() => parseDirectUrl(bad)).toThrow(/no es válida/);
  });
});

describe("findSourceWithDirectUrl", () => {
  const sources = [
    source({ id: "a", directUrl: "https://A.example/Layer.zip", kind: WatchedSourceKind.DIRECT_URL }),
    source({ id: "b" }),
  ];

  it("should match case-insensitively", () => {
    expect(findSourceWithDirectUrl(sources, "https://a.example/layer.ZIP")?.id).toBe("a");
  });

  it("should ignore the excepted source id", () => {
    expect(findSourceWithDirectUrl(sources, "https://a.example/layer.zip", "a")).toBeUndefined();
  });

  it("should return undefined when no source has the URL", () => {
    expect(findSourceWithDirectUrl(sources, "https://other.example/")).toBeUndefined();
  });

  it("should return undefined for an empty list", () => {
    expect(findSourceWithDirectUrl([], "https://a.example")).toBeUndefined();
  });
});

describe("isDirectSource (kind defaulting)", () => {
  it("should treat a row without kind as CKAN", () => {
    expect(isDirectSource(source({}))).toBe(false);
  });

  it("should treat explicit ckan as CKAN", () => {
    expect(isDirectSource(source({ kind: WatchedSourceKind.CKAN }))).toBe(false);
  });

  it("should recognise direct-url", () => {
    expect(isDirectSource(source({ kind: WatchedSourceKind.DIRECT_URL }))).toBe(true);
  });

  it("should expose the kind constants as ckan and direct-url", () => {
    expect(WatchedSourceKind.CKAN).toBe("ckan");
    expect(WatchedSourceKind.DIRECT_URL).toBe("direct-url");
  });
});

describe("hasZipSignature", () => {
  it("should accept bytes starting with PK 03 04", () => {
    expect(hasZipSignature(Uint8Array.from([0x50, 0x4b, 0x03, 0x04]))).toBe(true);
  });

  it("should accept a real zip buffer", () => {
    expect(hasZipSignature(buildShapefileZip())).toBe(true);
  });

  it("should refuse an empty array", () => {
    expect(hasZipSignature(new Uint8Array())).toBe(false);
  });

  it("should refuse a 3-byte prefix of the signature", () => {
    expect(hasZipSignature(Uint8Array.from([0x50, 0x4b, 0x03]))).toBe(false);
  });

  it("should refuse an XML error body", () => {
    expect(hasZipSignature(Buffer.from("<?xml version=\"1.0\"?><ServiceException/>"))).toBe(false);
  });

  it("should refuse an empty-archive signature PK 05 06", () => {
    expect(hasZipSignature(Uint8Array.from([0x50, 0x4b, 0x05, 0x06]))).toBe(false);
  });
});

describe("listZipEntryNames", () => {
  it("should list entry names from the central directory", () => {
    expect(listZipEntryNames(buildZip(["a.shp", "dir/b.dbf"]))).toEqual(["a.shp", "dir/b.dbf"]);
  });

  it("should throw on a buffer too short to be a zip", () => {
    expect(() => listZipEntryNames(Buffer.from([0x50, 0x4b, 0x03, 0x04, 0, 0, 0]))).toThrow();
  });

  it("should throw instead of hanging on a truncated zip with the signature", () => {
    expect(() => listZipEntryNames(Buffer.from("PK\x03\x04garbage"))).toThrow();
  });
});

describe("checkShapefileParts", () => {
  it("should accept a complete set with .prj without warnings", () => {
    expect(checkShapefileParts(["c.shp", "c.dbf", "c.shx", "c.prj"])).toEqual({
      errorMessage: null,
      warnings: [],
    });
  });

  it("should accept a set without .prj and warn", () => {
    expect(checkShapefileParts(["c.shp", "c.dbf", "c.shx"])).toEqual({
      errorMessage: null,
      warnings: [MISSING_PRJ_WARNING],
    });
  });

  it("should word the warning as specified", () => {
    expect(MISSING_PRJ_WARNING).toBe("Sin archivo .prj: se pedirá el SRID al cargar.");
  });

  it.each([
    [".shp", ["c.dbf", "c.shx", "c.prj"]],
    [".dbf", ["c.shp", "c.shx", "c.prj"]],
    [".shx", ["c.shp", "c.dbf", "c.prj"]],
  ])("should name the missing %s part", (ext, names) => {
    expect(checkShapefileParts(names).errorMessage).toBe(
      `El ZIP no contiene el archivo ${ext} del shapefile.`
    );
  });

  it("should name .dbf exactly as the spec example", () => {
    expect(checkShapefileParts(["a.shp", "a.shx"]).errorMessage).toBe(
      "El ZIP no contiene el archivo .dbf del shapefile."
    );
  });

  it("should refuse an empty entry list", () => {
    expect(checkShapefileParts([]).errorMessage).toMatch(/ningún shapefile/);
  });

  it("should refuse a zip with unrelated files", () => {
    expect(checkShapefileParts(["readme.txt", "data.csv"]).errorMessage).toMatch(/ningún shapefile/);
  });

  it("should not combine parts with different base names", () => {
    expect(checkShapefileParts(["a.shp", "b.dbf", "c.shx"]).errorMessage).not.toBeNull();
  });

  it("should count entries inside folders", () => {
    expect(
      checkShapefileParts(["out/sub/c.shp", "out/sub/c.dbf", "out/sub/c.shx"]).errorMessage
    ).toBeNull();
  });

  it("should not combine parts that live in different folders", () => {
    expect(checkShapefileParts(["x/c.shp", "y/c.dbf", "y/c.shx"]).errorMessage).not.toBeNull();
  });

  it("should match extensions and names case-insensitively", () => {
    expect(checkShapefileParts(["C.SHP", "c.Dbf", "C.shX", "c.PRJ"])).toEqual({
      errorMessage: null,
      warnings: [],
    });
  });

  it("should accept backslash separators", () => {
    expect(checkShapefileParts(["d\\c.shp", "d\\c.dbf", "d\\c.shx"]).errorMessage).toBeNull();
  });

  it("should ignore folder entries", () => {
    expect(checkShapefileParts(["d/", "d/c.shp", "d/c.dbf", "d/c.shx"]).errorMessage).toBeNull();
  });

  it("should ignore __MACOSX resource-fork entries", () => {
    expect(checkShapefileParts(["__MACOSX/._c.shp", "c.dbf", "c.shx"]).errorMessage).not.toBeNull();
  });

  it("should accept several shapefile sets", () => {
    const result = checkShapefileParts(["a.shp", "a.dbf", "a.shx", "b.shp", "b.dbf", "b.shx"]);
    expect(result.errorMessage).toBeNull();
  });

  it("should not warn when at least one complete set has a .prj", () => {
    const result = checkShapefileParts([
      "a.shp", "a.dbf", "a.shx", "b.shp", "b.dbf", "b.shx", "b.prj",
    ]);
    expect(result.warnings).toEqual([]);
  });

  it("should accept a complete set even when another set is incomplete", () => {
    expect(checkShapefileParts(["a.shp", "a.dbf", "a.shx", "b.shp"]).errorMessage).toBeNull();
  });

  it("should ignore files without a base name or extension", () => {
    expect(checkShapefileParts(["README", ".shp"]).errorMessage).not.toBeNull();
  });
});

describe("assertShapefileZip", () => {
  it("should return no warnings for a full shapefile zip", () => {
    expect(assertShapefileZip(buildShapefileZip(true))).toEqual([]);
  });

  it("should return the .prj warning when .prj is missing", () => {
    expect(assertShapefileZip(buildShapefileZip(false))).toEqual([MISSING_PRJ_WARNING]);
  });

  it("should refuse non-zip bytes saying it is not a ZIP", () => {
    expect(() => assertShapefileZip(Buffer.from("<html>error</html>"))).toThrow(
      /no devolvió un archivo ZIP/
    );
  });

  it("should refuse an empty buffer", () => {
    expect(() => assertShapefileZip(new Uint8Array())).toThrow(/ZIP/);
  });

  it("should refuse a truncated zip that has the signature only", () => {
    expect(() => assertShapefileZip(Buffer.from([0x50, 0x4b, 0x03, 0x04, 0, 0, 0]))).toThrow(
      /no es un ZIP válido/
    );
  });

  it("should refuse a zip missing a shapefile part with its message", () => {
    expect(() => assertShapefileZip(buildZip(["c.shp", "c.shx"]))).toThrow(
      "El ZIP no contiene el archivo .dbf del shapefile."
    );
  });

  it("should refuse a zip with no shapefile at all", () => {
    expect(() => assertShapefileZip(buildZip(["notes.txt"]))).toThrow(/ningún shapefile/);
  });
});
