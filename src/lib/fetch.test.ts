import { afterEach, describe, expect, it } from "bun:test";
import { createLimiter, parseFeedsFromUrls } from "@/lib/rss";
import worker from "../worker";

const rss = (title: string) => `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>${title}</title>
    <link>http://localhost/</link>
    <item>
      <title>${title} item</title>
      <link>http://localhost/${encodeURIComponent(title)}</link>
      <pubDate>Mon, 23 Nov 2026 10:00:00 GMT</pubDate>
    </item>
  </channel>
</rss>`;

const originalFetch = globalThis.fetch;
const originalError = console.error;
const originalWarn = console.warn;

afterEach(() => {
  globalThis.fetch = originalFetch;
  console.error = originalError;
  console.warn = originalWarn;
  delete (globalThis as { caches?: unknown }).caches;
});

function quiet() {
  console.error = () => {};
  console.warn = () => {};
}

// Like Workers, let six fetches wait for response headers and queue the rest.
function limitConnections(max = 6) {
  const limit = createLimiter(max);
  globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) =>
    limit(() => originalFetch(input, init))) as typeof fetch;
}

// An in-memory stand-in for the Workers Cache API.
function stubCache() {
  const store = new Map<string, Response>();
  (globalThis as { caches?: unknown }).caches = {
    default: {
      async match(key: string) {
        return store.get(key)?.clone();
      },
      async put(key: string, response: Response) {
        store.set(key, new Response(await response.arrayBuffer(), response));
      },
    },
  };
  return store;
}

describe("createLimiter", () => {
  it("runs at most max tasks at once, in order", async () => {
    const limit = createLimiter(2);
    let active = 0;
    let peak = 0;
    const order: number[] = [];
    await Promise.all(
      [0, 1, 2, 3, 4].map((i) =>
        limit(async () => {
          active++;
          peak = Math.max(peak, active);
          order.push(i);
          await Bun.sleep(10);
          active--;
        }),
      ),
    );
    expect(peak).toBe(2);
    expect(order).toEqual([0, 1, 2, 3, 4]);
  });

  it("frees the slot when a task fails", async () => {
    const limit = createLimiter(1);
    await expect(
      limit(() => Promise.reject(new Error("boom"))),
    ).rejects.toThrow("boom");
    expect(await limit(async () => "ok")).toBe("ok");
  });
});

describe("parseFeedsFromUrls", () => {
  it("loads feeds queued behind slow servers", async () => {
    const server = Bun.serve({
      port: 9997,
      async fetch(req) {
        const { pathname } = new URL(req.url);
        if (pathname.startsWith("/slow/")) {
          await Bun.sleep(5000);
        }
        return new Response(rss(pathname), {
          headers: { "content-type": "application/rss+xml" },
        });
      },
    });
    quiet();
    limitConnections();
    try {
      const slow = [0, 1, 2, 3, 4, 5].map(
        (i) => `http://localhost:9997/slow/${i}`,
      );
      const fast = Array.from(
        { length: 36 },
        (_, i) => `http://localhost:9997/fast/${i}`,
      );
      const results = await parseFeedsFromUrls([...slow, ...fast], {
        fetchTimeoutMs: 300,
        deadlineMs: 3000,
      });

      const failed = results.filter(({ error }) => error);
      expect(failed.map(({ url }) => url)).toEqual(slow);
      expect(failed.every(({ error }) => error === "Request timed out")).toBe(
        true,
      );
      expect(results.filter(({ feed }) => feed)).toHaveLength(fast.length);
    } finally {
      server.stop(true);
    }
  });

  it("fails feeds that have not loaded by the deadline", async () => {
    const server = Bun.serve({
      port: 9996,
      async fetch() {
        await Bun.sleep(5000);
        return new Response(rss("late"));
      },
    });
    quiet();
    try {
      const started = Date.now();
      const results = await parseFeedsFromUrls(
        ["http://localhost:9996/a", "http://localhost:9996/b"],
        { concurrency: 1, fetchTimeoutMs: 1000, deadlineMs: 1500 },
      );
      expect(Date.now() - started).toBeLessThan(2500);
      expect(results.map(({ error }) => error)).toEqual([
        "Request timed out",
        "Request timed out",
      ]);
    } finally {
      server.stop(true);
    }
  });

  it("falls back to the cached copy when a stale feed fails to load", async () => {
    let status = 200;
    const server = Bun.serve({
      port: 9995,
      fetch() {
        return new Response(status === 200 ? rss("Cached Feed") : "Oops", {
          status,
          headers: { "content-type": "application/rss+xml" },
        });
      },
    });
    const store = stubCache();
    quiet();
    const url = "http://localhost:9995/feed.xml";
    const markStale = () => store.get(url)?.headers.set("X-Cached-At", "0");
    try {
      const [first] = await parseFeedsFromUrls([url]);
      expect(first.feed?.title).toBe("Cached Feed");
      expect(store.has(url)).toBe(true);

      markStale();
      status = 500;
      const [fromError] = await parseFeedsFromUrls([url]);
      expect(fromError.error).toBeNull();
      expect(fromError.feed?.title).toBe("Cached Feed");

      server.stop(true);
      const [fromDown] = await parseFeedsFromUrls([url]);
      expect(fromDown.error).toBeNull();
      expect(fromDown.feed?.title).toBe("Cached Feed");
    } finally {
      server.stop(true);
    }
  });

  it("refetches a stale feed and caches the new copy", async () => {
    let title = "Old";
    let hits = 0;
    const server = Bun.serve({
      port: 9994,
      fetch() {
        hits++;
        return new Response(rss(title), {
          headers: { "content-type": "application/rss+xml" },
        });
      },
    });
    const store = stubCache();
    const url = "http://localhost:9994/feed.xml";
    try {
      await parseFeedsFromUrls([url]);
      title = "New";
      const [fresh] = await parseFeedsFromUrls([url]);
      expect(fresh.feed?.title).toBe("Old");
      expect(hits).toBe(1);

      store.get(url)?.headers.set("X-Cached-At", "0");
      const [refreshed] = await parseFeedsFromUrls([url]);
      expect(refreshed.feed?.title).toBe("New");
      expect(hits).toBe(2);
    } finally {
      server.stop(true);
    }
  });
});

describe("GET /api/merge - caching", () => {
  it("refreshes a merged feed sooner when a feed failed", async () => {
    const server = Bun.serve({
      port: 9993,
      fetch(req) {
        const { pathname } = new URL(req.url);
        if (pathname === "/ok.xml") {
          return new Response(rss("OK"), {
            headers: { "content-type": "application/rss+xml" },
          });
        }
        return new Response("Not found", { status: 404 });
      },
    });
    const store = stubCache();
    quiet();
    try {
      const freshUntil = async (...urls: string[]) => {
        const request = new URL("http://localhost:3000/api/merge");
        for (const url of urls) {
          request.searchParams.append("url", url);
        }
        const response = await worker.fetch(new Request(request));
        expect(response.status).toBe(200);
        expect(response.headers.get("X-Fresh-Until")).toBeNull();
        const cached = store.get(request.toString());
        return (
          (Number(cached?.headers.get("X-Fresh-Until")) - Date.now()) / 1000
        );
      };

      const healthy = await freshUntil("http://localhost:9993/ok.xml");
      expect(healthy).toBeGreaterThan(3500);
      const withFailure = await freshUntil(
        "http://localhost:9993/ok.xml",
        "http://localhost:9993/missing.xml",
      );
      expect(withFailure).toBeGreaterThan(500);
      expect(withFailure).toBeLessThanOrEqual(600);
    } finally {
      server.stop(true);
    }
  });
});
