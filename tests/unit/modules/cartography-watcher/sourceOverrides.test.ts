import { describe, it, expect } from "vitest";
import { DEFAULT_WATCHED_SOURCES } from "@/modules/cartography-watcher/data/defaultSources";
import {
  isUntouchedDefault,
  mergeOverridesOverDefaults,
} from "@/modules/cartography-watcher/domain/sourceOverrides";
import type { WatchedSource } from "@/modules/cartography-watcher/types";

function buildCustomSource(overrides: Partial<WatchedSource> = {}): WatchedSource {
  return {
    id: "mi-conjunto",
    title: "Mi Conjunto",
    datasetSlug: "mi-conjunto",
    portalHost: "datos.example.org",
    isDefault: false,
    ...overrides,
  };
}

describe("isUntouchedDefault", () => {
  it("should return true when source matches the shipped default in every tracked property", () => {
    // Arrange
    const defaultSource = { ...DEFAULT_WATCHED_SOURCES[0] };

    // Act & Assert
    expect(isUntouchedDefault(defaultSource)).toBe(true);
  });

  it("should return false when a tracked property has been changed", () => {
    // Arrange
    const defaultSource = DEFAULT_WATCHED_SOURCES[0];

    // Act & Assert
    expect(isUntouchedDefault({ ...defaultSource, datasetSlug: "nuevo-slug" })).toBe(false);
    expect(isUntouchedDefault({ ...defaultSource, portalHost: "otro.portal.org" })).toBe(false);
    expect(isUntouchedDefault({ ...defaultSource, title: "Nuevo Titulo" })).toBe(false);
    expect(isUntouchedDefault({ ...defaultSource, description: "Nueva Descripcion" })).toBe(false);
  });

  it("should return false for a custom source id not in shipped defaults", () => {
    // Arrange & Act & Assert
    expect(isUntouchedDefault(buildCustomSource())).toBe(false);
  });
});

describe("mergeOverridesOverDefaults", () => {
  it("should return shipped defaults with isDefault: true when persisted rows are empty", () => {
    // Arrange & Act
    const result = mergeOverridesOverDefaults([]);

    // Assert
    expect(result).toHaveLength(DEFAULT_WATCHED_SOURCES.length);
    expect(result.every((source) => source.isDefault)).toBe(true);
    expect(result.map((source) => source.id)).toEqual(
      DEFAULT_WATCHED_SOURCES.map((source) => source.id)
    );
  });

  it("should apply overrides onto matching defaults and re-stamp isDefault: true", () => {
    // Arrange
    const defaultSource = DEFAULT_WATCHED_SOURCES[0];
    const overrideRow: WatchedSource = {
      id: defaultSource.id,
      title: "Titulo Modificado",
      datasetSlug: "slug-modificado",
      portalHost: "nuevo.portal.gub.uy",
      description: "Descripcion modificada",
      isDefault: false, // even if persisted with false
    };

    // Act
    const result = mergeOverridesOverDefaults([overrideRow]);

    // Assert
    const updated = result.find((source) => source.id === defaultSource.id);
    expect(updated?.title).toBe("Titulo Modificado");
    expect(updated?.datasetSlug).toBe("slug-modificado");
    expect(updated?.portalHost).toBe("nuevo.portal.gub.uy");
    expect(updated?.description).toBe("Descripcion modificada");
    expect(updated?.isDefault).toBe(true);
  });

  it("should append custom sources with isDefault: false", () => {
    // Arrange
    const custom = buildCustomSource({ isDefault: false });

    // Act
    const result = mergeOverridesOverDefaults([custom]);

    // Assert
    expect(result).toHaveLength(DEFAULT_WATCHED_SOURCES.length + 1);
    const added = result.find((source) => source.id === custom.id);
    expect(added).toBeDefined();
    expect(added?.isDefault).toBe(false);
  });

  it("should ignore persisted rows that claim to be defaults with unknown IDs", () => {
    // Arrange
    const impostor: WatchedSource = {
      id: "conjunto-desconocido",
      title: "Impostor",
      datasetSlug: "impostor",
      portalHost: "impostor.gub.uy",
      isDefault: true,
    };

    // Act
    const result = mergeOverridesOverDefaults([impostor]);

    // Assert
    expect(result).toHaveLength(DEFAULT_WATCHED_SOURCES.length);
    expect(result.some((source) => source.id === "conjunto-desconocido")).toBe(false);
  });
});
