import { describe, expect, it } from "vitest";

import { agreementWantsCode } from "./agreement";

describe("agreementWantsCode", () => {
  it("wants a code when uberserver says it sent one", () => {
    expect(
      agreementWantsCode(
        "A verification code has been sent to your email address. Please read our terms of service and then enter your four digit code below.\n\nBe nice.",
      ),
    ).toBe(true);
  });

  it("wants a code for teiserver's default agreement", () => {
    expect(
      agreementWantsCode(
        "A verification code has been sent to your email address. Please read our terms of service at https://example.org and the code of conduct at https://example.org/coc. Then enter your six digit code below if you agree to the terms.",
      ),
    ).toBe(true);
  });

  it("wants no code when the agreement is only the terms", () => {
    expect(agreementWantsCode("Be nice.\nNo cheating.")).toBe(false);
    expect(agreementWantsCode("")).toBe(false);
  });
});
