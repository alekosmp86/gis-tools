import { describe, it, expect } from "vitest";
import { definePageContributions } from "@/core/modules/definePageContributions";
import type { ModuleRouteDeclarationFile } from "@/core/modules/contracts";

/** Stand-in for a page component; core never inspects it, so a marker object is enough. */
const DashboardComponent = { name: "Dashboard" };
const DetailComponent = { name: "Detail" };

function buildDeclarationFile(
  pages: ModuleRouteDeclarationFile["pages"]
): ModuleRouteDeclarationFile {
  return { moduleId: "reports", endpoints: [], pages };
}

describe("definePageContributions", () => {
  it("should bind a declared page to the component registered under its path", () => {
    // Arrange
    const declarationFile = buildDeclarationFile([{ path: "", title: "Reportes" }]);

    // Act
    const [page] = definePageContributions(declarationFile, { "": DashboardComponent });

    // Assert
    expect(page.path).toBe("");
    expect(page.title).toBe("Reportes");
    expect(page.Component).toBe(DashboardComponent);
  });

  it("should normalise a declared path before binding it", () => {
    // Arrange
    const declarationFile = buildDeclarationFile([{ path: "/detalle/", title: "Detalle" }]);

    // Act
    const [page] = definePageContributions(declarationFile, { detalle: DetailComponent });

    // Assert
    expect(page.path).toBe("detalle");
  });

  it("should bind several pages independently", () => {
    // Arrange
    const declarationFile = buildDeclarationFile([
      { path: "", title: "Reportes" },
      { path: "detalle", title: "Detalle" },
    ]);

    // Act
    const pages = definePageContributions(declarationFile, {
      "": DashboardComponent,
      detalle: DetailComponent,
    });

    // Assert
    expect(pages.map((page) => page.Component)).toEqual([DashboardComponent, DetailComponent]);
  });

  it("should return nothing when a module declares no pages at all", () => {
    // Arrange: the field is optional, and most modules will not own a page.
    const declarationFile: ModuleRouteDeclarationFile = { moduleId: "reports", endpoints: [] };

    // Act & Assert
    expect(definePageContributions(declarationFile, {})).toEqual([]);
  });

  it("should reject a declared page with no component", () => {
    // Arrange: the generated route would resolve to nothing and render a 404 for ever.
    const declarationFile = buildDeclarationFile([{ path: "detalle", title: "Detalle" }]);

    // Act & Assert
    expect(() => definePageContributions(declarationFile, {})).toThrow(
      /declares page "detalle" .* supplies no component/
    );
  });

  it("should reject a component for a page that was never declared", () => {
    // Arrange: nothing would ever route to it.
    const declarationFile = buildDeclarationFile([{ path: "", title: "Reportes" }]);

    // Act & Assert
    expect(() =>
      definePageContributions(declarationFile, { "": DashboardComponent, detalle: DetailComponent })
    ).toThrow(/supplies page components for "detalle"/);
  });

  it("should reject the same page path declared twice", () => {
    // Arrange
    const declarationFile = buildDeclarationFile([
      { path: "detalle", title: "Detalle" },
      { path: "/detalle", title: "Detalle duplicado" },
    ]);

    // Act & Assert
    expect(() => definePageContributions(declarationFile, { detalle: DetailComponent })).toThrow(
      /declares page "detalle" twice/
    );
  });
});
