---
name: godaddy-go-live
description: Takes an app on GoDaddy Node.js Hosting live on its own domain with the gddy CLI. Checks or suggests a domain, attaches it with HTTPS, sets up a Professional Email mailbox and its mail DNS, connects the site's contact form to that mailbox over SMTP, adds the domain to Firebase Auth, and proves it all with a read-only go-live check. Use when the user wants to connect a domain, go live, set up a custom domain or business email, wire SMTP, or check launch readiness on GoDaddy hosting.
---

# GoDaddy go-live

## Guardrails

- Read before you write. Run every changing `gddy` command (`hosting domain attach`, `email create`) with `--dry-run` first, show the result, and run it for real only after the user says yes.
- Never buy anything. The user buys domains and plans at the godaddy.com checkout, where their credits apply. The CLI is only for looking up names and prices.
- Never print, echo or ask for secrets in chat: mailbox passwords, API keys, or `.env` contents. The user types them into `.env` themselves.
- Ask before `npm run deploy -- --secrets` or `npm run deploy -- --publish`, since both change the live site.

## Checklist

Copy this list, tick each step and report it at the end:

```
- [ ] 1. Preflight: CLI on production, app id known
- [ ] 2. Domain owned and active
- [ ] 3. Domain attached to the app, certificate issued
- [ ] 4. HTTPS answers from outside
- [ ] 5. Mailbox ready, mail DNS present
- [ ] 6. Contact form: SMTP settings deployed
- [ ] 7. Domain authorised in Firebase Auth
- [ ] 8. Go-live check passes
```

### 1. Preflight

```bash
gddy env get                              # env must be prod (https://api.godaddy.com)
gddy hosting app list --app-type NODEJS   # app ids look like NODEJS-<id>; this repo keeps it in GDDY_APP_ID
```

`--app-type` is required. The `NODEJS-` prefix is part of the id; without it, calls return 404.

### 2. Domain

If the user already owns it, `gddy domain get <domain>` must show `status: ACTIVE`; `gddy domain list` shows every domain on the account.

If they need one, suggest names and prices, then send them to godaddy.com to buy:

```bash
gddy domain suggest "<idea>" --tlds app,in,com --limit 10
gddy domain available <name.tld>
```

### 3. Attach the domain to the app

```bash
gddy hosting domain attach --app-id <APP_ID> --hostname <domain> --dry-run
gddy hosting domain attach --app-id <APP_ID> --hostname <domain>   # after the user confirms
gddy hosting domain list --app-id <APP_ID> --fields all            # poll until verificationStatus is ACTIVE
```

- When the domain uses GoDaddy DNS, the attach writes the A record (`anycastIp`) and the `_acme-challenge` CNAME itself. On any other DNS host, the user adds both by hand from that output.
- Attach the apex only. It also serves `www`; attaching `www` separately fails with `DOMAIN_MODIFY_BAD_REQUEST`.
- The certificate usually takes a few minutes.

### 4. HTTPS from outside

```bash
curl -sI https://<domain> | head -1            # HTTP/2 200
curl -sI https://www.<domain> | head -1        # HTTP/2 200
curl -sI http://<domain> | grep -i location    # https://<domain>/
```

Behind a corporate TLS-inspecting proxy such as Zscaler, the laptop sees the proxy's certificate, not the site's. To see the real one, open the site on a phone using mobile data.

### 5. Mailbox and mail DNS

`gddy email list` shows mailboxes; `status: COMPLETED` means ready. To create one (a plan holds one mailbox; a second gives `EMAIL_PLAN_NOT_AVAILABLE`):

```bash
gddy email check-eligibility --email <name>@<domain>   # eligibleAccounts[].accountId and requirements[].type
gddy email create --email <name>@<domain> --account-id <accountId> \
  --first-name <first> --last-name <last> --consent <TYPE> --dry-run
```

Show the user each consent type, which may start a trial that auto-renews, and get their yes before the real create. Then poll `gddy email get <mailboxId>` until it shows `COMPLETED`. The CLI can't set the mailbox password: the user sets or resets it on godaddy.com under My Products, Email, Manage.

`gddy dns list <domain>` should then show:

| Record | Name | Value |
|---|---|---|
| MX | `@` | `smtp.secureserver.net`, `mailstore1.secureserver.net` |
| TXT (SPF) | `@` | `v=spf1 include:secureserver.net -all` |
| CNAME (DKIM) | `secureserver1._domainkey`, `secureserver2._domainkey` | `*.onsecureserver.net` |
| TXT (DMARC) | `_dmarc` | `v=DMARC1; ...` |

### 6. Contact form over SMTP

The app sends through the mailbox (`src/integrations/smtp/client.ts`). The mailbox is both the sender and the recipient, so SPF and DKIM pass; the visitor's address goes in Reply-To. In `.env`:

```
SMTP_HOST=smtpout.secureserver.net
SMTP_PORT=465
SMTP_USER=<name>@<domain>
SMTP_PASSWORD=   # the user pastes the mailbox password here, never in chat
```

Without `SMTP_USER` and `SMTP_PASSWORD`, the form stays hidden and `/api/contact` returns 503. Once the password is in, and with the user's go-ahead:

- `npm run deploy -- --secrets` copies the settings into GoDaddy's encrypted secrets for preview and live, then restarts both.
- `npm run deploy -- --publish` ships the build if the live site doesn't have the form yet.

Corporate networks often block outbound SMTP from a laptop, so test the form on the deployed site. A failed send is logged as `upstream error` with `service: "Email"` and `upstreamStatus` set to the SMTP reply code; 535 means the password is wrong. To read the logs: `gddy hosting log list --app-id <APP_ID> --variant PUBLISH --level ERROR`.

### 7. Firebase Auth

Sign-in on the new domain fails until Firebase allows it. In the Firebase console, open Authentication, then Settings, then Authorized domains, and add `<domain>` and `www.<domain>`. To script it instead, send a PATCH to `https://identitytoolkit.googleapis.com/admin/v2/projects/<projectId>/config?updateMask=authorizedDomains` with a service-account access token, and include the existing domains in the list, since the PATCH replaces it.

### 8. Go-live check

```bash
npm run golive:check -- <domain>
```

This is read-only. It prints one ✓ or ✗ line per fact, with a fix for each failure, and exits 1 if anything fails. Share the output with the user as the final report:

```
Go-live check for musafira.app

  ✓ gddy CLI targets production        https://api.godaddy.com
  ✓ Domain active in your account      ACTIVE
  ✓ Domain attached to the app         NODEJS-rpmzemjwnn, certificate issued
  ✓ DNS points at the app              A @ 160.153.0.196
  ✓ https://musafira.app loads         200 OK
  ✓ https://www.musafira.app loads     200 OK
  ✓ http:// redirects to https://      301 to https://musafira.app/
  ✓ Mailbox on the domain ready        support@musafira.app
  ✓ Mail DNS: MX, SPF, DKIM, DMARC     all present
  ✓ Contact form live                  sends to support@musafira.app
```

## CLI notes

- When its output is piped, `gddy` prints `{ "data": ... }` JSON. Errors go to stderr as `{ "error": { "message" } }`, with a non-zero exit code.
- `gddy` installs into `~/.local/bin`; add it to `PATH` if the command isn't found.
