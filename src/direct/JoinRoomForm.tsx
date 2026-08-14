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

  // A pasted `192.168.1.5:8200` is one answer to two fields, so the address is
  // read as both and the port in it wins: it is the more specific answer, and it
  // is the one that was just typed.
  //
  // Read rather than rewritten as it is typed. Rewriting mid-keystroke turns
  // `127.0.0.1:8300` into `127.0.0.1300` on the way past the first digit of the
  // port, because the field the next keystroke lands in is no longer the field
  // the last one was in.
  const dialled = splitHostPort(address);
  const dialledPort = dialled.port ?? port;
  const problem = addressProblem(dialled.address);
  const portProblem = roomPortProblem(dialledPort);
  const nameProblem = playerNameProblem(name);
  const canJoin = !problem && !portProblem && !nameProblem && !joining;

  // Once they have finished with the field, the port moves into the port field
  // where it can be read and corrected. Nothing is decided here that submitting
  // would not decide anyway: this only makes it visible.
  function settleAddress() {
    if (!dialled.port) return;
    setAddress(dialled.address);
    setPort(dialled.port);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!canJoin) return;
    setJoining(true);
    setError(null);
    try {
      await onJoin({
        address: dialled.address,
        port: Number(dialledPort),
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
            onChange={(e) => setAddress(e.target.value)}
            onBlur={settleAddress}
            placeholder="192.168.1.5"
            autoComplete="off"
            spellCheck={false}
          />
        </label>

        {/* biome-ignore lint/a11y/noLabelWithoutControl: wraps the control (implicit label association) */}
        <label className="flex flex-1 flex-col gap-1 text-sm">
          <span className="font-medium">Port</span>
          {/* Shows the port that will be dialled, which is the one in the
              address while there is one. Typing here takes it back off the
              address, so this field is never showing one port and the join
              using another. */}
          <Input
            type="number"
            min={1}
            max={65535}
            value={dialledPort}
            onChange={(e) => {
              setAddress(dialled.address);
              setPort(e.target.value);
            }}
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
