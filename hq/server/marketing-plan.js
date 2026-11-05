// Mia's starting marketing plan for EKA Hosting. HQ shows it on the
// Marketing tab; ideas can be moved along (idea → doing → done) and Mia adds
// new ones each month and at the weekly meeting.

export const STRATEGIES = [
  {
    title: "Lead with the website builder",
    text: "Plain hosting is a crowded, price-driven market. Every post, ad and page should put the AI website builder first: \"Describe your business, get a finished website in minutes, hosting and email included.\" Hosting is the thing customers already need; the builder is why they choose EKA.",
  },
  {
    title: "Win local first",
    text: "Start in your own area. Offer 3–5 local businesses (café, trades, salon, gym) a done-for-you website at a founding discount in exchange for a testimonial, a case study and permission to show their site. Real local examples sell better than any ad.",
  },
  {
    title: "Show, don't tell: before-and-after content",
    text: "Short screen recordings of the builder making a site from one sentence are the most convincing thing you have. Post one a week (Reels, TikTok, YouTube Shorts, LinkedIn). Before/after makeovers of real local sites (with permission) work brilliantly.",
  },
  {
    title: "Google Business Profile and local SEO",
    text: "Set up EKA Hosting's Google Business Profile, ask every happy customer for a review, and publish one helpful blog post a week answering what small businesses search for (\"how much does a website cost UK\", \"best website builder for plumbers\"). The builder's local pages feature does the same for customers: mention it.",
  },
  {
    title: "Referral rewards",
    text: "Give customers a month free for every business they refer who signs up (and the new customer a month free too). Small businesses talk to each other; make it worth their while.",
  },
  {
    title: "Partnerships",
    text: "Accountants, bookkeepers, business coaches, print shops and local business networks (chambers of commerce, BNI) all meet new businesses before they have a website. Offer them a referral fee or a discount code for their clients.",
  },
  {
    title: "Sell to other hosts once you have proof",
    text: "Once about 20 happy sites run on EKA Builder, approach small UK hosting companies with the white-label builder: a free 14-day trial, founding-partner pricing and a demo. One host can bring hundreds of builder users.",
  },
  {
    title: "Honest pricing as a selling point",
    text: "\"The price you see is the price you renew at\", UK-based support and free site moves address the biggest complaints people have about big hosts. Say it everywhere.",
  },
];

const idea = (title, text, channel, effort) => ({ title, text, channel, effort });
export const IDEAS = [
  idea("Founding customers offer", "50% off the first year of Builder Business for the first 10 local businesses, in return for a review and a case study.", "Offer", "Low"),
  idea("\"Website in 60 seconds\" video", "Screen-record the builder making a site for a made-up café from one sentence. Post it everywhere, pin it to the profiles.", "Video", "Low"),
  idea("Free website check-up", "A simple offer: send us your website and we'll send a free 5-point check-up (speed, phone view, Google, contact details, security). Every reply is a warm lead.", "Lead magnet", "Medium"),
  idea("Local Facebook groups", "Join town and business Facebook groups; answer website questions helpfully (no hard selling). Mention the free check-up when it fits.", "Community", "Low"),
  idea("Trades bundle", "A package for trades (plumbers, electricians, builders): website with quote form, Google profile set-up and local pages for nearby towns.", "Offer", "Medium"),
  idea("Case study blog posts", "For each founding customer: the problem, the site we built, and results after a month (visitors, enquiries).", "Blog", "Medium"),
  idea("Google reviews drive", "After every finished site or solved ticket, ask for a Google review with a direct link. Aim for 25 reviews in 3 months.", "Reviews", "Low"),
  idea("Accountant partnership", "Contact 5 local accountants: their new business clients get Builder Starter free for 3 months; they get a referral fee.", "Partnership", "Medium"),
  idea("Seasonal pushes", "January (new year, new business), spring (tradespeople get busy), September (back to business). Plan a social campaign and an offer for each.", "Campaign", "Medium"),
  idea("Comparison page", "An honest \"EKA vs Wix vs Squarespace\" page: price, free email, UK support, no transaction fees. People search for these comparisons.", "Website", "Medium"),
  idea("Monthly email newsletter", "One useful tip, one customer site, one offer. Send to customers and enquiries every month.", "Email", "Low"),
  idea("LinkedIn for the host-company market", "Post weekly on LinkedIn about building the builder (behind the scenes, features). This is where hosting company owners will find you later.", "Social", "Low"),
];

// Four weeks of posts to get the profiles going (Mia writes more every Monday).
export const CALENDAR = [
  ["Mon", "Introduce EKA Hosting: who we are, what we do, why we started (UK-based, honest prices, AI website builder)."],
  ["Wed", "Video: the builder makes a website from one sentence in under a minute."],
  ["Fri", "Tip: 5 things every small business website needs (opening hours, phone number at the top, photos, reviews, a contact form)."],
  ["Mon", "Founding customers offer: 50% off the first year for 10 local businesses."],
  ["Wed", "Behind the scenes: how the AI designer chooses colours from your logo."],
  ["Fri", "Myth-busting: \"Websites cost thousands.\" They don't have to; here's what you get for £8 a month."],
  ["Mon", "Customer spotlight (first founding customer's new site, with permission)."],
  ["Wed", "Tip: why your website must work on phones (most visitors are on one)."],
  ["Fri", "Feature: online booking and enquiry forms included on every builder plan."],
  ["Mon", "Done-for-you websites: we build it, you approve it, from £299."],
  ["Wed", "Video: changing a site with words (\"make the buttons rounder\", \"add a gallery\")."],
  ["Fri", "Free website check-up offer: send us your link."],
].map(([day, text], i) => ({ week: Math.floor(i / 3) + 1, day, text }));

export const SOCIAL_SETUP = [
  "Facebook Page: EKA Hosting (category: Web hosting service). Add the logo, cover image, website link and a Book now / Contact button.",
  "Instagram business account linked to the Facebook Page (same name and logo). Bio: \"AI website builder + UK hosting. Your business online in minutes.\" with the website link.",
  "LinkedIn Company Page, plus post from your own profile; this is where hosting companies and partners are.",
  "Google Business Profile (most important for local customers): add services, prices, photos and ask for reviews.",
  "TikTok / YouTube Shorts: the same short builder videos as Instagram Reels.",
  "Use the same handle everywhere (e.g. @ekahosting) and the same profile picture.",
  "Aim for 3 posts a week to start; Mia drafts them every Monday in HQ for you to copy.",
];
