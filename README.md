# Notch

Every click, counted once.

Notch makes short links and QR codes. Each click is one unit of metered usage. It is built to show one production problem: **how to prove that the usage you bill matches what happened**, when usage can arrive late, twice, or never.

## The problem

A customer opens an invoice that says 1,204 clicks, and you cannot prove it. Usage billing goes wrong in four ways:

1. A report is sent again after a timeout, and the provider counts it twice.
2. A report fails after the click was recorded, and the provider never hears of it.
3. A click is judged a bot after it was reported, and the meter still holds it.
4. A click arrives after the billing cycle has closed.

## How Notch handles it

- **Ledger.** Every click is one row with a key made at the door. The same key offered twice adds nothing, so a retried write cannot count a click twice. A correction is a new row with minus one, never an edit. A late click goes to the cycle it happened in.
- **Reporter.** Once a minute, Notch sets the provider's meter to the ledger total with an absolute write. A total sent twice leaves the same total. There is no retry schedule: a failed cycle is marked again, and the next minute sends the newest total.
- **Reconciler.** Every night, and on demand, Notch compares the ledger, what it sent, and what the provider holds. If they differ, it repairs the meter, reads it back, and stores the evidence. Running it again on the same data changes nothing. It also proves the running totals against the ledger by reading every row, and rebuilds them if they are wrong.

Stack: Next.js 16, Convex (ledger, scheduled jobs), Kinde (sign-in and billing).

## What Notch shares with Bottle

Only the billing setup: a Kinde plan, a customer with an agreement, and a metered feature. Bottle handles events that Kinde sends in. Notch sends usage out and proves it. Notch has no webhook handler, no event queue, no lease, and no retry ladder.

## Built for load

Everything that grows with clicks is kept small, so no job has to read or write a lot at once:

- **Running totals are sharded.** Each account and cycle has 64 total rows, and each click adds to a random one, so many clicks at once rarely write the same row. A read adds 64 small rows. The same goes for each link.
- **The reporter claims and reads in one transaction.** A click that arrives after the read marks the cycle again, so it is never lost between the read and the send. It sends 100 cycles per batch, 10 at a time, and stops early if Kinde answers 429.
- **A cycle is marked once.** A busy account does not write the mark again for each click, and many clicks in a minute become one report.
- **Reads are bounded.** The dashboard reads 15 ledger rows and a few total rows. Only the reconciler reads the whole ledger, in pages of 1,000.
- **The nightly reconcile walks in pages.** Each page is 50 accounts, 5 at a time, and schedules the next page, so no single run has to hold the whole night.
- **A click is written after the redirect, with up to five tries and a random, growing wait between them.** The key is made before the first try, so a retry is safe.
- **Limits.** 1,000 links and 10 new links a minute for each account. A burst of 30 clicks from one address on one link within two minutes is judged a bot and corrected.

These limits come from the design. They are not measured. To measure them against your own deployment:

```bash
node scripts/load.mjs <short code> --clicks 5000 --concurrency 100
```

It prints requests a second and redirect times, then tells you what the ledger should hold. Run `npm run notch -- reconcile` after it.

What is not solved, and is outside this piece: Kinde's rate limits (not documented, so Notch backs off on 429), and abuse of short links, such as phishing. Add link review before you open sign-up to the public.

## Run it on your machine

```bash
npm install
npx convex dev        # first terminal: creates a deployment and writes NEXT_PUBLIC_CONVEX_URL
npm run setup         # makes a server key and stores it in .env.local and on Convex
npm run dev           # the site on http://localhost:3000
```

With no Kinde settings, Notch uses a local account and a built-in stand-in for the provider's meter, so the whole loop runs with no billing account. Open the dashboard, make a link, open it, then use **Break it on purpose** and **Reconcile now**.

## The CLI

```bash
npm run notch -- login
npm run notch -- shorten https://example.com/menu
npm run notch -- drift            # built-in meter only: count 6 extra
npm run notch -- reconcile        # prove, repair, read back
npm run notch -- reconcile        # the second run changes nothing
```

Every command has `--json`. `notch reconcile` exits with 4 when it leaves a difference it could not fix.

## Report to Kinde instead

On the Convex deployment:

```bash
npx convex env set METER_DRIVER kinde
npx convex env set KINDE_DOMAIN https://yourdomain.kinde.com
npx convex env set KINDE_M2M_CLIENT_ID <your machine-to-machine client id>
npx convex env set KINDE_M2M_CLIENT_SECRET <your machine-to-machine client secret>
```

The machine-to-machine app needs the `create:meter_usage` and `read:meter_usage` scopes. Set `METER_DRIVER=kinde` in `.env.local` too. Then, in the dashboard, connect the customer's Kinde agreement id and the feature code.

### What is verified and what is not

From Kinde's docs: `POST /api/v1/billing/meter_usage` takes `customer_agreement_id`, `billing_feature_code`, `meter_value` and `meter_type_code` (`absolute` or `delta`). `absolute` sets the running total.

Not stated in the docs, and written here as assumptions to confirm against a real agreement before you rely on them:

- the query parameters and response shape of `GET /api/v1/billing/meter_usage` (Notch looks for `current_usage` in the response, and reports "unreadable" if it finds none)
- whether a repeated `delta` write counts twice (Notch avoids the question by using `absolute`)
- how a late event is treated in a closed cycle (Notch does not write to a closed cycle, and records the drift instead)
- how a billing cycle is bounded (Notch uses the calendar month in UTC)

## Tests

```bash
npm test          # the rules, and the whole loop against Convex's test backend
npm run typecheck
npm run lint
```

## License

MIT
