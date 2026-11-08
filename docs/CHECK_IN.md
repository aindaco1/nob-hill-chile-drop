# Group passes and volunteer check-in

[Documentation index](../README.md) · [Drawing](DRAWING.md) · [Operations](OPERATIONS.md)

## Guest and door rules

After publication, every verified group receives a selected or waitlisted results email with a signed group QR, an inline/attached GIF, a plain-text fallback and a link to `/pass/`. Selected groups receive Hot Spot admission; a waitlist QR confirms only the waitlist entry. Public viewing does not require a QR. Unverified entries do not receive passes or results.

One QR covers the whole group. Everyone must be present and enter together. There are no partial arrivals or per-person tickets. After initial check-in, staff issue wristbands and manage re-entry. The original drawing's ranks and results remain immutable; door admission of a waitlisted group is a separate record, not a reroll or an automatic promotion.

The organizer sets the reservation cutoff in **Door check-in** using Mountain Time. The field starts blank. Waitlist admission remains disabled until the cutoff is set and reached. Before then, volunteers can admit selected groups only. After the cutoff, selected groups' unused reservations are released; both selected and waitlisted groups need available space. The same pass remains valid. Guest pass pages show the current cutoff; an already-sent email does not update, and changing the setting sends no new email.

The organizer separately opens/closes volunteer check-in after results publication. A cutoff never opens the door automatically. Default state is closed; deploying the feature does not change it.

**The admin counter measures people initially admitted over the night, not occupancy.** Each successful whole-group admission adds its group size once. Departures and wristband returns do not update it. Staff must assess actual space, preserve reserved places before the cutoff, and enforce the physical capacity. Total admissions may exceed the room capacity over time because of turnover; this does not change the drawing's 2,000-person ceiling. Do not calculate available room by subtracting the cumulative counter from capacity.

## Organizer setup

1. Add approved volunteer emails under **Door check-in → Volunteer access**. This grants access without sending an invitation. Share the `/check-in/` address through an organizer-approved communication.
2. Set the selected reservation cutoff before sending final guest instructions, preferably before results publication so the email includes the time. Until set, email/pass text explicitly says the organizers have not yet set it.
3. Publish the reviewed drawing when authorized. The existing publication action now queues both winner and waitlist emails exactly once. It does not immediately deliver all messages.
4. At the event, open volunteer check-in. Staff independently assess available space and keep the whole group together.
5. Monitor the initial-admission counter and recent records. It refreshes every 15 seconds in a visible organizer tab; the refresh button also reloads it.
6. Close check-in and revoke volunteer access after the event. Removing an email immediately invalidates its outstanding login links and sessions. Re-adding it does not revive old credentials.

There is no volunteer export, drawing, settings, partial-admission, exit, occupancy, promotion, or undo control. An accidental recorded admission requires organizer review; never bypass it by handing out another group's code or resetting database rows. Camera/internet access and a staffed capacity procedure need an event rehearsal.

## Volunteer workflow

Volunteers request a single-use email sign-in link (15 minutes). A successful sign-in creates a 12-hour session for the current browser tab. Existing organizers may use their organizer session in the scanner. Staff should use their own device, keep the scanner tab open, and sign out when handing it over; sign-out revokes that server session.

The in-page camera scanner avoids opening a new tab for every guest. There is no paste-link field or separate Verify group button. Camera permission is requested only on **Scan a group QR**; frames stay on the device. The scanner stops after reading a code, when the page is hidden, or when staff tap Stop camera. A successful scan scrolls the result card's validity badge into view and focuses its heading; reduced motion uses an immediate scroll.

Verification shows the current name, email, whole-party size, selected/waitlisted status and any prior admission. Staff check both confirmations: the entire party is present, and there is room for everyone. Only then do they press **Check in all N people** / **Admit waitlisted group of N**. Waitlist action is hidden and server-blocked before the cutoff. Unknown/altered codes, revoked staff access and closed check-in are rejected.

The scanner keeps its routine guidance brief: status/cutoff information, the two confirmations and wristband instructions. Capacity assessment and connection-recovery procedures remain in this guide; an actual failed check-in still tells staff to scan again to confirm saved status.

An already-admitted group shows its time and responsible volunteer; it cannot be counted again. Issue wristbands only after confirmed success. If the connection fails, the write may have succeeded: reconnect and scan again to recover authoritative status before admitting anyone. There is no offline acceptance or deferred check-in queue.

