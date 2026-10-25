import { describe, expect, it } from "bun:test";
import { encodeContent } from "@/lib/encoding";

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
