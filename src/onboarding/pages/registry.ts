import type { MessageDescriptor } from "@lingui/core";
import { msg } from "@lingui/core/macro";
import type { FC } from "react";
import type { PageId } from "../ids";
import AppearancePage from "./AppearancePage";
import DonePage from "./DonePage";
import GamesPage from "./GamesPage";
import HubPage from "./HubPage";
import LanguagePage from "./LanguagePage";
import ServerPage from "./ServerPage";

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

/**
 * A page the shell heads with a title, or one that draws its own heading with
 * `WIZARD_TITLE_ID`.
 */
export type WizardPageEntry = { Component: FC<WizardPageProps> } & (
  | { ownHeading?: false; title: MessageDescriptor }
  | { ownHeading: true }
);

export const PAGE_COMPONENTS: Record<PageId, WizardPageEntry> = {
  language: {
    Component: LanguagePage,
    title: msg`Choose your language`,
  },
  appearance: {
    Component: AppearancePage,
    title: msg`Appearance`,
  },
  games: {
    Component: GamesPage,
    title: msg`Download a game`,
  },
  hub: {
    Component: HubPage,
    title: msg`Sign in to the hub`,
  },
  server: {
    Component: ServerPage,
    title: msg`Log in to a server`,
  },
  done: {
    Component: DonePage,
    ownHeading: true,
  },
};
