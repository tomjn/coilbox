import { beforeEach, describe, expect, it, vi } from "vitest";

const verify = vi.hoisted(() => vi.fn());
vi.mock("../../content/bindings", () => ({ contentVerifyEngine: verify }));

import { hostEngineVersion } from "./hostEngineVersion";

beforeEach(() => {
  verify.mockReset();
});

describe("hostEngineVersion", () => {
  it("advertises a verified engine's version without running it again", async () => {
    await expect(
      hostEngineVersion({ executable: "/e/spring", syncVersion: "2025.06.20" }),
    ).resolves.toBe("2025.06.20");
    expect(verify).not.toHaveBeenCalled();
  });

  // The folder DarkBlueDiamond's engine sat in. It is not in the argument at
  // all, because an unverified engine's folder name is never a version.
  it("runs an unverified engine and advertises what it reports", async () => {
    verify.mockResolvedValue({ engine: { syncVersion: "2025.06.20" } });
    await expect(hostEngineVersion({ executable: "/e/spring" })).resolves.toBe(
      "2025.06.20",
    );
    expect(verify).toHaveBeenCalledWith({ path: "/e/spring" });
  });

  it("refuses when the engine cannot be run", async () => {
    verify.mockRejectedValue(new Error("engine version check timed out"));
    await expect(
      hostEngineVersion({ executable: "/e/spring" }),
    ).rejects.toThrow(
      "Could not read the engine's version: engine version check timed out",
    );
  });

  it("refuses when the engine runs and reports nothing", async () => {
    verify.mockResolvedValue({ engine: {} });
    await expect(
      hostEngineVersion({ executable: "/e/spring" }),
    ).rejects.toThrow("Could not read the engine's version.");
  });
});
