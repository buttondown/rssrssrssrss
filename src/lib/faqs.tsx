import type { ReactNode } from "react";

type FAQ = {
  question: string;
  questionJsx?: ReactNode;
  answer: string;
  answerJsx: ReactNode;
};

export const FAQS: FAQ[] = [
  {
    question: "How do I use this?",
    answer:
      "Put the URLs of RSS feeds you want to combine in the box; browse the preview to make sure it's what you want; hit the button to get a permalink (that's a base-64 encoded URL of the feeds, so no real worry about bitrot).",
    answerJsx: (
      <>
        Put the URLs of RSS feeds you want to combine in the box above; idly (or
        passionately) browse the preview to make sure it's what you want; hit
        the button to get a permalink (that's a base-64 encoded URL of the
        feeds, so no real worry about bitrot).
      </>
    ),
  },
  {
    question: "Why would I want to do this?",
    answer:
      "Lots of things take RSS. Relatively few things do a great job of interleaving multiple RSS feeds. This is a simple tool to do that.",
    answerJsx: (
      <>
        Lots of things take RSS. Relatively few things do a great job of
        interleaving multiple RSS feeds. This is a simple tool to do that.
      </>
    ),
  },
  {
    question: "May I refer to it as rss4?",
    questionJsx: (
      <>
        May I refer to it as rss<sup>4</sup>?
      </>
    ),
    answer: "If you insist.",
    answerJsx: <>If you insist.</>,
  },
  {
    question: "What if I have a sitemap but not an RSS feed?",
    answer:
      "Check out Sitemap to RSS (https://www.sitemaptorss.com/), which does exactly what it says on the tin.",
    answerJsx: (
      <>
        Check out{" "}
        <a
          href="https://www.sitemaptorss.com/"
          className="text-blue-600 hover:text-blue-800"
        >
          Sitemap to RSS
        </a>
        , which does exactly what it says on the tin.
      </>
    ),
  },
  {
    question: "What about if it's a calendar, not a sitemap?",
    answer:
      "Check out caltorss (https://caltorss.com/), which can convert public calendars (iCal/ICS) into RSS feeds that this tool can then combine and remix.",
    answerJsx: (
      <>
        Check out{" "}
        <a
          href="https://caltorss.com/"
          className="text-blue-600 hover:text-blue-800"
        >
          caltorss
        </a>
        , which can convert public calendars (iCal/ICS) into RSS feeds that this
        tool can then combine and remix.
      </>
    ),
  },
  {
    question: "Who built this?",
    answer:
      "Your friends at Buttondown (https://buttondown.com), and they even made it open source (https://github.com/buttondown/rssrssrssrss).",
    answerJsx: (
      <>
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
      </>
    ),
  },
];

export const getFaqStructuredData = () => ({
  "@context": "https://schema.org",
  "@type": "FAQPage",
  mainEntity: FAQS.map((faq) => ({
    "@type": "Question",
    name: faq.question,
    acceptedAnswer: {
      "@type": "Answer",
      text: faq.answer,
    },
  })),
});
