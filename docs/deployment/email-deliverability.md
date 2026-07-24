# Email deliverability — why invites land in junk, and how to fix it

HireOrbit AI sends all transactional mail (invitations, welcome + temp password,
password reset, account locked, reminders, daily digest) through **Brevo**
(`backend/src/services/brevo.service.ts`). The default sender is
`BREVO_SENDER_EMAIL` (defaults to `noreply@hireorbitai.com`,
`BREVO_SENDER_NAME = "HireOrbit AI"`), configured in `backend/src/config/env.ts`.

If invites land in **Spam/Junk**, it is almost always **domain authentication**, not
the code. Work this checklist top to bottom — the first three items fix ~90% of
junking.

> No secrets live in this doc or the repo. The Brevo API key is `BREVO_API_KEY`
> in the server `.env` only. DKIM keys are generated and shown **inside the Brevo
> dashboard** — copy them from there into DNS.

## 0. Prerequisite: authenticate the sending domain in Brevo

1. Brevo dashboard → **Senders, Domains & Dedicated IPs → Domains → Add a domain**.
2. Add `hireorbitai.com` (the domain in `BREVO_SENDER_EMAIL`).
3. Brevo shows the exact DNS records to add (DKIM + a Brevo verification record +
   the recommended SPF/DMARC). Add them at your DNS host, then click **Verify**.
4. The sender address must be **on an authenticated domain**. Sending as
   `@gmail.com` or an unauthenticated domain is the #1 cause of junking — use
   `noreply@hireorbitai.com`, not a free-mail address.

## 1. SPF — authorise Brevo to send for your domain

Add (or merge into the existing) TXT record on the root domain:

```
Type: TXT
Host: @            (hireorbitai.com)
Value: v=spf1 include:spf.brevo.com ~all
```

- Only **one** SPF TXT record may exist. If you already have one, merge the
  include — don't add a second `v=spf1` record.
- `~all` (softfail) is fine; `-all` (hardfail) is stricter once you're confident
  nothing else sends as this domain.

## 2. DKIM — sign the mail so receivers trust it

Brevo generates the DKIM selector + public key for your domain. From the Brevo
**Domains** page, copy the two records it shows (typically a `brevo._domainkey`
host) and add them exactly:

```
Type: TXT (or CNAME — use whatever Brevo shows)
Host: brevo._domainkey.hireorbitai.com
Value: <the long key string Brevo displays>     # copy from Brevo, do not invent
```

Wait for Brevo to mark the domain **Authenticated** (DNS can take up to 24–48h,
usually minutes).

## 3. DMARC — publish a policy + alignment

```
Type: TXT
Host: _dmarc.hireorbitai.com
Value: v=DMARC1; p=none; rua=mailto:dmarc@hireorbitai.com; fo=1; adkim=s; aspf=s
```

- Start with `p=none` (monitor only). Once the aggregate reports (`rua`) show
  SPF+DKIM passing and aligned for Brevo traffic, tighten to `p=quarantine`
  then `p=reject`.
- **Alignment** is the part that fixes Gmail/Outlook junking: the `From:` domain
  (`hireorbitai.com`) must match the DKIM `d=` domain and the SPF domain. Because
  we send `From: noreply@hireorbitai.com` and DKIM-sign with `hireorbitai.com`,
  alignment passes once steps 1–2 are done.

## 4. From / Reply-To hygiene

- **From domain alignment:** `BREVO_SENDER_EMAIL` must be on the authenticated
  domain (it is — `noreply@hireorbitai.com`). Don't override it with a free-mail
  address per-send.
- **Reply-To:** if you want replies to reach a real inbox, set a Reply-To header
  in `brevo.service.ts` (e.g. `support@hireorbitai.com`). A `noreply@` From with
  no working Reply-To is allowed but slightly lowers engagement signals.
- **Visible, consistent sender name** (`HireOrbit AI`) builds reputation — don't
  vary it per email type.

## 5. Sender reputation & warm-up

- A brand-new domain/IP has no reputation. Brevo's shared IP pool carries some
  baseline; ramp volume gradually (don't blast hundreds of invites on day one).
- Keep bounce + spam-complaint rates low: only email addresses people expect a
  message from (invitations are opt-in by nature — good).
- Set up the **Brevo → DNS** "Brevo code" record they request; it ties the
  domain to your account and improves trust.

## 6. Content checklist (reduces spam-score)

- Send a **plain-text part** alongside HTML (Brevo can auto-generate it; ensure
  the template isn't HTML-only).
- Avoid spammy subject lines (ALL CAPS, "FREE!!!", excessive emoji/exclamation).
- Keep a reasonable text-to-link ratio; don't ship a single giant image.
- Include a physical address / unsubscribe affordance where applicable
  (transactional mail is exempt from unsubscribe, but a footer helps reputation).
- Make sure links point to the real `hireorbitai.com` host (mismatched/shortened
  link domains raise spam score).

## 7. Verify it worked

1. Send a test invite to a Gmail **and** an Outlook address.
2. In Gmail: open the message → **⋮ → Show original**. Confirm
   **SPF: PASS, DKIM: PASS, DMARC: PASS**.
3. Run the sender through https://www.mail-tester.com (send the invite to the
   address it gives you) — aim for **9–10/10**. It itemises any failing record.
4. Check Brevo dashboard → **Statistics / Logs** for the message: delivered vs.
   soft/hard bounce vs. spam.

## Quick triage

| Symptom                       | Most likely cause                 | Fix                                          |
| ----------------------------- | --------------------------------- | -------------------------------------------- |
| All mail → spam               | Domain not authenticated in Brevo | Steps 0–2                                    |
| DKIM fails in "Show original" | DKIM record missing/typo          | Re-copy from Brevo (step 2)                  |
| DMARC fails / "not aligned"   | From domain ≠ DKIM/SPF domain     | Use `noreply@hireorbitai.com` (step 4)       |
| Some inboxes only             | Reputation / content              | Steps 5–6, warm up volume                    |
| Nothing arrives at all        | `BREVO_MOCK=true` on the server   | Set real `BREVO_API_KEY`, `BREVO_MOCK` unset |
