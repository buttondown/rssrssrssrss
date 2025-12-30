import type { MetadataRoute } from "next";

export default function sitemap(): MetadataRoute.Sitemap {
  return [
    {
      url: "https://rssrssrssrss.com",
      lastModified: new Date("2024-01-01"),
      changeFrequency: "weekly",
      priority: 1,
    },
  ];
}
