"use client";
import { type ReactElement } from "react";
import {
  Controller,
  type ControllerProps,
  type ControllerRenderProps,
  type FieldPath,
  type FieldValues,
  type UseFormReturn,
} from "react-hook-form";
import {
  FormField,
  type FormFieldProps,
  type FieldControlProps,
} from "./form-field";
export function RHFField<T extends FieldValues, N extends FieldPath<T>>({
  label,
  description,
  render,
  ...props
}: Omit<ControllerProps<T, N>, "render"> &
  Pick<FormFieldProps, "label" | "description"> & {
    render: (
      field: ControllerRenderProps<T, N>,
    ) => ReactElement<FieldControlProps>;
  }) {
  return (
    <Controller
      {...props}
      render={({ field, fieldState }) => (
        <FormField
          label={label}
          description={description}
          error={fieldState.error?.message}
        >
          {render(field)}
        </FormField>
      )}
    />
  );
}
// handleSubmit resolves void even on invalid input; this adapter explicitly keeps the panel open.
export function submitForm<T extends FieldValues>(
  form: UseFormReturn<T>,
  onValid: (values: T) => unknown | Promise<unknown>,
) {
  return async () => {
    let valid = false,
      result: unknown;
    await form.handleSubmit(async (values) => {
      valid = true;
      result = await onValid(values);
    })();
    return valid && result !== false;
  };
}
