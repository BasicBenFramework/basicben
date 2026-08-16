// Database entities
export interface User {
  id: number
  name: string
  email: string
  password: string
  role: string
  created_at: string
}

/** The authenticated principal, taken from the JWT. Capability checks read this. */
export interface AuthUser {
  id: number
  role: string
}

export interface Post {
  id: number
  user_id: number
  title: string
  content: string
  slug?: string
  excerpt?: string
  featured_image?: number
  category_id?: number
  meta_title?: string
  meta_description?: string
  publish_at?: string
  published: boolean
  created_at: string
  updated_at: string
  author_name?: string
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
  content?: string
  template: string
  published: boolean
  parent_id?: number
  menu_order: number
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
  approved: boolean
  created_at: string
  user?: User
  replies?: Comment[]
}

export interface Media {
  id: number
  user_id?: number
  filename: string
  original_name: string
  path: string
  mime_type?: string
  size?: number
  alt_text?: string
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
}

export interface Response {
  json: (data: unknown, status?: number) => void
  status: (code: number) => Response
  send: (body?: string) => void
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
