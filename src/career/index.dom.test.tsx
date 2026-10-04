// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const hoisted = vi.hoisted(() => ({ hide: [] as string[] }));

vi.mock("../profile/profile", () => ({
  getProfile: () => ({ hide: hoisted.hide }),
}));

import { cleanup } from "@testing-library/react";
import careerPlugin from "./index";

const item = careerPlugin.nav?.[0].items[0];

beforeEach(() => {
  hoisted.hide = [];
});
afterEach(cleanup);

describe("the Career nav item", () => {
  it("sits under Play and links to the page", () => {
    expect(careerPlugin.nav?.[0].id).toBe("play");
    expect(item?.to).toBe("/career");
    expect(item?.label).toBe("Career");
  });

  it("is visible with no profile", () => {
    expect(item?.useVisible?.()).toBe(true);
  });

  it("is hidden when a profile lists career.overview in hide", () => {
    hoisted.hide = ["downloads.games", "career.overview"];
    expect(item?.useVisible?.()).toBe(false);
  });

  it("stays visible when the profile hides other items", () => {
    hoisted.hide = ["conquest.list"];
    expect(item?.useVisible?.()).toBe(true);
  });
});
