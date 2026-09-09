"use client";
import { useCallback, useEffect, useRef, useState } from "react";
export type AsyncAction = () => unknown | Promise<unknown>;
export function useAsyncAction() {
  const [pending, setPending] = useState(false),
    [error, setError] = useState<string>();
  const busy = useRef(false),
    mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const run = useCallback(async (action: AsyncAction): Promise<boolean> => {
    if (busy.current) return false;
    busy.current = true;
    setPending(true);
    setError(undefined);
    try {
      return (await action()) !== false;
    } catch (cause) {
      if (mounted.current)
        setError(cause instanceof Error ? cause.message : "操作失败，请重试");
      return false;
    } finally {
      busy.current = false;
      if (mounted.current) setPending(false);
    }
  }, []);
  return {
    pending,
    error,
    run,
    clearError: useCallback(() => setError(undefined), []),
    isPending: () => busy.current,
  };
}