## Security and implementation

- `api/src/tickets.js`: HMAC-SHA-256 credentials scoped to the fixed drawing and entry, using the independent `TICKET_SIGNING_KEY`. QR content contains no name/email. A credential grants pass/status viewing only; it grants neither entry-owner nor volunteer authority. Do not rotate this key after issuing codes without an organizer-approved reissue plan.
- `api/src/door.js`: independent staff allowlist/link/session tables, per-request permission checks, role-specific authentication, explicit admission action and atomic SQL guards. Volunteer requests have their own per-person throughput limit (120/minute) instead of sharing the registration IP bucket. Login/verify still use an IP bucket and email login limit.
- `0004_group_admission.sql`: additive door settings, staff, tokens and admission tables. Existing entries, drawing ranks, revision and mail remain unchanged. The unique admission entry ID prevents two phones/retries from adding a group twice. An admission records the actor, time, whole-group size, request ID and selected/waitlisted/late-selected classification; audit records preserve action evidence.
- Changing door settings increments a separate revision; a previously reviewed scan must be refreshed before it can write. The first successful request wins. Repeated requests return the saved admission.
- `/pass/` and public pass verification show status/party size, not name/email. `/check-in/` requires approved staff authentication for contact details. The owner can retrieve their own pass through the existing authenticated `/entry/` page.
- Privacy erasure invalidates that group's QR and removes it from the recent-contact display; non-identifying admission totals and immutable drawing ranks remain. Staff records and audits require the organizer's retention policy; no new automatic purge is invented.
- QR generation uses `qrcode-generator` 2.0.4; the scanner lazily loads self-hosted `jsQR` 1.4.0. Licenses are shipped with assets. No third-party QR service receives credentials. Inline images use Resend's [CID attachments](https://resend.com/docs/dashboard/emails/embed-inline-images), not remote tracking images.

## API

All routes retain exact-origin restrictions, bounded JSON and private/no-store responses. Public pass lookup still requires a valid signed credential. Request bodies and credentials must not be logged.

| Route | Access / behavior |
| --- | --- |
| `POST /api/pass` | `{ticket}`; read-only pass status and cutoff, no contact details |
| `GET /api/entries/pass` | Entry-owner Bearer; own QR image/pass URL after publication |
| `POST /api/door/login` | `{email}`; generic response; approved staff only get a link |
| `POST /api/door/verify` | `{token}`; consumes link, returns role-specific session |
| `GET /api/door/session` | Staff/organizer Bearer; identity and current door settings |
| `POST /api/door/logout` | Staff/organizer Bearer; revokes this session |
| `POST /api/door/inspect` | Staff/organizer Bearer + `{ticket}`; verifies without admitting |
| `POST /api/door/check-in` | Staff/organizer Bearer + `{ticket,requestId,revision,wholeGroupPresent:true,spaceConfirmed:true}`; atomic whole-group admission |
| `GET /api/admin/door` | Organizer only; settings, counters, volunteers, recent admissions |
| `PATCH /api/admin/door` | Organizer only; `{admissionOpen,selectedCutoffAt,revision}`; cutoff epoch milliseconds or null |
| `POST /api/admin/volunteers` | Organizer only; `{email,active}`; grants/revokes volunteer access |

`door_closed`, `waitlist_closed`, `stale_door` and `check_in_conflict` are 409 responses. Invalid/unavailable QR credentials return 404. Staff authentication failures return 401. Missing signing-key configuration blocks publication with `tickets_unavailable` (503). Health reports `ticketsConfigured`; this checks configuration shape, not email delivery.

## Verification boundaries

The API suite checks roles, revocation, one-time links, cutoff/closure, forged QR credentials, concurrent admissions, retries, privacy erasure and both outcome emails. Browser tests connect the actual frontend and Worker through the isolated fixture, decode the generated email image, use a simulated camera frame, exercise a dropped response after a successful write, and check phone/enlarged-text layouts. These do not establish real inbox delivery or a physical phone camera's behavior. Complete a real-device volunteer rehearsal before the event with explicitly approved test data.

The organizer confirmed the isolated selected/waitlisted phone rehearsal complete on November 7, 2026. Event-day volunteer provisioning, reservation cutoff and door opening remain deferred organizer actions. Rehearse again when devices, staffing or connectivity change; this acceptance does not cover every phone/browser.
