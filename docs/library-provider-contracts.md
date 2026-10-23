# Library provider contracts

This module is read-only. It does not approve, schedule, monitor, delete, mark
watched, rate, or favourite anything. HTTP uses `src/core.ts:fetchJson` (including
its cancellation, timeout, response-size and redirect controls). Secrets are
read from the environment only; discovery/results never return configured URLs
or credentials. No cache, database, config file or credential file is written.

## Integration API

`src/library/intelligence.ts` exports:

- `libraryTools: Tool[]`: five MCP definitions with read-only annotations and
  strict advertised object schemas.
- `runLibraryTool(name: string, args: unknown): Promise<OperationResult<unknown>>`:
  validates the particular tool's Zod schema, rejects unknown fields/coercion,
  and normalizes failures. Aggregate reads can succeed with `complete:false`
  plus `errors`; callers must inspect coverage, not just `ok`.
- `loadLibrarySnapshot(services?: string[]): Promise<LibrarySnapshot>`: **ARR
  only**, using the unchanged `model.ts` contract. Empty ARR configuration is
  an empty snapshot, not a startup failure. An explicitly unknown service is
  an incomplete snapshot with an error. Provider/config failures never become
  affirmative evidence of absence.
- `getWatchEvidence(item: LibraryItem, users: ViewerScope[], seasonNumber?: number)`:
  per-viewer evidence and conservative aggregate flags. Invalid/duplicate viewer
  scopes throw normalized errors; unavailable provider evidence becomes an
  unknown viewer with blockers. There is no default viewer.
- `mediaServers()`: synchronous, environment-only discovery. Entries expose
  `name`, `type`, `configured:true`, `reachable:null` and capabilities. They
  **never** contain tokens, URL bases or user-token bindings. Discovery is not
  a reachability test.
- `mediaSystemStatus(name: string)`: explicit remote identity/status read.
  Successful results include `configured:true, reachable:true`. Failures retain
  configuration state; an HTTP error proves reachability, while transport or
  schema failures leave it unknown (`null`). `isHealthy:false` is not a claim
  that a server is offline.

The parent dispatcher owns registration, output envelopes and startup. The
isolated module tests run with:

```sh
npm ci --include=dev --ignore-scripts
npm run build
node --test tests/library-*.test.mjs
```

The parent must add that last command to its final `npm test` script; this
workstream intentionally does not edit package files or `src/index.ts`.

## MCP inputs

Every object rejects additional properties, including viewer objects. Numbers
are literal safe integers: no string IDs, truncation or coercion. Strings naming
services/servers/users have length 1..200. Pagination is one-based: `page`
1..100000 (default 1), `pageSize` 1..250 (default 50). Optional `services` is an
array of 1..50 exact configured names. `query` is a case-insensitive substring,
maximum 500 characters; it is only browsing, never an identity join.

| Tool | Required | Optional |
| --- | --- | --- |
| `library_list` | none | `services`, `query`, `page`, `pageSize`, `scope:"library"\|"users"`, `mediaKind:"series"\|"movie"`, `monitored:boolean` |
| `media_detail` | `service:string`, `itemId:positive integer` | `includeReviews:boolean`, `reviewPage:integer 1..1000` |
| `watch_status` | `service:string`, `itemId:positive integer`, `users:ViewerScope[1..100]` | `seasonNumber:nonnegative integer` |
| `watch_history` | `server:string`, `userId:string` | `page`, `pageSize` |
| `upcoming_media` | none | `services`, `start`, `end`, `page`, `pageSize` |

`ViewerScope` is exactly `{server:string,userId:string}`. Scopes must be unique.
`seasonNumber` is valid only for a series; zero means specials, not “all”.

Examples (names and IDs are illustrative, not operational configuration):

```json
{"scope":"users","services":["jellyfin-home","plex-home"]}
```

```json
{"services":["jellyfin-home"],"mediaKind":"movie","page":1,"pageSize":50}
```

```json
{"service":"sonarr-home","itemId":42,"users":[{"server":"jellyfin-home","userId":"explicit-user-id"}],"seasonNumber":1}
```

`library_list` defaults to all configured ARR instances and media servers.
`scope:"users"` defaults to media servers only and returns
`{server,userId,name}` records from provider account discovery. User discovery
requires suitable provider permissions; it never guesses IDs or returns raw
account DTOs. `query`/pagination work on both scopes. `mediaKind`/`monitored`
apply to library records only; `monitored` excludes media-server records because
media servers do not own ARR monitoring state.

Library results contain `items,total,page,pageSize,hasMore,complete,errors`.
`total` counts **observed matching records**; when coverage is incomplete it is
not the size of the unseen provider library. ARR items use `LibraryItem` with
numeric IDs, files and coverage. Media-server copies are deliberately separate
records with string IDs, source, kind and provider IDs; they are not ARR removal
targets and are never silently merged by title.

`media_detail` and `watch_status` intentionally require ARR targets. Standalone
Plex/Jellyfin installations support library/account browsing, system status and
provider-supported history without ARR configuration.

