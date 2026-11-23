// Database entities
export interface User {
  id: number
  name: string
  email: string
  password: string
  role: string
  /** Author archive segment, e.g. `jane-doe`. Unique; set at registration. */
  slug?: string | null
  /** The author's biography, shown on a byline and an archive page. */
  bio?: string | null
  /** The author's own site. */
  website?: string | null
  /** Foreign key into `media`. Not a filename — resolved into `AuthorProfile`. */
  avatar_id?: number | null
  email_verified?: number
  email_verified_at?: string | null
  created_at: string
}

/**
 * A user as a reader meets them: the byline, not the account.
 *
 * Deliberately excludes the address, the password and the role. This shape
 * travels to public pages, so anything that must not be published cannot be on
 * it in the first place.
 */
export interface AuthorProfile {
  id: number
  name: string
  slug: string | null
  bio: string | null
  website: string | null
  /** Resolved through the storage adapter, so buckets can move. */
  avatar_url: string | null
}

/** The authenticated principal, taken from the JWT. Capability checks read this. */
export interface AuthUser {
  id: number
  role: string
  email_verified?: boolean
}

export interface Post {
  id: number
  user_id: number
  title: string
  /** Markdown source. Canonical — this is what the author wrote. */
  content: string
  /** Rendered, sanitized HTML. A cache of `content`; never edit it directly. */
  content_html?: string
  slug?: string
  excerpt?: string
  /** Foreign key into `media`. Not a filename — see `featured_image_url`. */
  featured_image?: number | null
  /** Resolved by the model through the storage adapter. */
  featured_image_url?: string | null
  /**
   * The primary category — the one a breadcrumb or canonical URL would name.
   * A post can belong to several; see `category_ids`.
   */
  category_id?: number
  /**
   * Every category on the post. Returned by `GET /api/posts/:id` so the editor
   * can preselect them; sent back on save to replace the set.
   */
  category_ids?: number[]
  /** Every tag on the post, same contract as `category_ids`. */
  tag_ids?: number[]
  meta_title?: string | null
  meta_description?: string | null
  /** When it goes, or went, live. A future value on a published post is a schedule. */
  publish_at?: string | null
  published: boolean
  /** Editorial state: `draft`, `pending` (awaiting review) or `published`. */
  status?: 'draft' | 'pending' | 'published'
  /** Set while the post is in the trash. */
  deleted_at?: string | null
  og_title?: string | null
  og_description?: string | null
  og_image?: number | null
  twitter_title?: string | null
  twitter_description?: string | null
  twitter_image?: number | null
  canonical_url?: string | null
  noindex?: number | boolean
  /** Who may read the body: `public`, `members`, or `paid` (enforced as members for now). */
  visibility?: 'public' | 'members' | 'paid'
  /** The author asked for this post to be emailed to members when it goes live. */
  send_newsletter?: number | boolean
  /** Content type key (migration 038). `post` for every post that predates types. */
  post_type?: string
  /** Custom field values: the stored JSON string on a row, an object once shaped for the editor. */
  fields?: string | Record<string, unknown> | null
  /** Custom taxonomy term ids, for the editor to preselect. */
  term_ids?: number[]
  created_at: string
  updated_at: string
  author_name?: string
  /** The author's profile, when the query asked for one. */
  author?: AuthorProfile | null
  category_name?: string
  tags?: Tag[]
}

export interface Category {
  id: number
  name: string
  slug: string
  description?: string
  parent_id?: number
  created_at: string
  post_count?: number
  children?: Category[]
}

export interface Tag {
  id: number
  name: string
  slug: string
  created_at: string
  post_count?: number
}

export interface Page {
  id: number
  title: string
  slug: string
  /** Markdown source. Canonical — this is what the author wrote. */
  content?: string
  /** Rendered, sanitized HTML. A cache of `content`; never edit it directly. */
  content_html?: string
  template: string
  published: boolean
  parent_id?: number
  menu_order: number
  /** Foreign key into `media`. Not a filename — see `featured_image_url`. */
  featured_image?: number | null
  /** Resolved by the model through the storage adapter. */
  featured_image_url?: string | null
  meta_title?: string
  meta_description?: string
  created_at: string
  updated_at: string
  children?: Page[]
}

