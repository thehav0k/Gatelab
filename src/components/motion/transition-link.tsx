"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";

export function TLink(props: React.ComponentProps<typeof Link>) {
  const router = useRouter();
  return (
    <Link
      {...props}
      onClick={(e) => {
        props.onClick?.(e);
        const d = typeof document !== "undefined" ? (document as Document & { startViewTransition?: (cb: () => void) => void }) : undefined;
        if (
          e.defaultPrevented ||
          e.metaKey ||
          e.ctrlKey ||
          e.shiftKey ||
          !d?.startViewTransition ||
          (typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches)
        ) {
          return;
        }
        e.preventDefault();
        d.startViewTransition(() => router.push(String(props.href)));
      }}
    />
  );
}
