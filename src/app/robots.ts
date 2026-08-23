import type { MetadataRoute } from "next";
import { SITE } from "@/lib/site";

/**
 * `/solutions` is password-gated and `/unlock` is the gate. Neither should be
 * crawled: a disallow here, `robots: noindex` on the pages themselves, and their
 * absence from the sitemap are three independent statements of the same thing,
 * which is the right number for something that is embarrassing to get wrong.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: { userAgent: "*", allow: "/", disallow: ["/solutions", "/unlock", "/api/"] },
    sitemap: `${SITE.url}/sitemap.xml`,
    host: SITE.url,
  };
}
