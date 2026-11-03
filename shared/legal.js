// A privacy policy page written from what the site actually does: its forms
// and their fields, maps, videos, payment links, web fonts and tracking code.
// A sensible starting point for a small business, not legal advice: the
// owner should read it and adjust it.

import { createPage, createSection, createBlock, FONT_CHOICES } from "./schema.js";
import { words } from "./i18n.js";

const esc = (v) => String(v ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const list = (items) => (items.length > 1 ? `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}` : items[0] || "");

/** What the site uses, for the policy and the editor. */
export function siteFacts(site) {
  const blocks = site.pages.flatMap((p) => p.sections.flatMap((s) => s.columns.flatMap((c) => c.blocks)));
  const forms = blocks.filter((b) => b.type === "form");
  const fields = [...new Set(forms.flatMap((f) => f.props.fields.map((x) => x.label.trim().toLowerCase()).filter(Boolean)))];
  const kinds = new Set(forms.map((f) => f.props.kind));
  const links = blocks.flatMap((b) => (b.type === "products" ? b.props.items.map((i) => i.href) : b.type === "buttons" ? b.props.items.map((i) => i.href) : []));
  const fonts = [site.theme.fonts.heading, site.theme.fonts.body].some((f) => FONT_CHOICES[f]?.google);
  return {
    forms: forms.length > 0, fields, booking: kinds.has("booking"), enquiry: kinds.has("enquiry"),
    copies: forms.some((f) => f.props.confirmEmail),
    maps: blocks.some((b) => b.type === "map" && b.props.address),
    videos: blocks.some((b) => b.type === "video" && b.props.url) || blocks.some((b) => b.style?.bgVideo),
    stripe: links.some((l) => /stripe\.com/i.test(l || "")),
    paypal: links.some((l) => /paypal\./i.test(l || "")),
    fonts,
    tracking: !!site.legal?.trackingCode?.trim() || blocks.some((b) => b.type === "html" && b.props.consent),
  };
}

export function privacyPolicySections(site) {
  const b = site.business || {};
  const f = siteFacts(site);
  const name = esc(site.name);
  const today = new Date().toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });
  const contact = [b.email && `email <a href="mailto:${esc(b.email)}">${esc(b.email)}</a>`, b.phone && `call ${esc(b.phone)}`, b.address && `write to ${esc(b.address)}`].filter(Boolean);
  const contactLine = contact.length ? `To ask about your information, ${list(contact)}.` : "To ask about your information, use the contact details on this website.";
  const uk = String(site.lang || "en-GB") === "en-GB" || site.lang === "cy";

  const parts = [
    ["Privacy policy", `<p>This policy explains how ${name} ("we", "us") uses personal information we receive through this website. Last updated ${today}.</p>`],
    ["Who we are", `<p>${name}${b.address ? `, ${esc(b.address)}` : ""} is responsible for the personal information described here. ${contactLine}</p>`],
  ];

  const what = [];
  if (f.forms) {
    const kinds = [f.booking && "booking request", f.enquiry && "enquiry", "message"].filter(Boolean);
    what.push(`<p>When you send us a ${list([...new Set(kinds)])} through a form on this website, we receive the details you enter${f.fields.length ? `: ${esc(list(f.fields.slice(0, 10)))}` : ""}.${f.copies ? " If you give an email address, we email you a copy of what you sent." : ""}</p>`);
  }
  what.push(`<p>If you email or phone us, we receive your contact details and what you tell us.</p>`);
  what.push(`<p>Like most websites, the server that hosts this site keeps short-lived technical logs (such as IP addresses and the pages requested) to keep it secure and working.</p>`);
  parts.push(["What we collect", what.join("")]);

  const why = [`<li>to reply to you and give you what you asked for${f.booking ? ", including arranging and confirming bookings" : ""}${f.enquiry ? " and quotes" : ""};</li>`, "<li>to keep our records and meet our legal obligations;</li>", "<li>to keep this website secure.</li>"];
  parts.push(["Why we use it", `<p>We use your information:</p><ul>${why.join("")}</ul><p>We do this because it's needed to take steps you've asked for (such as a booking or a quote), or because we have a legitimate interest in answering enquiries and running our business. We don't sell your information or use it for marketing without your permission.</p>`]);

  parts.push(["How long we keep it", "<p>We keep messages and booking details for as long as we need them to deal with your request, and then for up to two years in case you contact us again, unless the law requires us to keep them longer (for example, financial records).</p>"]);

  const others = ["<li>our website hosting provider, which stores this website and the messages sent through it;</li>"];
  if (f.maps) others.push("<li>Google Maps: the map on this site only loads if you choose to show it, and then Google's privacy policy applies;</li>");
  if (f.videos) others.push("<li>YouTube or Vimeo: videos only load from them when you play one;</li>");
  if (f.stripe) others.push("<li>Stripe, which takes card payments when you buy something; we never see your full card details;</li>");
  if (f.paypal) others.push("<li>PayPal, when you choose to pay with it;</li>");
  if (f.fonts) others.push("<li>Google Fonts, which supplies the lettering on this website and so receives your IP address;</li>");
  if (f.tracking) others.push("<li>the analytics or other services we use only if you accept cookies (see below).</li>");
  parts.push(["Who else sees it", `<p>We only share your information when we need to, with:</p><ul>${others.join("")}</ul><p>We may also share it if the law requires us to.</p>`]);

  parts.push(["Cookies", f.tracking
    ? `<p>We'd like to use cookies to understand how this website is used. They're only set if you choose <strong>Accept</strong> on the cookie notice. You can change your choice at any time: <a href="#cookies">${esc(words(site.lang).cookieSettings)}</a>.</p>`
    : `<p>This website doesn't use cookies to track you.${f.maps || f.videos ? " A map or video only sets cookies if you choose to load it." : ""}</p>`]);

  parts.push(["Your rights", `<p>You can ask us for a copy of the information we hold about you, and ask us to correct it, delete it or stop using it. ${contactLine}${uk ? ` If you're unhappy with how we've handled your information, you can complain to the Information Commissioner's Office (<a href="https://ico.org.uk" target="_blank" rel="noopener">ico.org.uk</a>).` : " You can also complain to your local data protection authority."}</p>`]);
  parts.push(["Changes to this policy", "<p>We'll update this page if how we use your information changes.</p>"]);

  const blocks = parts.flatMap(([title, html], i) => [
    createBlock("heading", { text: title, level: i === 0 ? 1 : 2 }),
    createBlock("text", { html }),
  ]);
  return [createSection({ width: "narrow", padding: "lg" }, [blocks])];
}

/**
 * Adds a privacy policy page (or rewrites it), left out of the menu and
 * linked from the footer, plus "Cookie settings" when there's a cookie notice.
 * Mutates and returns the site.
 */
export function ensurePrivacyPage(site, { rewrite = false } = {}) {
  let page = site.pages.find((p) => p.slug === "privacy" && !p.post);
  if (!page) {
    page = createPage("Privacy policy", "privacy");
    page.hidden = true;
    page.seo.description = `How ${site.name} uses personal information sent through this website.`;
    site.pages.push(page);
    rewrite = true;
  }
  if (rewrite) page.sections = privacyPolicySections(site);
  const w = words(site.lang);
  site.footer.links = site.footer.links || [];
  if (!site.footer.links.some((l) => /^\/privacy\/?$/.test(l.href))) site.footer.links.push({ text: w.privacy, href: "/privacy" });
  const notice = site.legal?.cookieNotice === "always" || (site.legal?.cookieNotice !== "off" && siteFacts(site).tracking);
  if (notice && !site.footer.links.some((l) => l.href === "#cookies")) site.footer.links.push({ text: w.cookieSettings, href: "#cookies" });
  return site;
}
