import { useEffect, useState } from "react";
import { useSearchParams } from "react-router";

/**
 * Read a one-shot `?game=<name>` query param and strip it from the URL. Game
 * detail's "Start a conquest" / "Start a warpath run" / "New campaign" actions
 * (issue #372) navigate here with the game preselected. This returns the name
 * once, then removes the param so it doesn't re-fire on further navigation
 * within the page or when a drawer closes. Mirrors `useImportParam`. Undefined
 * when there is no param.
 */
export function useGamePresetParam(): string | undefined {
  const [params, setParams] = useSearchParams();
  const [name, setName] = useState<string | undefined>(undefined);

  useEffect(() => {
    const value = params.get("game");
    if (!value) return;
    setName(value);
    const next = new URLSearchParams(params);
    next.delete("game");
    setParams(next, { replace: true });
  }, [params, setParams]);

  return name;
}
