"use client";
import { type ComponentProps, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { useAsyncAction, type AsyncAction } from "./use-async-action";
export type AsyncActionButtonProps = Omit<
  ComponentProps<typeof Button>,
  "onClick"
> & { onAction: AsyncAction; pendingLabel?: ReactNode };
export function AsyncActionButton({
  onAction,
  pendingLabel = "处理中…",
  children,
  disabled,
  ...props
}: AsyncActionButtonProps) {
  const action = useAsyncAction();
  return (
    <span className="inline-flex flex-col gap-1">
      <Button
        type="button"
        {...props}
        disabled={disabled || action.pending}
        aria-busy={action.pending}
        onClick={() => void action.run(onAction)}
      >
        {action.pending && <Spinner />}
        {action.pending ? pendingLabel : children}
      </Button>
      {action.error && (
        <span role="alert" className="text-sm text-destructive">
          {action.error}
        </span>
      )}
    </span>
  );
}
