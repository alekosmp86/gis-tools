"use client";

import React, { useEffect, useEffectEvent, useState } from "react";
import { FormField } from "@/ui-kit/components/ui/FormField";
import { KeyboardKey } from "@/ui-kit/types/ui";
import { schemaCommitPlan } from "../schemaDraft";

const SCHEMA_COMMIT_DELAY_MS = 500;

export interface SchemaDraftFieldProps {
  label: string;
  /** Starting value of the draft; the field then keeps its own draft. */
  initial: string;
  committed: string;
  onCommit: (schema: string) => void;
}

/** A schema field that commits its draft after a pause, on blur and on Enter. */
export const SchemaDraftField: React.FC<SchemaDraftFieldProps> = ({ label, initial, committed, onCommit }) => {
  // react-doctor-disable-next-line react-doctor/no-derived-useState -- the draft starts from the committed schema once per visit to this step; committed changes reach the draft only through a new visit
  const [draft, setDraft] = useState(initial);
  const commitAfterPause = useEffectEvent((next: string) => onCommit(next));

  const commitDraft = () => {
    const plan = schemaCommitPlan(draft, committed);
    if (plan.schema !== null) onCommit(plan.schema);
  };

  useEffect(() => {
    const next = schemaCommitPlan(draft, committed).schema;
    if (next === null) return;
    const handle = setTimeout(() => commitAfterPause(next), SCHEMA_COMMIT_DELAY_MS);
    return () => clearTimeout(handle);
  }, [draft, committed]);

  return (
    <FormField
      label={label}
      value={draft}
      onChange={setDraft}
      onBlur={commitDraft}
      onKeyDown={(event) => {
        if (event.key === KeyboardKey.ENTER) commitDraft();
      }}
    />
  );
};
