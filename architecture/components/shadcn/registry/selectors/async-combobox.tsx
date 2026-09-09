"use client";
import { useEffect, useRef, useState } from "react";
import {
  SearchSelect,
  type SearchSelectProps,
  type SelectOption,
} from "./search-select";
export type AsyncComboboxProps = Omit<
  SearchSelectProps,
  | "options"
  | "search"
  | "onSearchChange"
  | "loading"
  | "error"
  | "onRetry"
  | "filterLocally"
> & {
  loadOptions: (
    search: string,
    context: { signal: AbortSignal },
  ) => Promise<SelectOption[]>;
  debounceMs?: number;
};
export function AsyncCombobox({
  loadOptions,
  debounceMs = 0,
  ...props
}: AsyncComboboxProps) {
  const [search, setSearch] = useState(""),
    [options, setOptions] = useState<SelectOption[]>([]),
    [loading, setLoading] = useState(true),
    [error, setError] = useState<string>(),
    [retry, setRetry] = useState(0);
  const generation = useRef(0);
  useEffect(() => {
    const controller = new AbortController(),
      request = ++generation.current;
    setLoading(true);
    setError(undefined);
    const timer = setTimeout(
      async () => {
        try {
          const result = await loadOptions(search, {
            signal: controller.signal,
          });
          if (!controller.signal.aborted && request === generation.current)
            setOptions(result);
        } catch (cause) {
          if (!controller.signal.aborted && request === generation.current) {
            setOptions([]);
            setError(cause instanceof Error ? cause.message : "选项加载失败");
          }
        } finally {
          if (!controller.signal.aborted && request === generation.current)
            setLoading(false);
        }
      },
      Math.max(0, debounceMs),
    );
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [search, loadOptions, debounceMs, retry]);
  return (
    <SearchSelect
      {...props}
      options={options}
      search={search}
      onSearchChange={setSearch}
      loading={loading}
      error={error}
      onRetry={() => setRetry((value) => value + 1)}
      filterLocally={false}
    />
  );
}
