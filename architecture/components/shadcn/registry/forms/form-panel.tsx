"use client";
import { useEffect, useState, useRef, type ReactNode } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { ConfirmDialog } from "@/components/feedback/confirm-dialog";
import { ErrorState } from "@/components/feedback/states";
import {
  useAsyncAction,
  type AsyncAction,
} from "@/components/feedback/use-async-action";
export type FormPanelProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: ReactNode;
  description: ReactNode;
  children: ReactNode;
  onSubmit: AsyncAction;
  dirty?: boolean;
  onDiscard?: AsyncAction;
  submitLabel?: string;
  cancelLabel?: string;
};
function FormPanel({
  open,
  onOpenChange,
  title,
  description,
  children,
  onSubmit,
  dirty = false,
  onDiscard,
  submitLabel = "保存",
  cancelLabel = "取消",
  sheet = false,
}: FormPanelProps & { sheet?: boolean }) {
  const opener = useRef<HTMLElement | null>(null);
  const [discard, setDiscard] = useState(false),
    action = useAsyncAction();
  useEffect(() => {
    if (!open) {
      setDiscard(false);
      action.clearError();
    }
  }, [open, action.clearError]);
  const close = (value: boolean) => {
    if (action.isPending()) return;
    if (!value && dirty) setDiscard(true);
    else onOpenChange(value);
  };
  const Root = sheet ? Sheet : Dialog,
    Content = sheet ? SheetContent : DialogContent,
    Header = sheet ? SheetHeader : DialogHeader,
    Title = sheet ? SheetTitle : DialogTitle,
    Description = sheet ? SheetDescription : DialogDescription;
  return (
    <>
      <Root open={open} onOpenChange={close}>
        <Content
          showCloseButton={!action.pending}
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
          className="max-h-[100dvh] overflow-y-auto p-6 sm:max-w-xl"
          onEscapeKeyDown={(e) => {
            if (action.pending) e.preventDefault();
          }}
          onInteractOutside={(e) => {
            if (action.pending) e.preventDefault();
          }}
        >
          <Header className="p-0">
            <Title>{title}</Title>
            <Description>{description}</Description>
          </Header>
          <form
            className="mt-5 grid gap-5"
            onSubmit={async (e) => {
              e.preventDefault();
              if (await action.run(onSubmit)) onOpenChange(false);
            }}
          >
            <fieldset disabled={action.pending} className="grid min-w-0 gap-5">
              {children}
            </fieldset>
            {action.error && <ErrorState error={action.error} />}
            <div className="flex flex-wrap justify-end gap-2">
              <Button
                type="button"
                variant="outline"
                disabled={action.pending}
                onClick={() => close(false)}
              >
                {cancelLabel}
              </Button>
              <Button
                type="submit"
                disabled={action.pending}
                aria-busy={action.pending}
              >
                {action.pending && <Spinner />}
                {submitLabel}
              </Button>
            </div>
          </form>
        </Content>
      </Root>
      <ConfirmDialog
        open={discard}
        onOpenChange={setDiscard}
        title="放弃未保存的修改？"
        description="未保存的内容会丢失。"
        confirmLabel="放弃修改"
        cancelLabel="继续编辑"
        onConfirm={async () => {
          const result = await onDiscard?.();
          if (result === false) return false;
          onOpenChange(false);
        }}
      />
    </>
  );
}
export function FormDialog(props: FormPanelProps) {
  return <FormPanel {...props} />;
}
export function FormSheet(props: FormPanelProps) {
  return <FormPanel {...props} sheet />;
}
