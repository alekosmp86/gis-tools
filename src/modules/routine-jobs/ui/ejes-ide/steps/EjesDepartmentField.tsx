"use client";

import React from "react";
import { SelectField } from "@/ui-kit/components/ui/SelectField";
import type { SelectFieldOption } from "@/ui-kit/types/ui";
import { EJES_DEPARTMENTS, type EjesDepartment } from "../../../jobs/ejes-ide/constants";
import { EJES_DEPARTMENT_TEXT } from "../ejesIdeTexts";
import styles from "../../shared/steps/WizardSteps.module.css";

const ALL_DEPARTMENTS_VALUE = "";

const DEPARTMENT_OPTIONS: readonly SelectFieldOption<string>[] = [
  { value: ALL_DEPARTMENTS_VALUE, label: EJES_DEPARTMENT_TEXT.ALL },
  ...EJES_DEPARTMENTS.map((department) => ({ value: department, label: department })),
];

export interface EjesDepartmentFieldProps {
  department: EjesDepartment | null;
  onChange: (department: EjesDepartment | null) => void;
}

export const EjesDepartmentField: React.FC<EjesDepartmentFieldProps> = ({ department, onChange }) => (
  <>
    <SelectField
      label={EJES_DEPARTMENT_TEXT.LABEL}
      value={department ?? ALL_DEPARTMENTS_VALUE}
      options={DEPARTMENT_OPTIONS}
      onChange={(value) => onChange(value === ALL_DEPARTMENTS_VALUE ? null : (value as EjesDepartment))}
    />
    <p className={styles.hint}>{EJES_DEPARTMENT_TEXT.HINT}</p>
  </>
);
