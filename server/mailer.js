// Sends email for sites hosted by the builder (form messages, booking
// requests, copies for visitors). Uses the settings' SMTP server if there is
// one, otherwise the server's own mail program (sendmail, which most Linux
// hosting servers have). With neither, messages are still kept in the
// editor's Messages list; they just aren't emailed.

import fs from "node:fs";
import nodemailer from "nodemailer";

export function createMailer(env = process.env) {
  let transport = null;
  let how = "";
  if (env.SMTP_HOST) {
    const port = Number(env.SMTP_PORT) || 587;
    transport = nodemailer.createTransport({
      host: env.SMTP_HOST, port,
      secure: env.SMTP_SECURE ? /^(1|true|yes)$/i.test(env.SMTP_SECURE) : port === 465,
      auth: env.SMTP_USER ? { user: env.SMTP_USER, pass: env.SMTP_PASS || "" } : undefined,
    });
    how = `SMTP (${env.SMTP_HOST})`;
  } else {
    const path = env.SENDMAIL_PATH || ["/usr/sbin/sendmail", "/usr/lib/sendmail"].find((p) => fs.existsSync(p));
    if (path && process.platform !== "win32") {
      transport = nodemailer.createTransport({ sendmail: true, path, newline: "unix" });
      how = "sendmail";
    }
  }
  const from = env.MAIL_FROM || `Website forms <website@${(env.BASE_DOMAIN || "localhost").replace(/^\.+/, "")}>`;
  return {
    enabled: !!transport,
    how,
    async send({ to, subject, text, replyTo, fromName }) {
      if (!transport || !to) return false;
      const sender = fromName ? { name: String(fromName).replace(/[\r\n"<>]/g, " ").slice(0, 80), address: from.match(/<([^>]+)>/)?.[1] || from } : from;
      await transport.sendMail({ from: sender, to, subject, text, replyTo: replyTo || undefined });
      return true;
    },
  };
}
