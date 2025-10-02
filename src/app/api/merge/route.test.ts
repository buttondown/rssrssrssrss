import { encodeContent } from "./route";
import { expect, it, describe } from "bun:test";

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
    const content = "“Hello”";
    const merged = encodeContent(content);
    expect(merged).toBe("Hello");
  });
});
