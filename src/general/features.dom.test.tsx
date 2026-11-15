// @vitest-environment happy-dom
import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Profile } from "../profile/profile";
import { useFeature, useFeatureSetting } from "./features";

const store = new Map<string, unknown>();
let profile: Profile = { version: 1 };

vi.mock("../profile/profile", () => ({ getProfile: () => profile }));
vi.mock("@picoframe/frame", async (importOriginal) => {
  const React = await import("react");
  return {
    ...(await importOriginal<typeof import("@picoframe/frame")>()),
    useSetting: <T,>(key: string, fallback: T) => {
      const [, bump] = React.useReducer((n: number) => n + 1, 0);
      const value = (store.has(key) ? store.get(key) : fallback) as T;
      return [
        value,
        (v: T) => {
          store.set(key, v);
          bump();
        },
      ] as const;
    },
  };
});

beforeEach(() => {
  store.clear();
  profile = { version: 1 };
});

const feature = (name: Parameters<typeof useFeature>[0]) =>
  renderHook(() => useFeature(name)).result.current;

describe("feature toggles", () => {
  it("are off for a new player with no profile", () => {
    expect(feature("mapping")).toBe(false);
  });

  it("are all on for a player who had advanced mode on", () => {
    store.set("advanced.enabled", true);
    expect(feature("mapping")).toBe(true);
    expect(feature("uberstress")).toBe(true);
  });

  it("follow the player's own choice over the old advanced switch", () => {
    store.set("advanced.enabled", true);
    store.set("features.units", false);
    expect(feature("units")).toBe(false);
    expect(feature("animation")).toBe(true);
  });

  it("take profile.advanced as the seed for all of them", () => {
    profile = { version: 1, advanced: true };
    expect(feature("archives")).toBe(true);
  });

  it("take profile.features over profile.advanced, one feature at a time", () => {
    profile = { version: 1, advanced: true, features: { uberstress: false } };
    expect(feature("uberstress")).toBe(false);
    expect(feature("missions")).toBe(true);
  });

  it("keep the old advanced switch over the profile seed", () => {
    profile = { version: 1, features: { mapping: true } };
    store.set("advanced.enabled", false);
    expect(feature("mapping")).toBe(false);
  });

  it("store a change under the feature's own key", () => {
    const { result } = renderHook(() => useFeatureSetting("missions"));
    act(() => result.current[1](true));
    expect(store.get("features.missions")).toBe(true);
    expect(store.has("advanced.enabled")).toBe(false);
  });
});
