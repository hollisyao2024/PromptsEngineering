import { type ReactNode } from "react";
import {
  FieldSet,
  FieldLegend,
  FieldDescription,
  FieldGroup,
} from "@/components/ui/field";
export function FormSection({
  title,
  description,
  children,
  columns = 1,
}: {
  title: ReactNode;
  description?: ReactNode;
  children: ReactNode;
  columns?: 1 | 2;
}) {
  return (
    <FieldSet>
      <FieldLegend>{title}</FieldLegend>
      {description && <FieldDescription>{description}</FieldDescription>}
      <FieldGroup
        className={columns === 2 ? "grid gap-5 sm:grid-cols-2" : "grid gap-5"}
      >
        {children}
      </FieldGroup>
    </FieldSet>
  );
}
