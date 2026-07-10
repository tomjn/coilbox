/** Where a notification should be delivered. */
export type NotifyChannel = "toast" | "os";

/**
 * Decide the delivery channel for a notification. Pure so it can be unit-tested
 * without Tauri or sonner. An OS banner is only used when the window is NOT
 * focused (an in-app toast is enough when the user is already looking), the user
 * has enabled OS notifications, and the OS permission has been granted. Every
 * other case falls back to an in-app toast.
 */
export function route(
  focused: boolean,
  osEnabled: boolean,
  permGranted: boolean,
): NotifyChannel {
  if (focused) return "toast";
  if (osEnabled && permGranted) return "os";
  return "toast";
}
