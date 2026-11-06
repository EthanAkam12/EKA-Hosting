// EKA Hosting's own website, built from the website builder's blocks so it
// can be edited in the builder like any other site. HQ's Settings tab adds it
// to the builder in one click (or: POST /api/host/hq/import).
//
// Prices are the EKA Hosting plan: per month on a yearly plan (monthly
// billing about 20% more). Change anything in the builder afterwards.

import { createEmptySite, createPage, createBlock as b, createSection, normalizeSite } from "./schema.js";

const sec = (props, columns, style) => ({ ...createSection(props, columns), ...(style ? { style } : {}) });
const H = (text, level = 2, align = "left", style) => ({ ...b("heading", { text, level, align }), ...(style ? { style } : {}) });
const T = (html, align = "left", style) => ({ ...b("text", { html: html.startsWith("<") ? html : `<p>${html}</p>`, align }), ...(style ? { style } : {}) });
const btns = (items, align = "left") => b("buttons", { align, items: items.map(([text, href, style = "primary", icon = "none"]) => ({ text, href, style, icon })) });
const card = (icon, title, text, extra = {}) => b("card", { icon: `i:${icon}`, title, text, style: "shadow", align: "left", ...extra });
const ticks = (items) => b("list", { items, icon: "check" });
const price = (name, amount, period, features, buttonText, href, featured = false) => b("pricing", { name, price: amount, period, features, buttonText, href, featured });
const eyebrow = (text, align = "left") => T(`<p><strong>${text.toUpperCase()}</strong></p>`, align, { color: "#14b8a6", letterSpacing: 2, fontSize: 13 });
const head = (kicker, title, intro, align = "center") => [eyebrow(kicker, align), H(title, 2, align), intro ? T(intro, align, { color: "#5b6475" }) : null].filter(Boolean);
const pageHero = (kicker, title, intro, buttons, image) => sec(
  { layout: image ? "1-1" : "1", background: "dark", padding: "xl", width: image ? "normal" : "narrow", align: image ? "left" : "center", valign: "center" },
  image
    ? [[eyebrow(kicker), H(title, 1, "left", { textEffect: "words-up" }), T(intro, "left", { color: "#c7cdf5" }), buttons ? btns(buttons) : null].filter(Boolean), [image]]
    : [[eyebrow(kicker, "center"), H(title, 1, "center", { textEffect: "words-up" }), T(intro, "center", { color: "#c7cdf5" }), buttons ? btns(buttons, "center") : null].filter(Boolean)],
  { bg: "#0b1020", bg2: "#312e81", bgAnimate: true, shapeBottom: "curve", shapeH: 50 },
);
const cta = (title, text, buttons) => sec({ background: "dark", padding: "xl", width: "narrow", align: "center" }, [[H(title, 2, "center"), T(text, "center", { color: "#c7cdf5" }), btns(buttons, "center")]], { bg: "#312e81", bg2: "#0f766e", bgAnimate: true, shapeTop: "waves", shapeH: 40 });
const shot = (src, alt) => b("image", { src, alt, ratio: "auto", rounded: true, frame: "shadow" });

