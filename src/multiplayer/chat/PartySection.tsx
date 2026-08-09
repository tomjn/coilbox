import { Button } from "@picoframe/frame";
import { Check, LogOut, Users, X } from "lucide-react";
import type { ReactNode } from "react";
import {
  mpPartyAcceptInvite,
  mpPartyCancelInvite,
  mpPartyCreate,
  mpPartyDeclineInvite,
  mpPartyInvite,
  mpPartyKickMember,
  mpPartyLeave,
} from "../bindings";
import { useMultiplayer } from "../store";
import { Section } from "./Section";
import { UserPicker } from "./UserPicker";

/** A row action, sized to the WCAG target and matching the friend request buttons. */
function RowAction({
  icon,
  label,
  onClick,
}: {
  icon: ReactNode;
  label: string;
  onClick: () => void;
}) {
  return (
    <Button
      variant="secondary"
      onClick={onClick}
      aria-label={label}
      title={label}
      className="h-6 px-2"
    >
      {icon}
    </Button>
  );
}

/**
 * The Party section of the chat sidebar: who is in your party, who you have
 * asked, and the invitations waiting on you.
 *
 * Tachyon only. TASServer has no parties, so the caller hides this on that
 * protocol the way it hides the channel list on Tachyon.
 *
 * There is no leader in the protocol, so every member is offered the controls
 * and a server that only lets one person use them answers with a refusal, which
 * reaches the user as a server message.
 */
export function PartySection() {
  const { mirror, activeKey } = useMultiplayer();
  const state = mirror.state;
  const party = state?.party ?? null;
  const invites = state?.partyInvites ?? [];
  const me = state?.myUsername ?? null;

  if (!activeKey) return null;
  const key = activeKey;
  const swallow = () => {};

  return (
    <Section title="Party">
      {invites.length > 0 && (
        <ul className="flex flex-col gap-1 px-2 pb-1">
          {invites.map((invite) => (
            <li
              key={invite.id}
              className="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm"
            >
              <Users className="size-4 shrink-0 text-muted-foreground" />
              <span
                className="truncate"
                title={`Invitation from ${nameOf(invite.members)}`}
              >
                {nameOf(invite.members)}
              </span>
              <div className="ml-auto flex gap-1">
                <RowAction
                  icon={<Check className="size-4" />}
                  label={`Join the party with ${nameOf(invite.members)}`}
                  onClick={() =>
                    mpPartyAcceptInvite({
                      serverKey: key,
                      partyId: invite.id,
                    }).catch(swallow)
                  }
                />
                <RowAction
                  icon={<X className="size-4" />}
                  label={`Turn down the invitation from ${nameOf(invite.members)}`}
                  onClick={() =>
                    mpPartyDeclineInvite({
                      serverKey: key,
                      partyId: invite.id,
                    }).catch(swallow)
                  }
                />
              </div>
            </li>
          ))}
        </ul>
      )}

      {!party && (
        <div className="px-2 pb-2">
          <p className="px-2 py-1.5 text-xs text-muted-foreground">
            A party stays together from one battle to the next.
          </p>
          <Button
            variant="secondary"
            className="h-8 w-full justify-start gap-2"
            onClick={() => mpPartyCreate({ serverKey: key }).catch(swallow)}
          >
            <Users className="size-4" />
            Start a party
          </Button>
        </div>
      )}

      {party && (
        <>
          <ul className="flex flex-col gap-0.5 px-2">
            {party.members.map((name) => (
              <li
                key={`member:${name}`}
                className="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm"
              >
                <span className="truncate">{name}</span>
                {name === me && (
                  <span className="shrink-0 text-xs text-muted-foreground">
                    you
                  </span>
                )}
                {name !== me && (
                  <div className="ml-auto">
                    <RowAction
                      icon={<X className="size-4" />}
                      label={`Put ${name} out of the party`}
                      onClick={() =>
                        mpPartyKickMember({
                          serverKey: key,
                          username: name,
                        }).catch(swallow)
                      }
                    />
                  </div>
                )}
              </li>
            ))}
            {party.invited.map((name) => (
              <li
                key={`invited:${name}`}
                className="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm text-muted-foreground"
              >
                <span className="truncate">{name}</span>
                <span className="shrink-0 text-xs">invited</span>
                <div className="ml-auto">
                  <RowAction
                    icon={<X className="size-4" />}
                    label={`Withdraw the invitation to ${name}`}
                    onClick={() =>
                      mpPartyCancelInvite({
                        serverKey: key,
                        username: name,
                      }).catch(swallow)
                    }
                  />
                </div>
              </li>
            ))}
          </ul>
          <div className="flex items-center gap-2 px-4 py-2">
            <UserPicker
              label="Invite someone to your party"
              exclude={[...party.members, ...party.invited]}
              onPick={(username) =>
                mpPartyInvite({ serverKey: key, username }).catch(swallow)
              }
            />
            <Button
              variant="secondary"
              className="h-7 gap-2 px-2"
              onClick={() => mpPartyLeave({ serverKey: key }).catch(swallow)}
            >
              <LogOut className="size-4" />
              Leave
            </Button>
            <span className="ml-auto text-xs text-muted-foreground">
              {party.members.length} of {party.maxMembers}
            </span>
          </div>
        </>
      )}
    </Section>
  );
}

/**
 * What to call a party, which has no name of its own: its members. A party with
 * no members left is not one anybody is describing, so it falls back to words
 * rather than to the server's id, which would mean nothing to a reader.
 */
function nameOf(members: string[]): string {
  return members.length > 0 ? members.join(", ") : "a party";
}
