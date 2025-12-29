import { expect, it, describe } from "bun:test";
import {
  parseFeedFromXml,
  mergeFeeds,
  generateRSS,
  generateJSONFeed,
} from "./rss";

describe("rss - XML to final output", () => {
  it("should parse XML feed and generate RSS output", async () => {
    const feed1Xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:content="http://purl.org/rss/1.0/modules/content/">
  <channel>
    <title>Feed 1</title>
    <description>First feed</description>
    <link>http://example.com</link>
    <item>
      <title>Article 1 from Feed 1</title>
      <link>http://example.com/article1</link>
      <description>Content of article 1</description>
      <pubDate>Mon, 28 Oct 2025 10:00:00 GMT</pubDate>
    </item>
    <item>
      <title>Article 2 from Feed 1</title>
      <link>http://example.com/article2</link>
      <description>Content of article 2</description>
      <pubDate>Sun, 27 Oct 2025 10:00:00 GMT</pubDate>
    </item>
  </channel>
</rss>`;

    const feed2Xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:content="http://purl.org/rss/1.0/modules/content/">
  <channel>
    <title>Feed 2</title>
    <description>Second feed</description>
    <link>http://example2.com</link>
    <item>
      <title>Article 1 from Feed 2</title>
      <link>http://example2.com/article1</link>
      <description>Content of feed 2 article 1</description>
      <pubDate>Mon, 29 Oct 2025 15:00:00 GMT</pubDate>
    </item>
  </channel>
</rss>`;

    // Parse XML feeds directly
    const result1 = await parseFeedFromXml(
      feed1Xml,
      "http://example.com/feed1",
    );
    const result2 = await parseFeedFromXml(
      feed2Xml,
      "http://example2.com/feed2",
    );

    expect(result1.error).toBeNull();
    expect(result2.error).toBeNull();

    // Merge feeds
    const mergedFeed = mergeFeeds(
      [
        { ...result1, url: "http://example.com/feed1" },
        { ...result2, url: "http://example2.com/feed2" },
      ],
      "http://example.com/merged",
    );

    // Generate RSS output
    const rssOutput = generateRSS(mergedFeed, "http://example.com/merged");

    // Normalize dates in RSS output for snapshot comparison
    const normalizedRss = rssOutput.replace(
      /<lastBuildDate>.*?<\/lastBuildDate>/,
      "<lastBuildDate>NORMALIZED_DATE</lastBuildDate>",
    );

    expect(normalizedRss).toMatchSnapshot();
  });

  it("should parse XML feed and generate JSON Feed output", async () => {
    const feedXml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:content="http://purl.org/rss/1.0/modules/content/">
  <channel>
    <title>Test Feed</title>
    <description>Test description</description>
    <link>http://example.com</link>
    <item>
      <title>Test Article</title>
      <link>http://example.com/article</link>
      <description>Test content</description>
      <pubDate>Mon, 28 Oct 2025 10:00:00 GMT</pubDate>
    </item>
  </channel>
</rss>`;

    // Parse XML feed directly
    const result = await parseFeedFromXml(feedXml, "http://example.com/feed");

    expect(result.error).toBeNull();

    // Merge feeds
    const mergedFeed = mergeFeeds(
      [{ ...result, url: "http://example.com/feed" }],
      "http://example.com/merged",
    );

    // Generate JSON Feed output
    const jsonOutput = generateJSONFeed(
      mergedFeed,
      "http://example.com/merged",
    );

    expect(jsonOutput).toMatchSnapshot();
  });

  it("should handle failed feeds in merge", async () => {
    const feedXml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>Valid Feed</title>
    <item>
      <title>Valid Article</title>
      <pubDate>Mon, 28 Oct 2025 10:00:00 GMT</pubDate>
    </item>
  </channel>
</rss>`;

    const validResult = await parseFeedFromXml(
      feedXml,
      "http://example.com/valid",
    );
    const failedResult = {
      feed: null,
      error: "Failed to fetch feed",
      url: "http://example.com/failed",
    };

    // Merge feeds including failed one
    const mergedFeed = mergeFeeds(
      [{ ...validResult, url: "http://example.com/valid" }, failedResult],
      "http://example.com/merged",
    );

    // Generate RSS output
    const rssOutput = generateRSS(mergedFeed, "http://example.com/merged");

    // Normalize dates and timestamps in RSS output for snapshot comparison
    // Error items have dynamically generated timestamps, so normalize them
    const normalizedRss = rssOutput
      .replace(
        /<lastBuildDate>.*?<\/lastBuildDate>/,
        "<lastBuildDate>NORMALIZED_DATE</lastBuildDate>",
      )
      .replace(/guid>error-.*?-\d+</g, "guid>error-NORMALIZED_TIMESTAMP<")
      .replace(
        /<pubDate>\w{3}, \d+ \w{3} \d{4} \d{2}:\d{2}:\d{2} GMT<\/pubDate>/g,
        "<pubDate>NORMALIZED_DATE</pubDate>",
      );

    expect(normalizedRss).toMatchSnapshot();
  });

  it("should parse Aditya Athalye's Eval/Apply Blog feed", async () => {
    const feedXml = `<rss xmlns:atom="http://www.w3.org/2005/Atom" version="2.0">
<channel>
<title>Aditya Athalye's Eval/Apply Blog</title>
<link>https://www.evalapply.org/</link>
<description>Welcome to evalapply.org. Out here, I strive to "learn generously". My software specialties include "Full-systems" B2B SaaS development, and Functional Programming (especially Clojure). I also help software nerds write for fun, and burnout-free career growth.</description>
<generator>shite -- https://github.com/adityaathalye/shite</generator>
<language>en-gb</language>
<lastBuildDate>Tue, 16 Dec 2025 19:03:48 +0530</lastBuildDate>
<atom:link href="https://www.evalapply.org/index.xml" rel="self" type="application/rss+xml"/>
<image>
<title>Aditya Athalye's Eval/Apply Blog</title>
<url>https://www.evalapply.org/static/img/Lisp_logo.svg</url>
<link>https://www.evalapply.org/</link>
<width>128</width>
<height>128</height>
</image>
<item>
<title>Understanding not just Clojure's comp function by re-implementing it</title>
<link>https://www.evalapply.org/posts/lessons-from-reimplementing-clojure-comp-function/index.html</link>
<pubDate>Fri, 08 Aug 2025 00:00:00 +0000</pubDate>
<guid>https://www.evalapply.org/posts/lessons-from-reimplementing-clojure-comp-function/</guid>
<description>Because I realised thinking like this is not obvious to Clojure newcomers, especially those having non-FP first languages. Because I was there too, all those moons ago! Feat. a salty footnote about the misdirected rancour popularly heaped upon CSS (yes, Cascading Style Sheets), triggered by that fact that 'comp' is a combinator, and I think they should have called it Combinatory Styling System.</description>
<category domain="https://www.evalapply.org/tags">clojure</category>
<category domain="https://www.evalapply.org/tags">functional_programming</category>
<category domain="https://www.evalapply.org/tags">howto</category>
<category domain="https://www.evalapply.org/tags">riff</category>
</item></channel></rss>`;

    // Parse XML feed directly
    const result = await parseFeedFromXml(
      feedXml,
      "https://www.evalapply.org/index.xml",
    );

    expect(result.error).toBeNull();

    // Merge feeds
    const mergedFeed = mergeFeeds(
      [{ ...result, url: "https://www.evalapply.org/index.xml" }],
      "http://example.com/merged",
    );

    // Generate RSS output
    const rssOutput = generateRSS(mergedFeed, "http://example.com/merged");

    // Normalize dates in RSS output for snapshot comparison
    const normalizedRss = rssOutput.replace(
      /<lastBuildDate>.*?<\/lastBuildDate>/,
      "<lastBuildDate>NORMALIZED_DATE</lastBuildDate>",
    );

    expect(normalizedRss).toMatchSnapshot();

    // Also test JSON Feed generation
    const jsonOutput = generateJSONFeed(
      mergedFeed,
      "http://example.com/merged",
    );

    expect(jsonOutput).toMatchSnapshot();
  });
});
