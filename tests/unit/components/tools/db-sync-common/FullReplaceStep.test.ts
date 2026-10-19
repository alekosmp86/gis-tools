import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ReactElement, ReactNode } from "react";
import type { DbColumnMetadata, DbConfig } from "@/core/types/db";
import { FullReplaceStep } from "@/components/tools/db-sync-common/FullReplaceStep";

type Sequence = { qualifiedLabel: string; schema: string; name: string };

const workflow = vi.hoisted(() => ({
  confirmText: "public.t",
  confirmValue: "",
  password: "",
  showPassword: false,
  isRunning: false,
  canRun: false,
  setConfirmValue: () => {},
  setPassword: () => {},
  toggleShowPassword: () => {},
  run: () => {},
  sequenceDiscovery: { sequences: [] as Sequence[], unparsedDefaults: [] as string[] },
  resetSequences: true,
  setResetSequences: (() => {}) as (value: boolean) => void,
}));

vi.mock("@/components/tools/db-sync-common/useFullReplaceWorkflow", () => ({
  useFullReplaceWorkflow: () => workflow,
}));

type AnyElement = ReactElement<Record<string, unknown>>;

const flatten = (node: ReactNode, texts: string[] = []) => {
  if (node === null || node === undefined || typeof node === "boolean") return { texts };
  if (typeof node === "string" || typeof node === "number") {
    texts.push(String(node));
    return { texts };
  }
  if (Array.isArray(node)) {
    node.forEach((child) => flatten(child, texts));
    return { texts };
  }
  flatten((node as ReactElement<{ children?: ReactNode }>).props.children, texts);
  return { texts };
};

const findElements = (node: ReactNode, predicate: (element: AnyElement) => boolean, found: AnyElement[] = []) => {
  if (node === null || node === undefined || typeof node !== "object") return found;
  if (Array.isArray(node)) {
    node.forEach((child) => findElements(child, predicate, found));
    return found;
  }
  const element = node as AnyElement;
  if (predicate(element)) found.push(element);
  findElements(element.props.children as ReactNode, predicate, found);
  return found;
};

const isCheckbox = (element: AnyElement) => element.type === "input" && element.props.type === "checkbox";
const alertTexts = (tree: ReactNode) =>
  findElements(tree, (element) => typeof element.props.text === "string").map((element) => element.props.text as string);

const config = { host: "h", port: 5432, db_name: "d", table_name: "t", schema_name: "public", user: "u" } as unknown as DbConfig;
const mapping = { sourceByTarget: { id: "id" }, defaults: {} };
const targetDetails: DbColumnMetadata[] = [];
const base = { sourceColumns: ["id"], targetColumns: ["id"], targetDetails, mapping };

