import { Button, Input } from "@picoframe/frame";
import { Check, Copy, ExternalLink, Globe, RotateCw } from "lucide-react";
import { useCallback, useState } from "react";
import { Textarea } from "@/components/ui/textarea";
import { openExternal } from "@/home/navItem";
import { isHubEnabled } from "@/profile/profile";
import { ErrorBanner } from "../content/pages/components/states";
import { useHubAccount } from "./account";
import { useHubUrl } from "./config";
import { SignInButton } from "./pages/components/AccountControl";
import { Field } from "./pages/components/Field";
import {
  hubItemPageUrl,
  type Publication,
  publishToHub,
  splitTags,
  whyNotPublishable,
} from "./publish";

/**
 * Publishing to the Coilbox hub from the share drawer (issue #1349): a title, a
 * description, some tags, and a link back.
 *
 * This replaces the stand-in from issue #1346, which copied the code and opened
 * the hub's own publish page in a browser. That button survives, but only for
 * somebody who is not signed in, as the quieter of the two ways out of that
 * state. The louder one is signing in right here: sending the reader to Settings
 * to find a button made publishing look like a thing you had to be told how to
 * do. Signed in, both would be one button doing the same job the slower way.
 *
 * The upload itself happens in Rust, because that is where the access token is.
 * See `./publish`.
 */
export function PublishSection({ code }: { code: string }) {
  const hubUrl = useHubUrl();
  const account = useHubAccount(hubUrl);
  const { loading: checking, signedIn } = account;
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [tags, setTags] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [published, setPublished] = useState<{ id: string } | null>(null);
  const [copied, setCopied] = useState(false);

  // What is wrong with the code itself, before anybody types a title. A campaign
  // or something oversized can never be published, so the form does not appear
  // at all rather than being filled in and refused.
  const unpublishable = whyNotPublishable({
    code,
    title: "a title",
    description: "",
    tags: [],
  });

  const publish = useCallback(async () => {
    const publication: Publication = {
      code,
      title,
      description,
      tags: splitTags(tags),
    };
    setBusy(true);
    setError(null);
    const result = await publishToHub(hubUrl, publication);
    setBusy(false);
    if (result.ok) {
      setPublished({ id: result.value.id });
    } else {
      setError(result.reason);
    }
  }, [code, description, hubUrl, tags, title]);

  // Same clipboard write the code box does, called straight from the click
  // handler so it stays inside the user gesture macOS requires.
  const copyAndOpen = async () => {
    try {
      await navigator.clipboard.writeText(code);
    } catch {
      // clipboard may be unavailable, so the code is still selectable above.
    }
    openExternal(`${hubUrl}/publish`);
  };

  const copyLink = async (link: string) => {
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // clipboard may be unavailable, so the link is still on screen to read.
    }
  };

  if (!isHubEnabled()) return null;

  if (published) {
    const page = hubItemPageUrl(hubUrl, published.id);
    return (
      <div className="flex flex-col gap-1.5 border-t pt-3">
        <p className="text-sm">Published to the Coilbox hub.</p>
        <p className="break-all text-xs text-muted-foreground">{page}</p>
        <div className="flex gap-2">
          <Button
            variant="outline"
            className="flex-1"
            onClick={() => copyLink(page)}
          >
            {copied ? (
              <>
                <Check className="mr-1.5 size-4" aria-hidden /> Copied
              </>
            ) : (
              <>
                <Copy className="mr-1.5 size-4" aria-hidden /> Copy link
              </>
            )}
          </Button>
          <Button
            variant="outline"
            className="flex-1"
            onClick={() => openExternal(page)}
          >
            <ExternalLink className="mr-1.5 size-4" aria-hidden /> View on the
            hub
          </Button>
        </div>
      </div>
    );
  }

  if (unpublishable) {
    return (
      <div className="flex flex-col gap-1.5 border-t pt-3">
        <h3 className="text-sm font-medium leading-none">Coilbox hub</h3>
        <p className="text-xs text-muted-foreground">{unpublishable}</p>
      </div>
    );
  }

  if (checking) {
    return (
      <div className="flex flex-col gap-1.5 border-t pt-3">
        <h3 className="text-sm font-medium leading-none">Coilbox hub</h3>
        <p className="text-xs text-muted-foreground">
          Checking whether you are signed in.
        </p>
      </div>
    );
  }

  // Coilbox asked and could not find out, which is not the same as being signed
  // out (issue #1456). Usually a keychain that did not answer inside its ten
  // seconds. So it says that rather than "sign in", and offers the same question
  // again first, because whatever was in the way is often gone by now.
  if (account.unknown) {
    return (
      <div className="flex flex-col gap-1.5 border-t pt-3">
        <h3 className="text-sm font-medium leading-none">Coilbox hub</h3>
        <p className="text-xs text-muted-foreground">
          {account.problem ??
            "Coilbox could not tell whether you are signed in."}
        </p>
        <div className="flex gap-2">
          <Button className="flex-1" onClick={() => void account.recheck()}>
            <RotateCw className="mr-1.5 size-4" aria-hidden /> Try again
          </Button>
          <SignInButton
            busy={account.busy}
            onSignIn={account.signIn}
            size="default"
          />
        </div>
        <Button variant="ghost" onClick={copyAndOpen}>
          <Globe className="mr-1.5 size-4" aria-hidden /> Copy code &amp; open
          hub
        </Button>
      </div>
    );
  }

  if (!signedIn) {
    return (
      <div className="flex flex-col gap-1.5 border-t pt-3">
        <h3 className="text-sm font-medium leading-none">Coilbox hub</h3>
        <p className="text-xs text-muted-foreground">
          Sign in to publish from here. Or copy the code and finish on the hub's
          own page.
        </p>
        <SignInButton
          busy={account.busy}
          onSignIn={account.signIn}
          size="default"
        />
        {account.problem && (
          <p className="text-xs text-destructive">{account.problem}</p>
        )}
        <Button variant="ghost" onClick={copyAndOpen}>
          <Globe className="mr-1.5 size-4" aria-hidden /> Copy code &amp; open
          hub
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2 border-t pt-3">
      <h3 className="text-sm font-medium leading-none">
        Publish to the Coilbox hub
      </h3>
      <Field label="Title">
        <Input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="What people will see first"
        />
      </Field>
      <Field label="Description" hint="Optional.">
        <Textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={3}
        />
      </Field>
      <Field label="Tags" hint="Optional, separated by commas.">
        <Input
          value={tags}
          onChange={(e) => setTags(e.target.value)}
          placeholder="1v1, cheese, teaching"
        />
      </Field>
      {error && <ErrorBanner message={error} />}
      <Button
        onClick={publish}
        disabled={busy || title.trim() === ""}
        aria-busy={busy}
      >
        <Globe className="mr-1.5 size-4" aria-hidden />
        {busy ? "Publishing…" : "Publish"}
      </Button>
      <p className="text-xs leading-snug text-muted-foreground">
        Anyone browsing the hub will be able to find and import this.
      </p>
    </div>
  );
}
