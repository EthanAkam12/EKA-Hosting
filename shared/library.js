// The section library: ready-made sections, in categories, for the editor's
// "Section library". They use the site's theme (colours, fonts, corners), so
// they match wherever they're dropped; "Fill with AI" then writes the text
// for the business and finds photos.
//
// Each entry: { id, cat, name, make() → section or [sections] }.

import { createBlock as b, createSection as s, FORM_PRESETS } from "./schema.js";

export const LIBRARY_CATEGORIES = [
  ["hero", "Heroes"], ["services", "Services & features"], ["about", "About"], ["team", "Team"],
  ["reviews", "Reviews"], ["pricing", "Pricing"], ["faq", "Questions"], ["gallery", "Gallery & video"],
  ["cta", "Calls to action"], ["contact", "Contact"], ["booking", "Bookings & enquiries"], ["numbers", "Numbers & logos"],
  ["process", "Process & history"], ["food", "Menus & hours"], ["shop", "Shop"], ["blog", "Blog"], ["offers", "Offers & newsletter"],
];

const t = (html, align = "left") => b("text", { html: `<p>${html}</p>`, align });
const h = (text, level = 2, align = "left") => b("heading", { text, level, align });
const btns = (items, align = "left") => b("buttons", { align, items: items.map(([text, style = "primary", href = "#contact", icon = "none"]) => ({ text, href, style, icon })) });
const card = (icon, title, text, extra = {}) => b("card", { icon, title, text, ...extra });
const quote = (q, name, role = "", rating = 5) => b("testimonial", { quote: q, name, role, rating });
const photo = (alt, ratio = "4:3") => b("image", { alt, ratio });
const tint = (dark = true, extra = {}) => ({ tint: dark ? "#0f172a" : "#ffffff", tintOpacity: dark ? 55 : 70, ...extra });

const SERVICES = [["⚡", "Fast & reliable", "We turn up when we say we will and get the job done properly."], ["★", "Quality first", "Experienced people, great materials and real attention to detail."], ["✓", "Fair pricing", "Clear prices up front, with no hidden extras."], ["☎", "Friendly advice", "Not sure what you need? We'll talk it through."], ["🛡", "Fully insured", "Peace of mind on every job, big or small."], ["♻", "Tidy & careful", "We treat your place like our own and clean up after."]];
const REVIEWS = [["Fantastic service from start to finish. Highly recommended!", "Sarah J.", "Local customer"], ["Friendly, professional and great value. We'll be back.", "Mark T.", "Regular customer"], ["They went above and beyond. Couldn't be happier.", "Priya K.", "First-time customer"]];
const FAQS = () => [{ q: "What areas do you cover?", a: "We cover the town and the surrounding villages." }, { q: "How do I book?", a: "Use the form on this page or give us a call." }, { q: "Do you offer free quotes?", a: "Yes, always, with no obligation." }, { q: "How soon can you start?", a: "Usually within a week; sooner for urgent jobs." }];
const plans = (featured = 1) => [["Basic", "£29", ["The essentials", "Email support"]], ["Standard", "£49", ["Everything in Basic", "Priority booking", "Free check-up"]], ["Premium", "£99", ["Everything in Standard", "Same-day service", "Dedicated contact"]]].map(([name, price, features], i) => [b("pricing", { name, price, period: "/month", features, buttonText: "Choose " + name, href: "#contact", featured: i === featured })]);

