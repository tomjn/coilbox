/**
 * What the module list says when a filter hides every module (issue #3298).
 *
 * The module categories are offered by the inventory's one category menu
 * (#4538), in `CategoryMenu.tsx`.
 */

/** Shown in place of the grid when a filter hides every module. */
export function NoModuleMatches() {
  return (
    <p className="flex-1 px-6 py-10 text-center text-sm text-muted-foreground">
      No module matches. Clear the search or pick another category.
    </p>
  );
}
