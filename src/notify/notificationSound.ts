import { getMasterLevel } from "@/sound/context";

/**
 * The sound an OS notification banner makes.
 *
 * Not one of coilbox's own sounds, and not chosen from the sound library. The
 * notification plugin takes a name the operating system resolves itself, and
 * each platform has its own vocabulary: macOS wants a system sound, Windows a
 * named toast sound, Linux an XDG theme sound. There is no value that works
 * everywhere, which is why this is a lookup rather than a constant.
 *
 * Left out entirely, macOS and Linux banners are silent while Windows still
 * plays its default, so naming one on every platform is also what makes the
 * three behave the same.
 */

/**
 * Detected from the user agent rather than `@tauri-apps/plugin-os`, which is
 * not a dependency here, and the same way `assetUrl` already tells Windows
 * apart.
 */
function platformSound(): string | undefined {
  const ua = navigator.userAgent;
  // "Default" is the Windows toast sound `notify-rust` resolves by name.
  if (/windows/i.test(ua)) return "Default";
  // A macOS system sound. "Ping" is the short, neutral one, rather than the
  // longer alert tones people associate with an error.
  if (/mac os x|macintosh/i.test(ua)) return "Ping";
  // The XDG sound theme name for an incoming message.
  if (/linux|x11/i.test(ua)) return "message-new-instant";
  return undefined;
}

/**
 * The sound name to pass to the notification plugin, or `undefined` for a
 * silent banner.
 *
 * Respects the master mute, because "Mute all sound" that still let the app
 * ping at you would be a lie. It deliberately does not scale with the master
 * volume, which it cannot: the OS owns the playback and has its own volume for
 * exactly this.
 */
export function notificationSound(enabled: boolean): string | undefined {
  if (!enabled || getMasterLevel() === 0) return undefined;
  return platformSound();
}
