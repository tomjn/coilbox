import { OptionSelect } from "@/components/OptionSelect";
import { serverNameFor, useProtocolServers, usernameFromKey } from "./store";

/**
 * Picks which connected login a settings page acts on, for a page that shows
 * one account's controls at a time rather than a section per connection
 * (issue #2846). Render only when more than one connection is live: with one,
 * there is nothing to pick and the page acts on it without asking.
 */
export function AccountPicker({
  keys,
  value,
  onChange,
}: {
  keys: string[];
  value: string;
  onChange: (serverKey: string) => void;
}) {
  const servers = useProtocolServers();

  return (
    <OptionSelect
      value={value}
      onValueChange={onChange}
      ariaLabel="Account"
      options={keys.map((key) => ({
        value: key,
        label: `${usernameFromKey(key)} · ${serverNameFor(key, servers)}`,
      }))}
    />
  );
}
