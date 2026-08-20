import { cn } from "@picoframe/frame";

/**
 * Say that a node is not on the map its challenge names (issue #1393).
 *
 * A shared challenge names the map for every node so everybody who opens it
 * plays the same battlefields. When one of those maps is not available here,
 * coilbox substitutes rather than refusing the import, and this is the line
 * that keeps the substitution from being invisible. Shown wherever the map name
 * is, in both conquest and warpath.
 */
export function SubstitutedMapNote({
  original,
  className,
}: {
  /** The map the challenge names. Nothing renders without one. */
  original: string | undefined;
  className?: string;
}) {
  if (!original) return null;
  return (
    <span className={cn("block text-[10px] text-muted-foreground", className)}>
      Stands in for {original}, which is not available here.
    </span>
  );
}
