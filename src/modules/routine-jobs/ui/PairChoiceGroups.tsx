"use client";

import React from "react";
import { RefreshCw } from "lucide-react";
import { Button } from "@/ui-kit/components/ui/Button";
import { ButtonVariant } from "@/ui-kit/types/ui";
import type { PairChoice } from "../jobs/actualizar-padron/types";
import { CollapsibleSection } from "./ActualizarReportSections";
import { chosenGroupCount, isUnappliedGroup, type AmbiguousGroupView } from "./pairChoices";
import { PairChoiceGroupCard } from "./PairChoiceGroupCard";
import { groupReviewItemsOf, type OpenReview } from "./padronReviewItems";
import styles from "./PairChoiceGroups.module.css";

const ICON_SIZE = 15;
const SECTION_TITLE = "Grupos ambiguos";
export const RESIMULATE_LABEL = "Volver a analizar con la selección";

/**
 * `choices` is the current selection and `submitted` the choices sent with the shown run. Without onChoose the groups are read-only;
 * without onResimulate there is no re-run button (real-run results).
 * onChooseMany and onRemoveMany are the bulk forms used by the pending loose pairs (one state update for the whole list).
 */
export interface PairChoiceSelection {
  choices: readonly PairChoice[];
  submitted: readonly PairChoice[];
  onChoose?: (choice: PairChoice) => void;
  onChooseMany?: (choices: PairChoice[]) => void;
  onRemoveMany?: (choices: PairChoice[]) => void;
  onResimulate?: () => void;
  canResimulate: boolean;
}

export interface PairChoiceGroupsProps {
  groups: readonly AmbiguousGroupView[];
  unappliedChoices: readonly PairChoice[];
  selection: PairChoiceSelection;
  onOpenReview: OpenReview;
}

interface ChoiceToolbarProps {
  chosen: number;
  total: number;
  canResimulate: boolean;
  onResimulate: () => void;
}

function ChoiceToolbar({ chosen, total, canResimulate, onResimulate }: ChoiceToolbarProps) {
  return (
    <div className={styles.toolbar}>
      <p className={styles.count}>{`${chosen} de ${total} grupos con elección`}</p>
      <Button variant={ButtonVariant.SECONDARY} onClick={onResimulate} disabled={!canResimulate}>
        <RefreshCw size={ICON_SIZE} />
        <span>{RESIMULATE_LABEL}</span>
      </Button>
    </div>
  );
}

export function PairChoiceGroups({ groups, unappliedChoices, selection, onOpenReview }: PairChoiceGroupsProps) {
  const { choices, onChoose, onResimulate, canResimulate } = selection;
  return (
    <CollapsibleSection summary={`${SECTION_TITLE} (${groups.length})`}>
      {onResimulate !== undefined && (
        <ChoiceToolbar
          chosen={chosenGroupCount(groups, choices)}
          total={groups.length}
          canResimulate={canResimulate}
          onResimulate={onResimulate}
        />
      )}
      <div className={styles.groups}>
        {groups.map((group, index) => (
          <PairChoiceGroupCard
            key={group.id}
            group={group}
            choices={choices}
            unapplied={isUnappliedGroup(group, unappliedChoices)}
            onChoose={onChoose}
            onShowMap={() => onOpenReview(groupReviewItemsOf(groups), index)}
          />
        ))}
      </div>
    </CollapsibleSection>
  );
}
