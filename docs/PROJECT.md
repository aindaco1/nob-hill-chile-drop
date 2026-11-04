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
| Group size | 1–8 people, including the entrant; required location is city, state/province and country (Country defaults to USA) |
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

The entry and owner-edit forms offer only 1–8 in a native group-size dropdown. Required City, State/Province and Country inputs accept free text; Country starts at USA and remains editable. Location is private organizer/entry-owner information, included in the guest CSV and removed by privacy erasure. The 2,000-person event ceiling and selection algorithm are unchanged. See [Operations](OPERATIONS.md#group-size-and-location-release) for the additive location migration and form-contract release.

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

## November 4 implementation: rules, consent and homepage stream

This section describes source changes, not a production release. The dated live snapshot below remains the October 28 observation.

- `/hot-spot-rules/` covers event admission/hours, designated-area access, relevant venue conduct/safety policies, belongings, photography and recording. It is linked from the entry forms, drawing rules and footer. Venue terms were reviewed against [Hotel Zazz's policies](https://www.hotelzazz.com/policies) on November 4; room reservations, charges, checkout, room visitors' curfew and hotel check-in age are not event conditions. The service-animal wording follows [DOJ guidance](https://www.ada.gov/topics/service-animals/), without importing room-specific restrictions.
- Registration and owner edits require a separate, unchecked recording-consent checkbox. `_data/event.yml` owns the notice and its version. The notice covers appearance, voice and name in any media, throughout the universe in perpetuity, for event advertising, marketing and promotion. The Worker validates literal agreement and the current version, and records version/time. Existing entries are not retroactively marked as consenting; drawing eligibility is unchanged. The entrant is asked to share the notice with the group, not to claim consent on behalf of every guest.
- **Organizer desk → Homepage display** switches between the chile animation (default) and the supplied Channel 26 player. This setting stays editable after drawing preparation/publication and never changes registration, capacity, ranks or the drawing revision. Visible homepages refresh configuration once a minute and when returning to the tab. A config outage retains the last known display; an initial outage leaves the animation.
- The fixed embed uses Channel 26's own playback controls, a responsive 3:2 frame and an external fallback link. No stream frame loads in animation mode or on private entry/admin pages. Restoring animation removes the player. On narrow phones the stream spans the page width under the title; the player remains above the fold, with supporting hero copy below it. The animation layout retains its existing full-hero viewport fit.
- The form starts with “Enter the drawing,” without a repeated event-name header. The hero has one coral drawing button with a lime offset shadow and a dark arrow badge; public viewing remains in the navigation and Getting here section. The button has no repeating animation.
- The Hot Spot rules include the organizer's non-expired government photo ID policy for alcohol purchases, with photo and birth date proving age 21+. This is the requested event policy, not a statement that state law invalidates expired IDs; [New Mexico ABC guidance](https://www.rld.nm.gov/abc/frequently-asked-questions/for-servers/) allows expired IDs, reviewed November 4.
- Getting here includes a lazy-loaded OpenStreetMap neighborhood embed, a dark color treatment, an event-colored frame, visible attribution and a larger-map link. The address and marker come from [Hotel Zazz's own website](https://www.hotelzazz.com/) (3711 Central Ave NE; 35.080089, -106.602618), reviewed November 4. This locates the hotel; it does not establish event boundaries, parking or arrival instructions. The privacy notice discloses the map connection.
- Getting here uses three columns from 1100px (venue details, smaller map, public viewing information), two on tablets and one on phones. The map is 280px high on larger screens and 260px on phones; surrounding labels and attribution can expand with text size.
- The Hot Spot has a faint, static repeating chile background derived from the organizer-supplied event photo. The 180 × 120px tiles render at 9% opacity, with alternating rows offset by half a tile to avoid straight columns. The form stays opaque and the decoration is absent in forced-colors mode. See [asset provenance](DEVELOPMENT.md#photographic-chile-decoration) for the source and edit prompt.
- The separate personal-photos/photoshoot restriction was removed at the organizer's request. Recording-consent wording is unchanged but italicized in the rules, with regular type in the shared form checkbox. Event/access questions on the rules page go to `nobhillabqmainstreet@gmail.com`, owned by `_data/event.yml`; this is distinct from the existing private administration, privacy and report contacts.
- Release requires additive migration `0002_media_consent_and_display.sql`, the Worker and Pages. New forms fail closed against an older consent contract; old forms receive a refresh instruction from the new Worker. See [Operations](OPERATIONS.md#rules-consent-and-stream-release) for sequencing and rollback limits.

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
