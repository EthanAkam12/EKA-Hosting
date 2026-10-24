# Heirloom skin for CubeCart 6.8+

A warm, classic skin for antiques and vintage shops, built on CubeCart's
Atrium skin. Every item is treated as one of a kind: no quantity boxes,
"One of a kind" on product pages, and a "Sold" stamp on anything out of stock.

## Install

1. In cPanel, open **File Manager** and go to your CubeCart folder, then `skins/`.
2. Upload `heirloom.zip` and **Extract** it, so you end up with `skins/heirloom/`.
3. In the CubeCart admin, open your store settings, find where the storefront
   **skin** is chosen, pick **Heirloom**, and save.
4. Optional: in the same place pick a colour scheme: Forest Green (default),
   Oxblood, Navy or Walnut.

## Recommended shop settings

- **Every product:** turn stock control on and set the stock level to **1**.
  After it sells, it shows as "Sold" automatically.
- **Keep sold items visible** (store settings, stock options) so past finds
  stay on the site with their "Sold" stamp. Customers love browsing them.
- **Currency:** check the pound (GBP) is the default currency with an exchange
  rate of exactly **1**.
- **Logo:** until a logo is uploaded, the shop name is shown in the skin's
  serif font. Upload a logo in the admin when you have one.

## Homepage

The homepage banner is page content, not part of the skin. Open the homepage
document in the admin, switch the editor to **Source** mode, and paste in
`docs/HOMEPAGE.html`. Change the wording to suit the shop. Ticking "hide title"
on that document stops the "Welcome to..." heading repeating above it.

## Changing the look yourself

Put your own CSS in `css/custom.css`. It loads last, so it overrides
everything. The skin's own design is in `css/heirloom.css`.

## Updates

CubeCart updates don't overwrite this skin. After a big CubeCart update,
check the shop still looks right.

## Credits and licence

Based on Atrium by CubeCart (GPL-3.0); this skin is GPL-3.0 too. Fonts:
Cormorant Garamond and Figtree, both SIL Open Font License (see `fonts/`).
