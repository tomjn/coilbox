import { describe, expect, it } from "vitest";
import { identifierFieldProps } from "./identifierField";

describe("identifierFieldProps", () => {
  it("turns off autocapitalize, autocorrect and spell check", () => {
    expect(identifierFieldProps).toEqual({
      autoCapitalize: "off",
      autoCorrect: "off",
      spellCheck: false,
    });
  });
});
