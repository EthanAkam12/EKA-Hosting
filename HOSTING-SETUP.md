# Setting up the web hosting side of EKA Hosting

This is everything between "we have a website builder" and "customers can pay us for hosting". HQ's **Setup** tab tracks the same steps: Otto ticks off what he can check himself (servers, payments, products, prices, domains…), and you tick the rest.

## How it fits together

| Part | What it does | Where it runs |
|---|---|---|
| **WHMCS** | The shop and client area: orders, invoices, payments, support tickets, and setting up accounts when someone pays | Your reseller hosting |
| **Reseller hosting (cPanel/WHM)** | Customers' normal hosting: files, databases, **email** | Your reseller provider's servers |
| **EKA Builder** | Builder customers' websites | Your own small server (SERVER-SETUP.md) |
| **EKA HQ** | Your AI staff, watching all of the above | The same server as the builder |

A customer orders on WHMCS → pays by card → WHMCS creates their cPanel account and/or builder account → they log in from the client area → Sam answers their tickets, Otto watches the servers, Alex looks after billing.

## 1. Buy reseller hosting (from about £11 a month)

Look for: **UK data centre, cPanel/WHM, a WHMCS licence included, free migrations, private nameservers, daily backups**. Two good routes:

- **Cheapest to start (recommended):** a UK cPanel reseller plan that includes a free WHMCS licence, e.g. [Asura Hosting](https://www.asurahosting.co.uk/whmcs-reseller-hosting) (from about £11/month) or [Gossd Hosting](https://www.gossdhosting.co.uk/free-whmcs-reseller/) (about £20/month, 10 accounts). The free licence is usually the **Starter edition** (up to about 250 customers), which is plenty to begin with. Everything in this repo (the cPanel plugin, the WHMCS module, Sam's help pages) is written for cPanel.
- **Bigger and more polished:** [20i reseller hosting](https://www.20i.com/reseller-hosting) (UK, unlimited sites, free migrations, its own control panel StackCP instead of cPanel, a WHMCS module and discounted WHMCS licences). It costs more, and you'd use 20i's own panel rather than our cPanel plugin.

Prices and licence limits change: check them on the provider's site before you buy.

## 2. Install WHMCS

Most resellers install it for you, or with one click (Softaculous). Put it on a subdomain such as **my.ekahosting.co.uk**. Then, in WHMCS:

- **System Settings → General Settings:** company name, logo, email, currency **GBP**, and your website's address.
- **Invoices:** if you're under the VAT threshold (£90,000 a year), turn VAT off and don't show a VAT number.
- **Mail:** use your email provider's SMTP so WHMCS emails don't go to spam. Send yourself a test.
- **Automation (the cron job):** your reseller sets this up; check System Health shows it running.
- **Suspensions:** choose one. Either let WHMCS suspend unpaid services automatically, or turn that off and let Otto ask you first (HQ → Settings → Otto: after how many days).

## 3. Your own name everywhere

- **Private nameservers:** ns1/ns2.ekahosting.co.uk (ask your reseller; most do it for free).
- **cPanel branding:** your logo in WHM → cPanel → Customization.
- **Client area:** your logo and colours (WHMCS → System Settings → General → logo; the default theme takes your colour).

## 4. Taking payments

WHMCS → System Settings → **Payment Gateways**: activate **Stripe** (cards, Apple Pay, Google Pay) and paste in your Stripe keys. Stripe pays out to your business bank account. GoCardless (Direct Debit) is a good second option for monthly plans.

## 5. Add your servers to WHMCS

1. **System Settings → Servers → Add New Server**, module **cPanel**: your reseller's WHM hostname, username and API token. **Test Connection**.
2. Once the builder is on its server (SERVER-SETUP.md), add another server, module **EKA Website Builder**: hostname builder.ekahosting.co.uk, password = the builder's host API key, tick Secure. Copy `tools/whmcs/modules/servers/ekabuilder` into WHMCS's `modules/servers/` first.
3. Put each in its own **server group** ("cPanel" and "EKA Builder").

In WHM, make **packages** to match the hosting plans (Starter 10GB, Business 50GB, Pro 100GB…), and a small **Email** package (1GB, no website) for builder customers.

## 6. Create the products

**System Settings → Products/Services:** create four groups (Website Builder, Web Hosting, Done-for-you Websites, For Hosting Companies), then these products, **named exactly as below** (Otto matches them by name). The prices come from `shared/eka-plans.js`, the same file the website uses, so they match. The website shows the yearly price per month; WHMCS needs the monthly and yearly prices:

| Product | Monthly | Yearly | Setup fee | Module |
|---|---|---|---|---|
| Builder Starter | £9.60 | £96.00 | – | EKA Website Builder (plan: starter) |
| Builder Business | £18.00 | £180.00 | – | EKA Website Builder (plan: business) |
| Builder Pro | £28.80 | £288.00 | – | EKA Website Builder (plan: pro) |
| Hosting Starter | £4.79 | £47.88 | – | cPanel (package: Starter) |
| Hosting Business | £8.39 | £83.88 | – | cPanel (package: Business) |
| Hosting Pro | £15.59 | £155.88 | – | cPanel (package: Pro) |
| Done-for-you website: Launch | £18.00 | £180.00 | £299 | EKA Website Builder (plan: business) |
| Done-for-you website: Growth | £18.00 | £180.00 | £599 | EKA Website Builder (plan: business) |
| Care plan | £25.00 | £250.00 | – | None ("Other") |
| Builder licence: Starter | £29.00 | £290.00 | – | None ("Other") |
| Builder licence: Growth | £59.00 | £590.00 | – | None ("Other") |
| Builder licence: Unlimited | £99.00 | £990.00 | – | None ("Other") |

Also make the builder's plans match (builder → Customers → Plans): *starter*, *business*, *pro*, with the websites and AI allowances from the pricing plan.

**Your decision: email for builder customers.** The builder plans promise email addresses, but the builder hosts websites, not email. The simplest way is a WHMCS **Product Bundle** (Products/Services → Product Bundles): "Builder Starter" = the builder product + the small cPanel **Email** product, so one order sets up both. Their domain's website records then point at the builder (the builder's domain helper shows exactly what to change), and email stays on cPanel. Or, if you'd rather keep things simpler at first, take "email" off the builder plans on the website until you're ready.

## 7. The questions done-for-you customers answer

On **Done-for-you website: Launch** and **Growth** → **Custom Fields**, add these, each with **Show on Order Form** ticked. Bea reads them and starts building as soon as the order comes in (or from the Get started form on your website):

| Field name | Type | Required |
|---|---|---|
| Business name | Text Box | Yes |
| What does your business do? | Text Area | Yes |
| Services (one per line) | Text Area | No |
| Areas you cover | Text Box | No |
| Opening hours | Text Area | No |
| Prices (optional, one per line) | Text Area | No |
| Customer reviews (optional, one per line) | Text Area | No |
| Why do customers choose you? (optional) | Text Area | No |
| Facebook or Instagram links (optional) | Text Box | No |
| Which style do you like? | Drop Down: Modern, Elegant, Bold, Minimal, Playful, Luxury, Natural, Warm & friendly, Corporate, Fresh | No |

WHMCS order forms can't take photo uploads, so Bea's email asks for the logo and photos, and the **Get started** form on your website accepts them directly.

## 8. Domain names

Use your reseller's registrar (most include a WHMCS registrar module, or use Enom/ResellerClub/OpenSRS). **System Settings → Domain Registrars**: activate it. **Domain Pricing**: .co.uk and .uk £9.99 a year, .com £13.99 a year. Turn on free domain transfers in, with auto-renew on.

## 9. Rules and paperwork

- **Terms of service** (what's included, fair use, payment, cancellation, refunds) and an **acceptable use policy**. Link them in WHMCS (General Settings → Ordering → Terms of Service). The website already has a privacy page. Have them checked; a template from a UK hosting trade body or a solicitor is worth it.
- **Consumer cancellation rights:** UK consumers have 14 days to cancel online orders. WHMCS's order form can ask them to agree that the service starts straight away.
- **ICO data protection fee:** about £50 a year for small businesses ([ico.org.uk/fee](https://ico.org.uk/fee)).
- **VAT:** you only need to register once your turnover passes £90,000 a year.
- A **business bank account**, so Stripe payouts are kept separate.

## 10. Connect HQ

WHMCS → System Settings → **API Credentials** → Generate New API Credential (role with: GetTickets, GetTicket, AddTicketReply, GetClients, GetClientsDetails, GetClientsProducts, GetInvoices, GetOrders, AcceptOrder, GetStats, SendEmail, ModuleSuspend, ModuleUnsuspend, GetServers, GetProducts, GetPaymentMethods, GetTLDPricing). Put the URL, identifier and secret in `hq-settings.txt`, and add your server's IP under **General Settings → Security → API IP Access Restriction**. Restart HQ, then open its **Setup** tab: Otto checks the rest.

## 11. A test order

Make a 100% discount promo code, order **Builder Starter** yourself, and check: the account is created, the welcome email arrives, **Open Website Builder** in the client area signs you straight in, and a ticket you open appears in HQ with Sam's draft reply.

## Running costs to start, roughly

| | Per month |
|---|---|
| Reseller hosting with WHMCS | £11–20 |
| Server for the builder and HQ | £4–6 |
| Stripe | 1.5% + 20p per UK card payment |
| Domains | wholesale cost, passed on at your prices |
| ICO fee | about £4 (£50 a year) |
