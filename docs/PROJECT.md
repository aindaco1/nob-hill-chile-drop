# Project decisions and current state

[Documentation index](../README.md) · Last reviewed **October 28, 2026** against application commit `3b45b14faa197ae40ebf71980d23ea47bea95d62` and the live read-only checks below.

## Purpose and confirmed event facts

Help visitors understand the event, enter a free group drawing for Hot Spot admission, and distinguish that entry from public viewing. Give organizers a private way to manage entries and publish one reviewed drawing.

| Fact | Current decision |
| --- | --- |
| Name | Nob Hill Chile Drop |
| Event | December 31, 2026, welcoming 2027 |
| Venue | Hotel Zazz, Nob Hill, Albuquerque, New Mexico |
| Hot Spot opens | **10 p.m. Mountain Time**, December 31 |
| Alcohol sales end | **11:30 p.m. Mountain Time**, December 31 |
| Chile drop | Midnight into January 1, 2027 |
| Countdown instant | `2027-01-01T00:00:00-07:00`, equivalent to `2027-01-01T07:00:00Z` |
| Time zone | `America/Denver`; use explicit Mountain Time in visitor copy |
| Admission | Free entry into a drawing; selected groups receive free Hot Spot admission |
| Capacity | At most 2,000 people, kept in whole groups |
| Administration and weekly reports | `alonso@dustwave.xyz` |
| Closing and drawing | Manual; no announced date |
| Domain | Temporary GitHub Pages address; custom-domain ownership/access unconfirmed |

The Hot Spot offers close views, music, alcohol sales for eligible adults and a chance to appear in event coverage. Drinks are purchased separately. Public viewing outside it does not require a drawing entry. The hotel's guest-only upper area is a separate internal access arrangement, not a public lottery tier.

## Decisions future work must preserve

| Decision | Reason or consequence |
| --- | --- |
| Free drawing replaces the earlier $1.50 paid-chance proposal | No checkout, payment collection or sales reporting in this release |
| One verified email represents one group | Repeated submissions cannot overwrite someone else's existing group; email ownership is required |
| One random rank per group | A larger group gets no additional weight; this is not a per-person raffle |
| Stop at the first whole group that does not fit | Smaller later groups do not skip ahead; unused capacity is possible |
| Prepare once, review, commit, publish | Preparing already fixes the random order and locks registration/capacity; there is no reroll/reset endpoint |
| Publish counts publicly and notify selected groups privately | Guest identities and ranks are not public |
| Dedicated drawing service with shared Platform primitives | Store's RSVP workflow confirms admission immediately; a pending drawing entry is not an RSVP ticket |
| Jekyll + native JS + small Worker | Preserve the existing structure and keep changes DRY and KISS |

See [Drawing](DRAWING.md) for precise eligibility and capacity behavior. Equal random rank does not imply identical final admission probability for different group sizes.

## Current content and visual direction

- Main title: “Nob Hill Chile Drop.” Intro: “One very Albuquerque way to welcome the new year.” Use direct, useful event copy; avoid generic slogans and filler sections.
- Countdown sits below the header and above the hero. The accompanying label is “Hot Spot opens at 10pm MT.” It still counts down to midnight, not opening time.
- Keep the hero visible above the fold at the supported desktop/mobile test sizes. Maintain readable type instead of shrinking all text to fit.
- Original chile SVG, with navy, lime, red, cream and blue inspired by the event's neon-sign aesthetic. Free, self-hosted Barlow Condensed and DM Sans fonts; licenses copied during the build.
- The chile automatically loops through its drop animation. A pause control remains; there is no “Drop it again” button. Motion pauses offscreen/when the document is hidden and is disabled for reduced motion.
- The matching red chile cursor is limited to fine mouse pointers. Native cursor behavior remains for inputs, keyboard/touch use, reduced motion and forced colors.
- No top announcement bar; drawing rules are linked in the footer. Alcohol sales and hours are prominent in the Hot Spot section.
- Footage is conditional on an approved `film.youtube_id`; the empty section stays hidden. The YouTube player loads only after a click.
- `preview: true` currently emits noindex. The site is publicly accessible; noindex is not access control.

Visual reference: [event Instagram](https://www.instagram.com/nobhillchiledrop/). Information-structure reference: [One Times Square](https://onetimessquare.com/nye-ball). These references do not establish this event's schedule or grant rights to reuse their media.

## Remaining decisions and limitations

These are a handoff list, not authorization to implement or publish them automatically.

| Item | What is still needed |
| --- | --- |
| Registration close/drawing announcement | Organizer-selected dates and public wording; manual controls already exist |
| Arrival and admission fulfillment | Check-in location, acceptable proof, group arrival policy and guest instructions; no QR/ticket/check-in system is implemented |
| Visitor logistics | Approved public viewing map, parking, street closures/access, accessible routes/restrooms and bag rules |
| Approved footage | A usable video and confirmed permission; no placeholder footage is presented as real |
| Final public launch | Organizer decision on indexing, final logistics and any domain cutover |
| Domain | Confirm ownership and access before DNS or naming changes |
| Waitlist | No automatic promotion, cancellation/reallocation or second drawing workflow |
| Data retention | Organizer-approved retention/deletion schedule; there is no automatic campaign-wide purge |
| Mail observability | Provider acceptance is recorded; no delivery/bounce webhook or automatic inbox-delivery confirmation |
| Future edition | Single-event schema and hardcoded email/API/calendar details need review; do not reset the existing drawing/database |

## Verified production snapshot

Read-only checks on **October 28, 2026** established:

| Surface | Evidence |
| --- | --- |
| Pages application release before this docs update | Commit `3b45b14`; [successful workflow 40739680700](https://github.com/aindaco1/nob-hill-chile-drop/actions/runs/40739680700) |
| Public health | `/health`: `ok: true`, `emailConfigured: true` |
| Registration | `/api/config`: `registrationOpen: true`, `capacity: 2000`, `locked: false`, `revision: 0` |
| Published results | `/api/config`: `resultsPublished: false`, `results: null` |
| Worker version | `5cf9b535-b22c-4169-b3a3-836c7cb67d8a`, 100% traffic; deployment created `2026-10-28T06:22:44.324418Z` |
| D1 binding | `DB` points to `7afb3b21-843c-4967-bda4-edc5272e9a3c` |
| Service configuration | Live bindings matched `api/wrangler.toml`; both required secret names were present |
| Schedules | Every-minute outbox dispatcher and Monday `16:00 UTC` weekly report trigger present |

These checks did **not** log in, query private entrants, send email, prove inbox delivery or run a drawing. `emailConfigured` checks configuration shape, not provider validity. Future agents must recheck live state for operational tasks. See [Operations](OPERATIONS.md).

## Source provenance

The starting ZEMA Landing structure was taken from commit `ea02ebc8594569cdeee35a3c959c8196479ea911`. Dust Wave Platform is pinned to v0.44.0, commit `ad2be4580fc05978e7d8d05c93c3038c13e09876`; [platform.json](../platform.json) records package versions. This project does not automatically track either upstream's latest code.
