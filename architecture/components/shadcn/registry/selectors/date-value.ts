export type DateValue = string;
export type DateRangeValue = { from: DateValue; to: DateValue };
export function parseDateValue(value?: string): Date | undefined {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return undefined;
  const [year, month, day] = value.split("-").map(Number);
  if (year < 1 || year > 9999) return undefined;
  // Local noon avoids UTC parsing and midnight DST transitions; never serialize toISOString().
  const date = new Date(2000, month - 1, day, 12);
  date.setFullYear(year);
  return date.getFullYear() === year &&
    date.getMonth() === month - 1 &&
    date.getDate() === day
    ? date
    : undefined;
}
export function formatDateValue(date: Date): DateValue {
  return `${String(date.getFullYear()).padStart(4, "0")}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}
export function validDateValue(
  value?: string,
  min?: string,
  max?: string,
): boolean {
  return (
    !!parseDateValue(value) &&
    (!min || (!!parseDateValue(min) && value! >= min)) &&
    (!max || (!!parseDateValue(max) && value! <= max))
  );
}
export function validDateRange(
  value?: DateRangeValue,
  min?: string,
  max?: string,
): boolean {
  return (
    !!value &&
    validDateValue(value.from, min, max) &&
    validDateValue(value.to, min, max) &&
    value.from <= value.to
  );
}