export interface Comment {
  id: number
  post_id: number
  user_id?: number
  parent_id?: number
  author_name?: string
  author_email?: string
  content: string
  /** Kept in step with `status`: true exactly when it is `approved`. */
  approved: boolean
  /** pending, approved, spam or trash. Moderators only; the public list is all approved. */
  status?: 'pending' | 'approved' | 'spam' | 'trash'
  /** Why a check held it or called it spam. Moderators only. */
  held_reason?: string | null
  /** The rate limiter's view of the commenter's address. Moderators only. */
  author_ip?: string | null
  /** Whether the commenter asked to be emailed about replies. */
  notify_replies?: boolean | number
  reply_notified?: boolean | number
  created_at: string
  user?: User
  /** 1 for a top-level comment; set on the trees the post thread returns. */
  depth?: number
  replies?: Comment[]
}

export interface Media {
  id: number
  user_id?: number
  filename: string
  original_name: string
  /** The storage key. Not a URL — see `url`. */
  path: string
  /** Resolved per request through the storage adapter, so buckets can move. */
  url?: string
  mime_type?: string
  size?: number
  alt_text?: string
  /** Pixel dimensions, read from the file at upload. Null for non-images. */
  width?: number | null
  height?: number | null
  created_at: string
}

export interface Settings {
  id: number
  key: string
  value?: string
  group_name: string
  created_at: string
  updated_at: string
}

// API types
export interface ApiResponse<T> {
  data?: T
  error?: string
}

export interface PaginatedResponse<T> {
  data: T[]
  total: number
  page: number
  per_page: number
  total_pages: number
}

// Request/Response (from BasicBen core)
export interface Request {
  body: Record<string, unknown>
  params: Record<string, string>
  query: Record<string, string>
  headers: Record<string, string>
  userId?: number
  user?: AuthUser
  /** Set by requireCapability when a loadResource option is supplied */
  resource?: Record<string, unknown>
  /**
   * Set by requireScope when the credential was an API token rather than a
   * session. Its presence is what distinguishes a program from a person —
   * a token has scopes but no role, so capability checks do not apply to it.
   */
  apiToken?: { id: number; name: string; scopes: string[] }
  /**
   * Set by the member middleware: the signed-in reader, or null when the
   * request carried no valid member session. Never an admin principal —
   * nothing that sets this touches `user` or `userId`.
   */
  member?: import('../models/Member').MemberRow | null
}

export interface Response {
  json: (data: unknown, status?: number) => void
  status: (code: number) => Response
  send: (body?: string) => void
  redirect: (url: string, status?: number) => void
  setHeader: (name: string, value: string) => void
  end: (body?: string) => void
}

// Form data types
export interface PostFormData {
  title: string
  content: string
  slug?: string
  excerpt?: string
  featured_image?: number
  /** Who the post is attributed to. Only honoured for `post.edit` holders. */
  user_id?: number
  category_id?: number
  tags?: number[]
  meta_title?: string
  meta_description?: string
  publish_at?: string
  published: boolean
}

export interface PageFormData {
  title: string
  slug?: string
  content?: string
  featured_image?: number | null
  template?: string
  parent_id?: number
  menu_order?: number
  meta_title?: string
  meta_description?: string
  published: boolean
}

export interface CategoryFormData {
  name: string
  slug?: string
  description?: string
  parent_id?: number
}

export interface TagFormData {
  name: string
  slug?: string
}

export interface CommentFormData {
  content: string
  author_name?: string
  author_email?: string
  parent_id?: number
  /** Email me when someone replies. Needs an address: the guest's, or the account's. */
  notify_replies?: boolean
  /** The signed timestamp from the comments response's `form.token`. */
  form_token?: string
  /** The honeypot. A person never fills it in. */
  website?: string
}

export interface UserFormData {
  name: string
  email: string
  password?: string
}

export interface LoginFormData {
  email: string
  password: string
}

export interface RegisterFormData {
  name: string
  email: string
  password: string
}
