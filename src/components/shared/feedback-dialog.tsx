"use client";

import { useState } from "react";
import { usePathname } from "next/navigation";
import { toast } from "sonner";
import { Mail, MessageSquare, Send } from "lucide-react";
import { GithubIcon } from "@/components/shared/github-icon";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  CONTACT,
  FEEDBACK_KINDS,
  feedbackPayload,
  mailtoUrl,
  validateFeedback,
  type Feedback,
  type FeedbackKind,
} from "@/lib/feedback";
import { cn } from "@/lib/utils";

/**
 * The endpoint. FormSubmit relays a POST straight to the inbox with no backend,
 * no API key and no signup — which matters, because this app has no server of its
 * own to put a mailer on.
 *
 * Override it with NEXT_PUBLIC_FEEDBACK_ENDPOINT to point somewhere else (a
 * Formspree form, a Vercel route handler, anything that accepts JSON) without
 * touching this file.
 */
const ENDPOINT =
  process.env.NEXT_PUBLIC_FEEDBACK_ENDPOINT ??
  `https://formsubmit.co/ajax/${CONTACT.email}`;

const EMPTY: Feedback = { kind: "Bug", from: "", message: "" };

export function FeedbackDialog({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [sending, setSending] = useState(false);
  const [touched, setTouched] = useState(false);
  const [form, setForm] = useState<Feedback>(EMPTY);

  const errors = validateFeedback(form);
  const shown = touched ? errors : {};

  const send = async () => {
    setTouched(true);
    if (Object.keys(errors).length > 0) return;

    setSending(true);
    try {
      const res = await fetch(ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify(feedbackPayload(form, pathname)),
      });
      if (!res.ok) throw new Error(String(res.status));

      setForm(EMPTY);
      setTouched(false);
      setOpen(false);
      toast.success("Sent — thank you", {
        description: form.from.trim()
          ? `If it needs an answer, it will come to ${form.from.trim()}.`
          : "It went in anonymously, so there is no way to reply.",
      });
    } catch {
      /**
       * The relay is down, or blocked, or the network is gone. DO NOT pretend the
       * message was delivered — hand it to the user's own mail client with every
       * field already filled in, and say plainly what happened.
       */
      window.location.href = mailtoUrl(form, pathname);
      toast.warning("Could not send it from here", {
        description: "Your mail app should be opening with the message ready to go.",
      });
    } finally {
      setSending(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{children}</DialogTrigger>

      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <MessageSquare className="size-4" /> Send feedback
          </DialogTitle>
          <DialogDescription>
            Found a wrong answer, a broken pinout, or something that should exist and
            does not? It goes straight to the maintainer.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label>What is it?</Label>
            <div className="grid grid-cols-4 gap-1.5">
              {FEEDBACK_KINDS.map((k) => (
                <button
                  key={k}
                  type="button"
                  onClick={() => setForm((f) => ({ ...f, kind: k as FeedbackKind }))}
                  className={cn(
                    "rounded-md border px-2 py-1.5 text-xs transition-colors",
                    form.kind === k
                      ? "border-ring bg-accent text-foreground"
                      : "text-muted-foreground hover:bg-accent/50",
                  )}
                >
                  {k}
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="fb-message">Message</Label>
            <Textarea
              id="fb-message"
              rows={5}
              value={form.message}
              onChange={(e) => setForm((f) => ({ ...f, message: e.target.value }))}
              onBlur={() => setTouched(true)}
              placeholder="The 7402 gate 1 output looks wrong on pin 1…"
              aria-invalid={!!shown.message}
              className="resize-none"
            />
            {shown.message && (
              <p className="text-destructive text-xs">{shown.message}</p>
            )}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="fb-from">
              Your email
              <span className="text-muted-foreground ml-1 font-normal">
                optional — but there is no way to reply without it
              </span>
            </Label>
            <Input
              id="fb-from"
              type="email"
              inputMode="email"
              autoComplete="email"
              value={form.from}
              onChange={(e) => setForm((f) => ({ ...f, from: e.target.value }))}
              onBlur={() => setTouched(true)}
              placeholder="you@example.com"
              aria-invalid={!!shown.from}
            />
            {shown.from && <p className="text-destructive text-xs">{shown.from}</p>}
          </div>

          <Button onClick={send} disabled={sending} className="w-full">
            <Send />
            {sending ? "Sending…" : "Send"}
          </Button>

          <div className="text-muted-foreground flex flex-wrap items-center justify-center gap-x-4 gap-y-1 border-t pt-3 text-xs">
            <span>Or reach out directly:</span>
            <a
              href={`mailto:${CONTACT.email}`}
              className="hover:text-foreground flex items-center gap-1 underline underline-offset-4"
            >
              <Mail className="size-3" />
              {CONTACT.email}
            </a>
            <a
              href={CONTACT.githubUrl}
              target="_blank"
              rel="noreferrer"
              className="hover:text-foreground flex items-center gap-1 underline underline-offset-4"
            >
              <GithubIcon className="size-3" />@{CONTACT.github}
            </a>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
