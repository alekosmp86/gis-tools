import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, it, expect } from "vitest";
import { ShpNewOperationButton, ShpRunFooter } from "@/components/tools/db-shapefile-sync/ShpRunFooter";
import styles from "@/components/tools/db-shapefile-sync/ShpRunFooter.module.css";

const renderFooter = (props: React.ComponentProps<typeof ShpRunFooter>): string =>
  renderToStaticMarkup(React.createElement(ShpRunFooter, props));

describe("ShpRunFooter", () => {
  describe("leading and trailing groups", () => {
    it("should render the leading group before the trailing group when both are given", () => {
      const html = renderFooter({
        leading: React.createElement("span", null, "Izquierda"),
        trailing: React.createElement("span", null, "Derecha"),
      });

      expect(html.indexOf("Izquierda")).toBeGreaterThanOrEqual(0);
      expect(html.indexOf("Izquierda")).toBeLessThan(html.indexOf("Derecha"));
    });

    it("should wrap the leading content in the leading class when it is given", () => {
      const html = renderFooter({ leading: React.createElement("span", null, "Izquierda") });

      expect(html).toContain(styles.leading);
      expect(html).toContain("Izquierda");
      expect(html).not.toContain(styles.trailing);
    });

    it("should wrap the trailing content in the trailing class when it is given", () => {
      const html = renderFooter({ trailing: React.createElement("span", null, "Derecha") });

      expect(html).toContain(styles.trailing);
      expect(html).toContain("Derecha");
      expect(html).not.toContain(styles.leading);
    });

    it("should render only the footer wrapper without groups when no content is given", () => {
      const html = renderFooter({});

      expect(html).toContain(styles.footer);
      expect(html).not.toContain(styles.leading);
      expect(html).not.toContain(styles.trailing);
    });
  });

  describe("ShpNewOperationButton", () => {
    it("should render the Nueva operación label as a button of type button", () => {
      const html = renderToStaticMarkup(React.createElement(ShpNewOperationButton, { onClick: () => undefined }));

      expect(html).toContain("<button");
      expect(html).toContain('type="button"');
      expect(html).toContain("Nueva operación");
    });
  });

  describe("button order within the footer", () => {
    it("should place Nueva operación before the right-hand Volver a configurar and Reemplazar ahora buttons", () => {
      const html = renderFooter({
        leading: React.createElement(ShpNewOperationButton, { onClick: () => undefined }),
        trailing: React.createElement(
          React.Fragment,
          null,
          React.createElement("button", { type: "button" }, "Volver a configurar"),
          React.createElement("button", { type: "button" }, "Reemplazar ahora")
        ),
      });

      const newOperationAt = html.indexOf("Nueva operación");
      const reconfigureAt = html.indexOf("Volver a configurar");
      const replaceAt = html.indexOf("Reemplazar ahora");
      expect(newOperationAt).toBeGreaterThanOrEqual(0);
      expect(newOperationAt).toBeLessThan(reconfigureAt);
      expect(reconfigureAt).toBeLessThan(replaceAt);
    });
  });
});
