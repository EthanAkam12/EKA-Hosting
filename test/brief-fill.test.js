import { test } from "node:test";
import assert from "node:assert/strict";
import { SITE_DESIGNS, siteFromDesign } from "../shared/site-designs.js";
import { fillFromBrief, briefFromAnswers, parsePrices, parseReviews, parseServices, iconFor } from "../shared/brief-fill.js";
import { renderPage } from "../shared/render.js";

const BRIEF = {
  name: "Jo Evans Plumbing", description: "Friendly, reliable plumber covering York. Bathrooms, boilers and leaks.",
  services: "Boiler repairs - All makes, same day\nBathroom fitting\nLeaks and burst pipes", area: "York", phone: "07700 900123", email: "jo@example.co.uk",
  hours: "Monday – Friday: 8am – 6pm", reviews: "Absolute star. - Sarah, Acomb", highlights: "Gas Safe registered", prices: "Boiler service - £80\nHourly rate - £55", kit: "corporate",
};

test("parsing what clients write", () => {
  assert.deepEqual(parseServices("Boiler repairs - Same day\n• Bathrooms"), [{ title: "Boiler repairs", text: "Same day" }, { title: "Bathrooms", text: "" }]);
  assert.deepEqual(parseReviews('"Great job!" - Sarah, York'), [{ quote: "Great job!", name: "Sarah, York" }]);
  const p = parsePrices("Cakes:\nVictoria sponge - £3.50 - Homemade daily\nScone £2.20");
  assert.deepEqual(p.map((x) => [x.category, x.name, x.price]), [["Cakes", "Victoria sponge", "£3.50"], ["Cakes", "Scone", "£2.20"]]);
  assert.equal(iconFor("Boiler repairs"), "i:flame");
  assert.deepEqual(briefFromAnswers({ "Business name": "Rosie's", "What does your business do?": "Cakes", "Your services (one per line)": "Cakes\nBread", "Areas you cover": "Leeds", "Which style do you like?": "Warm & friendly", "I'm happy to be contacted": "on" }),
    { name: "Rosie's", description: "Cakes", services: "Cakes\nBread", area: "Leeds", kit: "friendly" });
});

test("every design filled without AI: the client's details in, no made-up claims or placeholders left", () => {
  for (const d of SITE_DESIGNS) {
    const { site, todo } = fillFromBrief(siteFromDesign(d.id, { name: BRIEF.name }), BRIEF);
    const json = JSON.stringify(site);
    for (const bad of ["01234 567890", "Your phone", "your@email.com", "hello@business.co.uk", "Fantastic service from start", "since 2010", "5-star rated", "Fully insured", "Accredited", "12 High Street", "Est. 2015", "Alex Morgan", "20% off"]) assert.ok(!json.includes(bad), `${d.id} still has "${bad}"`);
    assert.ok(json.includes("07700 900123") || json.includes("07700900123"), `${d.id} has the phone number`);
    assert.ok(json.includes("Boiler repairs"), `${d.id} has the services`);
    assert.ok(json.includes("Absolute star."), `${d.id} has the real review`);
    assert.equal(site.pages[0].sections[0].columns.flatMap((c) => c.blocks).find((b) => b.type === "heading").props.text, "Jo Evans Plumbing");
    assert.equal(site.theme.fonts.heading, "montserrat", "the chosen style");
    assert.ok(Array.isArray(todo));
    for (const page of site.pages) assert.ok(renderPage(site, page, { base: "/" }).includes("<html"), `${d.id}/${page.slug} renders`);
  }
});

test("without reviews or highlights, the examples are taken out rather than left", () => {
  const { site } = fillFromBrief(siteFromDesign("trades", { name: "X" }), { name: "X", description: "We fix things." });
  const types = site.pages.flatMap((p) => p.sections.flatMap((s) => s.columns.flatMap((c) => c.blocks.map((b) => b.type))));
  assert.ok(!types.includes("testimonial"));
  assert.ok(!JSON.stringify(site).includes("Fully insured"));
});
