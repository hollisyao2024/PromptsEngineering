"use client";
import { cloneElement, useId, type ReactElement, type ReactNode } from "react";
import {
  Field,
  FieldLabel,
  FieldDescription,
  FieldError,
} from "@/components/ui/field";
export type FieldControlProps = {
  id?: string;
  "aria-describedby"?: string;
  "aria-invalid"?: boolean | "true" | "false";
};
export type FormFieldProps = {
  label: ReactNode;
  description?: ReactNode;
  error?: ReactNode;
  id?: string;
  className?: string;
  children:
    ReactElement<FieldControlProps> | ((props: FieldControlProps) => ReactNode);
};
export function FormField({
  label,
  description,
  error,
  id,
  className,
  children,
}: FormFieldProps) {
  const generated = useId(),
    child = typeof children === "function" ? undefined : children;
  const controlId = id || child?.props.id || generated;
  const describedBy =
    [
      child?.props["aria-describedby"],
      description ? `${controlId}-description` : "",
      error ? `${controlId}-error` : "",
    ]
      .filter(Boolean)
      .join(" ") || undefined;
  const props: FieldControlProps = {
    id: controlId,
    "aria-describedby": describedBy,
    "aria-invalid": error ? true : child?.props["aria-invalid"],
  };
  return (
    <Field className={className} data-invalid={!!error}>
      <FieldLabel htmlFor={controlId}>{label}</FieldLabel>
      {typeof children === "function"
        ? children(props)
        : cloneElement(children, props)}
      {description && (
        <FieldDescription id={`${controlId}-description`}>
          {description}
        </FieldDescription>
      )}
      {error && <FieldError id={`${controlId}-error`}>{error}</FieldError>}
    </Field>
  );
}
