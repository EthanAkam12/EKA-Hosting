# EKA Hosting

An AI website builder for making and managing customer websites.

- **Describe a business → get a whole site.** The AI writes the pages, copy, layout and colour scheme.
- **Change it by asking.** "Add a pricing section", "make it feel more premium", or select one block and say "make this punchier".
- **Or change it by hand.** A drag-and-drop editor in the style of Elementor or Kadence: drag blocks and ready-made sections onto the page, double-click text to edit it in place, and tweak anything in the side panel. Desktop, tablet and mobile previews; undo/redo; autosave; a full version history.
- **Fast customer sites.** Published pages are plain HTML with the CSS inlined and **no JavaScript at all**. The mobile menu, FAQs and form messages are pure CSS, photos are auto-converted to WebP with phone-sized copies, and YouTube embeds load only a thumbnail until clicked. A typical page is ~20 KB.
- **Hosting built in.** Each site is served at `<name>.<your-domain>` and/or the customer's own domain, with contact-form messages collected for you.

## Quick start

```bash
npm install
ADMIN_PASSWORD=choose-a-password ANTHROPIC_API_KEY=sk-ant-... npm start
```

Open http://localhost:3000/admin and log in.

Without `ANTHROPIC_API_KEY` everything still works except AI: new sites start from a template and you edit by hand.

Run the tests with `npm test`.

## Settings (environment variables)

| Variable | What it does |
| --- | --- |
| `ADMIN_PASSWORD` | Password for the builder. If unset, one is generated on first run and printed (and saved to `data/.admin-password`). |
| `ANTHROPIC_API_KEY` | Turns on AI generation and editing (Claude). |
| `AI_MODEL` | Claude model for building new sites. Default `claude-opus-5-5` (best quality). |
| `AI_EDIT_MODEL` | Claude model for AI changes to existing sites. Default `claude-sonnet-5-5` (faster and about half the price). |
| `AI_EFFORT` / `AI_GENERATE_EFFORT` | How hard the AI thinks for edits / new sites (`low`…`max`). Defaults `medium` / `high`. Lower is faster and cheaper. |
| `AI_PROVIDER` | `claude` (default when a key is set) or `demo` (templates only). |
| `BASE_DOMAIN` | e.g. `ekahosting.com`. Sites are then served at `https://<site-name>.ekahosting.com`. Without it, sites are served at `/s/<site-name>/` on the builder. |
| `PORT` | Default `3000`. |
| `DATA_DIR` | Where sites, images and messages are stored. Default `./data`. **Back this folder up.** |
| `NODE_ENV=production` | Marks login cookies as HTTPS-only. |
| `TRUST_PROXY` | Set to `1` when running behind a reverse proxy such as Caddy or Nginx, so rate limits see real visitor IPs. |

## Going live

1. Get a server (any small VPS works) and a domain, e.g. `ekahosting.com`.
2. DNS: point `ekahosting.com` **and** `*.ekahosting.com` (wildcard) at the server.
3. Run the app with `BASE_DOMAIN=ekahosting.com NODE_ENV=production TRUST_PROXY=1`, e.g. with the included `Dockerfile` or a process manager like `pm2`.
4. Put [Caddy](https://caddyserver.com) in front for automatic HTTPS. `deploy/Caddyfile` covers the builder, every subdomain and customers' own domains.

The builder is at `https://admin.ekahosting.com/admin` (or the bare domain). A customer site called "bright-spark" is at `https://bright-spark.ekahosting.com`.

**Customer domains:** in the editor go to **Site → Custom domains** and add e.g. `www.brightspark.co.uk`. Then have the customer point their domain at your server (an `A` record to its IP, or a `CNAME` to `<site-name>.ekahosting.com`). Caddy issues the certificate automatically on the first visit.

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
