"use client";
import { type ReactNode } from "react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  Empty,
  EmptyHeader,
  EmptyTitle,
  EmptyDescription,
  EmptyContent,
} from "@/components/ui/empty";
import { Spinner } from "@/components/ui/spinner";
import { AsyncActionButton } from "./async-action-button";
import { type AsyncAction } from "./use-async-action";
export function LoadingState({ label = "加载中…" }: { label?: ReactNode }) {
  return (
    <div role="status" className="flex items-center justify-center gap-2 p-6">
      <Spinner />
      {label}
    </div>
  );
}
export function EmptyState({
  title = "暂无数据",
  description,
  children,
}: {
  title?: ReactNode;
  description?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <Empty>
      <EmptyHeader>
        <EmptyTitle>{title}</EmptyTitle>
        {description && <EmptyDescription>{description}</EmptyDescription>}
      </EmptyHeader>
      {children && <EmptyContent>{children}</EmptyContent>}
    </Empty>
  );
}
export function ErrorState({
  error,
  title,
  onRetry,
}: {
  error: ReactNode;
  title?: ReactNode;
  onRetry?: AsyncAction;
}) {
  return (
    <Alert variant="destructive">
      {title && <AlertTitle>{title}</AlertTitle>}
      <AlertDescription>
        {error}
        {onRetry && (
          <AsyncActionButton variant="outline" onAction={onRetry}>
            重试
          </AsyncActionButton>
        )}
      </AlertDescription>
    </Alert>
  );
}
