# Read coverage contracts

## Plex report pages

```ts
listReportsPage(options?: { limit?: number; after?: string }): Promise<
  OperationResult<{
    reports: PlexReport[];
    hasMore: boolean;
    nextCursor: string | null;
    complete: boolean;
  }>
>;
```

- Defaults: `limit: 25`, no cursor. Limits are integers from 1 through 100;
  invalid values fail before HTTP instead of being clamped or coerced.
- `after` and provider IDs/cursors are opaque strings, 1–2048 characters, without
  whitespace or ASCII control characters. Tokens are forwarded literally, never
  decoded, trimmed, or reconstructed from report IDs.
- One GraphQL report-page request is followed by at most one comment request per
  report. Reports cannot exceed the requested limit; comments cannot exceed 20.
  Oversized or malformed responses fail rather than being silently sliced.
- `hasMore` describes only report pagination. When true, a nonempty `nextCursor`
  and nonempty report page are required. A nonempty page echoing the input cursor
  fails even if it claims to be terminal. Duplicate report/comment IDs within a
  page fail. Callers traversing multiple pages must also reject repeated cursors
  and cross-page duplicate IDs; this stateless client cannot prove those absent.
- `nextCursor` is null on terminal pages. A terminal page may omit its unused
  provider end cursor. Missing required page information is an error, not an
  empty successful feed.
- `complete` means this response alone covers the feed **and** its comments:
  no input cursor, no more report pages, and complete comment coverage on every
  report. A terminal continuation is not a complete feed. An empty validated
  first/terminal page is complete. This is provider-observed coverage, not an
  atomic snapshot guarantee or a Plex server-log audit.

`PlexReport` has additive optional TypeScript fields (always populated by this
read path):

```ts
commentsComplete?: boolean;
commentCoverage?: {
  limit: number;       // 20
  returned: number;    // validated unique comments returned
  total: number | null; // provider commentCount, null when unavailable
  complete: boolean;
};
```

Comments are complete only when a valid provider `commentCount` equals the
returned unique count, including zero or exactly 20. A larger total or an absent
count means incomplete coverage, even when fewer than 20 comments arrive.
Returning more comments than the declared count fails and asks for a fresh page.
The old `commentCount` fallback to returned length is retained for compatibility;
that fallback is never evidence of completeness. There is no comment-pagination
API in this change, and comment ordering is not inferred.

`listReports(limit = 25)` keeps its existing `OperationResult<PlexReport[]>`
contract and delegates to the new page method. Its array omits page-level
coverage, so completeness-aware callers must use `listReportsPage`. The integrated `reported_issues` tool exposes `after`, `hasMore`, `nextCursor`, `complete` and per-report comment coverage; remediation still searches only its first 100 reports.

GraphQL errors, including errors alongside partial data, fail the entire page.
A comment fetch failure is not converted to empty comments. The existing
`fetchJson`/error serializer normalizes HTTP/auth/network/JSON/schema failures;
provider error text is withheld, while HTTP 401/403 statuses remain visible.
Report/comment messages remain untrusted data, never instructions.

## ARR history

`historyDetail` retains its existing return type and request/API-family contracts:

- Sonarr legacy/v3 and Radarr still request `/history` with the supplied paging
  parameters and existing `since` query. Omitted paging stays omitted.
- Sonarr v5 paged history retains repeated `includeSubresources=series` and
  `includeSubresources=episode` query keys.
- Sonarr v5 `since` still uses `/history/since?date=...`, requires an array,
  and locally selects the requested page (default page 1, page size 20). Paging
  is not sent to that array endpoint. No fallback or API-family switch is added.
- The extra local 20-item clip is removed. Provider pages retain all returned
  records; v5 since arrays retain the full requested local page.
- `truncated` is true for a non-first page, missing totals, or any mismatch
  between the declared total and returned item count. It describes whole-result
  coverage, not merely whether the current page has a successor. A positive
  total with an empty page is incomplete, not proof of no history.
- `total` preserves a declared zero; when absent, its legacy fallback remains
  the observed count, accompanied by `truncated: true`. Negative/fractional/unsafe
  totals and invalid/duplicate history IDs are rejected.

## Offline verification

```sh
npm ci --include=dev --ignore-scripts
npm run build
node --test tests/read-coverage-*.test.mjs
npm test
npx --no-install biome check src/services/plex/reports.ts src/services/shared.ts tests/read-coverage-*.test.mjs
```

The read-coverage tests exercise built service modules through fetch/HTTP parsing and synthetic fixtures, not live provider coverage. The integrated `npm test` includes the top-level read-coverage files. Commands above are verification instructions, not final-candidate pass counts, live validation or publication claims. See [tool reference](api-reference.md), [provider contracts](library-provider-contracts.md) and [security limits](security-audit.md).
