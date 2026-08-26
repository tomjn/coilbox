import { afterEach, describe, expect, it, vi } from "vitest";
import { newClientId, newZerokInstallId } from "./clientId";

const stubRandom = (value: number) =>
  vi
    .spyOn(crypto, "getRandomValues")
    .mockImplementation(<T extends ArrayBufferView | null>(array: T): T => {
      (array as unknown as Uint32Array)[0] = value;
      return array;
    });

afterEach(() => {
  vi.restoreAllMocks();
});

describe("newClientId", () => {
  it("renders the random word as decimal digits", () => {
    stubRandom(4294967295);
    expect(newClientId()).toBe("4294967295");
  });

  it("never returns the id teiserver rejects", () => {
    stubRandom(0);
    expect(newClientId()).toBe("1");
  });
});

describe("newZerokInstallId", () => {
  it("is a UUID", () => {
    expect(newZerokInstallId()).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
  });

  it("is a different one every time it is generated", () => {
    // Generated once and kept from then on, so this only ever runs on a fresh
    // install. Two installs getting the same value would tie them together in
    // Zero-K's multi-account checks.
    expect(newZerokInstallId()).not.toBe(newZerokInstallId());
  });
});
