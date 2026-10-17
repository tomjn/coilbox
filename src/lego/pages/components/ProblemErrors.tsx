import type { Problem } from "../../problems";

/**
 * Errors stay on the view without opening the problems list: a unit with a
 * missing root did not open properly, and that should not wait to be found.
 * The pointer passes through, so it never blocks the model underneath.
 */
export function ProblemErrors({ problems }: { problems: Problem[] }) {
  const errors = problems.filter((p) => p.severity === "error");
  if (errors.length === 0) return null;
  return (
    <ul className="pointer-events-none mx-auto w-fit max-w-[80%] rounded-md border border-destructive/40 bg-background/90 px-3 py-1.5 text-xs text-muted-foreground backdrop-blur">
      {errors.map((p) => (
        <li key={`${p.source}:${p.message}`}>{p.message}</li>
      ))}
    </ul>
  );
}
