import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const bindings = vi.hoisted(() => ({ mpJoinBattle: vi.fn() }));
vi.mock("../bindings", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../bindings")>()),
  ...bindings,
}));
vi.mock("../../notify/notify", () => ({ notify: vi.fn() }));

import type { Battle } from "../bindings";
import { forgetOaPassword, oaPasswordFor } from "../oaPassword";
import { joinBattle } from "./joinBattle";

const join = (engine: string, key?: string) =>
  joinBattle({
    serverKey: "server",
    battle: { id: 7, engine } as Battle,
    key,
    leaveOther: async () => {},
    awaitLanding: () => {},
    giveUp: () => {},
  });

beforeEach(() => {
  bindings.mpJoinBattle.mockReset().mockResolvedValue({});
});
afterEach(forgetOaPassword);

describe("the key a player joins with (issue #4955)", () => {
  it("is kept for OA when the battle is Open Annihilation", async () => {
    await join("Open Annihilation", "s3cret");
    expect(oaPasswordFor("server", 7)).toBe("s3cret");
  });

  it("is not kept for a Recoil battle", async () => {
    await join("spring", "s3cret");
    expect(oaPasswordFor("server", 7)).toBeNull();
  });

  it("is forgotten when the join could not be sent", async () => {
    bindings.mpJoinBattle.mockRejectedValue(new Error("not connected"));
    await join("Open Annihilation", "s3cret");
    expect(oaPasswordFor("server", 7)).toBeNull();
  });
});
