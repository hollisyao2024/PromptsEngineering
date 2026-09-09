"use client";
import { useState, type ReactNode } from "react";
import { Check, ChevronsUpDown, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Command,
  CommandInput,
  CommandList,
  CommandEmpty,
  CommandGroup,
  CommandItem,
} from "@/components/ui/command";
import { LoadingState, ErrorState } from "@/components/feedback/states";
export type SelectOption = {
  value: string;
  label: string;
  disabled?: boolean;
  group?: string;
};
export type SelectCommonProps = {
  label: string;
  options: SelectOption[];
  selectedOptions?: SelectOption[];
  placeholder?: string;
  disabled?: boolean;
  clearable?: boolean;
  id?: string;
  "aria-describedby"?: string;
  "aria-invalid"?: boolean | "true" | "false";
  search?: string;
  onSearchChange?: (value: string) => void;
  loading?: boolean;
  error?: ReactNode;
  onRetry?: () => unknown | Promise<unknown>;
  filterLocally?: boolean;
};
function SelectControl({
  label,
  options,
  selectedOptions = [],
  placeholder = "请选择",
  disabled,
  clearable = true,
  value,
  onChange,
  multiple = false,
  search,
  onSearchChange,
  loading,
  error,
  onRetry,
  filterLocally = true,
  ...aria
}: SelectCommonProps & {
  value: string[];
  onChange: (value: string[]) => void;
  multiple?: boolean;
}) {
  const [open, setOpen] = useState(false),
    [localSearch, setLocalSearch] = useState("");
  const query = search ?? localSearch;
  const setSearch = (text: string) => {
    setLocalSearch(text);
    onSearchChange?.(text);
  };
  const all = new Map(
    [...selectedOptions, ...options].map((option) => [option.value, option]),
  );
  const groups = [...new Set(options.map((option) => option.group || ""))];
  return (
    <div className="flex min-w-0 items-center gap-1">
      <Popover
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          if (!next) setSearch("");
        }}
      >
        <PopoverTrigger asChild>
          <Button
            {...aria}
            type="button"
            variant="outline"
            role="combobox"
            aria-label={label}
            aria-expanded={open}
            disabled={disabled}
            className="min-w-0 flex-1 justify-between"
          >
            <span className="truncate">
              {value.length
                ? value.map((id) => all.get(id)?.label || id).join("、")
                : placeholder}
            </span>
            <ChevronsUpDown className="shrink-0 opacity-50" />
          </Button>
        </PopoverTrigger>
        <PopoverContent
          align="start"
          className="w-[var(--radix-popover-trigger-width)] min-w-60 max-w-[90vw] p-0"
        >
          <Command shouldFilter={filterLocally}>
            <CommandInput
              value={query}
              onValueChange={setSearch}
              placeholder="搜索选项…"
              aria-label={`搜索${label}`}
            />
            <CommandList aria-label={`${label}选项`}>
              {loading ? (
                <LoadingState />
              ) : error ? (
                <ErrorState error={error} onRetry={onRetry} />
              ) : (
                <>
                  <CommandEmpty>没有匹配选项</CommandEmpty>
                  {groups.map((group) => (
                    <CommandGroup key={group} heading={group || undefined}>
                      {options
                        .filter((option) => (option.group || "") === group)
                        .map((option) => (
                          <CommandItem
                            key={option.value}
                            value={option.value}
                            keywords={[option.label]}
                            disabled={option.disabled}
                            onSelect={() => {
                              if (option.disabled) return;
                              onChange(
                                multiple
                                  ? value.includes(option.value)
                                    ? value.filter((v) => v !== option.value)
                                    : [...value, option.value]
                                  : [option.value],
                              );
                              if (!multiple) {
                                setOpen(false);
                                setSearch("");
                              }
                            }}
                          >
                            <Check
                              aria-hidden="true"
                              className={
                                value.includes(option.value)
                                  ? "opacity-100"
                                  : "opacity-0"
                              }
                            />
                            <span className="break-all">{option.label}</span>
                          </CommandItem>
                        ))}
                    </CommandGroup>
                  ))}
                </>
              )}
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
      {clearable && value.length > 0 && (
        <Button
          type="button"
          variant="ghost"
          size="icon"
          disabled={disabled}
          aria-label={`清除${label}`}
          onClick={() => onChange([])}
        >
          <X />
        </Button>
      )}
    </div>
  );
}
export type SearchSelectProps = SelectCommonProps & {
  value?: string;
  onChange: (value: string | undefined) => void;
};
export function SearchSelect({ value, onChange, ...props }: SearchSelectProps) {
  return (
    <SelectControl
      {...props}
      value={value === undefined ? [] : [value]}
      onChange={(values) => onChange(values[0])}
    />
  );
}
export function MultiSelect({
  value = [],
  onChange,
  ...props
}: SelectCommonProps & {
  value?: string[];
  onChange: (value: string[]) => void;
}) {
  return (
    <SelectControl {...props} value={value} onChange={onChange} multiple />
  );
}
