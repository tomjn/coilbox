import { toast } from "sonner";

/**
 * Copy a generated `coilbox://` link to the clipboard, confirming success or
 * reporting failure via a toast (issue #498). `link` is `null` when the
 * caller had nothing valid to build a link from (see `build.ts`) - reported
 * rather than silently doing nothing, so a share action never looks like it
 * worked when it didn't.
 */
export async function copyDeepLink(link: string | null): Promise<void> {
  if (!link) {
    toast.error("There's nothing to share yet.");
    return;
  }
  try {
    await navigator.clipboard.writeText(link);
    toast.success("Link copied", {
      description: "Paste it into chat or Discord.",
    });
  } catch (e) {
    toast.error("Couldn't copy the link", {
      description: e instanceof Error ? e.message : String(e),
    });
  }
}
