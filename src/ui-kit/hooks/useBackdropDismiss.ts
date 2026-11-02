import { useEffect } from "react";

/**
 * Calls onDismiss for a click on the dialog element itself, which is its backdrop. A press that began inside the
 * content (a text selection that ends outside it) does not count.
 */
export function useBackdropDismiss(dialogRef: React.RefObject<HTMLDialogElement | null>, onDismiss: () => void): void {
  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog === null) return;
    let pressedOnBackdrop = false;

    const handleMouseDown = (event: MouseEvent) => {
      pressedOnBackdrop = event.target === dialog;
    };
    const handleClick = (event: MouseEvent) => {
      const isBackdropClick = pressedOnBackdrop && event.target === dialog;
      pressedOnBackdrop = false;
      if (isBackdropClick) onDismiss();
    };

    dialog.addEventListener("mousedown", handleMouseDown);
    dialog.addEventListener("click", handleClick);
    return () => {
      dialog.removeEventListener("mousedown", handleMouseDown);
      dialog.removeEventListener("click", handleClick);
    };
  }, [dialogRef, onDismiss]);
}
