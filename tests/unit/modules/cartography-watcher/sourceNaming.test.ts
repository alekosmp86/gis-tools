import { describe, it, expect } from "vitest";
import {
  DEFAULT_PORTAL_HOST,
  formatTitleFromSlug,
  parsePortalReference,
  resolveResourceFilename,
  sanitizeSlug,
} from "@/modules/cartography-watcher/domain/sourceNaming";

describe("sanitizeSlug", () => {
  it("should fold accents rather than dropping the letters", () => {
    expect(sanitizeSlug("Ejes de vías de circulación")).toBe("ejes_de_vias_de_circulacion");
  });

  it("should collapse runs of unsafe characters into a single separator", () => {
    expect(sanitizeSlug("a///b   c")).toBe("a_b_c");
  });

  it("should trim leading and trailing separators", () => {
    expect(sanitizeSlug("  ¡hola!  ")).toBe("hola");
  });

  it("should preserve characters that are already safe", () => {
    expect(sanitizeSlug("ide-ejes-vias_2026")).toBe("ide-ejes-vias_2026");
  });

  it("should fall back to a usable name when nothing survives sanitising", () => {
    // Arrange & Act & Assert: an empty filename would be a broken path, not an empty one.
    expect(sanitizeSlug("¿¿¿")).toBe("recurso");
    expect(sanitizeSlug("")).toBe("recurso");
  });
});

describe("resolveResourceFilename", () => {
  it("should prefer the filename the portal publishes in the download URL", () => {
    // Arrange
    const url = "https://catalogodatos.gub.uy/dataset/x/resource/y/download/flores.csv";

    // Act & Assert
    expect(resolveResourceFilename("Ejes viales - FLORES", "CSV", url)).toBe("flores.csv");
  });

  it("should decode a percent-encoded filename", () => {
    // Arrange
    const url = "https://example.org/download/tacuaremb%C3%B3.csv";

    // Assert
    expect(resolveResourceFilename("Tacuarembó", "CSV", url)).toBe("tacuarembó.csv");
  });

  it("should fall back to the resource name when the URL carries no filename", () => {
    expect(resolveResourceFilename("Ejes viales - FLORES", "CSV", "https://example.org/download/")).toBe(
      // The hyphen is a legal slug character, so it survives between the folded spaces.
      "ejes_viales_-_flores.csv"
    );
  });

  it("should fall back to the resource name when the URL is unusable", () => {
    expect(resolveResourceFilename("Direcciones", "ZIP", "no-es-una-url")).toBe("direcciones.zip");
  });

  it("should default the extension when the portal publishes no format", () => {
    expect(resolveResourceFilename("Direcciones", "")).toBe("direcciones.csv");
  });
});

describe("parsePortalReference", () => {
  it("should accept a dataset URL", () => {
    // Act
    const reference = parsePortalReference(
      "https://catalogodatos.gub.uy/dataset/ide-ejes-vias-circulacion"
    );

    // Assert
    expect(reference).toEqual({
      portalHost: "catalogodatos.gub.uy",
      datasetSlug: "ide-ejes-vias-circulacion",
    });
  });

  it("should accept a resource URL beneath a dataset", () => {
    // Act
    const reference = parsePortalReference(
      "https://catalogodatos.gub.uy/dataset/ide-ejes-vias-circulacion/resource/abc123"
    );

    // Assert
    expect(reference.datasetSlug).toBe("ide-ejes-vias-circulacion");
  });

  it("should accept a bare slug and assume the default portal", () => {
    // Act
    const reference = parsePortalReference("  ide-ejes-vias-circulacion  ");

    // Assert
    expect(reference).toEqual({
      portalHost: DEFAULT_PORTAL_HOST,
      datasetSlug: "ide-ejes-vias-circulacion",
    });
  });

  it("should keep the host of a portal other than the default", () => {
    // Act
    const reference = parsePortalReference("https://datos.example.org/dataset/otro-conjunto");

    // Assert
    expect(reference.portalHost).toBe("datos.example.org");
  });

  it("should reject empty input", () => {
    expect(() => parsePortalReference("   ")).toThrow(/no puede estar vacío/);
  });

  it("should reject a URL that names no dataset", () => {
    expect(() => parsePortalReference("https://catalogodatos.gub.uy/organization/ide")).toThrow(
      /No se pudo identificar el conjunto de datos/
    );
  });
});

describe("formatTitleFromSlug", () => {
  it("should turn a slug into a readable title", () => {
    expect(formatTitleFromSlug("direcciones-geograficas-del-uruguay")).toBe(
      "Direcciones Geograficas Del Uruguay"
    );
  });

  it("should drop the ide- prefix the portal uses for its own datasets", () => {
    expect(formatTitleFromSlug("ide-ejes-vias-circulacion")).toBe("Ejes Vias Circulacion");
  });

  it("should tolerate repeated separators", () => {
    expect(formatTitleFromSlug("uno--dos")).toBe("Uno Dos");
  });
});
