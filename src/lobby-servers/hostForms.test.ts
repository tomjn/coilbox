import { describe, expect, it } from "vitest";
import { addressOfKey, bracketedHost, dialHost } from "./hostForms";

describe("dialHost", () => {
  it("takes the brackets off an IPv6 address", () => {
    expect(dialHost("[::1]")).toBe("::1");
    expect(dialHost("[2001:db8::1]")).toBe("2001:db8::1");
  });

  it("leaves everything else as it is", () => {
    expect(dialHost("::1")).toBe("::1");
    expect(dialHost("192.168.1.45")).toBe("192.168.1.45");
    expect(dialHost("tomlaptop.local")).toBe("tomlaptop.local");
  });
});

describe("bracketedHost", () => {
  it("puts an IPv6 address in brackets once", () => {
    expect(bracketedHost("::1")).toBe("[::1]");
    expect(bracketedHost("[::1]")).toBe("[::1]");
  });

  it("leaves a name and an IPv4 address as they are", () => {
    expect(bracketedHost("192.168.1.45")).toBe("192.168.1.45");
    expect(bracketedHost("tomlaptop.local")).toBe("tomlaptop.local");
  });
});

describe("addressOfKey", () => {
  it("is the host and port after the first @", () => {
    expect(addressOfKey("me@192.168.1.45:8200")).toBe("192.168.1.45:8200");
    expect(addressOfKey("me@lobby.example.com:8200")).toBe(
      "lobby.example.com:8200",
    );
  });

  it("brackets an IPv6 host that the key wrote bare, and keeps one that had them", () => {
    expect(addressOfKey("me@::1:8200")).toBe("[::1]:8200");
    expect(addressOfKey("me@2001:db8::1:8200")).toBe("[2001:db8::1]:8200");
    expect(addressOfKey("me@[2001:db8::1]:8200")).toBe("[2001:db8::1]:8200");
  });

  it("keeps a zone id, which the normaliser then refuses", () => {
    expect(addressOfKey("me@fe80::1%eth0:8200")).toBe("[fe80::1%eth0]:8200");
  });
});
