import React from "react";
import { Button } from "@/ui-kit/components/ui/Button";
import { ButtonVariant } from "@/ui-kit/types/ui";
import styles from "./ShpRunFooter.module.css";

export interface ShpRunFooterProps {
  leading?: React.ReactNode;
  trailing?: React.ReactNode;
}

export interface ShpNewOperationButtonProps {
  onClick: () => void;
}

export const ShpRunFooter: React.FC<ShpRunFooterProps> = ({ leading, trailing }) => (
  <div className={styles.footer}>
    {leading && <div className={styles.leading}>{leading}</div>}
    {trailing && <div className={styles.trailing}>{trailing}</div>}
  </div>
);

export const ShpNewOperationButton: React.FC<ShpNewOperationButtonProps> = ({ onClick }) => (
  <Button type="button" variant={ButtonVariant.GHOST} onClick={onClick}>
    Nueva operación
  </Button>
);