export const SECTION_LIBRARY = [
  // ---- heroes ---------------------------------------------------------------
  { id: "hero-dark", cat: "hero", name: "Bold, centred", make: () => s({ background: "dark", padding: "xl", minHeight: true, width: "narrow", align: "center", valign: "center" }, [[h("A bold headline that says what you do", 1, "center"), t("One or two sentences on why customers should choose you.", "center"), btns([["Get started"], ["Learn more", "outline", "#services"]], "center")]]) },
  { id: "hero-photo", cat: "hero", name: "Full photo with tint", make: () => ({ ...s({ background: "image", padding: "xl", minHeight: true, width: "narrow", align: "center", valign: "center" }, [[h("Welcome to something special", 1, "center"), t("A short line that makes visitors want to find out more.", "center"), btns([["Book now"], ["See our work", "light", "#gallery"]], "center")]]), style: { bgPhoto: "welcoming business interior", tint: "#0f172a", tint2: "#2563eb", tintDir: "diagonal", tintOpacity: 62, bgEffect: "zoom" } }) },
  { id: "hero-photo-left", cat: "hero", name: "Photo, text on the left", make: () => ({ ...s({ background: "image", padding: "xl", minHeight: true, valign: "center" }, [[{ ...h("Local experts you can trust", 1), style: { maxWidth: 620 } }, { ...t("Quality work, friendly people and fair prices since 2010."), style: { maxWidth: 520 } }, btns([["Get a free quote"]])]]), style: { bgPhoto: "professional at work", tint: "#0f172a", tint2: "#0f172a", tintDir: "right", tintOpacity: 70, bgPos: "right" } }) },
  { id: "hero-split", cat: "hero", name: "Text + picture", make: () => s({ layout: "1-1", padding: "xl", valign: "center" }, [[h("Your headline goes here", 1), t("Explain the main benefit in a sentence or two."), btns([["Book now"], ["Call us", "outline", "tel:", "phone"]])], [photo("the business at its best", "4:3")]]) },
  { id: "hero-split-r", cat: "hero", name: "Picture + text", make: () => s({ layout: "1-1", padding: "xl", valign: "center", background: "surface" }, [[photo("happy customer", "1:1")], [b("text", { html: "<p><strong>NEW IN TOWN</strong></p>" }), h("Something worth talking about", 1), t("A friendly introduction to what you offer."), btns([["Find out more"]])]]) },
  { id: "hero-primary", cat: "hero", name: "On brand colour", make: () => s({ background: "primary", padding: "xl", width: "narrow", align: "center" }, [[h("Make it happen with us", 1, "center"), t("Straightforward, reliable and on your side.", "center"), btns([["Get in touch", "light"]], "center")]]) },
  { id: "hero-minimal", cat: "hero", name: "Minimal, editorial", make: () => s({ padding: "xl", width: "narrow" }, [[b("text", { html: "<p><strong>Est. 2015 · Family run</strong></p>" }), h("Simple, honest and beautifully done.", 1), t("We keep things simple so you don't have to worry."), btns([["Say hello", "outline"]])]]) },
  { id: "hero-gradient", cat: "hero", name: "Moving gradient", make: () => ({ ...s({ padding: "xl", minHeight: true, width: "narrow", align: "center", valign: "center" }, [[{ ...h("Bright ideas, beautifully delivered", 1, "center"), style: { textEffect: "words-up" } }, t("A fresh approach to an everyday need.", "center"), btns([["Start today", "light"]], "center")]]), style: { bg: "#2563eb", bg2: "#7c3aed", bgAnimate: true, color: "#ffffff" } }) },
  { id: "hero-stats", cat: "hero", name: "Headline + numbers", make: () => [s({ background: "dark", padding: "xl", width: "narrow", align: "center" }, [[h("Trusted by hundreds of local customers", 1, "center"), btns([["Get a quote"]], "center")]]), s({ background: "dark", padding: "sm" }, [[b("stats", { countUp: true, items: [{ value: "15+", label: "Years experience" }, { value: "900", label: "Happy customers" }, { value: "4.9★", label: "Average rating" }] })]])] },
  { id: "hero-offer", cat: "hero", name: "With an offer badge", make: () => s({ layout: "1-1", padding: "xl", valign: "center" }, [[b("offer", { badge: "This month", title: "Your first visit is 20% off", text: "Book online and mention this offer.", buttonText: "Book now", href: "#book", countdown: false, style: "primary", align: "left" })], [photo("the business", "4:3")]]) },

  // ---- services & features -------------------------------------------------------------
  { id: "svc-3", cat: "services", name: "Three cards", make: () => [s({ width: "narrow", align: "center", anchor: "services" }, [[h("What we offer", 2, "center"), t("A short introduction to your services.", "center")]]), s({ layout: "1-1-1", padding: "sm" }, SERVICES.slice(0, 3).map(([i, ti, tx]) => [card(i, ti, tx)]))] },
  { id: "svc-6", cat: "services", name: "Six features", make: () => [s({ width: "narrow", align: "center", anchor: "services", background: "surface" }, [[h("Why customers choose us", 2, "center")]]), s({ layout: "1-1-1", background: "surface", padding: "sm" }, [0, 1, 2].map((c) => [card(...SERVICES[c], { style: "plain" }), card(...SERVICES[c + 3], { style: "plain" })]))] },
  { id: "svc-photos", cat: "services", name: "Cards with photos", make: () => s({ layout: "1-1-1", anchor: "services" }, [["first service in action"], ["second service in action"], ["third service in action"]].map(([alt], i) => [card("", SERVICES[i][1], SERVICES[i][2], { image: "", style: "shadow", linkText: "Find out more", href: "#contact" })])) },
  { id: "svc-list", cat: "services", name: "Text + tick list", make: () => s({ layout: "1-1", valign: "center", anchor: "services" }, [[h("Everything you need, in one place", 2), t("From the first call to the finishing touches, we look after it all.")], [b("list", { items: ["Free, no-obligation quotes", "Experienced, friendly team", "Fully insured and guaranteed", "Flexible appointments, including weekends"] })]]) },
  { id: "svc-zigzag", cat: "services", name: "Alternating rows", make: () => SERVICES.slice(0, 3).map(([, ti, tx], i) => s({ layout: "1-1", valign: "center", background: i % 2 ? "surface" : "default" }, i % 2 ? [[photo(`${ti.toLowerCase()} in action`)], [h(ti), t(tx), btns([["Ask about this", "outline"]])]] : [[h(ti), t(tx), btns([["Ask about this", "outline"]])], [photo(`${ti.toLowerCase()} in action`)]])) },
  { id: "svc-dark", cat: "services", name: "Outline cards on dark", make: () => s({ layout: "1-1-1", background: "dark", anchor: "services" }, SERVICES.slice(0, 3).map(([i, ti, tx]) => [card(i, ti, tx, { style: "outline" })])) },
  { id: "svc-4", cat: "services", name: "Four small features", make: () => s({ layout: "1-1-1-1", padding: "md", align: "center" }, SERVICES.slice(0, 4).map(([i, ti, tx]) => [card(i, ti, tx, { style: "plain", align: "center" })])) },
  { id: "svc-wide", cat: "services", name: "Big intro + cards", make: () => s({ layout: "1-2", valign: "top", anchor: "services" }, [[h("Our services", 2), t("Here's how we can help. Ask if you need something not listed."), btns([["Get a quote"]])], [b("list", { icon: "check", items: SERVICES.map(([, ti, tx]) => `${ti}: ${tx}`) })]]) },

  // ---- about ----------------------------------------------------------------------
  { id: "about-img", cat: "about", name: "Story + photo", make: () => s({ layout: "1-1", valign: "center", anchor: "about" }, [[photo("the owner in their workplace")], [h("Our story"), t("Tell your story: who you are, how long you've been doing this and what makes you different."), b("list")]]) },
  { id: "about-centred", cat: "about", name: "Centred story", make: () => s({ width: "narrow", align: "center", background: "surface", anchor: "about" }, [[h("About us", 2, "center"), t("A warm, personal introduction to the business and the people behind it. Two or three sentences is plenty.", "center"), b("logo", { height: 70 })]]) },
  { id: "about-values", cat: "about", name: "Story + values", make: () => [s({ layout: "2-1", anchor: "about" }, [[h("Who we are"), t("A paragraph about the business: when it started, what you care about, and who you help.")], [b("stats", { items: [{ value: "2010", label: "Founded" }, { value: "12", label: "People" }] })]]), s({ layout: "1-1-1", padding: "sm" }, [["🤝", "Honest", "We tell you what you need, nothing more."], ["🎯", "Careful", "Details matter to us."], ["😊", "Friendly", "Always happy to help."]].map((x) => [card(...x, { style: "plain" })]))] },
  { id: "about-photo-bg", cat: "about", name: "Over a photo", make: () => ({ ...s({ background: "image", padding: "xl", width: "narrow" }, [[h("Made with care, right here", 2), t("Every piece starts in our workshop, made by people who love what they do.")]]), style: { bgPhoto: "craftsperson in a workshop", ...tint(true, { bgEffect: "parallax" }) } }) },
  { id: "about-quote", cat: "about", name: "Owner's words", make: () => s({ layout: "1-2", valign: "center", background: "surface" }, [[photo("portrait of the owner", "3:4")], [{ ...h("“We started this business because we believed people deserved better.”", 2), style: { italic: true } }, t("Name, founder")]]) },
  { id: "about-timeline", cat: "about", name: "Our history", make: () => s({ layout: "1-2", anchor: "about" }, [[h("Our journey"), t("How it all began, and how we got here.")], [b("timeline")]]) },

  // ---- team -------------------------------------------------------------------
  { id: "team-3", cat: "team", name: "Team, round photos", make: () => s({ align: "center" }, [[h("Meet the team", 2, "center"), b("team")]]) },
  { id: "team-4", cat: "team", name: "Team, four across", make: () => s({ background: "surface" }, [[h("The people behind it", 2, "center"), b("team", { columns: 4, shape: "portrait", items: [...b("team").props.items, { image: "", name: "Chris Lee", role: "Apprentice", bio: "Learning fast and loving it." }] })]]) },
  { id: "team-intro", cat: "team", name: "Intro + team", make: () => s({ layout: "1-2" }, [[h("Small team, big hearts"), t("Get to know the people you'll be working with.")], [b("team", { columns: 2, shape: "square", align: "left", items: b("team").props.items.slice(0, 2) })]]) },

  // ---- reviews -----------------------------------------------------------------
  { id: "rev-3", cat: "reviews", name: "Three reviews", make: () => [s({ width: "narrow", align: "center", background: "surface" }, [[h("What our customers say", 2, "center")]]), s({ layout: "1-1-1", background: "surface", padding: "sm" }, REVIEWS.map((r) => [quote(...r)]))] },
  { id: "rev-one", cat: "reviews", name: "One big review", make: () => s({ width: "narrow", align: "center", background: "primary" }, [[{ ...quote(...REVIEWS[0]), style: { bg: "transparent" } }]]) },
  { id: "rev-strip", cat: "reviews", name: "Scrolling reviews", make: () => s({ padding: "md", background: "dark" }, [[b("marquee", { size: "md", items: REVIEWS.map(([q, n]) => ({ text: `“${q}” — ${n}`, image: "" })), speed: 50 })]]) },
  { id: "rev-side", cat: "reviews", name: "Rating + reviews", make: () => s({ layout: "1-2", valign: "center" }, [[b("stats", { items: [{ value: "4.9★", label: "from 120+ reviews" }] }), btns([["Read more reviews", "outline", "#"]])], [quote(...REVIEWS[1]), quote(...REVIEWS[2])]]) },
  { id: "rev-photo", cat: "reviews", name: "Review over photo", make: () => ({ ...s({ background: "image", padding: "xl", width: "narrow", align: "center" }, [[h("“The best decision we made this year.”", 2, "center"), t("Happy customer, York", "center")]]), style: { bgPhoto: "happy customers", ...tint(true) } }) },

  // ---- pricing -----------------------------------------------------------------
  { id: "price-3", cat: "pricing", name: "Three plans", make: () => [s({ width: "narrow", align: "center" }, [[h("Simple pricing", 2, "center"), t("No hidden extras. Pick what suits you.", "center")]]), s({ layout: "1-1-1", padding: "sm" }, plans())] },
  { id: "price-2", cat: "pricing", name: "Two plans", make: () => s({ layout: "1-1", width: "normal", background: "surface" }, plans(1).slice(1)) },
  { id: "price-list", cat: "pricing", name: "Price list", make: () => s({ width: "narrow" }, [[h("Prices", 2, "center"), b("menu", { showTags: false, note: "Prices include VAT. Ask us for a tailored quote.", items: [{ category: "", name: "Standard visit", description: "Up to an hour", price: "£45", tags: "" }, { category: "", name: "Half day", description: "Up to four hours", price: "£150", tags: "" }, { category: "", name: "Full day", description: "Up to eight hours", price: "£280", tags: "" }] })]]) },
  { id: "price-dark", cat: "pricing", name: "Plans on dark", make: () => s({ layout: "1-1-1", background: "dark" }, plans()) },

  // ---- questions -----------------------------------------------------------------
  { id: "faq-narrow", cat: "faq", name: "Questions list", make: () => s({ width: "narrow" }, [[h("Frequently asked questions", 2, "center"), b("faq", { items: FAQS() })]]) },
  { id: "faq-side", cat: "faq", name: "Heading + questions", make: () => s({ layout: "1-2", background: "surface" }, [[h("Questions?"), t("Can't find your answer? Just ask."), btns([["Contact us", "outline"]])], [b("faq", { items: FAQS() })]]) },
  { id: "faq-two", cat: "faq", name: "Two columns", make: () => s({ layout: "1-1" }, [[b("faq", { items: FAQS().slice(0, 2) })], [b("faq", { items: FAQS().slice(2) })]]) },

  // ---- gallery & video -----------------------------------------------------------------
  { id: "gal-grid", cat: "gallery", name: "Photo grid", make: () => s({ anchor: "gallery" }, [[h("Our work", 2, "center"), b("gallery")]]) },
  { id: "gal-masonry", cat: "gallery", name: "Masonry", make: () => s({ width: "wide", anchor: "gallery" }, [[b("gallery", { layout: "masonry", ratio: "auto", gap: 8, hover: "colour" })]]) },
  { id: "gal-wide", cat: "gallery", name: "Two big photos", make: () => s({ width: "full", padding: "none" }, [[b("gallery", { columns: 2, mobileColumns: 1, gap: 0, ratio: "3:2", lightbox: true })]]) },
  { id: "gal-text", cat: "gallery", name: "Text + gallery", make: () => s({ layout: "1-2", background: "surface" }, [[h("A look inside"), t("A few of our favourite recent projects."), btns([["See more", "outline", "/gallery"]])], [b("gallery", { columns: 2, rows: 2 })]]) },
  { id: "video", cat: "gallery", name: "Video", make: () => s({ width: "narrow" }, [[h("See us in action", 2, "center"), b("video", { url: "", title: "Video" })]]) },
  { id: "beforeafter", cat: "gallery", name: "Before & after", make: () => s({ layout: "1-1", valign: "center" }, [[h("See the difference"), t("Drag the slider to compare.")], [b("beforeafter")]]) },

  // ---- calls to action -------------------------------------------------------------------
  { id: "cta-primary", cat: "cta", name: "Banner on brand colour", make: () => s({ background: "primary", align: "center", width: "narrow", padding: "lg" }, [[h("Ready to get started?", 2, "center"), t("Get in touch today for a free, no-obligation quote.", "center"), btns([["Contact us", "light"]], "center")]]) },
  { id: "cta-dark", cat: "cta", name: "Dark with two buttons", make: () => s({ background: "dark", align: "center", width: "narrow" }, [[h("Let's make it happen", 2, "center"), btns([["Book now"], ["Call us", "outline", "tel:", "phone"]], "center")]]) },
  { id: "cta-split", cat: "cta", name: "Text left, button right", make: () => s({ layout: "2-1", background: "surface", valign: "center", padding: "md" }, [[h("Have a project in mind?", 3), t("We'd love to hear about it.")], [btns([["Get a quote", "primary", "#contact", "arrow"]], "right")]]) },
  { id: "cta-photo", cat: "cta", name: "Over a photo", make: () => ({ ...s({ background: "image", align: "center", width: "narrow", padding: "xl" }, [[h("Come and see us", 2, "center"), t("We're open six days a week.", "center"), btns([["Get directions", "light", "#contact"]], "center")]]), style: { bgPhoto: "shop front", ...tint(true, { bgEffect: "parallax" }) } }) },
  { id: "cta-card", cat: "cta", name: "Floating card", make: () => ({ ...s({ width: "narrow", padding: "lg" }, [[h("Free consultation", 2, "center"), t("Book a free 20-minute chat to see how we can help.", "center"), btns([["Book your free chat"]], "center")]]), style: { bg: "#ffffff", radius: 18, shadow: "xl", margin: { d: { t: 40, b: 40 } }, maxWidth: 760, align: "center" } }) },
  { id: "cta-phone", cat: "cta", name: "Call us now", make: () => s({ background: "primary", align: "center", padding: "md" }, [[h("Need help today? Call 01234 567890", 3, "center"), btns([["Call now", "light", "tel:01234567890", "phone"]], "center")]]) },

  // ---- contact ---------------------------------------------------------------------
  { id: "contact-form", cat: "contact", name: "Details + form", make: () => s({ layout: "1-1", anchor: "contact", background: "surface" }, [[h("Get in touch"), t("📞 <a href=\"tel:\">Your phone</a><br>✉️ <a href=\"mailto:\">your@email.com</a><br>📍 Your address")], [b("form")]]) },
  { id: "contact-map", cat: "contact", name: "Form + map", make: () => s({ layout: "1-1", anchor: "contact" }, [[h("Visit or message us"), b("form")], [b("map"), b("hours")]]) },
  { id: "contact-cards", cat: "contact", name: "Three ways to reach us", make: () => s({ layout: "1-1-1", anchor: "contact", padding: "md" }, [[card("📞", "Call", "01234 567890", { style: "outline", align: "center" })], [card("✉️", "Email", "hello@business.co.uk", { style: "outline", align: "center" })], [card("📍", "Visit", "12 High Street, York", { style: "outline", align: "center" })]]) },
  { id: "contact-dark", cat: "contact", name: "Dark contact", make: () => s({ layout: "1-1", anchor: "contact", background: "dark" }, [[h("Let's talk"), t("Tell us what you need and we'll get back to you within a day."), b("hours", { title: "" })], [b("form")]]) },
  { id: "contact-narrow", cat: "contact", name: "Simple form", make: () => s({ width: "narrow", anchor: "contact" }, [[h("Send us a message", 2, "center"), b("form")]]) },

  // ---- bookings & enquiries ---------------------------------------------------------------
  { id: "book", cat: "booking", name: "Booking form", make: () => s({ layout: "1-1", anchor: "book", background: "surface" }, [[h("Book an appointment"), t("Choose a day and time and we'll confirm by email or phone."), b("list", { items: ["Free to request", "We reply within one working day", "Easy to change"] })], [b("form", FORM_PRESETS.booking())]]) },
  { id: "book-steps", cat: "booking", name: "How booking works + form", make: () => [s({ layout: "1-1-1", padding: "md", align: "center" }, [["📅", "1. Pick a time", "Choose a day that suits you."], ["✉️", "2. We confirm", "We'll reply to confirm."], ["✓", "3. See you then", "Nothing to pay now."]].map((x) => [card(...x, { style: "plain", align: "center" })])), s({ width: "narrow", anchor: "book" }, [[b("form", FORM_PRESETS.booking())]])] },
  { id: "enquiry", cat: "booking", name: "Enquiry form", make: () => s({ width: "narrow", anchor: "enquire" }, [[h("Make an enquiry", 2, "center"), t("Tell us what you're looking for and we'll get back to you with a quote.", "center"), b("form", FORM_PRESETS.enquiry())]]) },
  { id: "quote-photo", cat: "booking", name: "Quote form over photo", make: () => ({ ...s({ background: "image", layout: "1-1", valign: "center", padding: "xl", anchor: "quote" }, [[h("Get your free quote"), t("Quick, friendly and no obligation.")], [{ ...b("form", FORM_PRESETS.enquiry()), style: { bg: "#ffffff", color: "#111827", padding: { d: { t: 24, r: 24, b: 24, l: 24 } }, radius: 14 } }]]), style: { bgPhoto: "team at work", ...tint(true) } }) },

  // ---- numbers & logos --------------------------------------------------------------------
  { id: "stats", cat: "numbers", name: "Numbers on colour", make: () => s({ background: "primary", padding: "md" }, [[b("stats", { countUp: true })]]) },
  { id: "stats-light", cat: "numbers", name: "Numbers + heading", make: () => s({ align: "center" }, [[h("Proud of our numbers", 2, "center"), b("stats", { countUp: true, items: [{ value: "12", label: "Years" }, { value: "3000", label: "Jobs done" }, { value: "98%", label: "Would recommend" }, { value: "24/7", label: "Emergency line" }] })]]) },
  { id: "logos", cat: "numbers", name: "Scrolling logos / points", make: () => s({ padding: "sm", background: "surface" }, [[b("marquee")]]) },
  { id: "trust", cat: "numbers", name: "Trust badges", make: () => s({ layout: "1-1-1-1", padding: "sm", align: "center" }, [["✓", "Fully insured"], ["★", "5-star rated"], ["🏅", "Accredited"], ["⏱", "On time"]].map(([i, ti]) => [card(i, ti, "", { style: "plain", align: "center" })])) },

  // ---- process & history -------------------------------------------------------------------
  { id: "steps-3", cat: "process", name: "How it works, 3 steps", make: () => [s({ width: "narrow", align: "center" }, [[h("How it works", 2, "center")]]), s({ layout: "1-1-1", padding: "sm" }, [["1", "Get in touch", "Tell us what you need."], ["2", "We plan it", "A clear quote and a date."], ["3", "Job done", "Finished properly, on time."]].map((x) => [card(...x, { style: "surface", align: "center" })]))] },
  { id: "steps-timeline", cat: "process", name: "Steps as a timeline", make: () => s({ width: "narrow" }, [[h("Our process", 2), b("timeline", { items: [{ date: "Step 1", title: "Free consultation", text: "We talk through what you need." }, { date: "Step 2", title: "Your plan", text: "A clear quote with no surprises." }, { date: "Step 3", title: "We get to work", text: "Done properly, start to finish." }] })]]) },
  { id: "history", cat: "process", name: "Our history", make: () => s({ layout: "1-1", background: "surface" }, [[h("Since 2012"), t("A short story of how the business grew.")], [b("timeline")]]) },

  // ---- menus & hours ------------------------------------------------------------------------
  { id: "menu", cat: "food", name: "Menu", make: () => s({ width: "narrow", anchor: "menu" }, [[h("Our menu", 2, "center"), b("menu")]]) },
  { id: "menu-2", cat: "food", name: "Menu, two columns", make: () => s({ background: "surface", anchor: "menu" }, [[h("Menu", 2, "center"), b("menu", { columns: 2 })]]) },
  { id: "menu-photo", cat: "food", name: "Photo + menu", make: () => s({ layout: "1-1", valign: "top", anchor: "menu" }, [[photo("signature dish beautifully plated", "3:4")], [h("Today's favourites"), b("menu", { items: b("menu").props.items.slice(0, 3) })]]) },
  { id: "hours-map", cat: "food", name: "Hours + map", make: () => s({ layout: "1-1", anchor: "visit" }, [[b("hours"), btns([["Get directions", "outline", "#"]])], [b("map")]]) },
  { id: "hours-dark", cat: "food", name: "Opening hours band", make: () => s({ background: "dark", width: "narrow" }, [[b("hours", { title: "When we're open" })]]) },

  // ---- shop ------------------------------------------------------------------------------
  { id: "shop-3", cat: "shop", name: "Three products", make: () => s({ anchor: "shop" }, [[h("Shop", 2, "center"), b("products")]]) },
  { id: "shop-4", cat: "shop", name: "Four across", make: () => s({ background: "surface", anchor: "shop" }, [[h("Popular right now", 2, "center"), b("products", { columns: 4, mobileColumns: 2, items: [...b("products").props.items, { image: "", name: "Product name", price: "£30.00", text: "", buttonText: "Buy now", href: "", soldOut: false }] })]]) },
  { id: "shop-feature", cat: "shop", name: "Featured product", make: () => s({ layout: "1-1", valign: "center" }, [[photo("featured product", "1:1")], [b("text", { html: "<p><strong>BESTSELLER</strong></p>" }), h("The one everyone loves"), t("A short description of why it's special."), h("£35.00", 3), btns([["Buy now", "primary", "", "cart"]])]]) },
  { id: "shop-delivery", cat: "shop", name: "Delivery & returns", make: () => s({ layout: "1-1-1", padding: "md", background: "surface" }, [["🚚", "Free delivery", "On orders over £50."], ["↩", "Easy returns", "30 days, no fuss."], ["🔒", "Secure payment", "Card, Apple Pay and PayPal."]].map((x) => [card(...x, { style: "plain" })])) },

  // ---- blog ------------------------------------------------------------------------------
  { id: "blog-3", cat: "blog", name: "Latest posts", make: () => s({ background: "surface" }, [[h("Latest news", 2, "center"), b("posts", { count: 3 })]]) },
  { id: "blog-list", cat: "blog", name: "Post list", make: () => s({ width: "narrow" }, [[h("From the blog", 2), b("posts", { count: 5, columns: 1 })]]) },
  { id: "blog-side", cat: "blog", name: "Intro + posts", make: () => s({ layout: "1-2" }, [[h("Tips & news"), t("Advice, ideas and what we've been up to."), btns([["All posts", "outline", "/blog"]])], [b("posts", { count: 2, columns: 2 })]]) },

  // ---- offers & newsletter ------------------------------------------------------------------
  { id: "offer", cat: "offers", name: "Offer banner", make: () => s({ padding: "md" }, [[b("offer")]]) },
  { id: "offer-count", cat: "offers", name: "Offer with countdown", make: () => s({ padding: "md" }, [[b("offer", { style: "dark", ends: new Date(Date.now() + 14 * 86400000).toISOString().slice(0, 10), title: "Summer sale ends soon" })]]) },
  { id: "news", cat: "offers", name: "Newsletter signup", make: () => s({ background: "dark", padding: "lg" }, [[b("newsletter")]]) },
  { id: "news-side", cat: "offers", name: "Newsletter + text", make: () => s({ layout: "1-1", background: "surface", valign: "center" }, [[h("Be the first to know"), t("New arrivals, offers and news, once a month.")], [b("newsletter", { title: "", text: "", align: "left" })]]) },
];

