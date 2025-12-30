import { encodeContent } from "@/lib/encoding";
import { expect, it, describe } from "bun:test";
import { GET } from "./route";
import { NextRequest } from "next/server";

describe("encodeContent", () => {
  it("should encode content", () => {
    const content = "https://www.google.com/rss";
    const merged = encodeContent(content);
    expect(merged).toBe("https://www.google.com/rss");
  });

  it("should encode content with special characters", () => {
    const content = "Hi—weird stuff here";
    const merged = encodeContent(content);
    expect(merged).toBe("Hiweird stuff here");
  });

  it("should encode smart quotes", () => {
    const content = "\u201cHello\u201d";
    const merged = encodeContent(content);
    expect(merged).toBe("Hello");
  });
});

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