`upcoming_media` uses actual ARR `/calendar` results, not dates inferred from
watch summaries. Dates are ISO date-times with UTC/explicit offsets. Default
range is now through 30 days later; end must be after start and at most 366 days
later. Missing event dates, failed pages and unknown services are incomplete.

## Configuration

ARR configuration is exclusively `loadConfigFromEnvOnly()`. This module does
not add another ARR discovery mechanism or registry and does not rewrite its
configured policy. Private URL base paths survive every request.

Media servers accept `PLEX_<SLUG>_URL` (or `_BASE_URL`), `_TOKEN`, optional
`_NAME`; Jellyfin accepts `JELLYFIN_<SLUG>_URL`, `_API_KEY` (or `_TOKEN`/`_KEY`),
optional `_NAME`. `FLIX_BRIDGE_` aliases are supported. Slugs become lower-case
hyphenated names, e.g. `JELLYFIN_HOME_LAN_*` -> `jellyfin-home-lan`. Conflicting
slug aliases and duplicate names are errors. URLs must be HTTP(S) without
userinfo, query or fragment. Legacy `PLEX_BASE_URL`/`PLEX_URL` + `PLEX_TOKEN`
(and prefixed aliases) discover `plex`; equivalent single Jellyfin variables
are accepted too. Single-instance and slug instances can coexist.

Plex summaries are token-user-specific. Configure an explicit binding under
that server's prefix:

```text
PLEX_HOME_USER_ALICE_ID=<server-local account ID from scope:users>
PLEX_HOME_USER_ALICE_TOKEN=<that user's Plex token>
```

Alternatively `_USER_ID` explicitly binds the main server token to that one
account. Unbound users do not inherit the server-owner token. Different tokens
bound to one requested ID are rejected. These are operator-supplied identity
bindings, not an interactive sign-in or cryptographic proof of token ownership;
Plex account discovery confirms server membership. Correct binding is an
operator prerequisite. Do not copy actual tokens into documentation or MCP
arguments. Global session/history/account reads use the main server token.