// More designs, one or two per category.
SECTION_LIBRARY.push(
  { id: "hero-surface", cat: "hero", name: "Soft, with a list", make: () => s({ layout: "1-1", background: "surface", padding: "xl", valign: "center" }, [[h("Everything sorted, start to finish", 1), b("list", { items: ["Free quotes", "Friendly local team", "Work guaranteed"] }), btns([["Get a quote"]])], [photo("the team at work", "4:3")]]) },
  { id: "hero-video", cat: "hero", name: "Over a video", make: () => ({ ...s({ background: "image", padding: "xl", minHeight: true, width: "narrow", align: "center", valign: "center" }, [[h("See what we do", 1, "center"), t("Paste a video link in this section's Style tab.", "center"), btns([["Get in touch", "light"]], "center")]]), style: { bgPhoto: "business in action", ...tint(true) } }) },
  { id: "svc-icons-primary", cat: "services", name: "Icons on brand colour", make: () => s({ layout: "1-1-1", background: "primary", align: "center" }, SERVICES.slice(0, 3).map(([i, ti, tx]) => [card(i, ti, tx, { style: "plain", align: "center" })])) },
  { id: "svc-pricecards", cat: "services", name: "Services with prices", make: () => s({ width: "narrow", background: "surface" }, [[h("Services & prices", 2, "center"), b("menu", { showTags: false, note: "", items: SERVICES.slice(0, 4).map(([, ti, tx], i) => ({ category: "", name: ti, description: tx, price: `from £${(i + 1) * 25}`, tags: "" })) })]]) },
  { id: "about-split-dark", cat: "about", name: "Dark story + numbers", make: () => s({ layout: "1-1", background: "dark", valign: "center" }, [[h("Built on trust"), t("For over a decade, local families and businesses have relied on us.")], [b("stats", { items: [{ value: "10+", label: "Years" }, { value: "500+", label: "Customers" }] })]]) },
  { id: "team-dark", cat: "team", name: "Team on dark", make: () => s({ background: "dark" }, [[h("Our experts", 2, "center"), b("team", { shape: "square" })]]) },
  { id: "rev-grid", cat: "reviews", name: "Reviews + stars heading", make: () => s({ layout: "1-1" }, [[h("★★★★★ Rated excellent"), t("Hundreds of happy customers.")], [quote(...REVIEWS[0]), quote(...REVIEWS[2])]]) },
  { id: "price-surface", cat: "pricing", name: "Plans + questions", make: () => [s({ layout: "1-1-1", background: "surface" }, plans()), s({ width: "narrow", background: "surface", padding: "sm" }, [[b("faq", { items: FAQS().slice(0, 2) })]])] },
  { id: "faq-dark", cat: "faq", name: "Questions on dark", make: () => s({ width: "narrow", background: "dark" }, [[h("Good to know", 2, "center"), b("faq", { items: FAQS() })]]) },
  { id: "gal-dark", cat: "gallery", name: "Gallery on dark", make: () => s({ background: "dark", width: "wide" }, [[h("Recent work", 2, "center"), b("gallery", { columns: 4, mobileColumns: 2, hover: "darken" })]]) },
  { id: "cta-accent", cat: "cta", name: "Offer-style call to action", make: () => ({ ...s({ align: "center", width: "narrow", padding: "lg" }, [[h("Don't wait: limited spaces this month", 2, "center"), btns([["Book your place", "dark"]], "center")]]), style: { bg: "#f59e0b", color: "#111111" } }) },
  { id: "contact-hours", cat: "contact", name: "Details, hours + form", make: () => s({ layout: "1-1-1", anchor: "contact", valign: "top" }, [[h("Contact", 3), t("📞 Your phone<br>✉️ your@email.com<br>📍 Your address")], [b("hours")], [b("form")]]) },
  { id: "book-dark", cat: "booking", name: "Booking on dark", make: () => s({ layout: "1-1", background: "dark", anchor: "book" }, [[h("Reserve your spot"), t("We'll confirm your booking by email.")], [b("form", FORM_PRESETS.booking())]]) },
  { id: "numbers-dark", cat: "numbers", name: "Numbers on dark", make: () => s({ background: "dark", padding: "md" }, [[b("stats", { countUp: true })]]) },
  { id: "steps-4", cat: "process", name: "Four steps", make: () => s({ layout: "1-1-1-1", align: "center", background: "surface" }, [["1", "Call", "Tell us what you need."], ["2", "Visit", "We take a look."], ["3", "Quote", "A clear, fixed price."], ["4", "Done", "Finished on time."]].map((x) => [card(...x, { style: "plain", align: "center" })])) },
  { id: "menu-dark", cat: "food", name: "Menu on dark", make: () => s({ background: "dark", width: "narrow" }, [[h("Menu", 2, "center"), b("menu")]]) },
  { id: "shop-dark", cat: "shop", name: "Products on dark", make: () => s({ background: "dark" }, [[h("New in", 2, "center"), b("products")]]) },
);
