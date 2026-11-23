# Admin API

The Admin API is the set of `/api/*` routes the admin itself uses to change the
site, opened to programs holding a write-scoped API token: an importer, a
publishing script, an editor integration. Reads for a front end belong on the
public content API, `/api/v1`, with a `content:read` token.

## Authentication

Send a token in the usual header:

```
Authorization: Bearer bb_…
```

Tokens are issued under **Admin → API tokens**, and only from a signed-in
session — a token can never mint, list or revoke tokens.

**A token acts as the person who issued it.** The request runs with the owner's
*current* account: their role, their email verification, and it is refused
outright (401) if the account has been disabled. Every capability check the
admin applies applies to the token too. So a token can never do more than its
owner can, and the scope narrows it further:

| Scope           | Grants (on top of the matching read)                                  |
|-----------------|-----------------------------------------------------------------------|
| `content:write` | posts: list, read, create, update, trash; tags and categories: create, update, delete |
| `media:write`   | media: list, read, upload (sign + confirm), update metadata           |

An author's `content:write` token can create and publish their own posts but not
edit anyone else's; a contributor's can write drafts and submit them for review
but not publish; an admin's still cannot touch users, settings, comments or
tokens, which accept sessions only.

A valid token without the scope a route needs gets **403** naming the scope. An
unknown, expired or revoked token, or one whose owner is disabled, gets **401**.

## Endpoints

### Posts (`content:write`)

| Method | Path              | Notes |
|--------|-------------------|-------|
| GET    | `/api/posts`      | Listing as the owner sees it in the admin (drafts included). `?status=`, `?search=`, `?page=`, `?per_page=` |
| GET    | `/api/posts/:id`  | One post, with `category_ids` and `tag_ids` |
| POST   | `/api/posts`      | Needs `post.create`. Body: `title`, `content` (Markdown), optional `slug`, `excerpt`, `status` (`draft`/`pending`/`published`), `publish_at`, `category_ids`, `tag_ids`, `featured_image`, SEO fields, `user_id` (honoured only for editors) |
| PUT    | `/api/posts/:id`  | Same body; absent keys are left alone. Refused with **409** while a person holds the post's edit lock (below) |
| DELETE | `/api/posts/:id`  | Moves the post to the trash. Deleting a post that is already in the trash (permanently) is **403** with a token: emptying the trash needs a session |

Bulk actions, revisions, restore-from-trash, autosave and the edit lock are
admin-only and refuse tokens.

### Tags and categories (`content:write`)

| Method | Path                    | Notes |
|--------|-------------------------|-------|
| POST   | `/api/tags`             | Needs `tag.manage` (editor or admin) |
| PUT    | `/api/tags/:id`         | |
| DELETE | `/api/tags/:id`         | |
| POST   | `/api/categories`       | Needs `category.manage` (editor or admin) |
| PUT    | `/api/categories/:id`   | |
| DELETE | `/api/categories/:id`   | |

Reading them needs no credential: `GET /api/tags`, `GET /api/categories`.

### Media (`media:write`)

| Method | Path                  | Notes |
|--------|-----------------------|-------|
| GET    | `/api/media`          | Needs `media.upload` |
| GET    | `/api/media/:id`      | |
| POST   | `/api/media/sign`     | Step 1: `{ filename, contentType, size }` → `{ uploadUrl, key, ticket, headers }` |
| PUT    | *uploadUrl*           | Step 2: send the bytes straight to storage with the returned headers |
| POST   | `/api/media/confirm`  | Step 3: `{ key, ticket, filename?, altText? }` → the media row |
| PUT    | `/api/media/:id`      | Update alt text and other metadata |

Deleting media is session-only: there is no media trash, and a deleted file
breaks every post that shows it.

## Edit locks

While someone has a post open in the admin editor, the editor holds a soft lock
on it, refreshed every 30 seconds and released when they leave. A lock not
refreshed for two minutes lapses.

- A token write (`PUT /api/posts/:id`) to a post someone else has locked gets
  **409** with a body naming the holder:

  ```json
  { "error": "Ada is editing this post. Your changes were not saved.",
    "lock": { "locked": true, "user_name": "Ada", "expires_at": "…", … } }
  ```

- A token cannot take a lock over or hold one. Retry after `lock.expires_at`;
  the lock is refreshed while the editor stays open, so a script should back
  off rather than poll hard. A person's unsaved typing cannot be recovered and
  a script's request can simply be sent again, which is why the person wins.
- A post nobody has open is not locked, so a token never needs to lock first.
- The token owner's *own* lock does not block them: an editor with the post
  open and a script running under the same account are the same person.

## Limits and attribution

- Writes (anything but GET) with a token are limited to **60 a minute per
  token**; over that is **429** with `Retry-After`. Reads are not counted here
  — use `/api/v1` for bulk reads, which has its own per-address limit.
- Every response to a token request carries `X-BasicBen-Token-Id: <id>`, and
  every token write logs a line to stdout:
  `[admin-api] token 7 "Importer" (user 3) PUT /api/posts/42`.
- Content written by a token is attributed to the token's owner (author,
  revisions), exactly as if they had saved it in the admin. The hooks that fire
  on each write receive the request, so `req.apiToken` (`{ id, name, scopes }`)
  is available to a listener that wants a durable audit trail.

## Example

```sh
curl -X POST https://example.com/api/posts \
  -H "Authorization: Bearer $BASICBEN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"title":"Hello from a script","content":"Written by the importer.","status":"draft"}'
```
