# EKA Hosting

An AI website builder for making and managing customer websites.

- **Describe a business → describe each page → pick a design → get a whole site.** A short brief (description, logo, contact details, colours, style, pages) plus a sentence or two per page gives you a homepage design to judge. Ask for another design, or type changes page by page ("make it darker", "on the Gallery page show 9 photos"), then confirm and the AI builds every page in that style. Without an AI key the changes are kept as a to-do list in the editor's AI tab.
- **Change it by asking.** "Add a pricing section", "make it feel more premium", or select one block and say "make this punchier".
- **Or change it by hand.** A drag-and-drop editor in the style of Elementor or Kadence: drag blocks and ready-made sections onto the page, double-click text to edit it in place, and tweak anything in the side panel. Each block and section has Content, Style and Advanced tabs: margin and padding per device, background colours and gradients, borders, corner radius, shadows, font size, max width, entrance animations, hover effects and hide-on-mobile/tablet/desktop. Site-wide button, text and layout settings (button size, shape and hover animation; text sizes; content width; section spacing; scroll animations) are in the Style tab. Desktop, tablet and mobile previews; undo/redo; autosave; a full version history.
- **Fast customer sites.** Published pages are plain HTML with the CSS inlined and **no JavaScript at all**. The mobile menu, FAQs and form messages are pure CSS, photos are auto-converted to WebP with phone-sized copies, and YouTube embeds load only a thumbnail until clicked. Animations are pure CSS too (they play as sections scroll into view, and switch off for visitors who turn off motion). A typical page is ~20 KB.
- **Hosting built in.** Each site is served at `<name>.<your-domain>` and/or the customer's own domain, with contact-form messages collected for you.

## Try it on Windows (no coding needed)

