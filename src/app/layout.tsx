import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  metadataBase: new URL('https://rssrssrssrss.com'),
  title: "rssrssrss - Combine Multiple RSS Feeds into One",
  description: "Free tool to merge and combine multiple RSS feeds into a single unified feed. Perfect for news aggregation, blog following, and content curation.",
  keywords: ["RSS", "feed", "merge", "combine", "aggregator", "news", "blog", "content", "curation"],
  authors: [{ name: "rssrssrss" }],
  creator: "rssrssrss",
  publisher: "rssrssrss",
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      'max-video-preview': -1,
      'max-image-preview': 'large',
      'max-snippet': -1,
    },
  },
  openGraph: {
    type: 'website',
    locale: 'en_US',
    url: 'https://rssrssrssrss.com/',
    siteName: 'rssrssrss',
    title: 'rssrssrss - Combine Multiple RSS Feeds into One',
    description: 'Free tool to merge and combine multiple RSS feeds into a single unified feed. Perfect for news aggregation, blog following, and content curation.',
    images: [
      {
        url: '/og-image.png',
        width: 1200,
        height: 630,
        alt: 'rssrssrss - RSS Feed Merger Tool',
      },
    ],
  },
  twitter: {
    card: 'summary_large_image',
    site: '@rssrssrss',
    creator: '@rssrssrss',
    title: 'rssrssrss - Combine Multiple RSS Feeds into One',
    description: 'Free tool to merge and combine multiple RSS feeds into a single unified feed. Perfect for news aggregation, blog following, and content curation.',
    images: ['/og-image.png'],
  },
  alternates: {
    canonical: 'https://rssrssrssrss.com/',
  },
  category: 'Technology',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const structuredData = {
    "@context": "https://schema.org",
    "@type": "WebApplication",
    "name": "rssrssrss",
    "url": "https://rssrssrssrss.com/",
    "description": "Free tool to merge and combine multiple RSS feeds into a single unified feed. Perfect for news aggregation, blog following, and content curation.",
    "applicationCategory": "WebApplication",
    "operatingSystem": "Web Browser",
    "offers": {
      "@type": "Offer",
      "price": "0",
      "priceCurrency": "USD"
    },
    "featureList": [
      "Combine multiple RSS feeds",
      "Real-time preview",
      "Compressed URL generation",
      "Load existing merged feeds"
    ]
  };

  return (
    <html lang="en">
      <head>
        <link rel="manifest" href="/manifest.json" />
        <meta name="theme-color" content="#3b82f6" />
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{
            __html: JSON.stringify(structuredData),
          }}
        />
      </head>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        {children}
      </body>
    </html>
  );
}
