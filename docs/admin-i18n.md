# Admin languages

The admin ships in English and Spanish. Strings live in
`src/client/i18n/locales/<code>/`; the code is in `src/client/i18n/index.ts`.

## Choosing a language

- **For the whole site:** Settings → Language & Time → Admin language
  (the `admin_locale` setting). Blank means English.
- **For one browser:** Profile → Admin language. "Site default" follows the
  setting above.

A tag the admin has no dictionary for falls back by language (`es-MX` uses
`es`), then to English. This is separate from the `locale` setting, which is
the language of the public site and is reported to front ends by
`/api/v1/site`.

Messages that come from the server — validation errors, site-health checks —
are in English for now.

## Writing translatable admin code

Strings are keyed on their English text:

```tsx
import { useT, slots } from '../../i18n'

const { t, tn, locale } = useT()

t('Save changes')
t('Deleted {name}', { name })
tn('{count} post', '{count} posts', total)        // {count} is filled in
slots(t('Entries live at {code}.'), { code: <code>/recipes/slug</code> })
date.toLocaleDateString(locale)
```

- Keep the argument a literal: the test extracts them statically.
- One sentence, one string. Don't join translated fragments — word order
  differs between languages. Use placeholders, and `slots()` for markup.
- For a value from a fixed set (a status, a role), map it to literal `t()`
  calls rather than `t(status)`.

`tests/admin-i18n.test.js` fails when a shipped language is missing a string
or its placeholders differ, and when an admin file has visible English outside
`t()`.

## Adding a language

1. Copy `src/client/i18n/locales/es/` to `locales/<code>/` and translate the
   values (keys stay English). Plurals are objects keyed by
   [CLDR plural category](https://cldr.unicode.org/index/cldr-spec/plural-rules):
   `{ one: '…', few: '…', many: '…', other: '…' }` — `other` is required.
2. Add `{ code: '<code>', name: '<the language's own name>' }` to
   `ADMIN_LOCALES` in `src/client/i18n/index.ts`.
3. `node --test tests/admin-i18n.test.js` lists anything missing.

Each dictionary is its own chunk, loaded only when that language is chosen.
