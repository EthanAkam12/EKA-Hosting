// Ready-made sections for the "Add" panel. Each returns a fresh section.

import { createBlock as b, createSection as s, FORM_PRESETS } from "/admin/shared/schema.js";

export const SECTION_TEMPLATES = [
  {
    id: "hero", name: "Hero", desc: "Big headline with buttons", icon: "i:star",
    make: () => s({ background: "dark", padding: "xl", minHeight: true, width: "narrow", align: "center" }, [[
      b("heading", { text: "A bold headline that says what you do", level: 1, align: "center" }),
      b("text", { html: "<p>One or two sentences on why customers should choose you.</p>", align: "center" }),
      b("buttons", { align: "center", items: [{ text: "Get started", href: "#contact", style: "primary" }, { text: "Learn more", href: "#", style: "outline" }] }),
    ]]),
  },
  {
    id: "hero-split", name: "Hero with image", desc: "Text left, picture right", icon: "◧",
    make: () => s({ layout: "1-1", padding: "xl", valign: "center" }, [
      [
        b("heading", { text: "Your headline goes here", level: 1 }),
        b("text", { html: "<p>Explain the main benefit in a sentence or two.</p>" }),
        b("buttons", { items: [{ text: "Book now", href: "#contact", style: "primary" }] }),
      ],
      [b("image", { ratio: "4:3" })],
    ]),
  },
  {
    id: "features", name: "Features / services", desc: "Heading + 3 cards", icon: "▤",
    make: () => [
      s({ width: "narrow", align: "center", padding: "lg" }, [[
        b("heading", { text: "What we offer", level: 2, align: "center" }),
        b("text", { html: "<p>A short introduction to your services.</p>", align: "center" }),
      ]]),
      s({ layout: "1-1-1", padding: "sm" }, [
        [b("card", { icon: "i:zap", title: "Service one" })],
        [b("card", { icon: "i:star", title: "Service two" })],
        [b("card", { icon: "i:check", title: "Service three" })],
      ]),
    ],
  },
  {
    id: "about", name: "Text + image", desc: "Two columns", icon: "◨",
    make: () => s({ layout: "1-1", background: "surface", valign: "center" }, [
      [b("image", { ratio: "4:3" })],
      [
        b("heading", { text: "About us", level: 2 }),
        b("text", { html: "<p>Tell your story: who you are, how long you've been doing this and what makes you different.</p>" }),
        b("list"),
      ],
    ]),
  },
  {
    id: "stats", name: "Numbers", desc: "Key stats on colour", icon: "#",
    make: () => s({ background: "primary", padding: "md" }, [[b("stats")]]),
  },
  {
    id: "testimonials", name: "Testimonials", desc: "3 customer reviews", icon: "❝",
    make: () => s({ layout: "1-1-1", background: "surface" }, [
      [b("testimonial")], [b("testimonial")], [b("testimonial")],
    ]),
  },
  {
    id: "pricing", name: "Pricing", desc: "3 price boxes", icon: "£",
    make: () => s({ layout: "1-1-1" }, [
      [b("pricing", { name: "Basic", price: "£29" })],
      [b("pricing", { name: "Standard", price: "£49", featured: true })],
      [b("pricing", { name: "Premium", price: "£99" })],
    ]),
  },
  {
    id: "faq", name: "FAQ", desc: "Questions & answers", icon: "?",
    make: () => s({ width: "narrow" }, [[b("heading", { text: "Frequently asked questions", level: 2, align: "center" }), b("faq")]]),
  },
  {
    id: "cta", name: "Call to action", desc: "Banner with a button", icon: "➜",
    make: () => s({ background: "primary", align: "center", width: "narrow", padding: "lg" }, [[
      b("heading", { text: "Ready to get started?", level: 2, align: "center" }),
      b("text", { html: "<p>Get in touch today for a free, no-obligation quote.</p>", align: "center" }),
      b("buttons", { align: "center", items: [{ text: "Contact us", href: "#contact", style: "light" }] }),
    ]]),
  },
  {
    id: "contact", name: "Contact", desc: "Details + form", icon: "✉",
    make: () => s({ layout: "1-1", anchor: "contact", background: "surface" }, [
      [
        b("heading", { text: "Get in touch", level: 2 }),
        b("text", { html: "<p>📞 <a href=\"tel:\">Your phone</a><br>✉️ <a href=\"mailto:\">your@email.com</a><br>📍 Your address</p>" }),
      ],
      [b("form")],
    ]),
  },
  {
    id: "booking", name: "Booking form", desc: "Date, time, service + details", icon: "i:calendar-check",
    make: () => s({ layout: "1-1", anchor: "book", background: "surface", valign: "top" }, [
      [
        b("heading", { text: "Book an appointment", level: 2 }),
        b("text", { html: "<p>Choose a day and time that suits you and we'll confirm your booking by email or phone.</p>" }),
        b("list", { items: ["Free to request, no payment now", "We reply within one working day", "Need to change it? Just let us know"] }),
      ],
      [b("form", FORM_PRESETS.booking())],
    ]),
  },
  {
    id: "enquiry", name: "Enquiry form", desc: "Quotes and questions", icon: "✍",
    make: () => s({ width: "narrow", anchor: "enquire" }, [[
      b("heading", { text: "Make an enquiry", level: 2, align: "center" }),
      b("text", { html: "<p>Tell us what you're looking for and we'll get back to you with a quote or an answer.</p>", align: "center" }),
      b("form", FORM_PRESETS.enquiry()),
    ]]),
  },
  {
    id: "products", name: "Shop / products", desc: "Products with Buy buttons", icon: "🛍",
    make: () => s({ anchor: "shop" }, [[b("heading", { text: "Shop", level: 2, align: "center" }), b("products")]]),
  },
  {
    id: "posts", name: "Latest blog posts", desc: "Newest posts as cards", icon: "✎",
    make: () => s({ background: "surface" }, [[b("heading", { text: "Latest news", level: 2, align: "center" }), b("posts", { count: 3 })]]),
  },
  {
    id: "gallery", name: "Gallery", desc: "Grid of photos", icon: "▦",
    make: () => s({}, [[b("heading", { text: "Our work", level: 2, align: "center" }), b("gallery")]]),
  },
];

export const EMPTY_LAYOUTS = [
  { layout: "1", label: "1 column" },
  { layout: "1-1", label: "2 columns" },
  { layout: "1-1-1", label: "3 columns" },
  { layout: "2-1", label: "Wide + narrow" },
  { layout: "1-2", label: "Narrow + wide" },
  { layout: "1-1-1-1", label: "4 columns" },
];
