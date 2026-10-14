# Sonarr API v3 → v5: contract changes and FlixBridge scope

This research describes Sonarr's development implementation at
[`57816c149d02f95543973fefb4780c4495f8121c`](https://github.com/Sonarr/Sonarr/tree/57816c149d02f95543973fefb4780c4495f8121c),
not every released or installed application build. Controller/resource/core source
was checked alongside the checked-in OpenAPI documents. Fixtures derived from that
source are synthetic, not redacted live captures. The moving `develop` branch may
change again; older references to `v5-develop` are not the pinned contract.

## Three versions, three separate facts

- **Sonarr application version:** the `version` returned by system status.
- **HTTP API family:** `/api/v3` or `/api/v5`, with different routes and DTOs.
- **MCP protocol/tool contract:** FlixBridge's transport revision, tool names,
  arguments and normalized results. These do not inherit Sonarr's numbering.

[`ApiInfoController`](https://github.com/Sonarr/Sonarr/blob/57816c149d02f95543973fefb4780c4495f8121c/src/Sonarr.Http/ApiInfoController.cs#L9-L17)
advertises `current: "v5"`, `deprecated: ["v3"]`. This is not an endpoint capability
matrix. Both controller families remain in the examined source; there is no implied
`/api/v4`. A successful status read proves that read, not all operations.

A notable compatibility caveat: core queue processing now fills plural `Episodes`,
while the retained v3 queue mapper still reads obsolete singular `Episode`.
Retained v3 routes can therefore lose episode-related semantics on application v5.
This is a source-level risk, not a reproduced live failure. Missing identity must
block automation rather than be reconstructed from the first episode or a title.

## Material contract changes

Paths in the table are relative to the selected `/api/v3` or `/api/v5` family.

| Area | v3 → v5 | Consequence |
| --- | --- | --- |
| Queue progress | `sizeleft`/`timeleft` → `sizeLeft`/`timeLeft` | Case-sensitive adapters; zero remaining bytes must produce 100%, not missing progress |
| Queue identity | Singular episode/season → `episodeIds`, `episodes`, `seasonNumbers`, `episodesWithFilesCount`, `isFullSeason` | Preserve pack scope without multiplying one download into several independent targets |
| Queue visibility | `includeSeries`/`includeEpisode` → repeated `includeSubresources`; unknown-series items default to included | Request subresources deliberately and retain unknown/incomplete evidence |
| Other embedded resources | Episode/calendar/history/wanted use endpoint-specific `includeSubresources` enums | Queue takes `episodes`, history takes `episode`; one universal enum is wrong |
| Manual-import discovery | `downloadId` → array query `downloadIds` | Even one download uses the plural key; the old key can select a different discovery path |
| Import rejections | Human text in `reason` → structured reason code plus `message` and `type` | Retain both machine reason and readable explanation; any rejection still blocks automation |
| Import execution | POST `/manualimport` remains candidate reprocessing; POST `/command` with `ManualImport` executes | Reprocessing/HTTP acceptance are not successful imports; command and final media evidence are separate |
| Series add | Valid non-null `language` and nonempty `seasonType` required | Obtain one exact lookup resource; do not invent English or a season layout |
| Release search | Flat DTO → nested `release`, `parsedInfo`, `decision`, optional `history` | Requires a dedicated release adapter; existing metadata `search` is not release search |
| Release grab/push | Separate `{guid,indexerId,override?,searchInfo?}` grab DTO; push returns one resource rather than an array | Never replay a whole search response as a grab request; stale search cache is not retry authority |
| Media information | Flattened audio/subtitle fields → per-stream arrays | Preserve all tracks, channels, language and forced/hearing-impaired flags |
| Settings | `/config/*` → `/settings/*`; `/config/host` → `/settings/general` | Unused administration routes are documented, not exposed as speculative tools |
| Notifications | `/notification` → `/connection` | Rename around the same notification provider model, not a new provider system |
| Import-list exclusions | `/importlistexclusion` returns a paging envelope; old `/paged` route absent | Enumerate pages; an empty page does not prove an empty exclusion list |
| Quality definitions | Size limits absent from definition DTO; update moves to PUT `/qualitydefinition`; `/limits` absent | Limits belong on profile items; some profile-item limits also exist in the pinned v3 source |
| History | New `/history/season` and `/history/episode`; season filtering moves off series-history | Targeted history can reduce diagnosis scope; `/history/since?date=…` returns a list, not a paging object |
| Episode-file editing | Old `/episodefile/editor` absent; `/episodefile/bulk` takes an array of file resources | Do not reuse the old editor body; the v3 editor was already obsolete |
| Calendar | `unmonitored` → `includeUnmonitored`, with specials handling | Query compatibility needs more than a prefix change; calendar feeds also move `/feed/v3` → `/feed/v5` |
| Metadata | MAL/AniList IDs, original country and richer statistics | Useful anime context; a declared ID is not proof it is an accepted add lookup key |
| Authentication | Shared API-key mechanism retained | Use `X-Api-Key`; no new OAuth requirement is established by this API move |
| Errors | Validation arrays, error objects and empty bodies coexist | Do not assume universal ProblemDetails or include upstream bodies in public errors |
| Success responses | More precise documented 201/202/204 responses | Several changes correct OpenAPI metadata rather than wire behavior; support empty 204 and asynchronous 2xx |

### Development-source caveats

- The mapper derives `seasonNumbers` from one nullable mapped season; it is not a
  proven complete multi-season inventory. Declared DTO fields need not be populated.
- Language-profile v3 endpoints were already obsolete compatibility stubs, not
  working language preference tools removed wholesale in v5.
- Custom formats, tags, scene numbering and quality-score thresholds exist in both
  families. They are not new v5-exclusive features.
- GET `/release/push/{id}` is advertised but inherits an unimplemented handler.
  Conversely, `[NonAction]` bulk overrides are not exposed broken endpoints.
- Provider force switches change to `skipTesting`/`skipValidation`; do not bypass
  validation automatically. Release profiles use `indexerIds` and string-array terms.
- New `/settings/metadata` and `/settings/update` are not a clean exclusive split:
  some update fields remain on general settings in this source snapshot.

## What FlixBridge uses

The implemented policy and exact reviewed operation map are documented in
[configuration](configuration.md#sonarr-api-policy). Omission preserves legacy v3;
explicit `3` and `5` verify advertised families/status; `auto` chooses reviewed
per-operation routes. Strict `5` blocks unported workflows before writes. An
intentional v3 route in `auto` is visible policy, never failure-driven fallback.

Current v5 work includes queue/pack normalization, structured import diagnostics,
manual-import command execution, lookup-derived add metadata, same-family profile
round-trips and read-only `library_statistics`. Removal, file deletion, import-issue
collection and diagnostic auto-fix remain reviewed v3 workflows. See the
[tool reference](api-reference.md) for the stable MCP inputs and result semantics.

## Further features, in order of value

1. **Complete remaining write workflows:** port removal/file deletion/auto-fix only
   after exact query/body contracts, fresh scope, confirmation and independent
   readback are tested. Do not make strict v5 a loose preference to fill the gap.
2. **Targeted history:** optional episode/season scope on `history_detail`, using
   the specific routes rather than filtering an incomplete global page.
3. **Release explanations:** read-only inspection of structured release decisions,
   prior grabs and rejections. Keep metadata lookup distinct; a later grab action
   needs its own bounded input/authority and cache-expiry handling.
4. **Media-stream diagnostics:** explain audio/subtitle compatibility from all
   streams without automatically replacing media on incomplete metadata.
5. **Season monitoring/anime context:** a focused monitoring action for
   `/series/{id}/season` and richer MAL/AniList context if requested. Avoid a generic
   settings/provider editor merely to mirror every upstream endpoint.

## Primary source anchors

All links pin the same research revision:

- [v3 OpenAPI](https://github.com/Sonarr/Sonarr/blob/57816c149d02f95543973fefb4780c4495f8121c/src/Sonarr.Api.V3/openapi.json) and [v5 OpenAPI](https://github.com/Sonarr/Sonarr/blob/57816c149d02f95543973fefb4780c4495f8121c/src/Sonarr.Api.V5/openapi.json).
- [Queue resource](https://github.com/Sonarr/Sonarr/blob/57816c149d02f95543973fefb4780c4495f8121c/src/Sonarr.Api.V5/Queue/QueueResource.cs) and [controller](https://github.com/Sonarr/Sonarr/blob/57816c149d02f95543973fefb4780c4495f8121c/src/Sonarr.Api.V5/Queue/QueueController.cs).
- [Manual-import controller](https://github.com/Sonarr/Sonarr/blob/57816c149d02f95543973fefb4780c4495f8121c/src/Sonarr.Api.V5/ManualImport/ManualImportController.cs) and [resource](https://github.com/Sonarr/Sonarr/blob/57816c149d02f95543973fefb4780c4495f8121c/src/Sonarr.Api.V5/ManualImport/ManualImportResource.cs).
- [Series controller](https://github.com/Sonarr/Sonarr/blob/57816c149d02f95543973fefb4780c4495f8121c/src/Sonarr.Api.V5/Series/SeriesController.cs), [release resource](https://github.com/Sonarr/Sonarr/blob/57816c149d02f95543973fefb4780c4495f8121c/src/Sonarr.Api.V5/Release/ReleaseResource.cs), and [grab DTO](https://github.com/Sonarr/Sonarr/blob/57816c149d02f95543973fefb4780c4495f8121c/src/Sonarr.Api.V5/Release/ReleaseGrabResource.cs).

Source and synthetic checks do not certify live compatibility. Live write validation
requires a separately authorized disposable library; production maintenance is not
a release smoke test. See [security boundaries](security-audit.md).
