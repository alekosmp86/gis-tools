import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ShpReplaceFormFields } from "@/components/tools/db-shapefile-sync/ShpReplaceFormFields";
import type { ShpReplaceWorkflow } from "@/components/tools/db-shapefile-sync/useShpReplaceWorkflow";

const noop = () => undefined;

const workflow = (overrides: Partial<ShpReplaceWorkflow> = {}): ShpReplaceWorkflow =>
  ({
    confirmText: "geo.parcelas",
    confirmValue: "",
    setConfirmValue: noop,
    password: "",
    setPassword: noop,
    showPassword: false,
    toggleShowPassword: noop,
    sridText: "",
    setSridText: noop,
    sourceSrid: null,
    resetSequences: true,
    setResetSequences: noop,
    canAnalyze: false,
    canRun: false,
    analyze: noop,
    run: noop,
    ...overrides,
  }) as ShpReplaceWorkflow;

const render = (props: Partial<React.ComponentProps<typeof ShpReplaceFormFields>> = {}, wf = workflow()): string =>
  renderToStaticMarkup(
    React.createElement(ShpReplaceFormFields, { workflow: wf, sridHint: "Pista del SRID", targetUser: "app", ...props })
  );

describe("ShpReplaceFormFields", () => {
  describe("CR-13: showSrid", () => {
    it("should render the SRID input and its hint by default", () => {
      const html = render();

      expect(html).toContain("SRID de origen");
      expect(html).toContain('id="shpReplaceSridInput"');
      expect(html).toContain("Pista del SRID");
    });

    it("should render the SRID input when showSrid is true", () => {
      expect(render({ showSrid: true })).toContain('id="shpReplaceSridInput"');
    });

    it("should not render the SRID block at all when showSrid is false", () => {
      const html = render({ showSrid: false });

      expect(html).not.toContain("SRID de origen");
      expect(html).not.toContain("shpReplaceSridInput");
      expect(html).not.toContain("Pista del SRID");
    });

    it("should keep the reset sequences, confirmation and password fields when showSrid is false", () => {
      const html = render({ showSrid: false });

      expect(html).toContain("Reiniciar secuencias del destino");
      expect(html).toContain('id="shpReplaceConfirmInput"');
      expect(html).toContain('id="shpReplacePasswordInput"');
    });

    it("should show the invalid SRID hint instead of the given hint when the SRID text is out of range", () => {
      const html = render({}, workflow({ sridText: "0" }));

      expect(html).toContain("Ingrese un SRID entero entre 1 y 998999.");
      expect(html).not.toContain("Pista del SRID");
    });

    it("should not show the invalid hint when the SRID is valid or empty", () => {
      expect(render({}, workflow({ sridText: "32721" }))).not.toContain("Ingrese un SRID entero");
      expect(render({}, workflow({ sridText: "" }))).not.toContain("Ingrese un SRID entero");
    });
  });

  describe("CR-13: shared fields", () => {
    it("should show the confirmation text to type and the target user in the password label", () => {
      const html = render({ targetUser: "gisuser" });

      expect(html).toContain("geo.parcelas");
      expect(html).toContain("Contraseña de PostgreSQL del destino (gisuser)");
    });

    it("should render the password as hidden by default and as text when it is shown", () => {
      expect(render()).toContain('type="password"');
      expect(render({}, workflow({ showPassword: true }))).not.toContain('type="password"');
    });

    it("should label the eye button according to the visibility", () => {
      expect(render()).toContain("Mostrar contraseña");
      expect(render({}, workflow({ showPassword: true }))).toContain("Ocultar contraseña");
    });

    it("should check the reset sequences box according to the workflow", () => {
      expect(render({}, workflow({ resetSequences: true }))).toContain("checked");
      expect(render({}, workflow({ resetSequences: false }))).not.toContain("checked");
    });
  });
});
