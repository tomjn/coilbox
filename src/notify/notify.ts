import { getCurrentWindow, UserAttentionType } from "@tauri-apps/api/window";
import { sendNotification } from "@tauri-apps/plugin-notification";
import { toast } from "sonner";
import { getOsEnabled, getPermGranted } from "./prefs";
import { route } from "./route";

/** Severity of a notification, mapped to a sonner toast style. */
export type NotifyLevel = "info" | "success" | "error";

export interface NotifyInput {
  title: string;
  body?: string;
  level?: NotifyLevel;
}

function showToast({ title, body, level = "info" }: NotifyInput): void {
  const opts = body ? { description: body } : undefined;
  if (level === "success") toast.success(title, opts);
  else if (level === "error") toast.error(title, opts);
  else toast(title, opts);
}

/**
 * Deliver a notification, routed by window focus. Focused -> in-app toast.
 * Unfocused (and OS notifications enabled + permission granted) -> native OS
 * banner plus a dock-bounce / taskbar-flash. Never throws: any failure in the OS
 * path is caught and downgraded to a toast so callers (including download
 * bindings) can fire-and-forget.
 */
export async function notify(input: NotifyInput): Promise<void> {
  let focused = true;
  try {
    focused = await getCurrentWindow().isFocused();
  } catch {
    focused = true; // best-effort; a toast is the safe default
  }

  if (route(focused, getOsEnabled(), getPermGranted()) === "toast") {
    showToast(input);
    return;
  }

  try {
    sendNotification({ title: input.title, body: input.body });
    await getCurrentWindow()
      .requestUserAttention(UserAttentionType.Informational)
      .catch(() => {});
  } catch {
    showToast(input);
  }
}

// Re-export sonner's imperative toast for foreground-only callers (e.g. the
// settings "test" button, or success/error feedback that never needs a banner).
export { toast };
