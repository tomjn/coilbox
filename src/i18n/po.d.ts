// A `.po` catalog import, compiled to its messages by @lingui/vite-plugin.
declare module "*.po" {
  import type { Messages } from "@lingui/core";
  export const messages: Messages;
}
