// The wording of form emails, shared by the builder (hosted sites) and the
// contact.php it writes for sites published to other hosting.

export const FORM_WORDS = {
  contact: { noun: "message", subject: "New message from your website" },
  enquiry: { noun: "enquiry", subject: "New enquiry from your website" },
  booking: { noun: "booking request", subject: "New booking request from your website" },
};

export const formWords = (kind) => FORM_WORDS[kind] || FORM_WORDS.contact;

/** The email to the business owner. `lines` = [[label, value]]. */
export function ownerEmail({ kind, siteName, lines, page }) {
  const w = formWords(kind);
  const body = `You have a new ${w.noun} from the form on your website${page ? ` (${page} page)` : ""}.\n\n${lines.map(([l, v]) => `${l}:\n${v}\n`).join("\n")}\n--\nSent ${new Date().toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" })}. Reply to this email to answer them.`;
  return { subject: kind === "booking" ? `${w.subject}: ${siteName}` : w.subject, body };
}

/** The copy sent to the visitor who filled in the form. */
export function visitorEmail({ kind, siteName, lines, deposit = null }) {
  const w = formWords(kind);
  const pay = deposit?.link ? `\n\n${deposit.text || "Pay the deposit"}: ${deposit.link}` : "";
  return {
    subject: `We've received your ${w.noun}: ${siteName}`,
    body: `Thanks for getting in touch with ${siteName}. This is a copy of your ${w.noun}; we'll reply as soon as we can.${kind === "booking" ? " Your booking isn't confirmed until we get back to you." : ""}${pay}\n\n${lines.map(([l, v]) => `${l}:\n${v}\n`).join("\n")}\n--\n${siteName}`,
  };
}
