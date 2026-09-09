"use client";
import { useId, useState } from "react";
import { zhCN } from "date-fns/locale";
import { CalendarIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Calendar } from "@/components/ui/calendar";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  parseDateValue,
  formatDateValue,
  validDateValue,
  validDateRange,
  type DateValue,
  type DateRangeValue,
} from "./date-value";
export type DatePickerProps = {
  label: string;
  value?: DateValue;
  onChange: (value: DateValue | undefined) => void;
  min?: DateValue;
  max?: DateValue;
  disabled?: boolean;
  id?: string;
  "aria-describedby"?: string;
  "aria-invalid"?: boolean | "true" | "false";
};
export function DatePicker({
  label,
  value,
  onChange,
  min,
  max,
  disabled,
  ...aria
}: DatePickerProps) {
  const [open, setOpen] = useState(false),
    [draft, setDraft] = useState(value || ""),
    [error, setError] = useState(false),
    id = useId();
  const choose = (date: string) => {
    if (!validDateValue(date, min, max)) {
      setError(true);
      return;
    }
    onChange(date);
    setOpen(false);
  };
  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        if (next) {
          setDraft(value || "");
          setError(false);
        }
        setOpen(next);
      }}
    >
      <PopoverTrigger asChild>
        <Button
          {...aria}
          type="button"
          variant="outline"
          disabled={disabled}
          aria-label={label}
        >
          <CalendarIcon />
          {value || label}
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="w-auto max-w-[95vw] max-h-[var(--radix-popover-content-available-height)] overflow-y-auto space-y-3"
      >
        <Calendar
          mode="single"
          locale={zhCN}
          selected={parseDateValue(draft)}
          defaultMonth={parseDateValue(value || min)}
          disabled={(date) => !validDateValue(formatDateValue(date), min, max)}
          onSelect={(date) => {
            if (date) choose(formatDateValue(date));
          }}
        />
        <div className="grid gap-2">
          <Label htmlFor={id}>日期（YYYY-MM-DD）</Label>
          <Input
            id={id}
            value={draft}
            placeholder="YYYY-MM-DD"
            aria-invalid={error}
            aria-describedby={error ? `${id}-error` : undefined}
            onChange={(e) => {
              setDraft(e.target.value);
              setError(false);
            }}
          />
        </div>
        {error && (
          <p
            id={`${id}-error`}
            role="alert"
            className="text-sm text-destructive"
          >
            请输入有效且在允许范围内的日期
          </p>
        )}
        <div className="flex justify-between gap-2">
          <Button
            type="button"
            variant="ghost"
            onClick={() => {
              onChange(undefined);
              setOpen(false);
            }}
          >
            清除日期
          </Button>
          <Button type="button" onClick={() => choose(draft)}>
            应用日期
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
export type DateRangePickerProps = Omit<
  DatePickerProps,
  "value" | "onChange"
> & {
  value?: DateRangeValue;
  onChange: (value: DateRangeValue | undefined) => void;
  presets?: { label: string; value: DateRangeValue }[];
};
export function DateRangePicker({
  label,
  value,
  onChange,
  min,
  max,
  disabled,
  presets = [],
  ...aria
}: DateRangePickerProps) {
  const [open, setOpen] = useState(false),
    [from, setFrom] = useState(value?.from || ""),
    [to, setTo] = useState(value?.to || ""),
    [error, setError] = useState(false),
    id = useId();
  const choose = (range: DateRangeValue) => {
    if (!validDateRange(range, min, max)) {
      setError(true);
      return;
    }
    onChange(range);
    setOpen(false);
  };
  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        if (next) {
          setFrom(value?.from || "");
          setTo(value?.to || "");
          setError(false);
        }
        setOpen(next);
      }}
    >
      <PopoverTrigger asChild>
        <Button
          {...aria}
          type="button"
          variant="outline"
          disabled={disabled}
          aria-label={label}
          className="max-w-full"
        >
          <CalendarIcon />
          <span className="truncate">
            {value ? `${value.from} 至 ${value.to}` : label}
          </span>
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="w-auto max-w-[95vw] max-h-[var(--radix-popover-content-available-height)] overflow-y-auto space-y-3"
      >
        <div className="flex flex-wrap gap-2">
          {presets.map((preset) => (
            <Button
              key={preset.label}
              type="button"
              variant="secondary"
              size="sm"
              disabled={!validDateRange(preset.value, min, max)}
              onClick={() => choose(preset.value)}
            >
              {preset.label}
            </Button>
          ))}
        </div>
        <Calendar
          mode="range"
          locale={zhCN}
          selected={{ from: parseDateValue(from), to: parseDateValue(to) }}
          defaultMonth={parseDateValue(value?.from || min)}
          disabled={(date) => !validDateValue(formatDateValue(date), min, max)}
          onSelect={(range) => {
            setFrom(range?.from ? formatDateValue(range.from) : "");
            setTo(range?.to ? formatDateValue(range.to) : "");
            setError(false);
          }}
        />
        <div className="grid grid-cols-2 gap-2">
          {[
            ["from", "开始日期", from, setFrom],
            ["to", "结束日期", to, setTo],
          ].map(([key, text, current, setter]) => (
            <div key={key as string} className="grid gap-2">
              <Label htmlFor={`${id}-${key}`}>{text as string}</Label>
              <Input
                id={`${id}-${key}`}
                value={current as string}
                placeholder="YYYY-MM-DD"
                aria-invalid={error}
                aria-describedby={error ? `${id}-error` : undefined}
                onChange={(e) => {
                  (setter as (v: string) => void)(e.target.value);
                  setError(false);
                }}
              />
            </div>
          ))}
        </div>
        {error && (
          <p
            id={`${id}-error`}
            role="alert"
            className="text-sm text-destructive"
          >
            请选择完整、有序且在允许范围内的日期
          </p>
        )}
        <div className="flex justify-between gap-2">
          <Button
            type="button"
            variant="ghost"
            onClick={() => {
              onChange(undefined);
              setOpen(false);
            }}
          >
            清除日期
          </Button>
          <Button type="button" onClick={() => choose({ from, to })}>
            应用日期
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
