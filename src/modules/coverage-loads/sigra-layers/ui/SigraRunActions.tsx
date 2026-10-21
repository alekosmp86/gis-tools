"use client";

import React, { useRef, useState } from "react";
import { DatabaseZap, FlaskConical } from "lucide-react";
import { Button } from "@/ui-kit/components/ui/Button";
import { ButtonVariant } from "@/ui-kit/types/ui";
import type { SigraLayerId } from "../constants";
import { describeReplaceWarning } from "../domain/replaceWarning";
import { SigraReplaceConfirmation } from "./SigraReplaceConfirmation";
import shared from "./SigraShared.module.css";

interface SigraRunActionsProps {
  canRun: boolean;
  busy: boolean;
  selectedLayerIds: ReadonlyArray<SigraLayerId>;
  onDryRun: () => void;
  onLoad: () => void;
}

const LOAD_ACTION = "load";
const LOAD_BUTTON_SELECTOR = `[data-action="${LOAD_ACTION}"]`;

/** A real load asks for confirmation first; a dry run saves nothing and starts at once. */
export const SigraRunActions: React.FC<SigraRunActionsProps> = ({
  canRun,
  busy,
  selectedLayerIds,
  onDryRun,
  onLoad,
}) => {
  const [isConfirming, setIsConfirming] = useState(false);
  const actionsRef = useRef<HTMLDivElement>(null);
  const isDisabled = !canRun || busy;

  const confirm = () => {
    setIsConfirming(false);
    onLoad();
  };
  const cancel = () => {
    setIsConfirming(false);
    actionsRef.current?.querySelector<HTMLButtonElement>(LOAD_BUTTON_SELECTOR)?.focus();
  };
  const dryRun = () => {
    setIsConfirming(false);
    onDryRun();
  };

  return (
    <div className={shared.stack}>
      {isConfirming && !isDisabled && (
        <SigraReplaceConfirmation
          text={describeReplaceWarning(selectedLayerIds)}
          onConfirm={confirm}
          onCancel={cancel}
        />
      )}
      <div className={shared.actions} ref={actionsRef}>
        <Button type="button" variant={ButtonVariant.SECONDARY} isDisabled={isDisabled} onClick={dryRun}>
          <FlaskConical size={15} />
          Probar sin guardar
        </Button>
        <Button type="button" isDisabled={isDisabled} data-action={LOAD_ACTION} onClick={() => setIsConfirming(true)}>
          <DatabaseZap size={15} />
          Cargar y reemplazar
        </Button>
      </div>
    </div>
  );
};
