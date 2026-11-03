import { test } from "node:test";
import assert from "node:assert/strict";
import { siteAdvice } from "../shared/advice.js";
import { siteFromDesign } from "../shared/site-designs.js";
import { normalizeSite, createEmptySite, createSection, createBlock, createPage } from "../shared/schema.js";
import { createAi } from "../server/ai/index.js";

test("suggestions spot what a small-business site is missing, and go once dealt with", () => {
  const s = createEmptySite("Bob's Plumbing");
  s.business = { address: "1 Mill Lane, Leeds" };
  const about = createPage("About");
  about.sections = [createSection({}, [[createBlock("text", { html: "<p>We fix things.</p>" })]])];
  s.pages.push(about);
  const ids = siteAdvice(normalizeSite(s)).map((a) => a.id);
  for (const id of ["reviews", "faq", "cta", "about", "map", "form", "seo", "local", "logo"]) assert.ok(ids.includes(id), id);
  assert.ok(!siteAdvice(normalizeSite(s), { dismissed: ["faq"] }).some((a) => a.id === "faq"), "hidden ones stay hidden");
  // A finished design has most things already.
  const full = siteFromDesign("trades", { name: "Bob's Plumbing", phone: "0113 000000" });
  const left = siteAdvice(full).map((a) => a.id);
  assert.ok(!left.includes("reviews") && !left.includes("form") && !left.includes("cta"), left.join(","));
});

test("AI SEO, ideas and local pages come back in the right shape", async () => {
  const site = siteFromDesign("trades", { name: "Bob's Plumbing" });
  const replies = {
    seo: JSON.stringify({ pages: [{ slug: "index", title: "Plumber in Leeds | Bob's Plumbing", description: "Friendly local plumbers." }] }),
    ideas: JSON.stringify({ ideas: [{ title: "Add prices", why: "People like prices.", instruction: "Add a price list to Services" }, { title: "no instruction" }] }),
    local: JSON.stringify({ page: { title: "x", slug: "x", sections: [{ type: "section", props: {}, columns: [{ blocks: [{ type: "heading", props: { text: "Plumber in Leeds", level: 1 } }] }] }] } }),
  };
  const ai = createAi({ provider: { name: "claude", model: "m", complete: async ({ kind, prompt }) => { if (kind === "local") assert.match(prompt.map((p) => p.text).join(""), /Plumber in Leeds[^]*different from the other local pages \(Wakefield\)/); return replies[kind]; } } });
  assert.equal((await ai.writeSeo({ site })).pages[0].title, "Plumber in Leeds | Bob's Plumbing");
  const { ideas } = await ai.siteIdeas({ site });
  assert.equal(ideas.length, 1, "ideas without an instruction are dropped");
  const { page } = await ai.localPage({ site, service: "Plumber", town: "Leeds", others: ["Wakefield"] });
  assert.deepEqual([page.title, page.slug, page.hidden], ["Plumber in Leeds", "plumber-in-leeds", true]);
});
