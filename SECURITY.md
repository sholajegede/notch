# Security

## Report a problem

Do not open a public issue for a security problem. Use the "Report a vulnerability" button on the Security tab of the GitHub repository, which opens a private report. Include:

- what you found and where
- the steps to repeat it
- what you think it allows

You will get an answer within a few days. Please give a fair time to fix the problem before you share it.

## What to look for

Problems that matter most in Notch:

- a way to count a click twice, or to remove one, without a ledger row
- a way to read or change another account's links, clicks or reports
- a way to call the Convex functions without the server key
- a way to make the redirect route send a person to an address that the owner did not set
- anything that stores or leaks an IP address

## What Notch keeps

For each click: the time, the country, region and city, the device, browser and system, the referring site, and a salted hash of the address. It never stores the address. Secrets (the server key and the Kinde client secrets) belong in `.env.local`, Vercel and Convex, and never in the repository.
