/**
 * The "Join a room" form, as shown in the frame's drawer.
 *
 * One form for both ways in. A room found on the network arrives with its
 * address and port already filled, and a room that was never heard from is the
 * same form with those two fields empty. That is deliberate: the network is the
 * convenience, and the typed address is the thing that always works, so it is
 * not a lesser path hidden behind the list.
 *
 * The drawer keeps whatever element it was opened with, so nothing here may
 * depend on a prop that changes while it is open. The busy and failed states are
 * held here for that reason: the form asking is the form told.
 */

import { Button, Input, useDrawer } from "@picoframe/frame";
import { useState } from "react";
import { addressProblem, splitHostPort } from "./lan";
import { DEFAULT_ROOM_PORT, playerNameProblem, roomPortProblem } from "./room";

/** Everything the page needs to dial a room and join the battle in it. */
export interface JoinRoomArgs {
  /** The host's address, as typed or as their beacon arrived from. */
  address: string;
  /** The room's lobby port, not the engine's game port. */
  port: number;
  /** The name this client logs in to the room under. */
  name: string;
  /** The room's password, or empty for an open room. */
  password: string;
}

/** A room found on the network, filled into the form so nobody reads an address
 *  off a screen that already has it. */
export interface JoinRoomTarget {
  title: string;
  address: string;
  port: number;
  passworded: boolean;
}

export function JoinRoomForm({
  target,
  defaultName,
  blocked,
  onJoin,
}: {
  /** The room this was opened for, or undefined for a typed address. */
  target?: JoinRoomTarget;
  /** The name to offer as this player's, usually their last lobby login. */
  defaultName?: string;
  /** Why joining is unavailable, or null. Said rather than shown as a form that
   *  cannot work. */
  blocked: string | null;
  /** Dials the room and joins its battle. Rejects with what to tell the player. */
  onJoin: (args: JoinRoomArgs) => Promise<void>;
}) {
  const drawer = useDrawer();
  const [address, setAddress] = useState(target?.address ?? "");
  // Held as typed rather than as a number, so the field can be emptied and a bad
  // value can be shown back rather than corrected underneath.
  const [port, setPort] = useState(String(target?.port ?? DEFAULT_ROOM_PORT));
  const [name, setName] = useState(defaultName ?? "Player");
  const [password, setPassword] = useState("");
  const [joining, setJoining] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const problem = addressProblem(address);
  const portProblem = roomPortProblem(port);
  const nameProblem = playerNameProblem(name);
  const canJoin = !problem && !portProblem && !nameProblem && !joining;

  // A pasted `192.168.1.5:8200` is one answer to two fields. Split it here, so
  // the port a host read out lands in the port field instead of failing
  // validation in the address one.
  function typeAddress(typed: string) {
    const split = splitHostPort(typed);
    setAddress(split.address);
    if (split.port) setPort(split.port);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!canJoin) return;
    setJoining(true);
    setError(null);
    try {
      await onJoin({
        address: address.trim(),
        port: Number(port),
        name: name.trim(),
        password: password.trim(),
      });
      // Left open on success: a join lands in the battle room, and navigating
      // there closes every drawer, so there is nothing here to close.
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setJoining(false);
    }
  }

  if (blocked) {
    return <p className="text-sm text-muted-foreground">{blocked}</p>;
  }

  return (
    <form className="flex flex-col gap-2.5" onSubmit={submit}>
      {target && (
        <p className="text-sm text-muted-foreground">
          Joining {target.title}, found on this network.
        </p>
      )}

      <div className="flex gap-2">
        {/* biome-ignore lint/a11y/noLabelWithoutControl: wraps the control (implicit label association) */}
        <label className="flex flex-[2] flex-col gap-1 text-sm">
          <span className="font-medium">Host address</span>
          <Input
            value={address}
            onChange={(e) => typeAddress(e.target.value)}
            placeholder="192.168.1.5"
            autoComplete="off"
            spellCheck={false}
          />
        </label>

        {/* biome-ignore lint/a11y/noLabelWithoutControl: wraps the control (implicit label association) */}
        <label className="flex flex-1 flex-col gap-1 text-sm">
          <span className="font-medium">Port</span>
          <Input
            type="number"
            min={1}
            max={65535}
            value={port}
            onChange={(e) => setPort(e.target.value)}
          />
        </label>
      </div>
      {problem && <span className="text-xs text-destructive">{problem}</span>}
      {portProblem && (
        <span className="text-xs text-destructive">{portProblem}</span>
      )}

      {/* biome-ignore lint/a11y/noLabelWithoutControl: wraps the control (implicit label association) */}
      <label className="flex flex-col gap-1 text-sm">
        <span className="font-medium">Your name</span>
        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="The name others see"
        />
        {nameProblem && (
          <span className="text-xs text-destructive">{nameProblem}</span>
        )}
      </label>

      {/* Offered even for a room whose beacon says it is open, because the
          beacon is two seconds old and the host may have opened the room after
          it was sent. Never demanded, because most rooms have none. */}
      {/* biome-ignore lint/a11y/noLabelWithoutControl: wraps the control (implicit label association) */}
      <label className="flex flex-col gap-1 text-sm">
        <span className="font-medium">
          {target?.passworded
            ? "Room password"
            : "Password (if the host set one)"}
        </span>
        <Input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder={target?.passworded ? "" : "Leave blank for an open room"}
        />
      </label>

      {error && (
        <p
          role="alert"
          className="rounded-md border border-destructive/50 bg-destructive/10 p-2 text-xs text-destructive"
        >
          {error}
        </p>
      )}

      <div className="flex justify-end gap-2 pt-1">
        <Button
          type="button"
          variant="outline"
          className="h-9"
          onClick={() => drawer.close()}
        >
          Cancel
        </Button>
        <Button type="submit" className="h-9" disabled={!canJoin}>
          {joining ? "Joining…" : "Join room"}
        </Button>
      </div>
    </form>
  );
}