Use an administrative Jellyfin API key with visibility of all selected users
and all sessions. Before trusting `/Sessions`, this adapter requires a successful
schema-validated `/Auth/Providers` read, whose reviewed authorization policy is
`RequiresElevation`. It does not treat `/System/Info` as an admin probe. Denied,
unavailable or changed elevation probes make session coverage unknown, even if
`/Sessions` returns an empty restricted list. No authentication-provider secret
is requested or returned. The reviewed controller source is
[Jellyfin SessionController](https://github.com/jellyfin/jellyfin/blob/master/Jellyfin.Api/Controllers/SessionController.cs).
Provider authorization semantics remain a trust boundary; fixtures do not
prove an operator's live permission configuration.

## ARR endpoint and family contract

| Resource | Modeled reads |
| --- | --- |
| Sonarr v3 | `/tag`, `/series`, `/series/{id}`, `/episode?seriesId=...`, `/episodefile?seriesId=...`, `/calendar` |
| Radarr v3 | `/tag`, `/movie`, `/movie/{id}`, `/moviefile?movieId=...`, `/calendar` |

For explicit Sonarr policies the existing `SonarrService.systemStatus()`
performs authenticated discovery, family verification and reviewed-operation
mapping. This workflow currently accepts only the adapter-selected v3 route.
Strict v5 is **unsupported**, not a reason to request legacy endpoints. `auto`
selecting v5 is also blocked even if deprecated v3 is advertised; there is no
failed-read fallback, route override, private-method access or family replay.
Omitted policy retains existing legacy-v3 behavior. No new v5 DTO compatibility
is claimed by these fixtures.

Lists accept either an array or a validated paginated `records/totalRecords`
envelope. Paging is capped at 100 pages of requested size 250; array results
are capped at 25000 entries. Positive totals with empty pages, duplicate IDs,
wrong offsets/pages, changed totals and invalid DTO fields fail closed. ARR
snapshots preserve successful titles/services alongside normalized errors.
Subresources for another title are rejected. Inconsistent episode/file counts,
unknown tags, missing provider identity and unmapped files mark items incomplete.
Multi-episode file `episodeIds` are preserved, never collapsed to one episode.

Ratings retain source, value, explicit scale and votes when supplied. Reviewed
scales: TVDB/IMDb/TMDB 10; Metacritic/Rotten Tomatoes 100. Sonarr's flat legacy
rating uses TVDB/10. Unsupported sources or values outside their reviewed scale
fail explicitly rather than inventing a scale or dropping a bad rating.

## Media server joins and watch coverage

- Jellyfin: `/Users`, `/Users/{userId}`, `/Users/{userId}/Items`, `/Items`,
  `/Sessions`, `/System/Info`. `StartIndex/Limit` pages require stable totals,
  unique IDs and progress. Every requested user is identity-checked; summaries
  come from that user's endpoint, not a server-global counter.
- Plex: `/accounts`, `/identity`, `/library/sections`,
  `/library/sections/{key}/all`, `/library/metadata/{key}/allLeaves`,
  `/status/sessions`, `/status/sessions/history`. Metadata pages require
  `size,totalSize` and stable offsets/totals; missing coverage is unknown.
- Joins require at least one equal shared TVDB/TMDB/IMDb provider ID and no
  conflicting shared IDs. Duplicate provider copies are ambiguous. Plex modern
  GUIDs and reviewed legacy agent GUID forms are parsed; arbitrary/title GUIDs
  are not. Episode joins additionally require exact series parent, season and
  episode coordinates. No title-only identity joins exist.
- Jellyfin `Played` and `PlaybackPositionTicks` are explicit inputs. Missing or
  conflicting state is unknown; positive playback position is partial, not
  proof of completion. Explicit multi-version `MediaSources` are unknown.
  Last-played timestamps are real summaries, compared chronologically including
  timezone offsets; they are not converted into invented event history.
- Jellyfin favourites cover the root and all selected episodes. Missing flags
  are unknown. Plex favourites/watchlist are **unsupported**: ratings are not
  favourites, `favourite:null` is returned, and Plex evidence therefore always
  blocks cleanup even when a configured viewer is watched.
- Sessions cover the matching movie or any episode of the series, including
  playback by users outside the requested watch scopes. An unavailable session
  read is not an empty list. Series playback protection is deliberately broader
  than a requested season. Read results are observations, not locks against a
  playback session starting after the read.
- `complete` requires complete ARR metadata, every selected viewer known, known
  favourite/session coverage and no blockers. An incomplete source never
  yields affirmative cleanup permission. Watch state is per provider metadata
  item, not a claim that a particular encoding/file version was viewed; removal
  must separately bind and re-read exact ARR file identities.

Plex history returns only actual provider event records for the requested
server-local account. Every record must carry that exact `accountID`, a unique
`historyKey` and a real `viewedAt`; another account's event causes an error, not
silent filtering. `watchedAt` is the event timestamp, **not** proof that playback
completed. A history page is not lifetime coverage, and zero events does not
mean never watched. Jellyfin core has no reviewed playback-event endpoint here:
`watch_history` returns `supported:false,summaryOnly:true,events:[]` with a
reason after validating the user; use `watch_status` for its real summary.

## Optional reviews

`media_detail` includes review capability metadata. Without `TMDB_API_KEY` or
`TMDB_API_TOKEN`/`TMDB_TOKEN`, capability is `unconfigured`. A configured provider
is not contacted until `includeReviews:true`. An exact numeric TMDB ID is
required; missing IDs are unsupported, not searched by title. The only remote
host is `https://api.themoviedb.org/3`: GET `/{movie|tv}/{id}` plus `/reviews?page`.
Bearer tokens are preferred; a v3 API key is sent only as the provider-required
query parameter. Neither is returned or logged by the core HTTP logger.

Reviews preserve actual provider text, author, timestamps, TMDB source URLs and
optional reviewer rating. The title's TMDB rating has scale/votes. Each page is
bounded to 20 reviews, text to 100000 characters per review; paging totals and
identity are validated. Failures return capability `unavailable`, a normalized
error and incomplete coverage without discarding successful ARR detail.
Multiple pages expose `hasMore` and incomplete collection coverage. Provider
text is explicitly untrusted display data with `executableConditions:false`;
it is never inserted into the shared model, retention conditions or commands.

## Verification limits

Final local verification on Node v24.22.0:

- `npm ci --include=dev --ignore-scripts`: passed; no dependency changes.
- `npm run build`: passed with strict TypeScript and no `any` additions.
- `node --test tests/library-*.test.mjs`: **15 passed, 0 failed**.
- Existing `npm test`: **225 unit tests and 26 MCP tests passed**. This baseline
  script does not yet include `library-*.test.mjs`; parent wiring remains required.
- Scoped `biome check` on every new source/test file: passed.
- Full `npm run check`: blocked solely by the pre-existing formatter layout of
  `src/library/model.ts:37` in the supplied contract. That parent-owned file was
  not edited; parent can apply its formatter-only fix during integration.

`tests/library-intelligence.test.mjs` uses actual loopback HTTP responses through
`fetchJson`, plus a fetch-boundary TMDB fixture. It clears operator service
configuration and forbids non-loopback network requests outside that explicit
fixture. It covers paging/progress, authentication and schema failures,
per-viewer disagreement, ambiguous/conflicting IDs, exact coordinates,
multi-episode files, session/favourite protection, timezone ordering,
standalone discovery and review provenance. RED failures were observed before
implementing each end-to-end feature slice and the multi-version, rating,
chronological timestamp and undated-calendar guards.

No live providers, installed-package MCP integration or new Node-version matrix
were exercised by this workstream. Existing repository tests remain unchanged;
parent integration must run the new tests in its final script and re-run MCP
wire/package checks after registration. Unknown versions/DTOs and unsupported
capabilities are limitations, never simulated evidence.
