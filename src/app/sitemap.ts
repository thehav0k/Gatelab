import type { MetadataRoute } from "next";
import { SITE } from "@/lib/site";

/**
 * Six routes, and a crawler will find them all from the nav anyway — but a
 * sitemap is what gets them into Search Console's index report, which is the only
 * place you can see WHY a page was not indexed.
 *
 * `lastModified` is deliberately absent rather than `new Date()`: a timestamp that
 * changes on every build is a lie about the content changing, and Google learns to
 * ignore a feed that cries wolf.
 */
export default function sitemap(): MetadataRoute.Sitemap {
  const page = (path: string, priority: number) => ({
    url: `${SITE.url}${path}`,
    changeFrequency: "monthly" as const,
    priority,
  });

  return [
    page("", 1),
    page("/theory", 0.9),
    page("/diagrams", 0.9),
    page("/lab", 0.9),
    page("/manual", 0.7),
    page("/report", 0.5),
  ];
}
