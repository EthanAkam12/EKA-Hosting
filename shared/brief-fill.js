// Fills a ready-made design with what a client told us, without AI: their
// words, services, prices, reviews, hours and contact details go where they
// belong, and example content that would be untrue for them (made-up reviews,
// "fully insured", example prices, a fake phone number…) is replaced or taken
// out. Returns the site and a list of things a person should still check.
//
// brief: { name, description, tagline, services, area, hours, phone, email,
//          address, socials, reviews, highlights, prices, kit }
//   services / reviews / highlights / prices are text, one per line:
//     services:   "Boiler repairs - Fast fixes for all makes"   (or just "Boiler repairs")
//     reviews:    "Brilliant job, really tidy. - Sarah, York"
//     highlights: "Gas Safe registered"
//     prices:     "Cakes:" (a heading line), then "Victoria sponge - £3.50 - Homemade daily"

import { createBlock, createSection, normalizeSite } from "./schema.js";
import { applyStyleKit, STYLE_KITS } from "./style-kits.js";
import { ICONS } from "./icons.js";

const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const lines = (t) => String(t || "").split(/\r?\n/).map((l) => l.replace(/^[\s•*\-–—]+(?=\S)/, "").trim()).filter(Boolean);
const sentences = (t) => String(t || "").replace(/\s+/g, " ").trim().match(/[^.!?]+[.!?]*/g)?.map((s) => s.trim()).filter(Boolean) || [];
const splitPair = (l) => { const m = l.match(/^(.+?)\s+[-–—:|]\s+(.+)$/); return m ? [m[1].trim(), m[2].trim()] : [l.trim(), ""]; };
const paras = (t) => String(t || "").split(/\n\s*\n|\r?\n/).map((p) => p.trim()).filter(Boolean).map((p) => `<p>${esc(p)}</p>`).join("");

