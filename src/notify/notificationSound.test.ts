// @vitest-environment happy-dom

/**
 * The notification plugin takes a sound name the operating system resolves, and
 * the three platforms share no vocabulary. Passing macOS's "Ping" to Windows
 * gets a silent banner rather than an error, so a wrong name here fails quietly
 * on a platform the author is not using. That is the whole reason this is
 * tested rather than eyeballed.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const masterLevel = vi.fn(() => 1);
vi.mock("@/sound/context", () => ({ getMasterLevel: () => masterLevel() }));

function pretendPlatform(ua: string) {
  Object.defineProperty(navigator, "userAgent", {
    value: ua,
    configurable: true,
  });
}

const MACOS =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15";
const WINDOWS = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36";
const LINUX = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36";

beforeEach(() => {
  vi.resetModules();
  masterLevel.mockReturnValue(1);
});

describe("the OS notification sound", () => {
  it("names a sound each platform actually knows", async () => {
    const { notificationSound } = await import("./notificationSound");

    pretendPlatform(MACOS);
    expect(notificationSound(true)).toBe("Ping");
    pretendPlatform(WINDOWS);
    expect(notificationSound(true)).toBe("Default");
    pretendPlatform(LINUX);
    expect(notificationSound(true)).toBe("message-new-instant");
  });

  it("stays silent when the player turned the sound off", async () => {
    const { notificationSound } = await import("./notificationSound");
    pretendPlatform(MACOS);
    expect(notificationSound(false)).toBeUndefined();
  });

  it("stays silent when everything is muted", async () => {
    // "Mute all sound" that still let the app ping at you would be a lie, even
    // though the sound itself belongs to the operating system.
    const { notificationSound } = await import("./notificationSound");
    pretendPlatform(MACOS);
    masterLevel.mockReturnValue(0);
    expect(notificationSound(true)).toBeUndefined();
  });

  it("asks for no sound rather than guessing on an unknown platform", async () => {
    const { notificationSound } = await import("./notificationSound");
    pretendPlatform("Mozilla/5.0 (SomethingElse)");
    expect(notificationSound(true)).toBeUndefined();
  });
});
