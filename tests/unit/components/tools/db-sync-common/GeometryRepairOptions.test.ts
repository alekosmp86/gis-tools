import { describe, it, expect, vi } from "vitest";
import type { ReactElement, ReactNode } from "react";
import { GeometryRepairOptions, type GeometryRepairOptionsProps } from "@/components/tools/db-sync-common/GeometryRepairOptions";

type AnyElement = ReactElement<Record<string, unknown>>;

const elementsOf = (node: ReactNode, predicate: (element: AnyElement) => boolean, found: AnyElement[] = []): AnyElement[] => {
  if (node === null || node === undefined || typeof node !== "object") return found;
  if (Array.isArray(node)) {
    node.forEach((child) => elementsOf(child, predicate, found));
    return found;
  }
  const element = node as AnyElement;
  if (predicate(element)) found.push(element);
  elementsOf(element.props.children as ReactNode, predicate, found);
  return found;
};

const textsOf = (node: ReactNode, found: string[] = []): string[] => {
  if (typeof node === "string") {
    found.push(node);
    return found;
  }
  if (node === null || node === undefined || typeof node !== "object") return found;
  if (Array.isArray(node)) {
    node.forEach((child) => textsOf(child, found));
    return found;
  }
  return textsOf((node as AnyElement).props.children as ReactNode, found);
};

const inputOfType = (node: ReactNode, type: string): AnyElement[] =>
  elementsOf(node, (element) => element.type === "input" && element.props.type === type);

const baseProps: GeometryRepairOptionsProps = {
  enabled: true,
  decimalsInput: "4",
  decimalsValid: true,
  disabled: false,
  onEnabledChange: () => undefined,
  onDecimalsInputChange: () => undefined,
};

const render = (overrides: Partial<GeometryRepairOptionsProps> = {}) =>
  GeometryRepairOptions({ ...baseProps, ...overrides }) as ReactNode;

const DECIMALS_LABEL = "Decimales de control en EPSG:4326";
const DECIMALS_ERROR = "Ingrese un número entero entre 0 y 8.";
const HELP_CHECKED =
  "Corrige polígonos inválidos y quita las partes que quedarían con menos de 4 vértices al redondearlas a esta cantidad de decimales de grado en EPSG:4326. Las coordenadas guardadas no se redondean. Si todas las partes de una fila desaparecen, la fila conserva su geometría.";
const HELP_UNCHECKED = "Las geometrías se cargan tal como vienen del origen.";