// The plans (keep in step with WHMCS and the builder's plans).
const BUILDER_PLANS = [
  ["Builder Starter", "£8", "/month", ["1 website, designed by AI", "Booking & enquiry forms", "Free SSL and an email address", "Free domain connection help", "UK support"], false],
  ["Builder Business", "£15", "/month", ["Everything in Starter", "Online shop and blog", "Newsletter sign-ups and pop-ups", "More AI help each month", "5 email addresses", "Visitor statistics"], true],
  ["Builder Pro", "£24", "/month", ["3 websites", "The most AI help each month", "Brand kits and local area pages", "Priority support"], false],
];
const HOSTING_PLANS = [
  ["Starter", "£3.99", "/month", ["1 website", "10GB space", "Free SSL", "5 email addresses", "Daily backups"], false],
  ["Business", "£6.99", "/month", ["5 websites", "50GB space", "Unlimited email", "Daily backups", "Staging sites"], true],
  ["Pro", "£12.99", "/month", ["Unlimited websites", "100GB space", "Unlimited email", "Priority support"], false],
];
const DFY_PLANS = [
  ["Launch", "£299", " one-off", ["Up to 5 pages", "Your design, words and photos", "Domain connected", "Google listing set up", "Then Builder Business at £15/month"], false],
  ["Growth", "£599", " one-off", ["Up to 10 pages", "Online shop, blog or bookings", "Brand colours and brand kit", "3 local area pages", "1 round of changes", "Then Builder Business at £15/month"], true],
  ["Care plan", "+£25", "/month", ["Up to 30 minutes of changes a month", "A monthly check-up", "A monthly visitors report", "Add it to any website"], false],
];
const HOST_LICENCES = [
  ["Starter", "£29", "/month per server", ["Up to 100 customer accounts", "Your brand, not ours", "cPanel, DirectAdmin & WHMCS plugins", "14-day free trial"], false],
  ["Growth", "£59", "/month per server", ["Up to 500 customer accounts", "Everything in Starter", "Priority support"], true],
  ["Unlimited", "£99", "/month per server", ["Unlimited customer accounts", "Everything in Growth", "2 months free on yearly licences"], false],
];
const priceRow = (plans, href) => sec({ layout: "1-1-1", padding: "md", width: "normal" }, plans.map(([n, p, per, f, featured]) => [price(n, p, per, f, featured ? "Choose this plan" : "Get started", href, featured)]));
const BILLING_NOTE = "Prices are per month on a yearly plan; paying monthly costs about 20% more. The price you see is the price you renew at.";

