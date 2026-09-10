/**
 * A button that shows a file or folder in the file manager, and says so when
 * it could not.
 *
 * The file manager is a separate app, so without the message a failure looks
 * exactly like a button that does nothing.
 */

import { Button } from "@picoframe/frame";
import { type ReactNode, useState } from "react";

import { legoOpenPath } from "../../bindings";

interface Props {
  path: string;
  variant?: "outline" | "ghost";
  children?: ReactNode;
}

export function ShowMe({ path, variant = "outline", children }: Props) {
  const [problem, setProblem] = useState<string | null>(null);

  async function show() {
    setProblem(null);
    try {
      await legoOpenPath({ path });
    } catch (error) {
      setProblem(error instanceof Error ? error.message : String(error));
    }
  }

  return (
    <div className="flex flex-col gap-1">
      <Button variant={variant} size="sm" onClick={() => void show()}>
        {children ?? "Show me"}
      </Button>
      {problem ? <p className="text-xs text-destructive">{problem}</p> : null}
    </div>
  );
}