describe("GeometryRepairOptions", () => {
  describe("repair checkbox", () => {
    it("should render the Spanish 'Reparar geometrías' label next to the checkbox", () => {
      expect(textsOf(render())).toContain("Reparar geometrías");
    });

    it("should render the checkbox checked when the repair is enabled", () => {
      const [checkbox] = inputOfType(render({ enabled: true }), "checkbox");
      expect(checkbox.props.checked).toBe(true);
    });

    it("should render the checkbox unchecked when the repair is disabled", () => {
      const [checkbox] = inputOfType(render({ enabled: false }), "checkbox");
      expect(checkbox.props.checked).toBe(false);
    });

    it("should report the new checked state through onEnabledChange when the checkbox changes", () => {
      const onEnabledChange = vi.fn();
      const [checkbox] = inputOfType(render({ enabled: true, onEnabledChange }), "checkbox");
      (checkbox.props.onChange as (event: unknown) => void)({ target: { checked: false } });
      expect(onEnabledChange).toHaveBeenCalledWith(false);
    });

    it("should report true through onEnabledChange when a disabled repair is turned on", () => {
      const onEnabledChange = vi.fn();
      const [checkbox] = inputOfType(render({ enabled: false, onEnabledChange }), "checkbox");
      (checkbox.props.onChange as (event: unknown) => void)({ target: { checked: true } });
      expect(onEnabledChange).toHaveBeenCalledWith(true);
    });

    it("should disable the checkbox when disabled is true", () => {
      const [checkbox] = inputOfType(render({ disabled: true }), "checkbox");
      expect(checkbox.props.disabled).toBe(true);
    });

    it("should keep the checkbox enabled when disabled is false", () => {
      const [checkbox] = inputOfType(render({ disabled: false }), "checkbox");
      expect(checkbox.props.disabled).toBe(false);
    });
  });

  describe("decimals input", () => {
    it("should render the decimals input with the Spanish label when the repair is enabled", () => {
      const node = render({ enabled: true });
      expect(textsOf(node)).toContain(DECIMALS_LABEL);
      expect(inputOfType(node, "number")).toHaveLength(1);
    });

    it("should hide the decimals input and its label when the repair is disabled", () => {
      const node = render({ enabled: false });
      expect(inputOfType(node, "number")).toHaveLength(0);
      expect(textsOf(node)).not.toContain(DECIMALS_LABEL);
    });

    it("should bound the decimals input between 0 and 8 in steps of 1", () => {
      const [decimals] = inputOfType(render(), "number");
      expect(decimals.props.min).toBe(0);
      expect(decimals.props.max).toBe(8);
      expect(decimals.props.step).toBe(1);
    });

    it("should show the decimalsInput value as the controlled value", () => {
      const [decimals] = inputOfType(render({ decimalsInput: "6" }), "number");
      expect(decimals.props.value).toBe("6");
    });

    it("should report the raw typed text through onDecimalsInputChange", () => {
      const onDecimalsInputChange = vi.fn();
      const [decimals] = inputOfType(render({ onDecimalsInputChange }), "number");
      (decimals.props.onChange as (event: unknown) => void)({ target: { value: "6" } });
      expect(onDecimalsInputChange).toHaveBeenCalledWith("6");
    });

    it("should pass an empty typed text through unchanged so the workflow can validate it", () => {
      const onDecimalsInputChange = vi.fn();
      const [decimals] = inputOfType(render({ onDecimalsInputChange }), "number");
      (decimals.props.onChange as (event: unknown) => void)({ target: { value: "" } });
      expect(onDecimalsInputChange).toHaveBeenCalledWith("");
    });

    it("should disable the decimals input when disabled is true", () => {
      const [decimals] = inputOfType(render({ disabled: true }), "number");
      expect(decimals.props.disabled).toBe(true);
    });
  });

  describe("decimals validation feedback", () => {
    it("should show the inline Spanish error and mark the input invalid when the decimals are invalid", () => {
      const node = render({ decimalsInput: "9", decimalsValid: false });
      expect(textsOf(node)).toContain(DECIMALS_ERROR);
      const [decimals] = inputOfType(node, "number");
      expect(decimals.props["aria-invalid"]).toBe(true);
    });

    it("should not show the inline error and mark the input valid when the decimals are valid", () => {
      const node = render({ decimalsInput: "6", decimalsValid: true });
      expect(textsOf(node)).not.toContain(DECIMALS_ERROR);
      const [decimals] = inputOfType(node, "number");
      expect(decimals.props["aria-invalid"]).toBe(false);
    });

    it("should show the inline error for an empty decimals input", () => {
      const node = render({ decimalsInput: "", decimalsValid: false });
      expect(textsOf(node)).toContain(DECIMALS_ERROR);
    });

    it("should not show the inline error while the repair is disabled even if the decimals are invalid", () => {
      const node = render({ enabled: false, decimalsInput: "9", decimalsValid: false });
      expect(textsOf(node)).not.toContain(DECIMALS_ERROR);
    });
  });

  describe("help text", () => {
    it("should show the checked help text describing the repair when the repair is enabled", () => {
      const texts = textsOf(render({ enabled: true }));
      expect(texts).toContain(HELP_CHECKED);
      expect(texts).not.toContain(HELP_UNCHECKED);
    });

    it("should show the unchecked help text when the repair is disabled", () => {
      const texts = textsOf(render({ enabled: false }));
      expect(texts).toContain(HELP_UNCHECKED);
      expect(texts).not.toContain(HELP_CHECKED);
    });
  });
});
