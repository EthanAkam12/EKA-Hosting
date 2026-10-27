// "Before you publish" checklist: shows what still needs doing, with a Show
// button that jumps to each problem. Before publishing it resolves to true
// ("Publish anyway") or false ("Fix first").

import { checkSite } from "/admin/shared/checks.js";
import { h, modal } from "../ui.js";

export function siteIssues(state) {
  const s = state.get();
  return checkSite(s.site, { formEmail: s.meta?.formEmail || "", ownHosting: !!s.meta?.deploy?.enabled });
}

export function showChecklist(state, { beforePublish = false } = {}) {
  const issues = siteIssues(state);
  const fixes = issues.filter((i) => i.level === "fix");
  const tips = issues.filter((i) => i.level === "tip");
  return new Promise((resolve) => {
    let result = false;
    const show = (issue) => {
      if (issue.pageId && issue.pageId !== state.get().pageId) state.setPage(issue.pageId);
      if (issue.nodeId) setTimeout(() => state.select(issue.nodeId), 50);
      m.close();
    };
    const row = (issue) => h("li", { class: `check-item ${issue.level}` },
      h("span", { class: "check-icon", "aria-hidden": "true" }, issue.level === "fix" ? "!" : "i"),
      h("span", { class: "grow" }, issue.page ? h("strong", {}, `${issue.page}: `) : null, issue.text),
      issue.pageId || issue.nodeId ? h("button", { class: "btn btn-sm", onclick: () => show(issue) }, "Show") : null);
    const body = h("div", {},
      !issues.length ? h("p", { class: "check-ok" }, "✓ Everything looks good.") : null,
      fixes.length ? h("div", {}, h("h3", {}, `Needs fixing (${fixes.length})`), h("ul", { class: "check-list" }, fixes.map(row))) : null,
      tips.length ? h("div", {}, h("h3", {}, `Worth doing (${tips.length})`), h("ul", { class: "check-list" }, tips.map(row))) : null,
    );
    const m = modal({
      title: beforePublish ? "Before you publish" : "Site check",
      wide: true,
      body,
      footer: beforePublish
        ? [h("button", { class: "btn", onclick: () => m.close() }, "Fix first"), h("button", { class: "btn btn-primary", onclick: () => { result = true; m.close(); } }, "Publish anyway")]
        : [h("button", { class: "btn btn-primary", onclick: () => m.close() }, "Close")],
      onClose: () => resolve(result),
    });
  });
}
