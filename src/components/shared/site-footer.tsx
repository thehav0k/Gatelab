"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Mail, MessageSquare } from "lucide-react";
import { GithubIcon } from "@/components/shared/github-icon";
import { FeedbackDialog } from "@/components/shared/feedback-dialog";
import { CONTACT } from "@/lib/feedback";

/**
 * NOT on the lab.
 *
 * The lab is a fixed `100dvh - header` workspace whose whole point is that the
 * canvas fills the screen and the page never scrolls. Hanging a footer under it
 * would add exactly enough height to grow a scrollbar and letterbox the canvas —
 * which is the bug that layout was written to fix.
 */
export function SiteFooter() {
  const pathname = usePathname();
  if (pathname.startsWith("/lab")) return null;

  return (
    <footer className="no-print mt-auto border-t">
      <div className="text-muted-foreground mx-auto flex w-full max-w-6xl flex-col gap-3 px-4 py-6 text-xs sm:flex-row sm:items-center sm:px-6">
        <p className="text-pretty">
          Gatelab runs entirely in your browser. Nothing you build is uploaded.
        </p>

        <div className="flex flex-wrap items-center gap-x-5 gap-y-2 sm:ml-auto">
          <Link href="/manual" className="hover:text-foreground transition-colors">
            Manual
          </Link>

          <FeedbackDialog>
            <button
              type="button"
              className="hover:text-foreground flex items-center gap-1.5 transition-colors"
            >
              <MessageSquare className="size-3.5" />
              Feedback
            </button>
          </FeedbackDialog>

          <a
            href={`mailto:${CONTACT.email}`}
            className="hover:text-foreground flex items-center gap-1.5 transition-colors"
          >
            <Mail className="size-3.5" />
            {CONTACT.email}
          </a>

          <a
            href={CONTACT.githubUrl}
            target="_blank"
            rel="noreferrer"
            className="hover:text-foreground flex items-center gap-1.5 transition-colors"
          >
            <GithubIcon className="size-3.5" />@{CONTACT.github}
          </a>
        </div>
      </div>
    </footer>
  );
}
