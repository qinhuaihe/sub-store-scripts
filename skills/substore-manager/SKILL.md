---
name: substore-manager
description: Manage Sub-Store landing subscriptions and generate copy-ready Mihomo subscription URLs.
---

# Sub-Store Landing Manager

Use this skill to manage landing-node subscriptions in the user's Sub-Store and quickly generate copy-ready Mihomo links.

## Configuration

The companion script reads configuration from environment variables or a local `.env` file. Never print or commit secrets.

Required:

- `SUBSTORE_BASE_URL` — public/admin base URL of Sub-Store, without a trailing slash.
- `SUBSTORE_API_KEY` — optional secret used to authenticate to Sub-Store/Caddy. If the deployment does not require a key, it may be empty.
- `SUBSTORE_MIHOMO_FILE` — Sub-Store Mihomo file name used by `/api/file/:name`.

Optional authentication variables:

- `SUBSTORE_AUTH_HEADER` — header name used for the API key. Defaults to `Authorization`.
- `SUBSTORE_AUTH_SCHEME` — value prefix, defaults to `Bearer`. Set to an empty value when the key should be sent directly.

## Safety

- Never display `SUBSTORE_API_KEY`.
- Never put secrets into generated Mihomo URLs.
- Listing, reading, creating, and generating links may run directly when requested.
- Before deleting a subscription, clearly identify the subscription and obtain explicit user confirmation.
- Before overwriting the URL/configuration of an existing subscription, show the target subscription and obtain explicit user confirmation.
- Prefer a dedicated Sub-Store credential with only the permissions required for subscription management.

## Sub-Store API

Use Sub-Store's native subscription API:

- `GET /api/subs` — list subscriptions.
- `POST /api/subs` — create subscription.
- `GET /api/sub/:name` — get subscription/output.
- `PATCH /api/sub/:name` — update subscription.
- `DELETE /api/sub/:name` — delete subscription.

Use `scripts/substore.py` instead of constructing ad-hoc HTTP requests.

## Commands

```bash
python scripts/substore.py list
python scripts/substore.py get NAME
python scripts/substore.py create NAME URL
python scripts/substore.py update NAME URL
python scripts/substore.py delete NAME
python scripts/substore.py links
python scripts/substore.py links NAME
```

`create` creates a normal remote Sub-Store subscription. `update` only changes the subscription URL while preserving other returned subscription fields where possible.

## Landing resolution contract

The repository's Mihomo injection script interprets `landing=NAME` as follows:

1. Look for a node whose name exactly equals `NAME` in the `落地节点` subscription.
2. If no node matches, treat `NAME` as a Sub-Store subscription name and use the nodes from that subscription as landing nodes.
3. `landing=none` disables landing nodes.
4. Omitting `landing` uses all nodes from `落地节点`.

Therefore a dedicated subscription can represent one landing server without modifying the aggregate `落地节点` subscription.

## Link generation

When the user asks which links are available to copy, run `links` and return the generated URLs in copy-friendly code blocks.

Always include:

- Default: no `landing` parameter; uses all nodes from `落地节点`.
- Direct/no landing: `landing=none`.
- Rule URL for each selected landing subscription.
- Global URL for each selected landing subscription: `landing=NAME&mode=global`.

When a single landing is requested, return only that landing's Rule and Global URLs unless the user asks for the complete list.

URL-encode the file name and landing name.

## Typical workflow

When asked to add a new landing subscription:

1. Run `list` and check whether the requested name already exists.
2. If it exists, do not overwrite it without confirmation.
3. If it does not exist, run `create NAME URL`.
4. Verify it appears in `list`.
5. Run `links NAME` and return its Rule and Global Mihomo URLs.

When asked to show available landing links:

1. Run `links`.
2. Present the results grouped by landing name.
3. Do not expose the Sub-Store API key or upstream node credentials.
