import { useEffect, useState } from "react";
import { useSearchParams } from "react-router";

/** What a confirmed import link left on the importer's URL. */
export interface ImportParams {
  /** The code to import. Undefined until one arrives. */
  code?: string;
  /** The hub item it came from, when the browse screen started it (issue
   * #1368). Undefined for a pasted code or a file. */
  hubItemId?: string;
}

/**
 * Read the one-shot `?import=<code>` query param and strip it from the URL
 * (issue #388). A confirmed `coilbox://import` deep link navigates the importer
 * page here with the code in the query string. This returns the code once, then
 * removes the param so it does not re-fire when the user navigates within the
 * page or the drawer closes.
 *
 * `&hub=<id>` rides alongside for an import the hub browse screen started, so
 * the importer can record what it produced (see `../hub/imports.ts`). Both
 * params are read and stripped together, because two hooks each rewriting the
 * query string from the same render would drop one another's edit.
 */
export function useImportParam(): ImportParams {
  const [params, setParams] = useSearchParams();
  const [value, setValue] = useState<ImportParams>({});

  useEffect(() => {
    const code = params.get("import");
    if (!code) return;
    setValue({ code, hubItemId: params.get("hub") ?? undefined });
    const next = new URLSearchParams(params);
    next.delete("import");
    next.delete("hub");
    setParams(next, { replace: true });
  }, [params, setParams]);

  return value;
}
