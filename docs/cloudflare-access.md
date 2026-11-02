# Cloudflare Access upstream authentication

FlixBridge can send a Cloudflare Access service token to a configured Sonarr,
Radarr, SABnzbd, Plex Media Server or Jellyfin instance. This is outbound
application authentication, not an HTTP MCP transport or Tunnel provisioner.
It does not change FlixBridge's human-approval or queue-discard authority.

## Configure the Access application

Create a service token and allow it in the application's **Service Auth** policy.
An ordinary Allow policy or interactive identity-provider login is not a
headless replacement. Cloudflare's strict service-token mode returns 401/403
instead of a login redirect and requires the service-token headers on every
request. FlixBridge does not rely on an Access browser cookie.

The upstream API key/token is still required: Access gets the request to the
application; Sonarr/Radarr/SAB/Plex/Jellyfin authenticates it separately.

## Per-instance configuration

Supply settings through the MCP client's environment or an external secret-aware
launcher. FlixBridge does not automatically load `.env` files.

```sh
SONARR_HOME_URL=https://sonarr.example.com/sonarr
SONARR_HOME_API_KEY=<upstream-api-key>
SONARR_HOME_CF_ACCESS_CLIENT_ID=<service-token-client-id>
SONARR_HOME_CF_ACCESS_CLIENT_SECRET=<service-token-client-secret>
```

Use the same prefix as the instance's URL/provider credentials, not its custom
`NAME`. Supported prefixes are `SONARR`, `RADARR`, `SABNZBD`, `PLEX`, `JELLYFIN`,
and their existing `_<SLUG>` variants. Existing `FLIX_BRIDGE_<PREFIX>` aliases
are accepted. For example, a single Plex server uses `PLEX_URL`/`PLEX_TOKEN`
plus `PLEX_CF_ACCESS_CLIENT_ID` and `PLEX_CF_ACCESS_CLIENT_SECRET`.

Each alias that supplies either Access field must supply both. If both bare and
`FLIX_BRIDGE_` aliases are present, the complete pairs must be identical. Do not
split a pair across aliases. Credentials are opaque, nonempty visible ASCII
without whitespace; legacy and newer Cloudflare secret formats are accepted.

## Explicit global fallback

```sh
FLIX_BRIDGE_CF_ACCESS_CLIENT_ID=<shared-service-token-client-id>
FLIX_BRIDGE_CF_ACCESS_CLIENT_SECRET=<shared-service-token-client-secret>
```

This pair is an explicit opt-in to **share one Access identity across every
configured supported upstream without its own override**. Prefer per-instance
pairs when applications have different policy/identity requirements.

Resolution is pair-level:

1. A complete instance pair overrides the global pair.
2. Only when neither instance field is configured may the complete global pair
   apply.
3. With neither pair configured, no Access headers are sent and existing HTTP
   behavior is unchanged.

Partial, empty, whitespace-containing, invalid-header or conflicting pairs are
configuration errors, even if another override would hide them. There is no
local/global half-pair mixing. Every upstream receiving an effective pair must
use **HTTPS**, including private-network upstreams using the global fallback.
The HTTP URLs in older examples must be changed to HTTPS before enabling Access.

## Forwarding and failure boundaries

FlixBridge adds `CF-Access-Client-Id` and `CF-Access-Client-Secret` alongside the
existing provider authentication. The effective pair is bound to the selected
instance and its exact configured URL origin, including scheme and port. Two
instances may share an origin while retaining different Access identities.

Same-origin read redirects retain the existing bounded redirect policy.
Cross-origin redirects and mutation redirects remain rejected; SAB deletion
requests are mutations even though their HTTP method is GET. An authentication
failure never retries with global credentials, without Access, or with a weaker
API family. No arbitrary custom-header configuration is exposed.

Access credentials are not forwarded to Plex cloud reports/comments, optional
external review providers, approval webhooks or unrelated initial destinations.
The PMS metadata requests used to resolve reports remain instance-authenticated.
Both credential fields are withheld from public metadata, redacted from provider
echoes and normalized errors, and omitted from enumerable instance configuration.

A 200 HTML Access login page is a failed API request, not an empty/healthy service.
For 401/403 or a login page, check the Service Auth policy, token validity/expiry,
URL and the upstream API credentials. Status alone cannot identify which of the
two independent authentication layers denied access. No login URL, response body
or credential is needed in a public diagnostic.

## Rotation

Create/rotate a service-token secret in Cloudflare, using a grace period when
available. Update both fields in the same configured scope through the secret
manager/launcher, then reconnect or restart the owning MCP client so its instance
configuration is refreshed. Do not leave a half-updated pair or change only one
alias. Re-run `system_status` and a bounded read-only request before retiring the
old secret. Rotation does not approve a destructive operation or release a
consumed reservation. Never commit real credentials or diagnostic dumps.

Authoritative reference: [Cloudflare service tokens](https://developers.cloudflare.com/cloudflare-one/access-controls/service-credentials/service-tokens/).
