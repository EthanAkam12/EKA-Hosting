// EKA Hosting's plans and prices, in one place: the website's price boxes
// and Otto's WHMCS setup check both use this, so they can't disagree.
//
// Prices are per month on a yearly plan (what the website shows). In WHMCS,
// set the yearly price to 12 × that, and the monthly price about 20% higher.

// billing "yearly": the price is per month on a yearly plan (monthly billing ~20% more).
// billing "monthly": the price is the monthly price (yearly = 10 months: 2 months free).
const plan = (group, name, monthly, features, { featured = false, setup = 0, customFields = false, billing = "yearly" } = {}) => ({ group, name, monthly, features, featured, setup, customFields, billing });

export const PLAN_GROUPS = ["Website Builder", "Web Hosting", "Done-for-you Websites", "For Hosting Companies"];

export const PLANS = [
  plan("Website Builder", "Builder Starter", 8, ["1 website, designed by AI", "Booking & enquiry forms", "Free SSL and an email address", "Free domain connection help", "UK support"]),
  plan("Website Builder", "Builder Business", 15, ["Everything in Starter", "Online shop and blog", "Newsletter sign-ups and pop-ups", "More AI help each month", "5 email addresses", "Visitor statistics"], { featured: true }),
  plan("Website Builder", "Builder Pro", 24, ["3 websites", "The most AI help each month", "Brand kits and local area pages", "Priority support"]),
  plan("Web Hosting", "Hosting Starter", 3.99, ["1 website", "10GB space", "Free SSL", "5 email addresses", "Daily backups"]),
  plan("Web Hosting", "Hosting Business", 6.99, ["5 websites", "50GB space", "Unlimited email", "Daily backups", "Staging sites"], { featured: true }),
  plan("Web Hosting", "Hosting Pro", 12.99, ["Unlimited websites", "100GB space", "Unlimited email", "Priority support"]),
  // Done-for-you: a one-off setup fee, then Builder Business hosting.
  plan("Done-for-you Websites", "Done-for-you website: Launch", 15, ["Up to 5 pages", "Your design, words and photos", "Domain connected", "Google listing set up", "Then Builder Business at £15/month"], { setup: 299, customFields: true }),
  plan("Done-for-you Websites", "Done-for-you website: Growth", 15, ["Up to 10 pages", "Online shop, blog or bookings", "Brand colours and brand kit", "3 local area pages", "1 round of changes", "Then Builder Business at £15/month"], { setup: 599, customFields: true, featured: true }),
  plan("Done-for-you Websites", "Care plan", 25, ["Up to 30 minutes of changes a month", "A monthly check-up", "A monthly visitors report", "Add it to any website"], { billing: "monthly" }),
  plan("For Hosting Companies", "Builder licence: Starter", 29, ["Up to 100 customer accounts", "Your brand, not ours", "cPanel, DirectAdmin & WHMCS plugins", "14-day free trial"], { billing: "monthly" }),
  plan("For Hosting Companies", "Builder licence: Growth", 59, ["Up to 500 customer accounts", "Everything in Starter", "Priority support"], { featured: true, billing: "monthly" }),
  plan("For Hosting Companies", "Builder licence: Unlimited", 99, ["Unlimited customer accounts", "Everything in Growth", "2 months free on yearly licences"], { billing: "monthly" }),
];

// The questions done-for-you customers answer when they order (WHMCS custom
// fields, "Show on Order Form" ticked). Bea reads them to build the website.
export const ORDER_QUESTIONS = [
  ["Business name", "Text Box", true],
  ["What does your business do?", "Text Area", true],
  ["Services (one per line)", "Text Area", false],
  ["Areas you cover", "Text Box", false],
  ["Opening hours", "Text Area", false],
  ["Prices (optional, one per line)", "Text Area", false],
  ["Customer reviews (optional, one per line)", "Text Area", false],
  ["Why do customers choose you? (optional)", "Text Area", false],
  ["Facebook or Instagram links (optional)", "Text Box", false],
  ["Which style do you like?", "Drop Down: Modern, Elegant, Bold, Minimal, Playful, Luxury, Natural, Warm & friendly, Corporate, Fresh", false],
];

export const DOMAINS = [["co.uk", 9.99], ["uk", 9.99], ["com", 13.99]];

export const ADDONS = ["Domain names: .co.uk £9.99 a year, .com £13.99 a year", "Extra AI help: £5 for a top-up", "An extra website on a builder plan: £4 a month", "A professional logo: £49", "Moving your website to us: free"];

const money = (n) => (Number.isInteger(n) ? `£${n}` : `£${n.toFixed(2)}`);
/** For the website's price boxes: [name, price, period, features, featured]. */
export function priceBoxes(group) {
  return PLANS.filter((p) => p.group === group).map((p) => [
    p.name.replace(/^(Done-for-you website|Builder licence): |^Hosting /, ""),
    p.setup ? money(p.setup) : `${p.name === "Care plan" ? "+" : ""}${money(p.monthly)}`,
    p.setup ? " one-off" : p.group === "For Hosting Companies" ? "/month per server" : "/month",
    p.features, p.featured,
  ]);
}
/** What WHMCS should charge. */
const r2 = (n) => Math.round(n * 100) / 100;
export const whmcsPrices = (p) => (p.billing === "monthly"
  ? { monthly: p.monthly, annually: r2(p.monthly * 10), setup: p.setup }
  : { monthly: r2(p.monthly * 1.2), annually: r2(p.monthly * 12), setup: p.setup });
