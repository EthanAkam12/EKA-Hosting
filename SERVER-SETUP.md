# Putting EKA Hosting on a server (so your PC can be off)

Once this is done, the website builder, your customers' websites, your own website and EKA HQ all run on a small rented server, all the time. Henry messages your phone when something needs you, and you can open HQ from your phone or any computer.

It takes about an hour the first time. You only type a handful of commands; everything else is done by the install script.

## What runs where

| What | Where | Address (example) |
|---|---|---|
| Website builder + customers' websites + your own website | Your server (this guide) | builder.ekahosting.co.uk, ekahosting.co.uk |
| EKA HQ | Your server (this guide) | hq.ekahosting.co.uk |
| WHMCS (billing, client area, tickets) | Your reseller hosting (cPanel), where it's usually installed | my.ekahosting.co.uk |
| Customers' normal web hosting and email (cPanel) | Your reseller hosting / WHM | (set up by WHMCS when they order) |

WHMCS needs PHP and its own licence (many resellers include one), so keep it on your reseller hosting rather than this server.

## 1. Rent a server (5 minutes)

Any provider with **Ubuntu 24.04** works. Good, cheap options:
- **Hetzner Cloud**: the CX22 (2 CPUs, 4 GB) is about €4.50 a month. UK customers usually pick the Germany or Finland location; it's fast enough.
- **DigitalOcean** or **Vultr**: about $6 a month, with London data centres.
- **IONOS VPS**: cheap UK option.

Choose Ubuntu 24.04, 2 GB of memory or more, and add a password or SSH key. Write down the server's **IP address**.

## 2. Point your domain at it (5 minutes, then wait)

Where your domain's DNS is managed (often your reseller's cPanel → Zone Editor, or the domain company), add these **A records**, each pointing to the server's IP address:

| Name | Points to |
|---|---|
| `builder` | server IP |
| `hq` | server IP |
| `sites` | server IP |
| `*.sites` | server IP |
| `@` (the domain itself) and `www` | server IP, **only when your new website is ready to go live** |

Keep `my` (or whatever WHMCS uses) and your email records pointing where they already do. DNS changes can take an hour or two to work everywhere.

## 3. Install everything (15 minutes)

On Windows, open **PowerShell** (Start menu → type "PowerShell"). On a Mac, open **Terminal**. Then type, using your server's IP address:

```
ssh root@YOUR.SERVER.IP
```

Type `yes` if asked, then the password. Now you're "inside" the server. Copy and paste these three lines (with your domain and email):

```
apt-get update && apt-get install -y git
git clone https://github.com/EthanAkam12/eka-hosting.git && cd eka-hosting
sudo bash tools/install-server.sh ekahosting.co.uk you@example.com
```

At the end it shows the addresses and the **passwords** for the builder and HQ. Save them somewhere safe (a password manager).

## 4. Fill in the settings (15 minutes)

Still on the server, open the builder's settings:

```
nano /opt/eka-builder/settings.txt
```

Add your **ANTHROPIC_API_KEY** (or a free `AI_PROVIDER`, see below) and email (SMTP) settings. Save with **Ctrl+O**, Enter, then exit with **Ctrl+X**.

Then HQ's settings:

```
nano /opt/eka-builder/hq-settings.txt
```

- **AI**: the same API key (or a different one, to keep HQ's costs separate).
- **WHMCS**: in WHMCS go to Configuration → System Settings → API Credentials → Generate New API Credential. Put the URL, identifier and secret here. Also in WHMCS: General Settings → Security → **API IP Access Restriction**, and add your server's IP address.
- **Your phone**: install the free **ntfy** app (iPhone or Android), tap +, subscribe to a topic name only you know (e.g. `eka-hq-7f3k2q9x`), and put the same name after `NTFY_TOPIC=`.

Save, exit, then restart both:

```
sudo systemctl restart eka-builder eka-hq
```

## 5. Check it works

- Open **https://hq.ekahosting.co.uk**, log in, go to **Settings** and press **Send a test message to my phone**.
- Open **https://builder.ekahosting.co.uk/admin**, and in the builder's Customers page connect the cPanel/WHMCS plugins (see tools/README.md) using the address `https://builder.ekahosting.co.uk`.
- Your own website: build it in the builder, then in its **Site tab → Address** add `ekahosting.co.uk` and `www.ekahosting.co.uk`, publish, and point `@` and `www` at the server (step 2). HTTPS turns on by itself within a minute.
- In HQ → Settings, put your website's id in "Our own website" so Mia can write blog posts for it and follow up enquiries.

## Updating later

```
ssh root@YOUR.SERVER.IP
cd eka-hosting && git pull && sudo bash tools/update-linux.sh
```

It backs everything up first and puts the old version back if the new one doesn't start.

## Backups

The builder backs itself up every night (Customers page → Backups), and HQ keeps its files in `/var/lib/eka-hq`. Turn on your server provider's automatic backups too (about 20% of the server price); it's the simplest way to protect everything.

## Costs, roughly

| | Per month |
|---|---|
| Server | £4–6 |
| AI (Claude) for HQ's staff | about £2–10, depending on how many tickets and orders you get |
| AI for customers' websites | covered by their plans (the builder tracks it) |
| ntfy / Telegram | free |

## Can the AI be free?

Yes, with limits. In either settings file, instead of `ANTHROPIC_API_KEY`:
- `AI_PROVIDER=gemini` with a free key from **aistudio.google.com**. This is the best free option; it has daily limits.
- `AI_PROVIDER=groq` with a free key from **console.groq.com**. It's fast, with daily limits.
- `AI_PROVIDER=ollama` runs the AI on your own machine. It's free but needs a powerful computer with a good graphics card; a £5 server is far too small.

Claude makes clearly better websites and replies, and costs pennies per job. A sensible mix is a free option for HQ's everyday writing and Claude for building websites. Free plans may use what you send them to improve their AI, so don't use them for anything with customers' private details.
