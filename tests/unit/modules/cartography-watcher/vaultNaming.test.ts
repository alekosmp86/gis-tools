import { describe, it, expect } from "vitest";
import {
  sanitizeSlug,
  resolveResourceFilename,
} from "@/modules/cartography-watcher/utils/vaultNaming";
import type { CkanResource } from "@/modules/cartography-watcher/types/watcher";

describe("vaultNaming utility", () => {
  describe("sanitizeSlug", () => {
    it("should remove accents and normalize spaces and symbols to underscores", () => {
      // Arrange & Act
      const slug = sanitizeSlug("Ejes de vías de circulación - ARTIGAS");

      // Assert
      expect(slug).toBe("ejes_de_vias_de_circulacion_artigas");
    });

    it("should handle strings with multiple consecutive underscores", () => {
      // Arrange & Act
      const slug = sanitizeSlug("ide___ejes---vias");

      // Assert
      expect(slug).toBe("ide_ejes---vias");
    });

    it("should fall back to 'recurso' for empty or only-special-character input", () => {
      // Arrange & Act
      const slug = sanitizeSlug("   $$$   ");

      // Assert
      expect(slug).toBe("recurso");
    });
  });

  describe("resolveResourceFilename", () => {
    it("should extract filename from resource URL if available", () => {
      // Arrange
      const resource: CkanResource = {
        id: "123",
        name: "Ejes de vías de circulación - ARTIGAS",
        format: "CSV",
        url: "https://catalogodatos.gub.uy/dataset/123/download/artigas.csv",
      };

      // Act
      const filename = resolveResourceFilename(resource);

      // Assert
      expect(filename).toBe("artigas.csv");
    });

    it("should fall back to sanitized resource name with extension if URL lacks filename", () => {
      // Arrange
      const resource: CkanResource = {
        id: "456",
        name: "Ejes Canelones",
        format: "CSV",
        url: "https://catalogodatos.gub.uy/resource/download",
      };

      // Act
      const filename = resolveResourceFilename(resource);

      // Assert
      expect(filename).toBe("ejes_canelones.csv");
    });
  });
});
