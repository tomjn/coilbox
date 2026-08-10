import { useEffect, useState } from "react";
import { useSearchParams } from "react-router";

/**
 * Read a one-shot query param and strip it from the URL, returning its value
 * once (issue #1372). The shape `useImportParam` and `useGamePresetParam`
 * already use, with the name as an argument, for a screen that is sent the
 * address of one thing on it.
 *
 * Stripping matters because the param is an instruction, not a filter: leaving
 * it on the URL would re-fire it every time a drawer closes or the page
 * navigates within itself. Undefined when there is no param.
 */
export function useOneShotParam(name: string): string | undefined {
  const [params, setParams] = useSearchParams();
  const [value, setValue] = useState<string | undefined>(undefined);

  useEffect(() => {
    const found = params.get(name);
    if (!found) return;
    setValue(found);
    const next = new URLSearchParams(params);
    next.delete(name);
    setParams(next, { replace: true });
  }, [params, setParams, name]);

  return value;
}