describe("FullReplaceStep", () => {
  beforeEach(() => {
    workflow.sequenceDiscovery = { sequences: [], unparsedDefaults: [] };
    workflow.resetSequences = true;
    workflow.setResetSequences = () => {};
    workflow.isRunning = false;
  });

  it("should render nothing when the source config is missing", () => {
    expect(FullReplaceStep({ ...base, sourceConfig: null, targetConfig: config })).toBeNull();
  });

  it("should render nothing when the target config is missing", () => {
    expect(FullReplaceStep({ ...base, sourceConfig: config, targetConfig: null })).toBeNull();
  });

  it("should render the confirmation form when both configs exist", () => {
    expect(FullReplaceStep({ ...base, sourceConfig: config, targetConfig: config })).not.toBeNull();
  });

  it("should warn that the run can be interrupted, leave the target partially loaded and is safe to re-run (AC-15)", () => {
    const tree = FullReplaceStep({ ...base, sourceConfig: config, targetConfig: config }) as ReactNode;
    const { texts } = flatten(tree);
    const text = texts.join(" ");
    expect(text).toContain("interrumpe");
    expect(text).toContain("parcialmente");
    expect(text).toContain("seguro");
  });

  describe("sequence reset option", () => {
    const sequences: Sequence[] = [
      { qualifiedLabel: "geo.a_seq", schema: "geo", name: "a_seq" },
      { qualifiedLabel: "geo.b_seq", schema: "geo", name: "b_seq" },
    ];
    const render = () => FullReplaceStep({ ...base, sourceConfig: config, targetConfig: config }) as ReactNode;

    it("should not render the checkbox when there are no discoverable sequences", () => {
      const tree = render();
      expect(findElements(tree, isCheckbox)).toHaveLength(0);
      expect(flatten(tree).texts.join(" ")).not.toContain("Reiniciar secuencias del destino");
    });

    it("should render a checked checkbox with the label when sequences exist", () => {
      workflow.sequenceDiscovery = { sequences, unparsedDefaults: [] };
      const tree = render();
      const checkboxes = findElements(tree, isCheckbox);
      expect(checkboxes).toHaveLength(1);
      expect(checkboxes[0].props.checked).toBe(true);
      expect(flatten(tree).texts).toContain("Reiniciar secuencias del destino");
    });

    it("should list every sequence label while the checkbox is checked", () => {
      workflow.sequenceDiscovery = { sequences, unparsedDefaults: [] };
      const text = flatten(render()).texts.join(" ");
      expect(text).toContain("geo.a_seq");
      expect(text).toContain("geo.b_seq");
      expect(text).toContain("Se reiniciarán en 1");
    });

    it("should reflect an unchecked state and say the sequences will not be reset", () => {
      workflow.sequenceDiscovery = { sequences, unparsedDefaults: [] };
      workflow.resetSequences = false;
      const tree = render();
      expect(findElements(tree, isCheckbox)[0].props.checked).toBe(false);
      const text = flatten(tree).texts.join(" ");
      expect(text).toContain("no se reiniciarán");
      expect(text).not.toContain("geo.a_seq");
    });

    it("should disable the checkbox while a run is in progress", () => {
      workflow.sequenceDiscovery = { sequences, unparsedDefaults: [] };
      workflow.isRunning = true;
      expect(findElements(render(), isCheckbox)[0].props.disabled).toBe(true);
    });

    it("should forward the checkbox change to setResetSequences", () => {
      const calls: boolean[] = [];
      workflow.sequenceDiscovery = { sequences, unparsedDefaults: [] };
      workflow.setResetSequences = (value) => calls.push(value);
      const onChange = findElements(render(), isCheckbox)[0].props.onChange as (event: { target: { checked: boolean } }) => void;
      onChange({ target: { checked: false } });
      expect(calls).toEqual([false]);
    });

    it("should show the shared-sequence and ownership hint when sequences exist", () => {
      workflow.sequenceDiscovery = { sequences, unparsedDefaults: [] };
      const text = flatten(render()).texts.join(" ").replace(/\s+/g, " ");
      expect(text).toContain("otra tabla usa la misma secuencia");
      expect(text).toContain("colisionarán");
      expect(text).toContain("propietario");
      expect(text).toContain("se revierte todo el primer lote");
      expect(text).toContain("desmarcar esta opción");
    });

    it("should not show the shared-sequence hint when there are no sequences", () => {
      const text = flatten(render()).texts.join(" ");
      expect(text).not.toContain("colisionarán");
      expect(text).not.toContain("propietario");
      expect(text).not.toContain("desmarcar esta opción");
    });

    it("should show the unparsable-defaults warning listing each column default", () => {
      workflow.sequenceDiscovery = {
        sequences: [],
        unparsedDefaults: ["id: nextval(foo)", "pk: nextval(('a'||'b')::regclass)"],
      };
      const warnings = alertTexts(render()).filter((text) => text.includes("No se pudo interpretar"));
      expect(warnings).toHaveLength(1);
      expect(warnings[0]).toContain("id: nextval(foo)");
      expect(warnings[0]).toContain("pk: nextval(('a'||'b')::regclass)");
    });

    it("should not show the unparsable-defaults warning when there are none", () => {
      workflow.sequenceDiscovery = { sequences, unparsedDefaults: [] };
      expect(alertTexts(render()).some((text) => text.includes("No se pudo interpretar"))).toBe(false);
    });
  });
});
