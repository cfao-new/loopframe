# Shared Donation Link

This folder contains a small optional footer link for use across multiple
applications. It has no prompt, overlay, floating badge, or automatic action.

## Files

1. `donation-link.mjs` validates the configured address and controls the link.
2. `donation-link.css` supplies the basic inline presentation.
3. The application configuration is stored in the project root
   `donation.json`.

## Configuration

Use one shared page address:

```json
{
  "enabled": true,
  "service": "Buy Me a Coffee",
  "label": "Support this project",
  "url": "https://www.buymeacoffee.com/example",
  "placement": "footer",
  "promptOnLaunch": false
}
```

The URL must use HTTPS. Leave `enabled` false or leave `url` empty until the
public page is ready.

## Integration

1. Import `configureDonationLink` from `donation-link.mjs`.
2. Add an anchor with `data-donation-label` inside the footer.
3. Pass the loaded configuration and a function that opens web addresses.
4. Keep the anchor hidden by default.

```html
<a class="donation-link" id="support" hidden>
  Support this project
</a>
```

```js
configureDonationLink(link, config, (url) => openSecureUrl(url));
```
