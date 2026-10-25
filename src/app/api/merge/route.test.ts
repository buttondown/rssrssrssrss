import { describe, expect, it } from "bun:test";
import { NextRequest } from "next/server";
import { GET } from "./route";

describe("GET /api/merge - Multiple feeds with one returning 403", () => {
  it("should fetch multiple feeds and handle 403 error gracefully", async () => {
    const feed1 = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:content="http://purl.org/rss/1.0/modules/content/">
  <channel>
    <title>Feed 1</title>
    <description>First feed</description>
    <link>http://localhost:9999</link>
    <item>
      <title>Article 1 from Feed 1</title>
      <link>http://localhost:9999/article1</link>
      <description>Content of article 1</description>
      <pubDate>Mon, 28 Oct 2025 10:00:00 GMT</pubDate>
    </item>
    <item>
      <title>Article 2 from Feed 1</title>
      <link>http://localhost:9999/article2</link>
      <description>Content of article 2</description>
      <pubDate>Sun, 27 Oct 2025 10:00:00 GMT</pubDate>
    </item>
  </channel>
</rss>`;

    const feed2 = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:content="http://purl.org/rss/1.0/modules/content/">
  <channel>
    <title>Feed 2</title>
    <description>Second feed</description>
    <link>http://localhost:9999</link>
    <item>
      <title>Article 1 from Feed 2</title>
      <link>http://localhost:9999/article1</link>
      <description>Content of feed 2 article 1</description>
      <pubDate>Mon, 29 Oct 2025 15:00:00 GMT</pubDate>
    </item>
  </channel>
</rss>`;

    // Start a simple test HTTP server
    const server = Bun.serve({
      port: 9999,
      fetch(req) {
        const url = new URL(req.url);

        // Feed 1: success
        if (url.pathname === "/feed1.xml") {
          return new Response(feed1, {
            status: 200,
            headers: { "content-type": "application/rss+xml" },
          });
        }

        // Feed 2: success
        if (url.pathname === "/feed2.xml") {
          return new Response(feed2, {
            status: 200,
            headers: { "content-type": "application/rss+xml" },
          });
        }

        // Feed 3: 403 Forbidden
        if (url.pathname === "/feed3.xml") {
          return new Response("Forbidden", { status: 403 });
        }

        return new Response("Not found", { status: 404 });
      },
    });

    try {
      // Suppress console.error output for expected 403 error
      const originalError = console.error;
      console.error = () => {};

      const baseUrl = new URL("http://localhost:3000/api/merge");
      baseUrl.searchParams.append("url", "http://localhost:9999/feed1.xml");
      baseUrl.searchParams.append("url", "http://localhost:9999/feed2.xml");
      baseUrl.searchParams.append("url", "http://localhost:9999/feed3.xml");

      const request = new NextRequest(baseUrl);
      const response = await GET(request);
      const text = await response.text();

      // Restore console.error
      console.error = originalError;

      // Verify response is valid RSS
      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toContain(
        "application/rss+xml",
      );

      // Verify the merged feed title is present
      expect(text).toContain("Merged Feed");

      // Verify error entry for failed feed appears
      expect(text).toContain("⚠️ Failed to load feed");
      expect(text).toContain("http://localhost:9999/feed3.xml");
      expect(text).toContain("Status code 403");

      // Verify items from feed 1 are present
      expect(text).toContain("Article 1 from Feed 1");
      expect(text).toContain("Article 2 from Feed 1");
      expect(text).toContain("Feed 1");

      // Verify items from feed 2 are present
      expect(text).toContain("Article 1 from Feed 2");
      expect(text).toContain("Feed 2");

      // Verify error entry appears before regular items (at the top)
      const errorIndex = text.indexOf("⚠️ Failed to load feed");
      const feed1Index = text.indexOf("Article 1 from Feed 1");
      const feed2Index = text.indexOf("Article 1 from Feed 2");
      expect(errorIndex).toBeLessThan(feed1Index);
      expect(errorIndex).toBeLessThan(feed2Index);
    } finally {
      server.stop();
    }
  });
});

describe("GET /api/merge - One fetch per feed", () => {
  it("should fetch each URL once and skip a feed that is down", async () => {
    const hits: Record<string, number> = {};
    const server = Bun.serve({
      port: 9998,
      fetch(req) {
        const { pathname } = new URL(req.url);
        hits[pathname] = (hits[pathname] || 0) + 1;

        if (pathname === "/feed.json") {
          return Response.json(
            {
              version: "https://jsonfeed.org/version/1.1",
              title: "JSON Feed",
              items: [
                {
                  id: "1",
                  title: "Article from JSON Feed",
                  url: "http://localhost:9998/json1",
                  date_published: "2025-10-28T10:00:00Z",
                },
              ],
            },
            { headers: { "content-type": "application/feed+json" } },
          );
        }

        if (pathname === "/page.html") {
          return new Response(
            `<html><head><link rel="alternate" type="application/rss+xml" href="/feed.xml"></head></html>`,
            { headers: { "content-type": "text/html" } },
          );
        }

        if (pathname === "/feed.xml") {
          return new Response(
            `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>Discovered Feed</title>
    <link>http://localhost:9998</link>
    <item>
      <title>Article from Discovered Feed</title>
      <link>http://localhost:9998/xml1</link>
      <pubDate>Mon, 27 Oct 2025 10:00:00 GMT</pubDate>
    </item>
  </channel>
</rss>`,
            { headers: { "content-type": "application/rss+xml" } },
          );
        }

        return new Response("Not found", { status: 404 });
      },
    });

    const originalError = console.error;
    console.error = () => {};
    try {
      const baseUrl = new URL("http://localhost:3000/api/merge");
      baseUrl.searchParams.append("url", "http://localhost:9998/feed.json");
      baseUrl.searchParams.append("url", "http://localhost:9998/page.html");
      baseUrl.searchParams.append("url", "http://localhost:1/down.xml");

      const response = await GET(new NextRequest(baseUrl));
      const text = await response.text();

      expect(response.status).toBe(200);
      expect(hits).toEqual({
        "/feed.json": 1,
        "/page.html": 1,
        "/feed.xml": 1,
      });
      expect(text).toContain("Article from JSON Feed");
      expect(text).toContain("Article from Discovered Feed");
      expect(text).toContain("⚠️ Failed to load feed");
      expect(text).toContain("http://localhost:1/down.xml");
    } finally {
      console.error = originalError;
      server.stop();
    }
  });
});
