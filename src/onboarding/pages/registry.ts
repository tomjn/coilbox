import type { MessageDescriptor } from "@lingui/core";
import { msg } from "@lingui/core/macro";
import type { FC } from "react";
import type { PageId } from "../ids";
import AppearancePage from "./AppearancePage";
import DonePage from "./DonePage";
import LanguagePage from "./LanguagePage";

/**
 * What the shell hands a page. Both settle the current page and move on: a page
 * calls `next()` after its own success, such as a hub sign in, and `skip()`
 * when it offers its own way out.
 *
 * `beforeContinue` is run by the footer's Continue button, and not by Skip, so
 * a page can save a choice the player accepted without changing it. A page sets
 * it in an effect and clears it in that effect's cleanup.
 */
export interface WizardPageProps {
  next(): void;
  skip(): void;
  beforeContinue: { current: (() => void) | null };
}

export interface WizardPageEntry {
  Component: FC<WizardPageProps>;
  eyebrow: MessageDescriptor;
  title: MessageDescriptor;
}

/** Stands in for a page until its own task builds it. */
const Pending: FC<WizardPageProps> = () => null;

export const PAGE_COMPONENTS: Record<PageId, WizardPageEntry> = {
  language: {
    Component: LanguagePage,
    eyebrow: msg`Welcome to Coilbox`,
    title: msg`Choose your language`,
  },
  appearance: {
    Component: AppearancePage,
    eyebrow: msg`Make it yours`,
    title: msg`Appearance`,
  },
  games: {
    Component: Pending,
    eyebrow: msg`Something to play`,
    title: msg`Download a game`,
  },
  hub: {
    Component: Pending,
    eyebrow: msg`Coilbox hub`,
    title: msg`Sign in to the hub`,
  },
  server: {
    Component: Pending,
    eyebrow: msg`Multiplayer`,
    title: msg`Log in to a server`,
  },
  done: {
    Component: DonePage,
    eyebrow: msg`All set`,
    title: msg`You're ready`,
  },
};
