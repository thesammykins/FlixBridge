# Retention policy options addendum

- `allowUnsupportedFavourites` defaults to `false`. Plex retains `favourite: null`,
  reports `favouriteSupported: false`, and describes unsupported favourite/watchlist
  protection in `limitations`, not `blockers`. Complete Plex watch/session evidence
  can therefore be used only with the explicit opt-in. A true favourite, missing
  Jellyfin favourite data, failed reads, missing users/episodes, partial viewing or
  unknown sessions still block. Mixed-provider evidence preserves these protections;
  an absent capability marker is not an unsupported capability.
- `watchState` defaults to `"watched"`. `"unwatched"` permits movies and whole ended
  shows only when **every selected user** is explicitly currently unwatched (and
  every episode has matching evidence). `watchedPolicy: "any-selected"` applies only
  to watched rules; it cannot turn a partly seen household into an unseen one.
  Completed-season rules require `watchState: "watched"`.
- A provider's explicit unwatched flag/zero count establishes current state, not
  never-watched history. Missing summaries/history alone establish neither. When an
  explicitly unwatched viewer has no last-played date, the item must have known
  added-age residency of at least
  `max(minAddedAgeDays, watchGraceDays, minInactiveDays)`. Explanations name residency
  and disclaim never-watched proof; timestamps are not fabricated. If a last-played
  date exists, it must meet grace/inactivity thresholds. Watched viewers with no
  last-played date still block, including under any-selected rules. Ratings remain
  optional explicit source/scale/value/vote filters; they are not review text.
- Snapshot `observedAt` may be up to **five minutes after** the explicit
  `evaluationTime`, inclusive, because reads finish after evaluation is requested.
  This bound is deterministic from those two inputs; original timestamps remain in
  evidence. Invalid observations or later timestamps block. This observation-only
  tolerance never relaxes added dates, air dates, playback ages or future-date checks.

These options change recommendations, not human approval requirements. Deletion
must bind the explicit favourite waiver and rule revision into the approved plan
and revalidate fresh protection and watch evidence before execution.

Focused verification: `npm run build && node --test tests/retention-policy-options.test.mjs`.
Provider fixtures replace transport only; no production requests are made.
