"use client";

import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { KeyRound, Lock, TriangleAlert } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

/**
 * The password prompt for the worked-solutions catalogue.
 *
 * Nothing here decides anything. The password is posted to a route handler,
 * which is what compares it and sets the cookie; the middleware is what enforces
 * it. This page's whole job is to collect a string and then navigate — so
 * reading its source tells an attacker nothing they did not already know.
 */
export default function UnlockPage() {
  return (
    <Suspense fallback={null}>
      <UnlockForm />
    </Suspense>
  );
}

function UnlockForm() {
  const params = useSearchParams();
  const destination = params.get("next") ?? "/solutions";
  const unconfigured = params.get("unset") === "1";

  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/unlock", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      const body = (await response.json()) as { ok?: boolean; error?: string };
      if (!response.ok || !body.ok) {
        setError(body.error ?? "That password is not right.");
        return;
      }
      // A full navigation, not a client-side push: the middleware has to see the
      // new cookie, and it only runs on a real request.
      window.location.href = destination.startsWith("/") ? destination : "/solutions";
    } catch {
      setError("Could not reach the server. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto flex w-full max-w-md flex-col justify-center px-4 py-16 sm:py-24">
      <div className="mb-6 flex items-center gap-2">
        <Lock className="text-logic-high size-5" />
        <h1 className="text-xl font-semibold tracking-tight">Private</h1>
      </div>

      <p className="text-muted-foreground mb-6 text-sm text-pretty">
        The worked solutions are behind a password. The circuit builder is open to
        everyone —{" "}
        <Link href="/diagram" className="text-foreground underline underline-offset-4">
          go there instead
        </Link>
        .
      </p>

      {unconfigured ? (
        <Alert variant="destructive">
          <TriangleAlert />
          <AlertTitle>No password is set on this deployment</AlertTitle>
          <AlertDescription>
            Set <code>DIAGRAMS_PASSWORD</code> in the environment and redeploy. Until
            then this section stays locked for everybody, which is the safe way round.
          </AlertDescription>
        </Alert>
      ) : (
        <form onSubmit={submit} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="password">Password</Label>
            <Input
              id="password"
              type="password"
              autoFocus
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
            />
          </div>

          {error && <p className="text-destructive text-sm">{error}</p>}

          <Button type="submit" className="w-full" disabled={busy || password === ""}>
            <KeyRound />
            {busy ? "Checking…" : "Unlock"}
          </Button>
        </form>
      )}

      <p className="text-muted-foreground mt-6 text-xs text-pretty">
        Unlocking sets a cookie on this browser for 30 days. It holds a derived
        token, never the password itself.
      </p>
    </div>
  );
}
