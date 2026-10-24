# Donation Setup

Loopframe uses a single optional link in the footer. The link is hidden until
a valid web address is configured. It never opens by itself and never asks for
support during setup or publication.

## Recommendation

Use **Buy Me a Coffee** as the shared donation service for these applications.

Why it fits:

1. The donor page is familiar and requires no application account.
2. It supports a simple contribution flow and optional recurring support.
3. One public address can be used from several unrelated projects.
4. The service handles payment methods and provides a public supporter page.

Ko-fi is the best alternative when the priority is a free public page with
payment processing fees taken by the payment provider. GitHub Sponsors is a
good fit for developer focused projects, but donors need a GitHub account.
Stripe Payment Links offer the most control, but require more setup and a less
familiar donation experience.

Review current service fees before creating an account because providers can
change their terms.

## Suggested Setup

1. Create a Buy Me a Coffee account with the same public brand used by these
   applications.
2. Set the page name to `cfao`.
3. Add a short description that covers small independent tools.
4. Connect a payment account and complete the provider's payout checks.
5. Copy the public page address.
6. Run the configuration helper from this folder:

```powershell
node scripts/configure-donation.cjs https://www.buymeacoffee.com/cfao
```

7. Restart the application or rebuild the package.

The helper updates `donation.json`. For another application, copy
`shared/donation-link.mjs`, `shared/donation-link.css`, and the same
`donation.json` shape.

## Optional Link Behavior

The component must:

1. Appear only as a text link in a footer.
2. Remain hidden when no valid HTTPS address is configured.
3. Use one short action label.
4. Open in the system browser.
5. Never interrupt setup, editing, publication, or error recovery.

The included component follows these rules.
