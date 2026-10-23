export const PAGE_IDS = [
  "language",
  "appearance",
  "games",
  "hub",
  "server",
  "done",
] as const;
export type PageId = (typeof PAGE_IDS)[number];

export const BACKGROUND_IDS = ["engine", "game"] as const;
export type BackgroundId = (typeof BACKGROUND_IDS)[number];

export type SettleId = PageId | BackgroundId;

export const SETTLED_KEY = "onboarding.settled";

/** The id of the wizard's heading, which names the dialog. */
export const WIZARD_TITLE_ID = "onboarding-title";
