"use client";
import { useEffect, useRef, type ReactNode } from "react";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { useAsyncAction, type AsyncAction } from "./use-async-action";
export type ConfirmDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: ReactNode;
  description: ReactNode;
  onConfirm: AsyncAction;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
  error?: ReactNode;
  pending?: boolean;
};
export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  onConfirm,
  confirmLabel = "确认",
  cancelLabel = "取消",
  destructive = true,
  error,
  pending = false,
}: ConfirmDialogProps) {
  const opener = useRef<HTMLElement | null>(null);
  const action = useAsyncAction(),
    busy = pending || action.pending;
  useEffect(() => {
    if (!open) action.clearError();
  }, [open, action.clearError]);
  const close = (value: boolean) => {
    if (!pending && !action.isPending()) onOpenChange(value);
  };
  return (
    <AlertDialog open={open} onOpenChange={close}>
      <AlertDialogContent
        onOpenAutoFocus={() => {
          opener.current =
            document.activeElement instanceof HTMLElement
              ? document.activeElement
              : null;
        }}
        onCloseAutoFocus={(event) => {
          if (opener.current?.isConnected) {
            event.preventDefault();
            opener.current.focus();
          }
        }}
        onEscapeKeyDown={(event) => {
          if (busy) event.preventDefault();
        }}
      >
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>
        {(action.error || error) && (
          <p role="alert" className="text-sm text-destructive">
            {action.error || error}
          </p>
        )}
        <AlertDialogFooter>
          <Button
            type="button"
            variant="outline"
            disabled={busy}
            onClick={() => close(false)}
          >
            {cancelLabel}
          </Button>
          <Button
            type="button"
            variant={destructive ? "destructive" : "default"}
            disabled={busy}
            aria-busy={busy}
            onClick={async () => {
              if (await action.run(onConfirm)) onOpenChange(false);
            }}
          >
            {busy && <Spinner />}
            {confirmLabel}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
