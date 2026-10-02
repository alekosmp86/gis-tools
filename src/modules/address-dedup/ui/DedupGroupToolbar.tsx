"use client";

import React from "react";
import { ChevronsDownUp, ChevronsUpDown, FilterX } from "lucide-react";
import { formatNumber } from "@/core/common/ValueFormatter";
import { SearchInput } from "@/ui-kit/components/ui/SearchInput";
import { FILTER_ALL, GroupSort, OTHER_FUENTE_COLUMN, type DecisionFilter } from "../constants";
import {
  DECISION_FILTER_OPTIONS,
  OTHER_FUENTES_LABEL,
  REASON_FILTER_OPTIONS,
  type ReasonFilter,
  SORT_OPTIONS,
} from "../data/dedupLabels";
import type { GroupFilterCriteria, SelectOption } from "../types";
import { DedupFilterSelect } from "./DedupFilterSelect";
import styles from "./DedupGroupToolbar.module.css";

interface DedupGroupToolbarProps {
  criteria: GroupFilterCriteria;
  sort: GroupSort;
  fuentes: ReadonlyArray<string>;
  matchingCount: number;
  totalCount: number;
  isFiltered: boolean;
  onCriteriaChange: (patch: Partial<GroupFilterCriteria>) => void;
  onSortChange: (sort: GroupSort) => void;
  onClearFilters: () => void;
  onExpandAll: () => void;
  onCollapseAll: () => void;
}

function toFuenteOptions(fuentes: ReadonlyArray<string>): ReadonlyArray<SelectOption<string>> {
  return [
    { value: FILTER_ALL, label: "Todas" },
    ...fuentes.map((fuente) => ({ value: fuente, label: fuente === OTHER_FUENTE_COLUMN ? OTHER_FUENTES_LABEL : fuente })),
  ];
}

export const DedupGroupToolbar: React.FC<DedupGroupToolbarProps> = ({
  criteria,
  sort,
  fuentes,
  matchingCount,
  totalCount,
  isFiltered,
  onCriteriaChange,
  onSortChange,
  onClearFilters,
  onExpandAll,
  onCollapseAll,
}) => (
  <div className={styles.toolbar}>
    <div className={styles.row}>
      <SearchInput
        value={criteria.search}
        onChange={(search) => onCriteriaChange({ search })}
        placeholder="Buscar por URN, padrón o calle"
        className={styles.search}
      />
      <DedupFilterSelect<DecisionFilter>
        label="Decisión"
        value={criteria.decision}
        options={DECISION_FILTER_OPTIONS}
        onChange={(decision) => onCriteriaChange({ decision })}
      />
      <DedupFilterSelect<ReasonFilter>
        label="Motivo"
        value={criteria.reason}
        options={REASON_FILTER_OPTIONS}
        onChange={(reason) => onCriteriaChange({ reason })}
      />
      <DedupFilterSelect
        label="Fuente"
        value={criteria.fuente}
        options={toFuenteOptions(fuentes)}
        onChange={(fuente) => onCriteriaChange({ fuente })}
      />
      <DedupFilterSelect<GroupSort>
        label="Orden"
        value={sort}
        options={SORT_OPTIONS}
        onChange={onSortChange}
      />
    </div>

    <div className={styles.row}>
      <label className={styles.toggle}>
        <input
          type="checkbox"
          checked={criteria.reviewOnly}
          onChange={(event) => onCriteriaChange({ reviewOnly: event.target.checked })}
        />
        <span>Solo para revisar</span>
      </label>

      <button type="button" className={styles.action} onClick={onExpandAll}>
        <ChevronsUpDown size={14} />
        Expandir todo
      </button>
      <button type="button" className={styles.action} onClick={onCollapseAll}>
        <ChevronsDownUp size={14} />
        Contraer todo
      </button>
      {isFiltered && (
        <button type="button" className={styles.action} onClick={onClearFilters}>
          <FilterX size={14} />
          Limpiar filtros
        </button>
      )}

      <span className={styles.count} aria-live="polite">
        Mostrando {formatNumber(matchingCount)} de {formatNumber(totalCount)} grupos
      </span>
    </div>
  </div>
);