export function ekaWebsite({ name = "EKA Hosting", images = {} } = {}) {
  const editor = images.editor || "", wizard = images.wizard || "";
  const site = createEmptySite(name);
  site.theme.colors = { primary: "#4f46e5", accent: "#14b8a6", background: "#ffffff", surface: "#f5f6ff", text: "#0f172a", muted: "#5b6475", dark: "#0b1020" };
  site.theme.fonts = { heading: "poppins", body: "inter" };
  site.theme.radius = 14;
  site.theme.buttons = { size: "md", shape: "pill", weight: 600, uppercase: false, hover: "lift", shadow: true };
  site.theme.type = { base: 17, headingScale: 108, headingWeight: 700 };
  site.theme.layout = { width: 1160, spacing: 105, motion: "fade-up" };
  site.header = { ...site.header, logoText: name, ctaText: "Get started", ctaHref: "/pricing", ctaStyle: "primary", sticky: true,
    links: [
      { text: "Website Builder", href: "/website-builder" },
      { text: "Web Hosting", href: "/web-hosting" },
      { text: "Web Design", href: "/web-design" },
      { text: "Done-for-you websites", href: "/web-design#done-for-you", sub: true },
      { text: "Get your website built", href: "/website-brief", sub: true },
      { text: "For hosting companies", href: "/web-design#for-hosts", sub: true },
      { text: "Pricing", href: "/pricing" },
      { text: "Blog", href: "/blog" },
      { text: "Contact", href: "/contact" },
    ] };
  site.announce = { show: true, text: "Founding offer: half price on your first year of Builder Business for our first 10 customers.", linkText: "See the plans", href: "/pricing", style: "dark", close: true };
  site.footer = { text: `© ${new Date().getFullYear()} ${name}. UK web hosting, an AI website builder and done-for-you websites.`, links: [{ text: "Website Builder", href: "/website-builder" }, { text: "Pricing", href: "/pricing" }, { text: "Contact", href: "/contact" }, { text: "Privacy", href: "/privacy" }] };
  site.business = { ...site.business, type: "Web hosting and website builder", keywords: "web hosting, website builder, small business websites UK" };

  const page = (title, slug, description, sections) => { const p = slug === "index" ? createPage("Home", "index") : createPage(title, slug); p.seo = { title: slug === "index" ? `${name}: AI website builder and UK web hosting` : `${title} | ${name}`, description }; p.sections = sections; return p; };

  const home = page("Home", "index", "Describe your business and EKA's AI website builder makes the whole site in minutes, on fast hosting with free email. UK support, honest prices, from £8 a month.", [
    sec({ layout: "1-1", background: "dark", padding: "xl", width: "normal", valign: "center", minHeight: true }, [[
      eyebrow("AI website builder + UK web hosting"),
      H("Your business online in minutes, not months", 1, "left", { textEffect: "words-up" }),
      T("Describe your business in a sentence. Our AI website builder designs the whole site: the pages, the words, the photos, even booking and enquiry forms. Then change anything by clicking it, or just by saying what you want.", "left", { color: "#c7cdf5", fontSize: 19 }),
      btns([["Start from £8 a month", "/pricing", "primary", "i:arrow-right"], ["See the builder", "/website-builder", "light"]]),
      T("<p>✓ No tech skills needed &nbsp; ✓ Free email & SSL &nbsp; ✓ UK support</p>", "left", { color: "#a5b4fc", fontSize: 14 }),
    ], [editor ? shot(editor, "The EKA website builder editing a website") : b("image", { alt: "A website being designed in the EKA website builder", ratio: "4:3", frame: "shadow" })]], { bg: "#0b1020", bg2: "#312e81", bgAnimate: true, shapeBottom: "curve", shapeH: 60 }),
    sec({ padding: "sm", width: "full" }, [[b("marquee", { items: ["AI website builder", "Free email", "Booking & enquiry forms", "Online shop", "Free SSL", "UK support", "Free website moves", "No transaction fees", "Done-for-you websites"].map((text) => ({ text, image: "" })), speed: 40, size: "md", separator: "✦" })]]),
    sec({ layout: "1", padding: "lg", align: "center", width: "narrow" }, [head("Everything you need", "One company for your website, hosting and email", "Build it yourself with AI, let us build it for you, or bring the website you already have.")]),
    sec({ layout: "1-1-1", padding: "md" }, [
      [card("sparkles", "AI website builder", "Tell it about your business and get a complete, professional website in about a minute. Edit by clicking, or by typing what you want changed.", { linkText: "Explore the builder", href: "/website-builder" })],
      [card("server", "Web hosting", "Fast, secure hosting with free SSL, email addresses and daily backups, for any website. We'll even move your current site for free.", { linkText: "Hosting plans", href: "/web-hosting" })],
      [card("paintbrush", "Done-for-you websites", "Too busy? We build your website for you, from £299. You approve it before it goes live, and you can still change it yourself afterwards.", { linkText: "Web design", href: "/web-design" })],
    ]),
    sec({ layout: "1", padding: "lg", align: "center", width: "narrow", background: "surface" }, [head("How it works", "From idea to live website in three steps")], { shapeTop: "slant", shapeH: 40 }),
    sec({ layout: "1-1-1", padding: "md", background: "surface" }, [
      [card("message-square", "1. Describe your business", "What you do, where, and who for. Add your logo and photos if you have them; the builder picks colours from your logo.", { style: "plain" })],
      [card("zap", "2. The AI designs it", "Watch your home page appear, choose the look you like, then the builder writes every page, with photos that suit your business.", { style: "plain" })],
      [card("rocket", "3. Change anything, then publish", "Click any words or pictures to change them, drag sections around, or type \"make the buttons rounder\". Publish when you're happy.", { style: "plain" })],
    ]),
    sec({ layout: "1-1", padding: "xl", valign: "center", width: "normal" }, [[wizard ? shot(wizard, "Describing a business to the EKA AI website builder") : b("image", { alt: "Describing a business to the AI website builder", ratio: "4:3", frame: "shadow" })], [
      eyebrow("The builder"), H("A website builder that does the hard part for you", 2),
      T("Most builders give you a blank page and a hundred buttons. EKA gives you a finished website for your business, and makes changing it as easy as asking."),
      ticks(["Change it with words: \"add a gallery\", \"make it feel more luxurious\"", "100+ ready-made sections and 10 complete designs", "Booking, enquiry and contact forms on every plan", "Online shop and blog, no transaction fees from us", "Looks great on phones, fast to load, ready for Google"]),
      btns([["See everything it does", "/website-builder", "outline"]]),
    ]]),
    sec({ layout: "1", padding: "lg", background: "dark", align: "center" }, [[b("stats", { items: [{ value: "60s", label: "to your first design" }, { value: "£8", label: "a month, hosting included" }, { value: "0%", label: "transaction fees from us" }, { value: "100+", label: "ready-made sections" }] })]], { bg: "#0b1020", bg2: "#1e1b4b" }),
    sec({ layout: "1", padding: "lg", align: "center", width: "narrow" }, [head("Why EKA", "Small business websites, done honestly")]),
    sec({ layout: "1-1-1-1", padding: "md" }, [
      [card("badge-check", "Honest prices", "The price you see is the price you renew at. No big jump after the first year.")],
      [card("mail", "Free email", "Professional email addresses on your own domain, included in every plan.")],
      [card("users", "UK support", "Real people who explain things in plain English, not a script.")],
      [card("truck", "Free website moves", "Already have a website? We'll move it to EKA for you, free.")],
    ]),
    sec({ layout: "1", padding: "lg", align: "center", width: "narrow", background: "surface" }, [head("Website builder plans", "Hosting, email and the AI builder in one price", BILLING_NOTE)]),
    { ...priceRow(BUILDER_PLANS, "/contact"), props: { ...priceRow(BUILDER_PLANS, "/contact").props, background: "surface" } },
    sec({ layout: "1", padding: "md", align: "center", background: "surface" }, [[btns([["Compare all plans and prices", "/pricing", "outline"]], "center")]]),
    sec({ layout: "1-2", padding: "xl", width: "normal" }, [[eyebrow("Questions"), H("Good questions, straight answers", 2), T("Can't see yours? Ask us anything.", "left", { color: "#5b6475" }), btns([["Contact us", "/contact", "outline"]])], [b("faq", { items: [
      { q: "Do I need any technical skills?", a: "No. If you can describe your business and use a phone, you can make a website with EKA. And if you'd rather not, we'll build it for you." },
      { q: "Is the AI-written website really mine to change?", a: "Completely. Every word, photo, colour and section can be changed by clicking it, dragging it, or typing what you want." },
      { q: "Can I use my own domain name?", a: "Yes. Use one you already own (the builder shows you exactly what to change, and checks it for you) or register a new one with us." },
      { q: "What about email?", a: "Every plan includes email addresses on your domain, which you can use on your phone, in Outlook or in webmail." },
      { q: "Can I take bookings or sell online?", a: "Yes. Booking and enquiry forms come with every builder plan, and Builder Business adds an online shop and a blog." },
      { q: "Do you charge VAT?", a: "Our prices are shown as you pay them. We'll always say clearly if that changes." },
    ] })]]),
    cta("Ready to get your business online?", "Start with the AI builder today, or tell us about your business and we'll build it for you.", [["Choose a plan", "/pricing", "light"], ["Talk to us", "/contact", "outline"]]),
  ]);

  const builder = page("Website Builder", "website-builder", "EKA's AI website builder designs your whole website from a short description, then lets you change anything by clicking or by asking. From £8 a month with hosting and email.", [
    pageHero("The EKA website builder", "Describe your business. Get a website.", "Our AI designs every page, writes the words, picks photos that suit your business and adds the forms you need. Then it's yours to change, as easily as asking.", [["Start building", "/pricing", "primary", "i:arrow-right"], ["Have us build it", "/web-design", "light"]], editor ? shot(editor, "The EKA website builder") : null),
    sec({ layout: "1", padding: "lg", align: "center", width: "narrow" }, [head("What it does", "Everything a small business website needs")]),
    sec({ layout: "1-1-1", padding: "md" }, [
      [card("sparkles", "AI that designs, not templates", "Answer a few questions and see your home page designed in about a minute. Don't like it? Ask for another, or say what you'd change.")],
      [card("message-circle", "Change it with words", "\"Make the buttons rounder.\" \"Add our opening hours.\" \"Make it feel more luxurious.\" The builder does it, and you can undo anything.")],
      [card("pencil-ruler", "Click to edit, drag to move", "Edit words and photos right on the page. Drag sections into place. Every change is saved, with full history.")],
      [card("calendar-check", "Bookings and enquiries", "Booking requests, quote forms and contact forms on every plan, emailed to you and kept safe in the builder.")],
      [card("shopping-bag", "Online shop and blog", "Sell products and keep a blog on Builder Business and Pro. No transaction fees from us; payments go straight to you.")],
      [card("chart-line", "Visitor statistics", "See how many people visit, which pages they read and where they came from, without annoying cookie banners.")],
      [card("search", "Ready for Google", "Fast pages, your business details for Google, a sitemap and AI help writing page descriptions.")],
      [card("sparkle", "Style kits and your brand", "Change the whole look in one click, take colours from your logo, and save a brand kit for every new site.")],
      [card("smartphone", "Perfect on phones", "Every design works beautifully on phones and tablets, with a call or WhatsApp button for your customers.")],
    ]),
    sec({ layout: "1-1", padding: "xl", background: "surface", valign: "center", width: "normal" }, [[eyebrow("Made for small businesses"), H("Built for the way you work", 2), T("Cafés and restaurants, tradespeople, salons, gyms and coaches, shops, B&Bs, photographers, consultants and community groups: there's a complete design for each, with the sections they need."), ticks(["Menus and opening hours", "Quote forms and before/after photos", "Treatments, prices and booking", "Class timetables and sign-ups", "Galleries, reviews and maps"])], [wizard ? shot(wizard, "Choosing a design in the EKA builder") : b("image", { alt: "Choosing a design in the builder", ratio: "4:3", frame: "shadow" })]]),
    sec({ layout: "1", padding: "lg", align: "center", width: "narrow" }, [head("Plans", "Hosting, email and the builder in one price", BILLING_NOTE)]),
    priceRow(BUILDER_PLANS, "/contact"),
    cta("See it make your website", "It takes a minute to describe your business, and the first design appears straight away.", [["Get started", "/pricing", "light"], ["Ask a question", "/contact", "outline"]]),
  ]);

  const hosting = page("Web Hosting", "web-hosting", "Fast, secure UK-supported web hosting with free SSL, email and daily backups. Free website moves. From £3.99 a month, and the price you see is the price you renew at.", [
    pageHero("Web hosting", "Fast, friendly hosting for any website", "Free SSL, professional email, daily backups and UK support that explains things in plain English. We'll move your existing website for free.", [["See hosting plans", "#plans", "primary"], ["Move my website", "/contact", "light"]]),
    sec({ layout: "1", padding: "lg", align: "center", width: "narrow", anchor: "plans" }, [head("Hosting plans", "Pick the space you need", BILLING_NOTE)]),
    priceRow(HOSTING_PLANS, "/contact"),
    sec({ layout: "1-1-1-1", padding: "lg", background: "surface" }, [
      [card("shield-check", "Free SSL", "The padlock, set up automatically for every domain.")],
      [card("mail", "Email included", "Addresses on your domain, on your phone or in webmail.")],
      [card("database", "Daily backups", "Every day, kept safe, restored on request.")],
      [card("settings", "cPanel", "The control panel most hosting professionals know.")],
    ]),
    sec({ layout: "1-1", padding: "xl", valign: "center" }, [[eyebrow("Want a new website too?"), H("Add the AI website builder any time", 2), T("Hosting customers can switch to a builder plan whenever they like, and get a brand-new website designed for them in minutes."), btns([["Explore the builder", "/website-builder", "outline"]])], [b("faq", { items: [
      { q: "Can you move my current website?", a: "Yes, for free. Send us your old host's details (or a backup) and we'll do the rest, usually within a day." },
      { q: "Will my email stop working while you move it?", a: "No. We set everything up first and only switch over when it's ready." },
      { q: "Can I upgrade later?", a: "Any time, from your client area. You only pay the difference." },
    ] })]]),
    cta("Happy with your website, unhappy with your host?", "Move to EKA for free, and keep the same price every year.", [["Move my website", "/contact", "light"]]),
  ]);

  const design = page("Web Design", "web-design", "Done-for-you small business websites from £299, built with our AI website builder and finished by a person. Plus the EKA website builder for hosting companies.", [
    pageHero("Web design", "We'll build it for you", "Done-for-you websites for small businesses, and our website builder for hosting companies who want to offer it under their own name.", [["Get your website built", "/website-brief", "primary"], ["For hosting companies", "#for-hosts", "light"]]),
    sec({ layout: "1", padding: "lg", align: "center", width: "narrow", anchor: "done-for-you" }, [head("Done-for-you websites", "A professional website, without lifting a finger", "We use our AI website builder to do the groundwork, then a person finishes it to a high standard. Freelancers often charge £1,500 or more for this.")]),
    sec({ layout: "1", padding: "md", width: "narrow" }, [[b("timeline", { items: [
      { date: "Day 1", title: "Tell us about your business", text: "A short form or a 15-minute call: what you do, who for, and any words, photos or logo you have." },
      { date: "Days 2–4", title: "We build it", text: "Your website is designed, written and filled with photos that suit you, with forms, maps and everything you need." },
      { date: "Day 5", title: "You check it", text: "You get a link to the finished website. Click anything to leave a comment, or press Approve." },
      { date: "Go live", title: "We publish it", text: "We connect your domain and set up your Google listing. You can still change anything yourself afterwards." },
    ] })]]),
    priceRow(DFY_PLANS, "/website-brief"),
    sec({ layout: "1", padding: "md", width: "narrow", align: "center" }, [[b("offer", { badge: "Nothing to pay upfront", title: "£0 setup on a 12-month plan at £39 a month", text: "The Launch website and Builder Business hosting together, spread over the year.", buttonText: "Ask about it", href: "/contact", countdown: false, style: "primary", align: "center" })]]),
    sec({ layout: "1", padding: "xl", align: "center", width: "narrow", background: "dark", anchor: "for-hosts" }, [[eyebrow("For hosting companies", "center"), H("Offer an AI website builder under your own name", 2, "center"), T("Give your customers the EKA website builder with your brand on it. It plugs into cPanel, DirectAdmin and WHMCS, customers sign in with one click, and you set the plans.", "center", { color: "#c7cdf5" })]], { bg: "#0b1020", bg2: "#134e4a", shapeTop: "curve", shapeH: 50 }),
    sec({ layout: "1-1-1", padding: "lg", background: "surface" }, [
      [card("plug", "Plugs into your panel", "cPanel, DirectAdmin and WHMCS plugins: sign-in links, automatic accounts, suspensions and plan changes.")],
      [card("coins", "Your prices, your profit", "Set your own plans, websites and AI allowances. A billing report shows each customer's use.")],
      [card("key", "Your own AI key", "Use your own Anthropic AI key, so the AI costs are yours and fully under your control.")],
    ]),
    { ...priceRow(HOST_LICENCES, "/contact"), props: { ...priceRow(HOST_LICENCES, "/contact").props, background: "surface" } },
    sec({ layout: "1", padding: "md", align: "center", background: "surface" }, [[T("<p><strong>Founding partners:</strong> 50% off for life for our first 5 hosting companies, in return for feedback and a testimonial. Every licence starts with a 14-day free trial.</p>", "center"), btns([["Start a free trial", "/contact", "primary"]], "center")]]),
    cta("Not sure which is right for you?", "Tell us what you need and we'll recommend the simplest option, with no hard sell.", [["Talk to us", "/contact", "light"]]),
  ]);

  const pricing = page("Pricing", "pricing", "EKA Hosting prices: AI website builder plans from £8 a month, web hosting from £3.99, done-for-you websites from £299 and builder licences for hosting companies.", [
    pageHero("Pricing", "Simple prices, no surprises", `${BILLING_NOTE} Every plan includes free SSL, email and UK support.`, null),
    sec({ layout: "1", padding: "lg", align: "center", width: "narrow" }, [head("Most popular", "Hosting + AI website builder", "Your website designed by AI, hosting and email together.")]),
    priceRow(BUILDER_PLANS, "/contact"),
    sec({ layout: "1", padding: "lg", align: "center", width: "narrow", background: "surface" }, [head("Already have a website?", "Web hosting")]),
    { ...priceRow(HOSTING_PLANS, "/contact"), props: { ...priceRow(HOSTING_PLANS, "/contact").props, background: "surface" } },
    sec({ layout: "1", padding: "lg", align: "center", width: "narrow" }, [head("We build it for you", "Done-for-you websites", "Then Builder Business hosting at £15 a month. Or £0 upfront on a 12-month plan at £39 a month.")]),
    priceRow(DFY_PLANS, "/contact"),
    sec({ layout: "1", padding: "lg", align: "center", width: "narrow", background: "surface" }, [head("For hosting companies", "EKA website builder licences", "Your brand, your plans, your AI key. 14-day free trial; 2 months free on yearly licences.")]),
    { ...priceRow(HOST_LICENCES, "/contact"), props: { ...priceRow(HOST_LICENCES, "/contact").props, background: "surface" } },
    sec({ layout: "1-1", padding: "xl", width: "normal" }, [[eyebrow("Add-ons"), H("Extras when you need them", 2), b("list", { items: ["Domain names: .co.uk £9.99 a year, .com £13.99 a year", "Extra AI help: £5 for a top-up", "An extra website on a builder plan: £4 a month", "A professional logo: £49", "Moving your website to us: free"], icon: "symbol", symbol: "i:plus" })], [b("faq", { items: [
      { q: "Why are prices shown per month on a yearly plan?", a: "It's the best value. You can pay monthly instead, for about 20% more." },
      { q: "Do prices go up when I renew?", a: "No. The price you see is the price you renew at." },
      { q: "Do you take a cut of my shop sales?", a: "No. Payments go straight to your Stripe or PayPal account." },
      { q: "Do you charge VAT?", a: "Our prices are shown as you pay them. We'll always say clearly if that changes." },
      { q: "Can I change plan later?", a: "Yes, up or down, any time from your client area." },
    ] })]]),
    cta("Questions about which plan?", "Tell us about your business and we'll point you to the right one.", [["Ask us", "/contact", "light"]]),
  ]);

  const blog = page("Blog", "blog", "Practical website, hosting and marketing tips for UK small businesses from EKA Hosting.", [
    pageHero("The EKA blog", "Tips for small business websites", "Plain-English advice on getting found online, winning customers and making the most of your website.", null),
    sec({ layout: "1", padding: "lg" }, [[b("posts", { count: 12, columns: 3, showImage: true, showDate: true, showExcerpt: true, buttonText: "Read more" })]]),
  ]);

  const post = createPage("How much does a small business website cost in the UK?", "small-business-website-cost-uk");
  post.post = { date: new Date().toISOString().slice(0, 10), excerpt: "From free builders to £3,000 agency projects: what you actually get for your money, and how to choose.", cover: "", coverPhoto: "small business owner working on a laptop in a cafe", author: name, draft: false };
  post.seo = { title: "How much does a small business website cost in the UK? | EKA Hosting", description: "What a small business website really costs in the UK: DIY builders, freelancers, agencies and AI website builders compared, with the running costs people forget." };
  post.sections = [sec({ layout: "1", padding: "md", width: "narrow" }, [[
    T("<p>If you run a small business, you've probably wondered whether a website is worth the money, and how much \"the money\" actually is. The honest answer: anything from a few pounds a month to several thousand pounds. Here's what you get at each level.</p>"),
    H("1. Do it yourself with a website builder: £8–£30 a month", 2),
    T("<p>Builders like Wix, Squarespace and EKA let you make a website without code. You pay monthly, and hosting is included. The catch with most builders is time: you start with a template and a lot of buttons, and it can take days to make it look right.</p><p>AI website builders change that. With EKA you describe your business and the builder designs the whole site, words and photos included, in about a minute. You then change anything by clicking it or by asking.</p>"),
    H("2. A freelancer: £500–£2,000", 2),
    T("<p>A good freelance designer will build something tailored to you. Ask what happens after launch: who hosts it, who makes changes, and what that costs. Many small businesses end up paying for every small edit.</p>"),
    H("3. An agency: £2,000–£10,000+", 2),
    T("<p>Agencies are worth it for complex projects: online shops with thousands of products, custom systems, or big marketing campaigns. For a typical local business, it's usually more than you need.</p>"),
    H("The running costs people forget", 2),
    b("list", { items: ["A domain name: around £10 a year", "Hosting: £4–£15 a month if it's not included", "Email addresses on your domain: often £5 a month per person elsewhere", "Changes and updates: free if you can do them yourself, £40–£80 an hour if not"], icon: "check" }),
    H("So what should you choose?", 2),
    T("<p>For most small businesses, the best value is a builder you can manage yourself, with hosting and email included, and someone to help if you get stuck. If you'd rather not do it yourself at all, a done-for-you website built on a builder gives you a professional result for a few hundred pounds, and you can still change it later.</p><p>That's exactly what we offer at EKA: the AI website builder from £8 a month, or done-for-you websites from £299. <a href=\"/pricing\">See our prices</a>.</p>"),
    btns([["See the plans", "/pricing"], ["Talk to us", "/contact", "outline"]]),
  ]])];

  const contact = page("Contact", "contact", "Contact EKA Hosting about websites, hosting or the website builder. We reply within one working day.", [
    pageHero("Contact", "Let's talk about your website", "Questions, quotes, free website moves or a demo of the builder: send us a message and a real person will reply within one working day.", null),
    sec({ layout: "2-1", padding: "xl", width: "normal" }, [[H("Send us a message", 2), b("form", { kind: "enquiry", fields: [
      { label: "Your name", type: "text", required: true, options: "" },
      { label: "Email", type: "email", required: true, options: "" },
      { label: "Phone", type: "tel", required: false, options: "" },
      { label: "Your business", type: "text", required: false, options: "" },
      { label: "What are you interested in?", type: "select", required: true, options: "The AI website builder, A done-for-you website, Web hosting, Moving my website, The builder for my hosting company, Something else" },
      { label: "How can we help?", type: "textarea", required: true, options: "" },
      { label: "I'm happy to be contacted about my enquiry", type: "checkbox", required: true, options: "" },
    ], submitText: "Send message", successMessage: "Thanks! We'll get back to you within one working day.", confirmEmail: true })], [
      card("message-circle", "Already a customer?", "Open a support ticket in your client area and we'll get straight on it.", { style: "surface" }),
      card("truck", "Moving your website?", "Choose \"Moving my website\" and tell us who your current host is. We'll do the rest, free.", { style: "surface" }),
      card("building-2", "Hosting companies", "Ask for a demo and a 14-day free trial of the white-label website builder.", { style: "surface" }),
    ]]),
  ]);

  const brief = page("Get your website built", "website-brief", "Tell us about your business and we'll build your website for you, ready for you to check within days.", [
    pageHero("Done-for-you websites", "Tell us about your business", "Fill this in and we'll start building your website straight away. The more you tell us, the more of it will be your own words; you'll get a link to check it before anything goes live.", null),
    sec({ layout: "2-1", padding: "xl", width: "normal" }, [[b("form", { kind: "enquiry", fields: [
      { label: "Business name", type: "text", required: true, options: "" },
      { label: "What does your business do?", type: "textarea", required: true, options: "" },
      { label: "Your services (one per line, e.g. Boiler repairs - Same-day fixes)", type: "textarea", required: false, options: "" },
      { label: "Areas you cover", type: "text", required: false, options: "" },
      { label: "Opening hours", type: "textarea", required: false, options: "" },
      { label: "Prices (optional, one per line, e.g. Boiler service - £80)", type: "textarea", required: false, options: "" },
      { label: "Customer reviews (optional, one per line: the review - their name)", type: "textarea", required: false, options: "" },
      { label: "Why do customers choose you? (optional, one per line)", type: "textarea", required: false, options: "" },
      { label: "Phone", type: "tel", required: false, options: "" },
      { label: "Email", type: "email", required: true, options: "" },
      { label: "Address", type: "text", required: false, options: "" },
      { label: "Facebook or Instagram links (optional)", type: "text", required: false, options: "" },
      { label: "Which style do you like?", type: "select", required: false, options: "Modern, Elegant, Bold, Minimal, Playful, Luxury, Natural, Warm & friendly, Corporate, Fresh" },
      { label: "I'm happy to be contacted about my website", type: "checkbox", required: true, options: "" },
    ], submitText: "Build my website", successMessage: "Thank you! We've started on your website and will email you a link to check it.", confirmEmail: true })], [
      card("clock", "What happens next", "We start building straight away. You'll get an email with a link to your new website to check, usually within a few days.", { style: "surface" }),
      card("image", "Photos and logo", "Got a logo or photos? Reply to our email with them and we'll add them.", { style: "surface" }),
      card("tag", "Prices", "Done-for-you websites start at £299 (Launch) or £599 (Growth). We'll confirm which one suits you.", { style: "surface", linkText: "See the packages", href: "/web-design#done-for-you" }),
    ]]),
  ]);

  site.pages = [home, builder, hosting, design, pricing, blog, contact, brief, post];
  // Section titles sit close to the cards or prices under them.
  for (const p of site.pages) p.sections.forEach((sct, i) => {
    const blocks = sct.columns.length === 1 ? sct.columns[0].blocks : [];
    const titled = blocks[0]?.style?.letterSpacing === 2 && blocks.some((x) => x.type === "heading") && blocks.length <= 3;
    const next = p.sections[i + 1];
    if (titled && next && next.props.background === sct.props.background && !sct.style?.shapeBottom) {
      sct.style = { ...(sct.style || {}), padding: { d: { b: 8 }, t: { b: 8 }, m: { b: 8 } } };
      next.style = { ...(next.style || {}), padding: { d: { t: 24 }, t: { t: 20 }, m: { t: 16 } } };
    }
  });
  return normalizeSite(site);
}
