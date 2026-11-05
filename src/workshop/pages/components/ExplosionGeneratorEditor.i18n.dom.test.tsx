// @vitest-environment happy-dom
/**
 * Issue #5059: the create button once built its label from an English "a" or
 * "an" and a lowercased field label, so every language showed the English
 * article. Each field now has a whole message of its own. These render the
 * button under the real German catalog.
 */
import { i18n } from "@lingui/core";
import { I18nProvider } from "@lingui/react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { messages as deMessages } from "../../../locales/de/messages.po";
import type { CegWeaponField } from "../../explosionGenerators";
import { ExplosionGeneratorEditor } from "./ExplosionGeneratorEditor";

function draw(field: CegWeaponField, label: string) {
  render(
    <I18nProvider i18n={i18n}>
      <ExplosionGeneratorEditor
        field={field}
        label={label}
        value=""
        generators={{}}
        onSetGenerators={() => {}}
        onSetField={() => {}}
      />
    </I18nProvider>,
  );
}

afterEach(() => {
  cleanup();
  i18n.loadAndActivate({ locale: "en", messages: {} });
});

describe("the create effect button", () => {
  it.each([
    ["explosionGenerator", "Impact effect", "Create an impact effect"],
    ["bounceExplosionGenerator", "Bounce effect", "Create a bounce effect"],
    ["cegTag", "Trail effect", "Create a trail effect"],
  ] as const)("reads as English for %s", (field, label, name) => {
    i18n.loadAndActivate({ locale: "en", messages: {} });
    draw(field, label);
    expect(screen.getByRole("button", { name })).toBeTruthy();
  });

  it.each([
    ["explosionGenerator", "Einschlageffekt", "Einschlageffekt erstellen"],
    ["bounceExplosionGenerator", "Abprall-Effekt", "Abprall-Effekt erstellen"],
    ["cegTag", "Spureffekt", "Spureffekt erstellen"],
  ] as const)("takes the German catalog's sentence for %s", (field, label, name) => {
    i18n.loadAndActivate({ locale: "de", messages: deMessages });
    draw(field, label);
    const button = screen.getByRole("button", { name });
    expect(button.textContent).not.toMatch(/\b(a|an)\b/);
  });
});
