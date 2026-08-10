import { afterEach, describe, expect, it, vi } from "vitest";
import { newClientId } from "./clientId";

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
