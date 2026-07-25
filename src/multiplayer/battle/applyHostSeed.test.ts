import { describe, expect, it, vi } from "vitest";
import type { HostSeedBot } from "./fromSkirmish";

const mpAddBot = vi.fn(async (_arg: unknown) => ({ sent: true }));
vi.mock("../bindings", () => ({
  mpAddBot: (arg: unknown) => mpAddBot(arg),
}));

const { addHostSeedBots } = await import("./applyHostSeed");

const bot = (p: Partial<HostSeedBot> = {}): HostSeedBot => ({
  name: "Garrison",
  aiDll: "SimpleAI",
  side: 0,
  colorHex: "#ffffff",
  teamId: 0,
  ally: 0,
  handicap: 0,
  ...p,
});

describe("addHostSeedBots", () => {
  it("adds every bot when none already exist", async () => {
    const failures = await addHostSeedBots("key", [bot()]);
    expect(failures).toEqual([]);
    expect(mpAddBot).toHaveBeenCalledTimes(1);
  });

  it("skips a bot already in the battle rather than re-adding it (#547 follow-up)", async () => {
    mpAddBot.mockClear();
    const failures = await addHostSeedBots("key", [bot()], ["Garrison"]);
    expect(failures).toEqual([]);
    expect(mpAddBot).not.toHaveBeenCalled();
  });

  it("still adds the bots that aren't already present", async () => {
    mpAddBot.mockClear();
    const failures = await addHostSeedBots(
      "key",
      [bot({ name: "Garrison" }), bot({ name: "Scout" })],
      ["Garrison"],
    );
    expect(failures).toEqual([]);
    expect(mpAddBot).toHaveBeenCalledTimes(1);
    expect(mpAddBot).toHaveBeenCalledWith(
      expect.objectContaining({ name: "Scout" }),
    );
  });

  it("still reports a real failure from the server as a failure", async () => {
    mpAddBot.mockClear();
    mpAddBot.mockRejectedValueOnce(new Error("already exists"));
    const failures = await addHostSeedBots("key", [bot({ name: "New" })]);
    expect(failures).toEqual(["New: already exists"]);
  });
});
