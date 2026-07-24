import { useEffect, useState } from "react";
import { useSearchParams } from "react-router";

/**
 * Read a one-shot `?import=<code>` query param and strip it from the URL (issue
 * #388). A confirmed `coilbox://import` deep link navigates the importer page
 * here with the code in the query string. This returns the code once, then
 * removes the param so it does not re-fire when the user navigates within the
 * page or the drawer closes. Returns undefined when there is no import param.
 */
export function useImportParam(): string | undefined {
  const [params, setParams] = useSearchParams();
  const [code, setCode] = useState<string | undefined>(undefined);

  useEffect(() => {
    const value = params.get("import");
    if (!value) return;
    setCode(value);
    const next = new URLSearchParams(params);
    next.delete("import");
    setParams(next, { replace: true });
  }, [params, setParams]);

  return code;
}
