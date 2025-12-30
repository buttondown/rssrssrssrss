// Category can be a string or an object with _ property (when RSS category has attributes)
export type Category = string | { _: string; [key: string]: any };

// Types for RSS items
export type CustomItem = {
  title?: string;
  link?: string;
  pubDate?: string;
  content?: string;
  contentSnippet?: string;
  creator?: string;
  isoDate?: string;
  guid?: string;
  categories?: Category[];
  // Source tracking
  sourceFeedTitle?: string;
  sourceFeedUrl?: string;
  [key: string]: any; // For additional fields from RSS parser
};

export type CustomFeed = {
  title?: string;
  description?: string;
  link?: string;
  items: CustomItem[];
  [key: string]: any; // For additional fields from RSS parser
};

// JSON Feed types
export type JSONFeedItem = {
  id: string;
  url?: string;
  external_url?: string;
  title?: string;
  content_html?: string;
  content_text?: string;
  summary?: string;
  image?: string;
  banner_image?: string;
  date_published?: string;
  date_modified?: string;
  author?: {
    name?: string;
    url?: string;
    avatar?: string;
  };
  tags?: string[];
  language?: string;
  attachments?: Array<{
    url: string;
    mime_type: string;
    title?: string;
    size_in_bytes?: number;
    duration_in_seconds?: number;
  }>;
  [key: string]: any;
};

export type JSONFeed = {
  version: string;
  title: string;
  home_page_url?: string;
  feed_url?: string;
  description?: string;
  user_comment?: string;
  next_url?: string;
  icon?: string;
  favicon?: string;
  authors?: Array<{
    name?: string;
    url?: string;
    avatar?: string;
  }>;
  language?: string;
  expired?: boolean;
  items: JSONFeedItem[];
  [key: string]: any;
};
