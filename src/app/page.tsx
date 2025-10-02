"use client";

import LZString from "lz-string";
import { useEffect, useState } from "react";

type FeedItem = {
  title?: string;
  link?: string;
  pubDate?: string;
  content?: string;
  sourceFeedTitle?: string;
  image?: string;
};

const SAMPLE_FEEDS: { name: string; feeds: string[] }[] = [
  {
    name: "Tech News Bundle",
    feeds: [
      "https://hnrss.org/frontpage",
      "https://feeds.arstechnica.com/arstechnica/features",
      "https://www.theverge.com/rss/index.xml",
    ],
  },
  {
    name: "Development Blogs",
    feeds: [
      "https://overreacted.io/rss.xml",
      "https://jvns.ca/atom.xml",
      "https://kentcdodds.com/blog/rss.xml",
    ],
  },
  {
    name: "Design & UX",
    feeds: [
      "https://www.smashingmagazine.com/feed/",
      "https://alistapart.com/main/feed/",
      "https://www.nngroup.com/feed/rss/",
    ],
  },
];

export default function Home() {
  const [feedList, setFeedList] = useState<string>("");
  const [mergedUrl, setMergedUrl] = useState<string>("");
  const [errorMessage, setErrorMessage] = useState<string>("");
  const [previewItems, setPreviewItems] = useState<FeedItem[]>([]);
  const [isLoadingPreview, setIsLoadingPreview] = useState(false);
  const [existingUrl, setExistingUrl] = useState<string>("");
  const getFeedsFromList = () => {
    return feedList
      .split("\n")
      .map((feed) => feed.trim())
      .filter((feed) => feed !== "");
  };

  const isValidUrl = (url: string) => {
    try {
      new URL(url);
      return true;
    } catch (e) {
      return false;
    }
  };

  const loadExistingFeed = (url: string) => {
    try {
      const urlObj = new URL(url);
      const feedsParam = urlObj.searchParams.get("feeds");

      if (!feedsParam) {
        setErrorMessage("No feeds parameter found in URL");
        return;
      }

      const decompressed =
        LZString.decompressFromEncodedURIComponent(feedsParam);
      if (!decompressed) {
        setErrorMessage("Failed to decode feed data from URL");
        return;
      }

      const feeds = JSON.parse(decompressed);
      if (!Array.isArray(feeds)) {
        setErrorMessage("Invalid feed data format");
        return;
      }

      setFeedList(feeds.join("\n"));
      setExistingUrl("");
      setErrorMessage("");
    } catch (error) {
      setErrorMessage("Invalid URL or failed to decode feed data");
    }
  };

  // This name is now a bit of a misnomer; this function also generates the core feed.
  const fetchPreview = async () => {
    const feeds = getFeedsFromList();
    const validFeeds = feeds.filter((feed) => isValidUrl(feed));
    if (validFeeds.length === 0) {
      setPreviewItems([]);
      return;
    }

    setIsLoadingPreview(true);
    try {
      // Compress feeds using LZ-string for better compression
      const feedsData = JSON.stringify(validFeeds);
      const compressedFeeds = LZString.compressToEncodedURIComponent(feedsData);

      const response = await fetch(`/api/merge?feeds=${compressedFeeds}`);
      if (!response.ok) {
        throw new Error("Failed to fetch preview");
      }

      const text = (await response.text()).replaceAll(
        "content:encoded",
        "content",
      );
      const parser = new DOMParser();
      const xmlDoc = parser.parseFromString(text, "text/xml");
      console.log(xmlDoc);

      const items = Array.from(xmlDoc.querySelectorAll("item"))
        .slice(0, 25)
        .map((item) => {
          const getTextContent = (tagName: string) =>
            item.querySelector(tagName)?.textContent || undefined;

          return {
            title: getTextContent("title"),
            link: getTextContent("link"),
            pubDate: getTextContent("pubDate"),
            content: getTextContent("content"),
            sourceFeedTitle:
              item.querySelector("source")?.textContent || undefined,
            image:
              parser
                .parseFromString(getTextContent("encoded") || "", "text/html")
                .querySelector("img")
                ?.getAttribute("src") || undefined,
          };
        });

      setPreviewItems(items);
      setMergedUrl(
        `${window.location.origin}/api/merge?feeds=${compressedFeeds}`,
      );
    } catch (error) {
      console.error("Error fetching preview:", error);
      setPreviewItems([]);
    } finally {
      setIsLoadingPreview(false);
    }
  };

  useEffect(() => {
    const feeds = getFeedsFromList();
    const validFeeds = feeds.filter((feed) => isValidUrl(feed));
    if (validFeeds.length > 0) {
      const timeoutId = setTimeout(() => {
        fetchPreview();
      }, 500);
      return () => clearTimeout(timeoutId);
    }
    setPreviewItems([]);
  }, [feedList]);

  return (
    <div className="min-h-screen bg-neutral-100 font-sans p-0">
      <div className="flex flex-col lg:flex-row">
        <div className="max-w-prose p-8 space-y-8">
          <div className="">
            <h1 className="text-lg font-extrabold font-sans text-white p-2 mb-2 leading-[20px] bg-blue-500 inline-grid grid-cols-2 gap-1">
              <div>RSS</div>
              <div className="opacity-80">RSS</div>
              <div className="opacity-60">RSS</div>
              <div className="opacity-40">RSS</div>
            </h1>
            <p className="text-sm font-sans text-gray-500">
              Combine multiple RSS feeds into one unified feed
            </p>
          </div>

          <div className="bg-neutral-300/20 p-4 rounded-md border border-neutral-300">
            <h2 className="font-semibold text-gray-800">Add your RSS feeds</h2>
            <p className="text-sm text-gray-600 mb-2">
              Enter one RSS feed URL per line
            </p>
            <div className="space-y-4">
              <textarea
                value={feedList}
                onChange={(e) => {
                  setFeedList(e.target.value);
                  setErrorMessage("");
                }}
                className="w-full px-3 py-2 text-sm text-gray-700 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 font-mono bg-white"
                rows={6}
              />
            </div>

            <div className=" text-center text-sm text-gray-500 flex items-center -mx-4">
              <div className="flex-1 border-t border-neutral-300" />
              <div className="flex justify-center px-4 text-xs uppercase font-semibold">
                Or
              </div>
              <div className="flex-1 border-t border-neutral-300" />
            </div>

            <div className="">
              <h2 className="font-semibold text-gray-800">
                Load existing merged feed
              </h2>
              <p className="text-sm text-gray-600 mb-2">
                Paste an existing merged feed URL to edit it
              </p>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={existingUrl}
                  onChange={(e) => {
                    setExistingUrl(e.target.value);
                    loadExistingFeed(e.target.value);
                  }}
                  placeholder="https://rssrssrssrss.com/api/merge?feeds=..."
                  className="flex-1 px-3 py-2 text-sm text-gray-700 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 bg-white"
                />
              </div>
            </div>
          </div>

          <div className="">
            <h2 className="font-semibold text-gray-800">How do I use this?</h2>
            <p className="text-gray-600">
              Put the URLs of RSS feeds you want to combine in the box above;
              idly (or passionately) browse the preview to make sure it's what
              you want; hit the button to get a permalink (that's a base-64
              encoded URL of the feeds, so no real worry about bitrot).
            </p>
          </div>

          <div className="">
            <h2 className="font-semibold text-gray-800">
              Why would I want to do this?
            </h2>
            <p className="text-gray-600">
              Lots of things take RSS. Relatively few things do a great job of
              interleaving multiple RSS feeds. This is a simple tool to do that.
            </p>
          </div>

          <div className="">
            <h2 className="font-semibold text-gray-800">
              May I refer to it as rss<sup>4</sup>?
            </h2>
            <p className="text-gray-600">If you insist.</p>
          </div>

          <div className="">
            <h2 className="font-semibold text-gray-800">Who built this?</h2>
            <p className="text-gray-600">
              Your friends at{" "}
              <a
                href="https://buttondown.com?utm_source=rss4"
                className="text-blue-600 hover:text-blue-800"
              >
                Buttondown
              </a>
              , and they even made it{" "}
              <a
                href="https://github.com/buttondown/rssrssrssrss"
                className="text-blue-600 hover:text-blue-800"
              >
                open source
              </a>
              .
            </p>
          </div>

          {errorMessage && (
            <div className="mt-4 p-3 border border-red-300 rounded-md bg-red-50 text-red-700">
              <p>{errorMessage}</p>
            </div>
          )}
        </div>
        <div className="flex-1" />

        <div className="hidden lg:block">
          <div className="flex h-[calc(100vh)] overflow-y-hidden p-8 pb-0 sticky top-0">
            <div className="mx-auto shadow-2xl border border-neutral-300 rounded-md rounded-b-none bg-white w-[600px] overflow-y-scroll">
              {feedList.length > 0 && (
                <div className="grid grid-cols-3 p-2 pb-1 border-b border-neutral-300 shadow-sm sticky top-0 bg-white">
                  <div className="flex items-center">
                    {/* Every favicon, make a circle, 16px */}
                    {previewItems
                      .map((item) => item.link?.split("/")[2])
                      .filter(
                        (domain, index, self) => self.indexOf(domain) === index,
                      )
                      .map((domain, index) => (
                        <img
                          key={domain}
                          src={`https://s2.googleusercontent.com/s2/favicons?domain=${domain}`}
                          alt={domain}
                          className="w-4 h-4 -ml-2 first:ml-0 border border-neutral-300 rounded-full"
                          style={{ zIndex: index + 1 }}
                        />
                      ))}
                  </div>
                  <h3 className="text-sm font-semibold text-gray-800 text-center">
                    Merged Feed
                  </h3>
                  <div className="text-right">
                    <a
                      href={mergedUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-blue-600 hover:text-blue-800 inline-flex items-center whitespace-nowrap font-semibold text-xs bg-blue-200 px-1.5 py-[2px] rounded-sm"
                    >
                      <svg
                        xmlns="http://www.w3.org/2000/svg"
                        className="size-4 mr-1"
                        fill="none"
                        viewBox="0 0 24 24"
                        stroke="currentColor"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={2}
                          d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"
                        />
                      </svg>
                      Get permalink
                    </a>
                  </div>
                </div>
              )}

              {isLoadingPreview ? (
                <div className="space-y-0">
                  {[...Array(5)].map((_, index) => (
                    <div
                      key={index}
                      className="border border-gray-100 text-sm odd:bg-neutral-100/50 p-2 border-b border-b-neutral-300 animate-pulse"
                    >
                      <div className="h-5 bg-gray-300 rounded w-3/4 mb-2" />
                      <div className="space-y-2">
                        <div className="h-3 bg-gray-200 rounded" />
                        <div className="h-3 bg-gray-200 rounded w-5/6" />
                      </div>
                      <div className="flex justify-between mt-2">
                        <div className="flex items-center">
                          <div className="w-4 h-4 bg-gray-300 rounded mr-1" />
                          <div className="h-3 bg-gray-200 rounded w-24" />
                        </div>
                        <div className="h-3 bg-gray-200 rounded w-16" />
                      </div>
                    </div>
                  ))}
                </div>
              ) : previewItems.length > 0 ? (
                <div className="">
                  {previewItems.map((item, index) => (
                    <div
                      key={index}
                      className="border border-gray-100 text-sm odd:bg-neutral-50 p-2 max-w-full border-b border-b-neutral-300"
                    >
                      {item.image && (
                        <img
                          src={item.image}
                          alt={item.title}
                          className="w-full h-48 object-cover mb-2 rounded-md"
                        />
                      )}
                      <h4 className="font-semibold text-gray-900 truncate">
                        <a
                          href={item.link}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="hover:underline text-blue-600"
                        >
                          {item.title || "«No Title Defined»"}
                        </a>
                      </h4>
                      <div className="flex-1">
                        {item.content && (
                          <p
                            className="text-sm text-gray-600 line-clamp-4 break-normal [&_img]:hidden [&_.separator]:hidden [&_br:first-of-type]:hidden"
                            dangerouslySetInnerHTML={{ __html: item.content }}
                          />
                        )}
                      </div>
                      <div className="flex justify-between mt-2 text-xs">
                        <div className="flex items-center">
                          <img
                            src={`https://s2.googleusercontent.com/s2/favicons?domain=${
                              item.link?.split("/")[2]
                            }`}
                            alt={item.title}
                            className="w-4 h-4 mr-1 rounded-md"
                          />
                          {item.sourceFeedTitle && (
                            <p className="text-gray-500">
                              {item.sourceFeedTitle}
                            </p>
                          )}
                        </div>
                        {item.pubDate && (
                          <p className="text-gray-500">
                            {new Date(item.pubDate).toLocaleDateString()}
                          </p>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="flex flex-col items-center justify-center py-12 px-8 text-center">
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    className="h-12 w-12 text-gray-400 mb-4"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={1.5}
                      d="M6 5c7.18 0 13 5.82 13 13M6 11a7 7 0 017 7m-6 0a1 1 0 11-2 0 1 1 0 012 0z"
                    />
                  </svg>
                  <h3 className="text-lg font-semibold text-gray-700 mb-2">
                    No feeds added yet
                  </h3>
                  <p className="text-sm text-gray-500 mb-6">
                    Add RSS feed URLs to see a preview of your merged feed
                  </p>

                  <div className="space-y-3 w-full">
                    <p className="text-xs text-gray-600 font-semibold uppercase tracking-wider">
                      Try a sample bundle:
                    </p>
                    {SAMPLE_FEEDS.map((bundle, index) => (
                      <button
                        key={index}
                        onClick={() => setFeedList(bundle.feeds.join("\n"))}
                        className="w-full px-4 py-3 text-sm text-left border border-gray-300 rounded-md hover:bg-gray-50 transition-colors"
                      >
                        <div className="font-semibold text-gray-800">
                          {bundle.name}
                        </div>
                        <div className="text-xs text-gray-500 mt-1">
                          {bundle.feeds.length} feeds
                        </div>
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Mobile Preview Section - Shown only on small screens */}
        <div className="lg:hidden p-8 pt-0">
          <div className="mx-auto shadow-2xl border border-neutral-300 rounded-md bg-white max-h-96 overflow-y-scroll">
            {feedList.length > 0 && (
              <div className="grid grid-cols-3 p-2 pb-1 border-b border-neutral-300 shadow-sm sticky top-0 bg-white">
                <div className="flex items-center">
                  {/* Every favicon, make a circle, 16px */}
                  {previewItems
                    .map((item) => item.link?.split("/")[2])
                    .filter(
                      (domain, index, self) => self.indexOf(domain) === index,
                    )
                    .map((domain, index) => (
                      <img
                        key={domain}
                        src={`https://s2.googleusercontent.com/s2/favicons?domain=${domain}`}
                        alt={domain}
                        className="w-4 h-4 -ml-2 first:ml-0 border border-neutral-300 rounded-full"
                        style={{ zIndex: index + 1 }}
                      />
                    ))}
                </div>
                <h3 className="text-sm font-semibold text-gray-800 text-center">
                  Merged Feed
                </h3>
                <div className="text-right">
                  <a
                    href={mergedUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-blue-600 hover:text-blue-800 inline-flex items-center whitespace-nowrap font-semibold text-xs bg-blue-200 px-1.5 py-[2px] rounded-sm"
                  >
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      className="size-4 mr-1"
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"
                      />
                    </svg>
                    Get permalink
                  </a>
                </div>
              </div>
            )}

            {isLoadingPreview ? (
              <div className="space-y-0">
                {[...Array(5)].map((_, index) => (
                  <div
                    key={index}
                    className="border border-gray-100 text-sm odd:bg-neutral-100/50 p-2 border-b border-b-neutral-300 animate-pulse"
                  >
                    <div className="h-5 bg-gray-300 rounded w-3/4 mb-2" />
                    <div className="space-y-2">
                      <div className="h-3 bg-gray-200 rounded" />
                      <div className="h-3 bg-gray-200 rounded w-5/6" />
                    </div>
                    <div className="flex justify-between mt-2">
                      <div className="flex items-center">
                        <div className="w-4 h-4 bg-gray-300 rounded mr-1" />
                        <div className="h-3 bg-gray-200 rounded w-24" />
                      </div>
                      <div className="h-3 bg-gray-200 rounded w-16" />
                    </div>
                  </div>
                ))}
              </div>
            ) : previewItems.length > 0 ? (
              <div className="">
                {previewItems.map((item, index) => (
                  <div
                    key={index}
                    className="border border-gray-100 text-sm odd:bg-neutral-50 p-2 max-w-full border-b border-b-neutral-300"
                  >
                    {item.image && (
                      <img
                        src={item.image}
                        alt={item.title}
                        className="w-full h-48 object-cover mb-2 rounded-md"
                      />
                    )}
                    <h4 className="font-semibold text-gray-900 truncate">
                      <a
                        href={item.link}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="hover:underline text-blue-600"
                      >
                        {item.title || "«No Title Defined»"}
                      </a>
                    </h4>
                    <div className="flex-1">
                      {item.content && (
                        <p
                          className="text-sm text-gray-600 line-clamp-4 break-normal"
                          dangerouslySetInnerHTML={{ __html: item.content }}
                        />
                      )}
                    </div>
                    <div className="flex justify-between mt-2 text-xs">
                      <div className="flex items-center">
                        <img
                          src={`https://s2.googleusercontent.com/s2/favicons?domain=${
                            item.link?.split("/")[2]
                          }`}
                          alt={item.title}
                          className="w-4 h-4 mr-1 rounded-md"
                        />
                        {item.sourceFeedTitle && (
                          <p className="text-gray-500">
                            {item.sourceFeedTitle}
                          </p>
                        )}
                      </div>
                      {item.pubDate && (
                        <p className="text-gray-500">
                          {new Date(item.pubDate).toLocaleDateString()}
                        </p>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center py-12 px-8 text-center">
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  className="h-12 w-12 text-gray-400 mb-4"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={1.5}
                    d="M6 5c7.18 0 13 5.82 13 13M6 11a7 7 0 017 7m-6 0a1 1 0 11-2 0 1 1 0 012 0z"
                  />
                </svg>
                <h3 className="text-lg font-semibold text-gray-700 mb-2">
                  No feeds added yet
                </h3>
                <p className="text-sm text-gray-500 mb-6">
                  Add RSS feed URLs to see a preview of your merged feed
                </p>

                <div className="space-y-3 w-full">
                  <p className="text-xs text-gray-600 font-semibold uppercase tracking-wider">
                    Try a sample bundle:
                  </p>
                  {SAMPLE_FEEDS.map((bundle, index) => (
                    <button
                      key={index}
                      onClick={() => setFeedList(bundle.feeds.join("\n"))}
                      className="w-full px-4 py-3 text-sm text-left border border-gray-300 rounded-md hover:bg-gray-50 transition-colors"
                    >
                      <div className="font-semibold text-gray-800">
                        {bundle.name}
                      </div>
                      <div className="text-xs text-gray-500 mt-1">
                        {bundle.feeds.length} feeds
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
