import type { MetadataRoute } from "next";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: [
        "/api/",
        "/game/",
      ],
    },
    sitemap: "https://outprep.xyz/sitemap-index.xml",
  };
}
