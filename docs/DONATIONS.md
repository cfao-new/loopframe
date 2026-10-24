# Donation Setup

Loopframe uses one optional support destination in both the header and footer.
The links are hidden until a valid web address is configured. They never open
by themselves and never ask for support during setup or publication.

The current public support page is
[`buymeacoffee.com/cfao`](https://buymeacoffee.com/cfao). The Portugal service
comparison below explains the available alternatives and their tradeoffs.

## Recommendation

Use **Ko-fi** as the shared donation service for these applications in
Portugal.

Why it fits:

1. Ko-fi supports both PayPal and Stripe for Portuguese creators.
2. Payments can settle directly to your own PayPal or Stripe account.
3. The free page supports basic tips with payment provider fees only.
4. One public address can be used from several unrelated projects.
5. The donor flow is short and does not require an application account.

Buy Me a Coffee is the best alternative when brand recognition is more
important than lower platform cost. Buy Me a Coffee supports payouts in
Portugal through Stripe. GitHub Sponsors is a good fit for developer focused
projects, but donors need a GitHub account. Stripe Payment Links offer the most
control, but require more setup and a less familiar donation experience.

Review current service fees before creating an account because providers can
change their terms.

## Comparison

| Service | Strengths | Tradeoffs | Best fit |
| --- | --- | --- | --- |
| Buy Me a Coffee | Familiar brand, very short donor flow, one time support, optional monthly support, good share link, official payouts in Portugal | Platform fee plus payment processing costs and hosted branding | Broad consumer audience and many unrelated applications |
| Ko-fi | Free page for tips, PayPal and Stripe options, direct settlement to the selected payment account, optional shop and memberships | Payment provider setup is required, some advanced options require a paid plan, interface has fewer consumer brand cues | Portugal and fee conscious creators with a community or storefront |
| GitHub Sponsors | Trusted by developers, strong repository integration, recurring tiers, organization matching in some regions | Donors need GitHub accounts, eligibility review, tax and payout onboarding, less approachable for general consumers | Open source projects with a developer audience |

Use Ko-fi for Loopframe in Portugal. Use Buy Me a Coffee if the
shortest, most familiar donor path matters more than lower platform cost. Use
GitHub Sponsors only as a second channel for developers.

## Suggested Setup

1. Create a Ko-fi account with the same public brand used by these
   applications.
2. Set the page name to `cfao` if it is available.
3. Add a short description that covers small independent tools.
4. Connect PayPal, Stripe, or both and complete the provider's payout checks.
5. Copy the public page address.
6. Run the configuration helper from this folder:

```powershell
node scripts/configure-donation.cjs https://ko-fi.com/your-page
```

7. Restart the application or rebuild the package.

The helper updates `donation.json`. For another application, copy
`shared/donation-link.mjs`, `shared/donation-link.css`, and the same
`donation.json` shape.

## Optional Link Behavior

The component must:

1. Appear as a restrained header control and a text link in the footer.
2. Remain hidden when no valid HTTPS address is configured.
3. Use one short action label.
4. Open in the system browser.
5. Never interrupt setup, editing, publication, or error recovery.

The included component follows these rules.
