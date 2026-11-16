import React from "react";
import { X } from "lucide-react";
import { Button } from "@/ui-kit/components/ui/Button";
import { ButtonVariant } from "@/ui-kit/types/ui";
import groupStyles from "./PairChoiceGroups.module.css";
import own from "./PendingPairsSection.module.css";

const ICON_SIZE = 15;
export const ACCEPT_EVERY_NOTE = "La aceptación aplica a todas las geometrías pendientes, no solo a las listadas.";
const REJECT_EVERY_LABEL = "Rechazar todas";
const everyAcceptedLabelOf = (count: number): string =>
  count > 0 ? `Todas las geometrías pendientes aceptadas (${count})` : "Todas las geometrías pendientes aceptadas";

interface GeometryAcceptEveryBannerProps {
  count: number;
  onRejectAll?: () => void;
}

export function GeometryAcceptEveryBanner({ count, onRejectAll }: GeometryAcceptEveryBannerProps) {
  return (
    <>
      <div className={own.toolbar}>
        <p className={groupStyles.count}>{everyAcceptedLabelOf(count)}</p>
        {onRejectAll !== undefined && (
          <div className={own.actions}>
            <Button variant={ButtonVariant.SECONDARY} onClick={onRejectAll}>
              <X size={ICON_SIZE} />
              <span>{REJECT_EVERY_LABEL}</span>
            </Button>
          </div>
        )}
      </div>
      <p className={groupStyles.note}>{ACCEPT_EVERY_NOTE}</p>
    </>
  );
}
