# Contributing to Notch

Bug reports and pull requests are welcome.

## Set up

You need Node.js 22 or later and a Convex account.

```bash
git clone https://github.com/sholajegede/notch.git
cd notch
npm install
npx convex dev
npm run setup
npm run dev
```

With no Kinde settings, Notch runs on your machine with a local account and a built-in meter.

## Checks

Run all three before you open a pull request:

```bash
npm test
npm run typecheck
npm run lint
```

## What a good change looks like

- It does one thing, and the pull request says what and why.
- A change to the ledger, the reporter or the reconciler has a test that fails without it.
- A click is never counted twice and never lost. If your change touches how a click is written, say how it keeps both true.
- Corrections are new rows. Do not edit or delete a ledger row.
- The meter is written with an absolute write. Do not add a delta write to the reporter or the reconciler.
- Notch never stores an IP address. It stores the place and a salted hash.
- Text in the interface is short and plain.

## Commits

Use a short, clear message that says what changed. One change per commit.

## Security

Do not open a public issue for a security problem. Follow [SECURITY.md](SECURITY.md).
