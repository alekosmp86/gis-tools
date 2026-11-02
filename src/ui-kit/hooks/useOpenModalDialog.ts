import { useEffect } from "react";

/**
 * Opens a native dialog as modal on mount; unmounting removes it. The cleanup must not call close(): React's dev double effect
 * would fire the dialog's close event and the owner would dismiss the modal as soon as it opened. The page behind does not
 * scroll while the dialog is open.
 */
export function useOpenModalDialog(dialogRef: React.RefObject<HTMLDialogElement | null>): void {
  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog === null) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    if (!dialog.open) dialog.showModal();
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [dialogRef]);
}
