# Connecting EKA Website Builder to control panels and billing

These let your customers open the builder from where they already are, and
let your billing system create and remove builder customers automatically.
All of them talk to the builder's **host API** with the **host API key**;
both are on the builder's **Customers** page (log in as administrator).

Keep the key secret: anyone with it can sign in as any customer.

| Folder | What it's for |
| --- | --- |
| `cpanel/` | A **Website Builder** icon in cPanel (Jupiter theme). One click signs the customer in. |
| `directadmin/` | The same for DirectAdmin. |
| `whmcs/` | A WHMCS provisioning module: creates, suspends, unsuspends, upgrades and removes customers with their orders, and adds an **Open Website Builder** button to the client area. |
| `update-windows.ps1` | Used by `update-windows.bat`. |

Customers are matched by their panel account (e.g. `cpanel:server1:bob`), so
each cPanel/DirectAdmin account or WHMCS service is one builder customer. If a
customer with the same email already exists, it's linked instead of duplicated.

## cPanel

Copy the `cpanel` folder to the cPanel server and, as root:

```bash
bash install.sh https://builder.yourhost.com YOUR_HOST_API_KEY
```

The icon appears under **Domains**. Turn it on or off per package in
**WHM → Feature Manager** (feature `eka_builder`). To give cPanel packages
different builder plans, edit `/etc/eka-builder/config`:

```
plans=Basic:starter,Business:business
default_plan=starter
```

How it stays secure: the page the customer opens asks cPanel's root-run
"AdminBin" (`/usr/local/cpanel/bin/admin/EKA/Builder`) for a sign-in link.
cPanel tells that program who the customer really is, and only root can read
the key in `/etc/eka-builder/config`. Remove it with `bash uninstall.sh`.

## DirectAdmin

1. Pack the `eka_builder` folder: `tar -czf eka_builder.tar.gz -C directadmin/eka_builder .`
2. In DirectAdmin as admin: **Plugin Manager → Add plugin**, upload it, and install.
3. On the server, edit `/usr/local/directadmin/plugins/eka_builder/conf/config.ini`
   (address, key, and optionally `plans = "basic:starter,pro:business"`).

Users find **EKA Website Builder** in their plugins list. The plugin runs as
`diradmin`, so users can't read the key.

## WHMCS

1. Copy `whmcs/modules/servers/ekabuilder` into your WHMCS `modules/servers/` folder.
2. **System Settings → Servers → Add New Server**: Module *EKA Website Builder*,
   Hostname *builder.yourhost.com*, Password *your host API key*, tick *Secure*
   for https. **Test Connection** should succeed.
3. Make a product (e.g. "Website Builder Starter"), and on its **Module Settings**
   tab choose *EKA Website Builder* and enter the builder plan (e.g. `starter`).
   You can also choose what happens to websites on suspension and cancellation.

Plans are the ones on the builder's Customers page; use the plan's id or name.

## Anything else (Plesk, your own scripts)

Call the host API directly. Every request needs the header
`Authorization: Bearer YOUR_HOST_API_KEY` and JSON bodies.

| Request | Does |
| --- | --- |
| `POST /api/host/sso` `{ account, email, name?, plan? }` | Returns `{ url }`: a sign-in link that works once, for 2 minutes. Creates the customer if they're new. |
| `POST /api/host/accounts` `{ account, email, name?, plan? }` | Creates or updates a customer (e.g. a new plan). |
| `POST /api/host/accounts/suspend` `{ account, takeSitesOffline? }` | Stops them logging in; live sites stay up unless `takeSitesOffline`. |
| `POST /api/host/accounts/unsuspend` `{ account }` | Undoes that. |
| `POST /api/host/accounts/terminate` `{ account, keepSites? }` | Removes the customer and their websites (or keeps the websites as the administrator's). |
| `GET /api/host/accounts?account=…` | The customer, plan, websites and AI used this month. |
| `GET /api/host/plans` | The plans. |

Set `BUILDER_URL` in `settings.txt` (e.g. `https://builder.yourhost.com`) so
sign-in links use your public address when the builder sits behind a proxy.

These plugins follow cPanel's, DirectAdmin's and WHMCS's documented plugin
formats and were tested against the builder with stand-ins for each panel.
Try them on a test server or test account before rolling them out.
