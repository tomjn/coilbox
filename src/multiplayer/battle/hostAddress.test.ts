import { describe, expect, it } from "vitest";
import { checkHostAddress } from "./hostAddress";

describe("checkHostAddress", () => {
  it("passes a routable public address", () => {
    expect(checkHostAddress("47.149.22.144", 8452)).toEqual({ kind: "ok" });
  });

  it("passes a hostname through for the engine to resolve", () => {
    expect(checkHostAddress("lobby.recoilengine.org", 8452)).toEqual({
      kind: "ok",
    });
  });

  it("blocks a missing address or port", () => {
    expect(checkHostAddress("", 8452).kind).toBe("blocked");
    expect(checkHostAddress("   ", 8452).kind).toBe("blocked");
    expect(checkHostAddress(undefined, 8452).kind).toBe("blocked");
    expect(checkHostAddress("47.149.22.144", null).kind).toBe("blocked");
    expect(checkHostAddress("47.149.22.144", 0).kind).toBe("blocked");
  });

  it("blocks unspecified placeholders", () => {
    for (const ip of ["*", "0.0.0.0", "::", "::0", "0.1.2.3"]) {
      expect(checkHostAddress(ip, 8452).kind).toBe("blocked");
    }
  });

  it("blocks loopback, which points back at the joining player", () => {
    expect(checkHostAddress("127.0.0.1", 8452).kind).toBe("blocked");
    expect(checkHostAddress("127.4.5.6", 8452).kind).toBe("blocked");
    expect(checkHostAddress("::1", 8452).kind).toBe("blocked");
  });

  it("blocks addresses that name no single machine", () => {
    for (const ip of [
      "224.0.0.1",
      "239.1.2.3",
      "240.0.0.1",
      "255.255.255.255",
    ]) {
      expect(checkHostAddress(ip, 8452).kind).toBe("blocked");
    }
  });

  it("warns on private ranges, which only work on the same network", () => {
    for (const ip of [
      "10.0.0.5",
      "172.16.0.1",
      "172.31.255.254",
      "192.168.1.7",
    ]) {
      expect(checkHostAddress(ip, 8452).kind).toBe("warning");
    }
  });

  it("treats near-miss private ranges as public", () => {
    for (const ip of ["172.15.0.1", "172.32.0.1", "192.169.1.1", "11.0.0.1"]) {
      expect(checkHostAddress(ip, 8452)).toEqual({ kind: "ok" });
    }
  });

  it("warns on provider-shared and link-local addresses", () => {
    expect(checkHostAddress("100.64.0.1", 8452).kind).toBe("warning");
    expect(checkHostAddress("100.127.255.254", 8452).kind).toBe("warning");
    expect(checkHostAddress("169.254.10.20", 8452).kind).toBe("warning");
    expect(checkHostAddress("100.63.0.1", 8452)).toEqual({ kind: "ok" });
    expect(checkHostAddress("100.128.0.1", 8452)).toEqual({ kind: "ok" });
  });

  it("names the offending address in the reason", () => {
    const v = checkHostAddress("192.168.1.7", 8452);
    expect(v.kind === "warning" && v.reason).toContain("192.168.1.7");
  });

  it("rejects malformed quads by leaving them to the engine", () => {
    // Not a dotted quad, so not our call to make.
    expect(checkHostAddress("999.1.1.1", 8452)).toEqual({ kind: "ok" });
    expect(checkHostAddress("1.2.3", 8452)).toEqual({ kind: "ok" });
  });
});