1. Install **Node.js** (the "LTS" version) from [nodejs.org](https://nodejs.org/en/download). Click through the installer with the default options.
2. On this GitHub page, click the green **Code** button, then **Download ZIP**. Right-click the downloaded file, choose **Extract All**, and open the extracted folder.
3. Double-click **start-windows.bat**. The first time, it installs what it needs (a minute or two), then opens the builder in your browser.
   If Windows shows a blue "Windows protected your PC" box, click **More info**, then **Run anyway**.
4. Log in with the password **change-me**.
5. To choose your own password or turn on AI, open **settings.txt** in the same folder with Notepad, edit it, save, then close the black window and double-click **start-windows.bat** again.

Keep the black window open while you use the builder; closing it stops the builder. Everything you make is saved in the `data` folder.

**Updating:** close the black window, then double-click **update-windows.bat**. It downloads the latest version from GitHub and keeps your `data` folder and `settings.txt` (and saves a backup of both in `backups` first).

## Quick start

```bash
npm install
ADMIN_PASSWORD=choose-a-password ANTHROPIC_API_KEY=sk-ant-... npm start
```

Open http://localhost:3000/admin and log in.

Without `ANTHROPIC_API_KEY` everything still works except AI: new sites start from a template and you edit by hand.

Settings can also go in a `settings.txt` or `.env` file next to the code (see `settings.example.txt`); real environment variables take priority.

Run the tests with `npm test`.

## Settings (environment variables)

| Variable | What it does |
| --- | --- |
| `ADMIN_PASSWORD` | Password for the builder. If unset, one is generated on first run and printed (and saved to `data/.admin-password`). |
| `ANTHROPIC_API_KEY` | Turns on AI generation and editing (Claude). |
| `AI_MODEL` | Claude model for building new sites. Default `claude-opus-5-5` (best quality). |
| `AI_EDIT_MODEL` | Claude model for AI changes to existing sites. Default `claude-sonnet-5-5` (faster and about half the price). |
| `AI_EFFORT` / `AI_CONCEPT_EFFORT` / `AI_GENERATE_EFFORT` | How hard the AI thinks for edits / design previews / building the full site (`low`…`max`). Defaults `medium` / `medium` / `high`. Lower is faster and cheaper. |
| `AI_PROVIDER` | `claude` (default when a key is set) or `demo` (templates only). |
| `BASE_DOMAIN` | e.g. `ekahosting.com`. Sites are then served at `https://<site-name>.ekahosting.com`. Without it, sites are served at `/s/<site-name>/` on the builder. |
| `PORT` | Default `3000`. |
| `HOST` | Set to `127.0.0.1` to accept connections from this computer only (the Windows start file does this). |
| `DATA_DIR` | Where sites, images and messages are stored. Default `./data`. **Back this folder up.** |
| `NODE_ENV=production` | Marks login cookies as HTTPS-only. |
| `TRUST_PROXY` | Set to `1` when running behind a reverse proxy such as Caddy or Nginx, so rate limits see real visitor IPs. |
| `SERVER_IP` | This server's public IP, for the domain helper's DNS instructions. Default: whatever `BASE_DOMAIN` resolves to. |
| `BACKUP_DIR` / `BACKUP_KEEP` | Where daily backups go (default `<data>/backups`) and how many to keep (default 7). |
| `LICENCE_KEY` | The licence key from the seller (or enter it on the Customers page). |
| `BUILDER_URL` / `HOST_API_KEY` | The public address used in sign-in links, and the key for cPanel/DirectAdmin/WHMCS (see `tools/README.md`). |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `MAIL_FROM` | Email for form messages and password resets. Without them, the server's `sendmail` is used if it has one. |

## Going live

1. Get a server (any small VPS works) and a domain, e.g. `ekahosting.com`.
2. DNS: point `ekahosting.com` **and** `*.ekahosting.com` (wildcard) at the server.
3. Run the app with `BASE_DOMAIN=ekahosting.com NODE_ENV=production TRUST_PROXY=1`, e.g. with the included `Dockerfile` or a process manager like `pm2`.
4. Put [Caddy](https://caddyserver.com) in front for automatic HTTPS. `deploy/Caddyfile` covers the builder, every subdomain and customers' own domains.

The builder is at `https://admin.ekahosting.com/admin` (or the bare domain). A customer site called "bright-spark" is at `https://bright-spark.ekahosting.com`.

**Customer domains:** in the editor go to **Site → Custom domains** and add e.g. `www.brightspark.co.uk`. Then have the customer point their domain at your server (an `A` record to its IP, or a `CNAME` to `<site-name>.ekahosting.com`). Caddy issues the certificate automatically on the first visit.

## Installing on a Linux server (hosts)

From the unpacked builder folder, on Ubuntu/Debian (or any Linux with Node.js 20+ and systemd):

```bash
sudo bash tools/install-linux.sh
```

This installs Node.js if needed, copies the builder to `/opt/eka-builder`, keeps websites in `/var/lib/eka-builder`, runs it as a service on port 3000 and prints the administrator password. Then edit `/opt/eka-builder/settings.txt` and `sudo systemctl restart eka-builder`. Put Caddy in front for HTTPS (see below).

**Updating:** `sudo bash /opt/eka-builder/tools/update-linux.sh eka-builder-0.2.0.tar.gz` (or its web address). It backs up the websites and the current version to `/var/backups/eka-builder/` first, and puts the old version back if the new one doesn't start.

## Selling EKA Builder (licences and updates)

Each copy you sell asks your **licence server** whether its key is valid (twice a day; answers are signed, so they can't be faked). New installs get a 14-day trial. Without a valid licence, new websites, new customers and AI pause; **published websites always stay online**. If your licence server is unreachable, builders keep working for 14 days.

**Set up once, on your own server:**

1. `node licence-server/keys.mjs https://licence.yourdomain.com`. This makes your signing key (in `licence-server/data/`: back it up and never share it) and writes `server/licence-config.json`. **Commit that file**: it's how sold copies find your licence server.
2. Run the licence server: `LICENCE_ADMIN_PASSWORD=choose-one PORT=4100 node licence-server/server.mjs` (as a service, like the builder), with Caddy in front: `licence.yourdomain.com { reverse_proxy 127.0.0.1:4100 }`.
3. Open `https://licence.yourdomain.com/admin` (user `admin`). Make a licence key for each host: their name, how many servers, and an expiry date if it's a subscription. You see which servers use each key, their version, and how many websites and customers they have (counts only).

**Each release:** raise `version` in `package.json`, commit, and run `bash tools/make-release.sh`. Send hosts `dist/eka-builder-<version>.tar.gz` and their key. To tell everyone about an update, fill in **Announce an update** on the licence admin page: their dashboards show "Version x is available" with your notes and link.

Your own copy (without `server/licence-config.json` filled in) never asks for a key.

## Publishing to a customer's own hosting (any normal web host)

Sites don't have to be hosted by the builder. In the editor's **Site** tab, under **Your hosting (FTP)**:

1. Enter the FTP details the host gives you (server, username, password) and the folder (usually `public_html`). Click **Test connection**, then **Save**.
2. Tick **Upload to this hosting every time I click Publish**.
3. Under **Contact forms**, enter the email address messages should go to.

From then on **Publish** uploads the site straight to the host. Only changed files are sent, and the builder only ever removes files it uploaded itself. Contact forms work through a small `contact.php` that emails the owner (the host needs PHP, which almost all do). Prefer to upload by hand? Use **Download the published site as files** for a ZIP.

## Working with customers

- **Stock photos** (`PIXABAY_API_KEY`, free from pixabay.com/api/docs once logged in; or `PEXELS_API_KEY`): new designs get photos that suit the business instead of placeholder artwork, and the image picker searches Pixabay (or Pexels).
- **Site check**: before publishing, the builder lists anything visitors would notice (placeholders, template text, broken links, hard-to-read text, a form with nowhere to send messages) with a Show button for each.
- **Customer review links**: send the customer a link to the draft; they click anything to comment and press Approve. Comments appear in the editor's Site tab.
- **For Google and sharing**: every page gets an icon and share picture, the home page carries the business details (LocalBusiness), and live sites serve a sitemap.
- **Phone contact button**: an optional floating Call / WhatsApp button on phones.

## EKA HQ (runs the business; a separate program)

EKA HQ (`hq/`) is the main interface for running EKA Hosting, separate from the website builder. It's a full-screen pixel-art office with six AI staff, and tabs for what they're doing, things to approve, the numbers (revenue, recurring revenue, customers, websites), customers (with their hosting, invoices, tickets and websites), meetings and marketing.

- **Henry (boss):** a morning briefing, a weekly team meeting where everyone reports and suggests improvements, and messages to your phone (ntfy, Telegram or email) when something needs you and you're not in HQ.
- **Sam (support):** drafts replies to WHMCS tickets; you approve and they're posted to the ticket.
- **Bea (web designer):** builds done-for-you websites in the builder (from a WHMCS order or a form) and brings you a review link.
- **Alex (accounts):** welcome emails, friendly notes about overdue invoices, monthly check-ins with website customers.
- **Otto (operations):** new orders to accept, hosting servers, builder backups, disk, licence, failed builds, unanswered form messages, domains, and suspending long-unpaid services (with your approval).
- **Mia (marketing):** a marketing plan and ideas board, weekly social posts, blog posts for your own website, replies to enquiries, new ideas monthly.

Nothing reaches a customer or costs money until you approve it. Start it with `npm run hq` (or `start-hq-windows.bat`) and open http://localhost:3100; settings go in `hq-settings.txt` (see `hq-settings.example.txt`). HQ talks to the builder through its host API (`BUILDER_URL`, `BUILDER_API_KEY` = the builder's `HOST_API_KEY`) and to WHMCS through its API. To keep it running all the time, put it on a server: see [SERVER-SETUP.md](SERVER-SETUP.md).

## Help, support and the public demo

- **Help pages** are at `/help` and a **Support** page at `/support` (both public). Set `SUPPORT_EMAIL` to show your support address; the Support page fills in a ready-made email with the user's system details.
- **Demo mode** (`DEMO_MODE=1`) adds "Try the demo" to the login page. Each visitor gets a private workspace with no password. Publishing and FTP are off, AI use is capped (`DEMO_AI_PER_VISITOR`, `DEMO_AI_PER_DAY`), there's a site limit (`DEMO_SITES`), and demo sites are deleted after `DEMO_HOURS` (24 by default).

## Online shops (CubeCart)

The builder makes brochure sites; for a shop, install [CubeCart](https://www.cubecart.com) on the hosting and design the look here. In the editor's **Site** tab, **Download as CubeCart skin** turns the design into a CubeCart 6.8+ skin (built on the Heirloom skin in `cubecart-skins/heirloom`) with the site's colours, fonts, corner rounding and logo, plus a homepage banner from its first page. Upload the ZIP into CubeCart's `skins/` folder, extract it, and choose it in the CubeCart admin; `INSTALL.md` inside has the steps. After changing the design, download the skin again and upload it over the old one.

## How it fits together

```
shared/         used by both the server and the editor
  schema.js     the site format: blocks, sections, pages, theme + validation
  render.js     turns a site into static HTML/CSS (same code for editor + live)
  sanitize.js   safe HTML for rich text
server/
  index.js      routes: customer sites by host, admin pages, JSON API
  store.js      file storage (one folder per site, with version history)
  media.js      image uploads → resized WebP
  ai/           AI provider (Claude) + prompts; add other providers here
public/admin/   dashboard + drag-and-drop editor (plain JS modules, no build step)
test/           automated tests (npm test)
```

A site is a JSON document (pages → sections → columns → blocks). The AI reads and writes that same format, so anything it makes can be edited by hand and anything you make by hand can be changed by AI. Every AI change, publish and restore saves a restore point in **History**.

### Adding a new block type

Add it to `BLOCKS` in `shared/schema.js` (fields + defaults) and add a renderer in `shared/render.js`. The editor panel, drag-and-drop palette and AI instructions all pick it up automatically.

### Adding another AI provider

Create `server/ai/<name>.js` exporting `{ name, model, complete({ system, prompt, effort, onProgress }) }` that returns the model's text, and register it in `pickProvider()` in `server/ai/index.js`.