export function parseServices(text) {
  return lines(text).slice(0, 12).map((l) => { const [title, text] = splitPair(l); return { title: title.slice(0, 80), text: text.slice(0, 300) }; });
}
export function parseReviews(text) {
  return lines(text).slice(0, 9).map((l) => {
    const m = l.match(/^["“']?(.+?)["”']?\s+[-–—]\s+([^-–—]{2,60})$/);
    return m ? { quote: m[1].trim(), name: m[2].trim() } : { quote: l.replace(/^["“']|["”']$/g, ""), name: "" };
  });
}
export function parsePrices(text) {
  const out = [];
  let category = "";
  for (const l of lines(text)) {
    if (/:$/.test(l) && !/£|\d/.test(l)) { category = l.slice(0, -1).trim(); continue; }
    const parts = l.split(/\s+[-–—|]\s+/);
    const priceIdx = parts.findIndex((p) => /^(from\s+)?[£$€]\s?\d|^\d+(\.\d\d)?$/i.test(p.trim()));
    const m = priceIdx < 0 ? l.match(/^(.*?)\s*((?:from\s+)?[£$€]\s?\d[\d.,]*(?:\s*(?:per|\/)\s*\w+)?)\s*(.*)$/i) : null;
    if (priceIdx >= 0) out.push({ category, name: parts.filter((_, i) => i !== priceIdx)[0] || "", price: parts[priceIdx].trim(), description: parts.filter((_, i) => i !== priceIdx).slice(1).join(" – "), tags: "" });
    else if (m && m[1]) out.push({ category, name: m[1].replace(/[-–—:]\s*$/, "").trim(), price: m[2].trim(), description: m[3].replace(/^[-–—(]\s*|\)$/g, "").trim(), tags: "" });
  }
  return out.filter((p) => p.name).slice(0, 60);
}

// A suitable icon for a service, from its words.
const ICON_WORDS = [
  [/boiler|heating|gas|fire|bbq|grill/, "flame"], [/plumb|leak|water|drain|bath|shower|pipe/, "droplet"], [/electric|wiring|socket|light|ev charg/, "plug"],
  [/garden|lawn|landscap|hedge|tree|plant/, "leaf"], [/clean|valet|wash/, "sparkles"], [/paint|decorat/, "paint-roller"], [/roof|loft|extension|build|house|home/, "house"],
  [/repair|fix|service|maint/, "wrench"], [/install|fit|carpent|joiner|kitchen/, "hammer"], [/emergency|24|urgent|call.?out/, "phone-call"], [/lock|secur|alarm/, "lock"],
  [/coffee|espresso|latte/, "coffee"], [/cake|bake|pastr|dessert/, "cake-slice"], [/breakfast|brunch|croissant/, "croissant"], [/pizza/, "pizza"], [/drink|wine|cocktail|bar/, "wine"], [/beer|\bales?\b/, "beer"], [/food|lunch|dinner|meal|cater|menu/, "utensils"],
  [/hair|cut|barber|colour/, "scissors"], [/nail|make.?up|brow|lash|beauty|facial/, "brush"], [/massage|spa|relax|therap/, "hand-heart"], [/train|gym|fitness|strength|weights/, "dumbbell"], [/yoga|pilates|wellbeing|health/, "activity"], [/physio|clinic|medical|dent/, "stethoscope"],
  [/photo|portrait|camera/, "camera"], [/video|film/, "film"], [/wedding|event|party/, "party-popper"], [/web|website|online|digital|seo/, "monitor"], [/design|brand|logo|graphic/, "pen-tool"],
  [/account|tax|book.?keep|payroll/, "calculator"], [/legal|law|solicit/, "scale"], [/consult|advice|coach|mentor/, "message-circle"], [/training|course|lesson|tutor|class|teach/, "graduation-cap"],
  [/deliver|courier|removal|van|transport/, "truck"], [/\bcars?\b|vehicle|\bmot\b|tyre/, "car"], [/\bdogs?\b|\bpets?\b|groom|\bcats?\b|\bvets?\b/, "paw-print"], [/kid|child|baby|nursery/, "baby"], [/shop|retail|gift|product/, "shopping-bag"], [/stay|room|b&b|holiday|cottage|hotel/, "bed"],
  [/insur|guarantee|warrant|certif|regist|accredit|qualif/, "shield-check"], [/price|quote|free|value|afford/, "tag"], [/fast|quick|same.?day/, "zap"], [/local|area|near/, "map-pin"], [/friendly|family|team|people/, "users"], [/experience|year|expert|quality/, "award"],
];
export function iconFor(text, fallback = "check") {
  const t = String(text).toLowerCase();
  const hit = ICON_WORDS.find(([re, name]) => re.test(t) && ICONS[name]);
  return `i:${hit ? hit[1] : fallback}`;
}

// ---- walking a site -----------------------------------------------------------------
const blocksOf = (sec) => sec.columns.flatMap((c) => c.blocks);
const textOf = (b) => String(b.props.text || b.props.title || b.props.html || "").replace(/<[^>]+>/g, " ");
const has = (sec, type) => blocksOf(sec).some((b) => b.type === type);
const headingOf = (sec) => blocksOf(sec).find((b) => b.type === "heading");
const onlyTitle = (sec) => { const bl = blocksOf(sec); return bl.length <= 3 && bl.some((b) => b.type === "heading") && bl.every((b) => ["heading", "text", "buttons"].includes(b.type)); };
const CLAIMS = /insured|accredit|rated|award|certif|guarantee|years|est\.|since \d|family run|qualified|registered|\d+\s*(happy|customers|clients)/i;

function replaceStrings(value, fn) {
  if (typeof value === "string") return fn(value);
  if (Array.isArray(value)) return value.map((v) => replaceStrings(v, fn));
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, k === "id" ? v : replaceStrings(v, fn)]));
  return value;
}

// photos: stock photos are available (the builder has a Pixabay/Pexels key), so
// picture-led layouts (service photos) are used instead of icons.
export function fillFromBrief(input, rawBrief = {}, { photos = false } = {}) {
  const site = structuredClone(input);
  const b = Object.fromEntries(Object.entries(rawBrief).map(([k, v]) => [k, typeof v === "string" ? v.trim() : v]));
  const name = b.name || site.name;
  const todo = [];
  const services = parseServices(b.services);
  const reviews = parseReviews(b.reviews);
  const highlights = lines(b.highlights).slice(0, 8);
  const prices = parsePrices(b.prices);
  const desc = sentences(b.description);
  const area = b.area || "";
  const phoneDigits = String(b.phone || "").replace(/[^\d+]/g, "");
  const inArea = area ? ` in ${area}` : "";

  // 1. Contact details everywhere (and none of the examples left).
  const contactHtml = () => {
    const parts = [];
    if (b.phone) parts.push(`📞 <a href="tel:${phoneDigits}">${esc(b.phone)}</a>`);
    if (b.email) parts.push(`✉️ <a href="mailto:${esc(b.email)}">${esc(b.email)}</a>`);
    if (b.address) parts.push(`📍 ${esc(b.address)}`);
    return parts.length ? `<p>${parts.join("<br>")}</p>` : "";
  };
  for (const page of site.pages) {
    page.sections = replaceStrings(page.sections, (s) => {
      if (/Your phone|your@email\.com|Your address/.test(s)) return /^<p>|📞/.test(s) ? contactHtml() : s;
      return s
        .replace(/tel:01234567890|tel:(?=["'])/g, phoneDigits ? `tel:${phoneDigits}` : "tel:")
        .replace(/01234 567890/g, b.phone || "")
        .replace(/hello@business\.co\.uk/g, b.email || "")
        .replace(/mailto:(?=["'])/g, b.email ? `mailto:${b.email}` : "mailto:")
        .replace(/12 High Street, York|London, UK/g, b.address || area || "");
    });
  }
  site.business = { ...site.business, phone: b.phone || site.business?.phone || "", email: b.email || site.business?.email || "", address: b.address || site.business?.address || "", hours: b.hours || site.business?.hours || "", socials: b.socials || site.business?.socials || "" };
  if (area) site.business.keywords = `${site.business.keywords || ""} ${area}`.trim();

  // 2. Page by page.
  let serviceCursor = 0;
  let placedReviews = false;
  for (const page of site.pages) {
    const keep = [];
    const secs = page.sections;
    for (let i = 0; i < secs.length; i++) {
      const sec = secs[i];
      const bl = blocksOf(sec);
      const next = secs[i + 1];
      const drop = () => { if (keep.length && onlyTitle(keep.at(-1)) && keep.at(-1) !== secs[0]) keep.pop(); };

      // The home page's first section: the client's own headline and words.
      if (page.slug === "index" && i === 0) {
        const h1 = bl.find((x) => x.type === "heading");
        const t = bl.find((x) => x.type === "text");
        if (h1) h1.props.text = b.tagline || name;
        const intro = desc.slice(0, desc[0] && desc[0].length < 90 ? 2 : 1).join(" ");
        const mentionsArea = !area || intro.toLowerCase().includes(area.toLowerCase().split(/[ ,]/)[0]) || /\b(cover|covering|serving|based in)\b/i.test(intro);
        if (t) t.props.html = `<p>${esc(intro)}${mentionsArea ? "" : ` ${esc(`Serving ${area}.`)}`}</p>`;
        for (const x of bl.filter((x) => x.type === "text" && x !== t && CLAIMS.test(textOf(x)))) x.props.html = "";
        keep.push(sec); continue;
      }
      // Made-up reviews: the client's real ones, or none.
      if (has(sec, "testimonial") || bl.some((x) => x.type === "slider" && x.props.kind === "reviews")) {
        if (!reviews.length) { drop(); continue; }
        placedReviews = true;
        const slider = bl.find((x) => x.type === "slider");
        if (slider) slider.props.slides = reviews.map((r) => ({ image: "", title: r.quote, text: "", name: r.name, buttonText: "", href: "" }));
        else {
          const per = Math.min(3, reviews.length);
          for (let k = 0; k < reviews.length; k += per) keep.push(createSection({ ...sec.props, layout: ["1", "1-1", "1-1-1"][per - 1], anchor: k ? "" : sec.props.anchor }, reviews.slice(k, k + per).map((r) => [createBlock("testimonial", { quote: r.quote, name: r.name, role: "", rating: 5 })])));
          continue;
        }
        keep.push(sec); continue;
      }
      // Reviews in a scrolling strip, or one quote over a photo.
      const reviewStrip = bl.find((x) => x.type === "marquee" && x.props.items.some((it) => /^“/.test(it.text)));
      if (reviewStrip) {
        if (!reviews.length) { drop(); continue; }
        placedReviews = true;
        reviewStrip.props.items = reviews.map((r) => ({ text: `“${r.quote}”${r.name ? ` — ${r.name}` : ""}`, image: "" }));
        keep.push(sec); continue;
      }
      const quoteHeading = bl.find((x) => x.type === "heading" && /^[“"]/.test(x.props.text));
      if (quoteHeading) {
        if (!reviews.length) { drop(); continue; }
        placedReviews = true;
        quoteHeading.props.text = `“${reviews[0].quote}”`;
        const t = bl.find((x) => x.type === "text");
        if (t) t.props.html = `<p>${esc(reviews[0].name)}</p>`;
        keep.push(sec); continue;
      }
      // Example people, numbers, history and offers: out.
      if (["team", "stats", "timeline", "beforeafter", "offer"].some((t) => has(sec, t)) && !(has(sec, "timeline") && /how|step|process/i.test(textOf(headingOf(sec) || { props: {} })))) { drop(); continue; }
      // Badges and claims: the client's own highlights, or out.
      const cards = bl.filter((x) => x.type === "card");
      if (cards.length && cards.every((c) => CLAIMS.test(`${c.props.title} ${c.props.text}`) || c.props.title.length < 16 && !c.props.text)) {
        if (!highlights.length) { drop(); continue; }
        keep.push(createSection({ ...sec.props, layout: ["1", "1-1", "1-1-1", "1-1-1-1"][Math.min(4, highlights.length) - 1] }, highlights.slice(0, 4).map((h) => [createBlock("card", { ...cards[0].props, icon: iconFor(h, "badge-check"), title: h, text: "" })])));
        continue;
      }
      for (const m of bl.filter((x) => x.type === "marquee")) {
        const words = highlights.length ? highlights : services.map((s) => s.title);
        if (words.length) m.props.items = words.map((text) => ({ text, image: "" }));
      }
      if (bl.some((x) => x.type === "marquee") && !highlights.length && !services.length) { continue; }

      // Services: the first group of service cards gets them all.
      const title = textOf(headingOf(sec) || (keep.at(-1) && onlyTitle(keep.at(-1)) ? headingOf(keep.at(-1)) : null) || { props: {} });
      const isSteps = /how it works|step|process|what happens/i.test(title);
      if (cards.length >= 2 && !isSteps && services.length && serviceCursor < services.length) {
        const list = services.slice(serviceCursor);
        serviceCursor = services.length;
        // Even rows: 4 → one row of 4, 5 → 3 + 2, 6 → 3 + 3, 8 → 4 + 4.
        const per = Math.ceil(list.length / Math.ceil(list.length / 4));
        for (let k = 0; k < list.length; k += per) {
          const row = list.slice(k, k + per);
          keep.push(createSection({ ...sec.props, layout: ["1", "1-1", "1-1-1", "1-1-1-1"][row.length - 1], anchor: k ? "" : sec.props.anchor }, row.map((sv) => [createBlock("card", { ...cards[0].props, icon: cards[0].props.icon ? iconFor(sv.title) : "", image: "", title: sv.title, text: sv.text || `${sv.title}${inArea}. Get in touch to find out more.` })])));
        }
        continue;
      }
      for (const tabs of bl.filter((x) => x.type === "tabs")) {
        if (services.length >= 2) tabs.props.items = services.slice(0, 8).map((sv) => ({ title: sv.title, html: `<p>${esc(sv.text || `${sv.title}${inArea}.`)}</p>` }));
      }
      if (has(sec, "tabs") && services.length < 2) { drop(); continue; }
      // A "service in detail" section (heading, words, button, picture) per service.
      if (page.slug !== "index" && sec.columns.length === 2 && has(sec, "image") && bl.filter((x) => x.type === "heading").length === 1 && /reliable|quality|pricing|service|offer/i.test(textOf(headingOf(sec))) && services.length) {
        const sv = services[(page._detail = (page._detail ?? -1) + 1)];
        if (!sv) continue;
        headingOf(sec).props.text = sv.title;
        const t = bl.find((x) => x.type === "text");
        if (t) t.props.html = `<p>${esc(sv.text || `${sv.title}${inArea}. Get in touch to talk about what you need.`)}</p>`;
        keep.push(sec); continue;
      }
      // Prices: theirs, or flagged.
      for (const menu of bl.filter((x) => x.type === "menu")) {
        if (prices.length) { menu.props.items = prices; menu.props.showTags = false; menu.props.note = ""; }
        else todo.push(`Put the real prices on the ${page.title} page (the ones there are examples).`);
      }
      const boxes = bl.filter((x) => x.type === "pricing");
      if (boxes.length) {
        if (prices.length) {
          const row = prices.slice(0, 4);
          keep.push(createSection({ ...sec.props, layout: ["1", "1-1", "1-1-1", "1-1-1-1"][row.length - 1] }, row.map((p, k) => [createBlock("pricing", { ...boxes[0].props, name: p.name, price: p.price.replace(/\s*(per|\/)\s*\w+$/i, ""), period: (p.price.match(/(per|\/)\s*\w+$/i) || [""])[0], features: p.description ? p.description.split(/[,;]\s*/) : [], featured: row.length === 3 && k === 1 })])));
          continue;
        }
        todo.push(`Put the real prices in the price boxes on the ${page.title} page.`);
      }
      // About: their description.
      if (/about|story|who we are|meet|welcome/i.test(textOf(headingOf(sec) || { props: {} })) && b.description) {
        const t = bl.find((x) => x.type === "text");
        if (t) t.props.html = paras(b.description);
      }
      // FAQ: only what we know is true.
      for (const faq of bl.filter((x) => x.type === "faq")) {
        const qa = [];
        if (area || b.address) qa.push({ q: "Where are you based?", a: `${b.address ? `We're at ${b.address}` : `We're based in ${area}`}${area && b.address ? `, and we cover ${area}` : ""}.` });
        if (b.hours) qa.push({ q: "When are you open?", a: lines(b.hours).join(". ") + "." });
        if (services.length) qa.push({ q: "What do you offer?", a: `${services.slice(0, 6).map((s) => s.title).join(", ")}${services.length > 6 ? " and more" : ""}.` });
        if (b.phone || b.email) qa.push({ q: "How do I get in touch?", a: `${b.phone ? `Call us on ${b.phone}` : ""}${b.phone && b.email ? ", email " : b.email ? "Email " : ""}${b.email || ""}, or use the form on this website.` });
        faq.props.items = qa;
      }
      if (has(sec, "faq") && bl.find((x) => x.type === "faq").props.items.length < 2) { drop(); continue; }
      // Tick lists: their services, and no unbacked claims.
      for (const list of bl.filter((x) => x.type === "list")) {
        if (services.length && sec.props.anchor === "services") list.props.items = services.map((sv) => sv.title);
        else list.props.items = list.props.items.filter((it) => !CLAIMS.test(it));
      }
      // Example cards that make claims ("Fully insured"): taken out.
      if (cards.length >= 2 && cards.some((c) => CLAIMS.test(`${c.props.title} ${c.props.text}`))) {
        sec.columns = sec.columns.filter((col) => !col.blocks.some((x) => x.type === "card" && CLAIMS.test(`${x.props.title} ${x.props.text}`)));
        if (!sec.columns.length) { drop(); continue; }
        sec.props.layout = ["1", "1-1", "1-1-1", "1-1-1-1"][Math.min(4, sec.columns.length) - 1];
        if (sec.columns.length > 4) sec.columns = sec.columns.slice(0, 4);
      }
      // Example lines that would be untrue.
      for (const t of bl.filter((x) => x.type === "text" && CLAIMS.test(textOf(x)))) t.props.html = "";
      for (const t of bl.filter((x) => x.type === "text" && /A short introduction to your services/i.test(textOf(x)))) t.props.html = `<p>${esc(`Here's how ${name} can help${area ? ` across ${area}` : ""}.`)}</p>`;
      if (has(sec, "gallery")) todo.push(`Add real photos to the gallery on the ${page.title} page.`);
      keep.push(sec);
    }
    delete page._detail;
    page.sections = keep;
    // Google titles and descriptions.
    page.seo = { ...page.seo,
      title: page.slug === "index" ? `${name}${area ? ` | ${area}` : ""}` : `${page.title} | ${name}`,
      description: (page.slug === "index" ? desc.slice(0, 2).join(" ") : `${page.title} from ${name}${inArea}. ${desc[0] || ""}`).slice(0, 155),
    };
  }
  // A design without service cards: add a services section after the home page's first section.
  if (services.length && serviceCursor === 0) {
    const home = site.pages.find((p) => p.slug === "index") || site.pages[0];
    const add = [createSection({ layout: "1", padding: "md", align: "center", width: "narrow", anchor: "services" }, [[createBlock("heading", { text: "What we offer", level: 2, align: "center" }), createBlock("text", { html: `<p>${esc(`Here's how ${name} can help${area ? ` across ${area}` : ""}.`)}</p>`, align: "center" })]])];
    const per = Math.ceil(services.length / Math.ceil(services.length / 4));
    for (let k = 0; k < services.length; k += per) {
      const row = services.slice(k, k + per);
      add.push(createSection({ layout: ["1", "1-1", "1-1-1", "1-1-1-1"][row.length - 1], padding: "sm" }, row.map((sv) => [createBlock("card", { icon: iconFor(sv.title), title: sv.title, text: sv.text || `${sv.title}${inArea}. Get in touch to find out more.`, style: "surface" })])));
    }
    home.sections.splice(1, 0, ...add);
  }

  // Real reviews but no place for them in this design: add them before the home page's last section.
  if (reviews.length && !placedReviews) {
    const home = site.pages.find((p) => p.slug === "index") || site.pages[0];
    const per = Math.min(3, reviews.length);
    const add = [createSection({ layout: "1", padding: "md", align: "center", width: "narrow", background: "surface" }, [[createBlock("heading", { text: "What our customers say", level: 2, align: "center" })]])];
    for (let k = 0; k < reviews.length; k += per) add.push(createSection({ layout: ["1", "1-1", "1-1-1"][Math.min(per, reviews.length - k) - 1], padding: "sm", background: "surface" }, reviews.slice(k, k + per).map((r) => [createBlock("testimonial", { quote: r.quote, name: r.name, role: "", rating: 5 })])));
    home.sections.splice(Math.max(1, home.sections.length - 1), 0, ...add);
  }

  // 3. Example wording made true for this business (or taken out).
  const serviceList = services.slice(0, 5).map((sv) => sv.title.toLowerCase());
  const listText = serviceList.length > 1 ? `${serviceList.slice(0, -1).join(", ")} and ${serviceList.at(-1)}` : serviceList[0] || "";
  const REWRITE = {
    "Made fresh every day with local ingredients.": listText ? `Some of what we serve: ${listText}.` : "",
    "V vegetarian · VG vegan · GF gluten free. Please tell us about any allergies.": "Please tell us about any allergies when you order.",
    "Prices include VAT. Ask us for a tailored quote.": "Every job is different: ask us for a quote.",
    "Tell us about the job and we'll get back to you the same day.": "Tell us about the job and we'll get back to you as soon as we can.",
    "Everything we do, done properly.": `Everything ${name} offers${inArea}.`,
    "A few recent jobs we're proud of.": `Some of ${name}'s recent work.`,
    "Something for everyone; ask us for advice.": `Everything we offer at ${name}. Not sure what you need? Just ask.`,
    "Nothing to pay now.": "",
    "Small groups, big results.": `What's on at ${name}.`,
    "No pressure, just a chat and a workout.": "No pressure: get in touch and we'll find a time that suits you.",
    "A friendly introduction to what you offer.": desc[0] || "",
    "A short description of why it's special.": "",
    "Clear advice, fixed fees, no jargon.": `How ${name} can help${inArea}.`,
    "From the first call to the finishing touches, we look after it all.": desc.slice(0, 2).join(" "),
    "Your first call is free.": "Tell us what you need and we'll arrange a time to talk.",
    "A little about me and how I work.": desc.join(" "),
    "All rooms are en suite, with breakfast included.": "Get in touch for prices and availability.",
    "Our favourite walks, beaches and places to eat.": area ? `There's plenty to see and do around ${area}.` : "",
    "Send us your dates and we'll reply within a few hours.": "Send us your dates and we'll reply as soon as we can.",
    "Don't wait: limited spaces this month": "",
    "Order online; we'll wrap it beautifully.": "Order online, or get in touch with any questions.",
    "A short story of how the business grew.": desc.join(" "),
    "Quick, friendly and no obligation.": "Tell us what you need and we'll be in touch.",
    "Experienced people, great materials and real attention to detail.": "Real care and attention to detail on every job.",
  };
  const plain = (h) => String(h || "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  for (const page of site.pages) for (const sec of page.sections) for (const bl of blocksOf(sec)) {
    if (bl.type === "text" && plain(bl.props.html) in REWRITE) { const v = REWRITE[plain(bl.props.html)]; bl.props.html = v ? `<p>${esc(v)}</p>` : ""; }
    if (bl.type === "card" && bl.props.text in REWRITE) bl.props.text = REWRITE[bl.props.text];
    for (const k of ["note"]) if (typeof bl.props[k] === "string" && bl.props[k] in REWRITE) bl.props[k] = REWRITE[bl.props[k]];
    if (bl.type === "products") {
      if (prices.length) bl.props.items = prices.slice(0, 12).map((p) => ({ image: "", name: p.name, price: p.price, text: p.description, buttonText: "Ask about this", href: "#contact", soldOut: false }));
      else todo.push(`Add their real products and prices on the ${page.title} page.`);
    }
    if (bl.type === "offer") bl.props.title = "";
  }
  for (const page of site.pages) page.sections = page.sections.filter((sec) => !(blocksOf(sec).length && blocksOf(sec).every((x) => (x.type === "text" && !plain(x.props.html)) || (x.type === "offer" && !x.props.title))));

  // Restaurant wording for businesses that aren't one (e.g. a cake maker on the café design).
  if (!/table|restaurant|dine|dining|reservation|eat in|sit in/i.test(`${b.description} ${b.services}`)) {
    for (const page of site.pages) for (const sec of page.sections) for (const bl of blocksOf(sec)) {
      if (bl.type === "buttons") for (const it of bl.props.items) if (/book a table/i.test(it.text)) Object.assign(it, { text: "Get in touch", href: site.pages.some((p) => p.slug === "contact") ? "/contact" : "#contact" });
      if (bl.type === "heading" && /^book a table$/i.test(bl.props.text)) bl.props.text = "Get in touch";
    }
  }

  // 4. Richer home page: an About section with a photo, and where they work.
  const home = site.pages.find((p) => p.slug === "index") || site.pages[0];
  const homeText = JSON.stringify(home.sections);
  const photoAlt = `${site.business?.keywords || name}`.split(" ").slice(0, 5).join(" ");
  const insertAt = () => Math.max(1, home.sections.length - 1);
  if (desc.length >= 2 && !/About|Our story|Who we are|Meet/i.test(homeText)) {
    home.sections.splice(Math.min(home.sections.length - 1, 3), 0, { ...createSection({ layout: "1-1", valign: "center", padding: "lg" }, [
      [createBlock("image", { alt: photoAlt, ratio: "4:3", rounded: true, frame: "shadow" })],
      [createBlock("heading", { text: `About ${name}`, level: 2 }), createBlock("text", { html: paras(b.description) }), createBlock("buttons", { items: [{ text: "Get in touch", href: "#contact", style: "primary", icon: "none" }] })],
    ]) });
  }
  if (area && !/Where we work|areas we cover/i.test(homeText)) {
    const towns = area.split(/,|\band\b|&/).map((t) => t.trim()).filter(Boolean);
    home.sections.splice(insertAt(), 0, createSection({ layout: "1-1", valign: "center", padding: "lg" }, [
      [createBlock("heading", { text: "Where we work", level: 2 }), createBlock("text", { html: `<p>${esc(`${name} covers ${area}.${b.address ? ` You'll find us at ${b.address}.` : ""}`)}</p>` }), ...(towns.length > 1 ? [createBlock("list", { items: towns, icon: "symbol", symbol: "i:map-pin" })] : []), ...(b.phone ? [createBlock("buttons", { items: [{ text: `Call ${b.phone}`, href: `tel:${phoneDigits}`, style: "primary", icon: "i:phone" }] })] : [])],
      [createBlock("map", { address: b.address || area, height: 340, onClick: true })],
    ]));
  }

  // 5. A finishing touch: photos or icons, depth, rhythm and movement.
  site.theme.layout = { ...site.theme.layout, motion: site.theme.layout?.motion && site.theme.layout.motion !== "none" ? site.theme.layout.motion : "fade-up" };
  site.theme.buttons = { ...site.theme.buttons, hover: site.theme.buttons?.hover && site.theme.buttons.hover !== "none" ? site.theme.buttons.hover : "lift", shadow: true };
  for (const page of site.pages) {
    page.sections.forEach((sec, i) => {
      const bl = blocksOf(sec);
      // The first section: a bold, animated headline over a photo or colour.
      if (i === 0) {
        const h1 = bl.find((x) => x.type === "heading");
        if (h1 && page.slug === "index") h1.style = { ...(h1.style || {}), textEffect: h1.style?.textEffect || "words-up" };
        if (sec.props.background === "image") sec.style = { tintDir: "diagonal", tint2: site.theme.colors.primary, tintOpacity: 62, ...(sec.style || {}), ...(sec.style?.shapeBottom ? {} : { shapeBottom: "wave", shapeH: 56 }) };
        else if (["dark", "primary"].includes(sec.props.background)) sec.style = { bg: site.theme.colors.dark, bg2: site.theme.colors.primary, bgAnimate: true, ...(sec.style || {}), ...(sec.style?.shapeBottom ? {} : { shapeBottom: "curve", shapeH: 50 }) };
        return;
      }
      // Call-to-action bands: a moving gradient and a soft wave edge.
      if (["dark", "primary"].includes(sec.props.background) && bl.some((x) => x.type === "buttons") && !has(sec, "form")) {
        sec.style = { bg: site.theme.colors.dark, bg2: site.theme.colors.primary, bgAnimate: true, ...(sec.style || {}), ...(sec.style?.shapeTop ? {} : { shapeTop: "waves", shapeH: 40 }) };
      }
      // Cards lift when you point at them; services get a photo each when there are photos to use.
      for (const card of bl.filter((x) => x.type === "card")) {
        card.props.style = card.props.style === "plain" || card.props.style === "outline" ? card.props.style : "shadow";
        card.style = { hover: "lift", ...(card.style || {}) };
        if (photos && services.some((sv) => sv.title === card.props.title)) card.props.icon = "";
      }
    });
    // Alternate plain and tinted backgrounds so sections don't run together (a title stays with what follows it).
    let tint = false;
    page.sections.forEach((sec, i) => {
      if (i === 0 || i === page.sections.length - 1 && sec.props.background !== "default") return;
      if (!["default", "surface"].includes(sec.props.background)) { tint = false; return; }
      const prev = page.sections[i - 1];
      const joined = prev && onlyTitle(prev) && i - 1 > 0 && ["default", "surface"].includes(prev.props.background);
      if (!joined) tint = !tint;
      sec.props.background = tint ? "surface" : "default";
    });
    // Titles sit close to the cards under them.
    page.sections.forEach((sec, i) => {
      const next = page.sections[i + 1];
      if (i > 0 && onlyTitle(sec) && next && next.props.background === sec.props.background && !sec.style?.shapeBottom) {
        sec.style = { ...(sec.style || {}), padding: { d: { b: 8 }, t: { b: 8 }, m: { b: 8 } } };
        next.style = { ...(next.style || {}), padding: { d: { t: 24 }, t: { t: 20 }, m: { t: 16 } } };
      }
    });
  }

  // 6. Footer links to their social media, and the look they asked for.
  const socials = String(b.socials || "").split(/[\s,]+/).filter((l) => /\w+\.\w+\//.test(l)).map((l) => (l.startsWith("http") ? l : `https://${l}`));
  for (const url of socials.slice(0, 5)) {
    const label = (url.match(/facebook|instagram|linkedin|tiktok|youtube|twitter|x\.com/i)?.[0] || "Social").replace(/^./, (c) => c.toUpperCase()).replace("X.com", "X");
    if (!site.footer.links.some((l) => l.href === url)) site.footer.links.push({ text: label, href: url });
  }
  if (b.kit && STYLE_KITS.some((k) => k.id === b.kit)) applyStyleKit(site, b.kit);
  site.name = name;
  if (!b.phone && !b.email) todo.push("Add a phone number or email address so customers can reach them.");
  if (!desc.length) todo.push("Write a few lines about the business for the home page.");
  if (!b.logoUrl) todo.push("Add their logo if they have one.");
  if (!(b.photos || []).length) todo.push(photos ? "The photos are stock photos: swap in their own if they have some." : "Add some photos (or a free Pixabay key in settings.txt, so websites get stock photos).");
  return { site: normalizeSite(site), todo: [...new Set(todo)] };
}

// The client's answers (from a form or a WHMCS order) → a brief.
const FIELD_MAP = [
  ["name", /business name|company name|business called|name of (your|the) business/],
  ["tagline", /tagline|slogan|headline/],
  ["description", /what (does|do) (your|the) business|about (your|the) business|describe|description|tell us about/],
  ["services", /services|what you offer|products|treatments|classes/],
  ["prices", /price|cost|menu|rates/],
  ["area", /area|where.*(cover|work|based)|towns|locations?/],
  ["hours", /hours|opening|open times/],
  ["phone", /phone|mobile|telephone/],
  ["email", /e-?mail/],
  ["address", /address|postcode/],
  ["reviews", /review|testimonial|what customers say/],
  ["highlights", /why (choose|us)|highlights|qualif|accreditation|stand out/],
  ["socials", /facebook|instagram|social|links/],
  ["kit", /style|look|feel/],
];
export function briefFromAnswers(answers = {}) {
  const brief = {};
  for (const [label, value] of Object.entries(answers)) {
    const l = String(label).toLowerCase();
    const v = String(value ?? "").trim();
    if (!v || /^(on|yes|true)$/i.test(v) || /^\d+ pictures? attached$/.test(v)) continue;
    const hit = FIELD_MAP.find(([, re]) => re.test(l));
    if (!hit) continue;
    const key = hit[0];
    if (key === "kit") { brief.kit = STYLE_KITS.find((k) => k.name.toLowerCase().includes(v.toLowerCase()) || v.toLowerCase().includes(k.id))?.id || ""; continue; }
    brief[key] = brief[key] ? `${brief[key]}\n${v}` : v;
  }
  return brief;
}
