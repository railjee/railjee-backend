# Meta Conversions API (Phase 2 of conversion tracking)

- **Date:** 2026-10-30
- **Status:** Implemented on branch `feat/meta-conversion-tracking`, not committed. `build:shared` and `build:business` pass. A 32-case scripted test (compiled code, mocked Graph API, fake models) passed, and the real `UsersModule` + `PaymentsModule` boot with the new dependency. Not yet tested against Meta's Test events or a real database. ESLint can't run in this repo (pre-existing `ajv` override conflict); the new `meta/` files are Prettier-formatted.
- **Repo:** railji-backend (`apps/railji-business`, `libs/shared`)
- **Full plan (all four phases):** `RailJee/docs/plans/2026-10-29-meta-conversion-tracking.md`

## Why

Meta ads are relaunching and need server-side conversions that ad blockers and in-app browsers can't drop: CompleteRegistration (email + Google), InitiateCheckout and Purchase. The browser Pixel copies (Phase 3) use the same `event_id`, so Meta counts each conversion once.

## Changes

| File | Change |
|---|---|
| `apps/railji-business/src/modules/meta/meta-capi.service.ts` (new) | `send(event)` is fire-and-forget: it never throws, isn't awaited, times out after `META_CAPI_TIMEOUT_MS` (default 3000), and logs one `meta_capi` line per send (sent / failed / skipped). Hashes email and external_id with SHA-256. `isExcluded()` decides internal traffic. |
| `apps/railji-business/src/modules/meta/meta.module.ts` (new) | Provides and exports `MetaCapiService`. |
| `apps/railji-business/src/modules/meta/tracking.utils.ts` (new) | `getClientContext(req)` (client IP and user agent), `maskId()`, `sha256()`, `logEvent()` (structured log line). |
| `apps/railji-business/src/config/config.ts` | New `meta` and `tracking` sections (env below). |
| `.env.example` | Documents the new env vars (no values). |
| `apps/railji-business/src/main.ts` | Stops logging the whole config (it printed the Mongo URI, JWT secret and Razorpay secrets). |
| `libs/shared/src/schemas/user.schema.ts` | Optional `authProvider`, `attribution` (object) and `trackingExcluded`. No migration: MongoDB, optional fields. |
| `apps/railji-business/src/modules/users/dto/create-user.dto.ts` | Optional `attribution` (free-form object, cleaned in the service so an unknown key can never fail a signup), `authProvider`, `internal`. |
| `apps/railji-business/src/modules/users/users.controller.ts` | Passes the request's client context to the service. |
| `apps/railji-business/src/modules/users/users.service.ts` | Saves attribution/authProvider only when creating. On 201: a `signup` log line and a CompleteRegistration (`event_id = reg-<supabaseId>`). |
| `apps/railji-business/src/modules/users/users.module.ts`, `payments/payments.module.ts` | Import `MetaModule`. |
| `apps/railji-business/src/payments/schemas/payment-transaction.schema.ts` | Optional `tracking` object (fbp, fbc, internal) on the order record. |
| `apps/railji-business/src/payments/payments.controller.ts` | Passes client context to `createOrder`. Webhook log no longer prints the body (customer email/phone) or the signature. |
| `apps/railji-business/src/payments/services/payments.service.ts` | Order: pulls `fbp`/`fbc`/`internal` out of `metadata` (so they don't go into Razorpay notes), stores IP/UA/tracking on the order record, sends InitiateCheckout (`event_id = order id`). Webhook `payment.captured`: sends Purchase (`value`, `currency`, `event_id = payment id`). `payment_event` log lines with masked ids. |
| `apps/railji-business/src/payments/gateways/razorpay.gateway.ts` | Removes the debug log of the expected webhook signature. |

## Environment variables

| Name | Required | Example / default | Notes |
|---|---|---|---|
| `META_PIXEL_ID` | yes | `1798627321470498` | Without it (or the token) CAPI is off and logs `skipped`. |
| `META_CAPI_ACCESS_TOKEN` | yes | — | Events Manager → Settings → Conversions API → Generate access token. Never commit. |
| `META_TEST_EVENT_CODE` | no | `TEST12345` | Set only while testing; remove for live traffic. |
| `META_GRAPH_API_VERSION` | no | `v26.0` | Current version as of 2026-10. |
| `META_CAPI_TIMEOUT_MS` | no | `3000` | |
| `SITE_URL` | no | `https://railjee.in` | Used for `event_source_url` when there's no Referer. |
| `INTERNAL_FORWARD_SECRET` | yes for Google | random 32+ chars | Same value on Netlify. Only requests carrying it may set the forwarded client IP/UA headers. |
| `INTERNAL_EMAILS` | no | `me@gmail.com,@railjee.in` | Comma list; an entry starting with `@` matches the whole domain. |

## Event details

| Event | Trigger | event_id | user_data | custom_data |
|---|---|---|---|---|
| CompleteRegistration | POST /users returns 201 | `reg-<supabaseId>` | em, external_id (business userId), IP, UA, fbp, fbc | `status: 'registered'`, `auth_provider` (custom) |
| InitiateCheckout | POST /payments/order succeeds | Razorpay order id | em, external_id, IP, UA, fbp, fbc | value, currency, content_ids `[planId]`, content_category (department) |
| Purchase | webhook `payment.captured` | Razorpay payment id | same, from the order record and the user | value, currency, content_ids, content_category |

Client IP/UA: forwarded headers `x-rj-client-ip` / `x-rj-client-ua` only when `x-rj-forward-secret` matches; else `X-Real-IP`, then the first `X-Forwarded-For` entry, then the socket address. A UA of `node`/`undici` (server-side fetch) is ignored.

Internal traffic is skipped when any of these hold: the request sent `internal: true`, the email is in `INTERNAL_EMAILS`, the user's `userType` is admin/superadmin, or the user was flagged `trackingExcluded` at signup.

## Out of scope

- Frontend changes (Phase 3). Until then the frontend sends none of the new fields; the API behaves as before, and CompleteRegistration still fires from the server for every new user.
- The existing access-grant logic (`grantDepartmentAccessFromOrder` reads the newest transaction for the order).
- Rotating the secrets already logged to CloudWatch (user action, Phase 4).

## Risks

- **Deploy order:** deploy this before Phase 3. The new DTO fields are optional, so the current frontend keeps working.
- **`libs/shared` must be rebuilt** (`npm run build:shared`) because the business app imports its `dist`.
- **Node version on EC2** must be 18+ (global `fetch`, `AbortSignal.timeout`).
- Meta rejects website events without a user agent; an event with no UA is sent as `system_generated` instead of dropped.

## Testing

- `npm run build:shared && npm run build:business`.
- Scripted test with a mocked `fetch`: payload shape, hashing, test_event_code, timeout and failure paths never throw, exclusion rules, masked ids, no token in logs.
- After deploy: Events Manager → Test events with `META_TEST_EVENT_CODE` (checklist in Phase 4).
