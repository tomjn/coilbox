import { toast } from "sonner";
import { notify } from "@/notify/notify";

/**
 * Copy a generated `coilbox://` link to the clipboard, confirming success or
 * reporting failure (issue #498). `link` is `null` when the caller had
 * nothing valid to build a link from (see `build.ts`) - reported rather than
 * silently doing nothing, so a share action never looks like it worked when
 * it didn't.
 *
 * The success case stays a raw, un-recorded toast: "copied" is only useful in
 * the instant it fires, and putting it in the bell would just be noise. A
 * failure is routed through `notify()` instead, because a link that silently
 * failed to copy is worth surfacing later too (issue #2429).
 */
export async function copyDeepLink(link: string | null): Promise<void> {
  if (!link) {
    void notify({ title: "There's nothing to share yet.", level: "error" });
    return;
  }
  try {
    await navigator.clipboard.writeText(link);
    toast.success("Link copied", {
      description: "Paste it into chat or Discord.",
    });
  } catch (e) {
    void notify({
      title: "Couldn't copy the link",
      body: e instanceof Error ? e.message : String(e),
      level: "error",
    });
  }
}
