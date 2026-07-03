import { defineCommand } from "@picoframe/plugin-sdk";

/**
 * Typed bindings to the `coilbox-lobby-servers` plugin. The server *directory*
 * lives in the frame settings store (see `config.ts`); these commands only handle
 * the secrets, kept in the OS keychain rather than plaintext settings JSON.
 */

/** Store (or replace) a login secret for `{serverId, username}` in the keychain. */
export const lsStoreCredential = defineCommand<
  { serverId: string; username: string; secret: string },
  Record<string, never>
>("coilbox-lobby-servers", "ls_store_credential");

/** Read a stored secret. Resolves with `{ secret: string | null }`. */
export const lsGetCredential = defineCommand<
  { serverId: string; username: string },
  { secret: string | null }
>("coilbox-lobby-servers", "ls_get_credential");

/** Delete a stored secret. */
export const lsDeleteCredential = defineCommand<
  { serverId: string; username: string },
  Record<string, never>
>("coilbox-lobby-servers", "ls_delete_credential");
