// "Suggestions for this site": quick, free checks of what a small-business
// website usually needs, each with a one-click fix. (Different from the
// pre-publish check, which looks for mistakes; these are improvements.)
//
// Each suggestion: { id, title, why, fix } where fix is one of
//   { type: "addSection", library, page: slug, before: "contact" | null }  add a library section (and fill it with AI)
//   { type: "fillPage", page: slug }                                       rewrite a thin page with AI
//   { type: "seo" }                                                        write Google titles and descriptions
//   { type: "site", tab }                                                  open a tab to do it by hand

const blocksOf = (page) => page.sections.flatMap((s) => s.columns.flatMap((c) => c.blocks));
const words = (page) => blocksOf(page).map((b) => [b.props.text, b.props.html, b.props.title, b.props.quote, ...(b.props.items || []).map((i) => (typeof i === "string" ? i : `${i.q || ""} ${i.a || ""} ${i.text || ""} ${i.title || ""}`))].filter((x) => typeof x === "string").join(" "))
  .join(" ").replace(/<[^>]+>/g, " ").split(/\s+/).filter(Boolean).length;

export function siteAdvice(site, { dismissed = [] } = {}) {
  const pages = site.pages.filter((p) => !p.post && p.slug !== "privacy");
  const home = site.pages[0];
  const all = pages.flatMap(blocksOf);
  const has = (type) => all.some((b) => b.type === type);
  const b = site.business || {};
  const out = [];
  const contactPage = pages.find((p) => p.slug === "contact");

  if (!has("testimonial") && !all.some((x) => x.type === "marquee" && /“/.test(JSON.stringify(x.props)))) {
    out.push({ id: "reviews", title: "Add customer reviews", why: "Reviews are what most visitors look for before they get in touch.", fix: { type: "addSection", library: "rev-3", page: "index", before: "contact" } });
  }
  if (!has("faq")) {
    out.push({ id: "faq", title: "Answer common questions", why: "An FAQ saves you phone calls and helps you show up in Google for questions people ask.", fix: { type: "addSection", library: "faq-narrow", page: contactPage ? "contact" : "index", before: "contact" } });
  }
  const firstButtons = blocksOf({ sections: home.sections.slice(0, 1) }).some((x) => x.type === "buttons" || x.type === "offer");
  if (!firstButtons && !site.header.ctaText) {
    out.push({ id: "cta", title: "Give visitors a clear next step", why: "The top of the home page has no button. Say what you want visitors to do: call, book or get a quote.", fix: { type: "addSection", library: "cta-primary", page: "index", before: null, after: 0 } });
  }
  const about = pages.find((p) => /about|story/.test(p.slug));
  if (about && words(about) < 80) {
    out.push({ id: "about", title: `Say more on the ${about.title} page`, why: "It's very short. People like to know who they're dealing with: your story, experience and what makes you different.", fix: { type: "fillPage", page: about.slug } });
  }
  if (b.address && !has("map")) {
    out.push({ id: "map", title: "Show where you are", why: "You have an address but no map. A map and opening hours help people find you.", fix: { type: "addSection", library: "hours-map", page: contactPage ? "contact" : "index", before: null } });
  } else if (b.hours && !has("hours")) {
    out.push({ id: "hours", title: "Show your opening hours", why: "You've added opening hours but they aren't on the site.", fix: { type: "addSection", library: "hours-dark", page: contactPage ? "contact" : "index", before: null } });
  }
  if (!has("form") && !has("newsletter")) {
    out.push({ id: "form", title: "Let people get in touch from the site", why: "There's no contact, enquiry or booking form, so visitors have to call or email.", fix: { type: "addSection", library: "contact-form", page: contactPage ? "contact" : "index", before: null } });
  }
  const noSeo = pages.filter((p) => !p.seo.description.trim());
  if (noSeo.length) {
    out.push({ id: "seo", title: `Write Google descriptions (${noSeo.length} page${noSeo.length === 1 ? "" : "s"})`, why: "The short text under your link in Google search results. Without it, Google guesses, often badly.", fix: { type: "seo" } });
  }
  if (!pages.some((p) => p.slug.includes("-in-")) && (b.address || /\b(in|near|across)\s+[A-Z][a-z]+/.test(b.type || ""))) {
    out.push({ id: "local", title: "Get found in nearby towns", why: "Pages like \"Plumber in Leeds\" help you show up when people search for your service in places you cover.", fix: { type: "local" } });
  }
  if (!site.header.logoImage) out.push({ id: "logo", title: "Add your logo", why: "A logo makes the site look established. Click the header to upload one.", fix: { type: "site", select: "header" } });
  if (!b.phone && !b.email) out.push({ id: "details", title: "Add your contact details", why: "Google and the phone Call button use the phone number and email in Site → Business details.", fix: { type: "site", tab: "settings" } });
  return out.filter((x) => !dismissed.includes(x.id));
}
