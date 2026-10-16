import { describe, it, expect, vi } from "vitest";
import type { ReactElement, ReactNode } from "react";
import type { DbConfig } from "@/core/types/db";
import { FullReplaceStep } from "@/components/tools/db-sync-common/FullReplaceStep";

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
}));

vi.mock("@/components/tools/db-sync-common/useFullReplaceWorkflow", () => ({
  useFullReplaceWorkflow: () => workflow,
}));

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

const config = { host: "h", port: 5432, db_name: "d", table_name: "t", schema_name: "public", user: "u" } as unknown as DbConfig;
const mapping = { sourceByTarget: { id: "id" }, defaults: {} };
const base = { sourceColumns: ["id"], targetColumns: ["id"], mapping };

describe("FullReplaceStep", () => {
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
});
