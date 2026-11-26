# hugo-gl-admin

A Hugo Module that adds a browser-based editor for the Markdown posts on GitLab to a Hugo site. It is the GitLab version of [hugo-gh-admin](https://github.com/kmmz532/hugo-gh-admin). It includes login, creating and editing posts, and the admin screens. (Japanese version: [README.md](README.md))

- Posts are saved to a GitLab project (gitlab.com or a self-managed instance) as `content/posts/<slug>.md`.
- The admin screens are available in Japanese and English. Choose the language with `params.glAdmin.lang`.

## Requirements

- Hugo 0.141.0 or later (extended edition)
- Go (used by Hugo Modules to fetch the module)
- A GitLab project for the posts (called "the posts repository" below) and an access token with the `api` scope and a role that can push to its target branch

## Installation

Add the following to the site's `go.mod` and `hugo.toml`.

```toml
[[module.imports]]
  path = "github.com/kmmz532/hugo-gl-admin"
```

```sh
hugo mod get github.com/kmmz532/hugo-gl-admin@v0.1.0
```

Pin the version with a tag. Check the differences before running `hugo mod get -u`.

## Settings (`params.glAdmin`)

Write these in `[params.glAdmin]` in `hugo.toml`. Omitted items use their defaults. The defaults are defined only once, in `layouts/partials/gl-admin/settings.html`.

| Item | Default | Meaning |
|---|---|---|
| `gitlabURL` | `https://gitlab.com` | The GitLab URL. Set the instance URL for a self-managed GitLab |
| `repo` | none | The full path of the posts repository (`group/subgroup/project`) |
| `branch` | `main` | The branch where posts are saved |
| `postsDir` | `content/posts` | The folder for posts |
| `imagesDir` | `static/images` | The folder for images |
| `imagesURL` | `/images/` | The URL prefix for images in posts (passed through `relURL`) |
| `defaultCategory` | `tech` | The default category for new posts |
| `authorField` | `false` | With `true`, the editor shows an author field. Otherwise, the `author` in a post is kept as it is |
| `author` | (empty) | The default author for new posts (a GitLab username). The author saved last in the editor takes priority |
| `editURL` | `/edit/` | The URL of the editor |
| `loginURL` | `/login/` | The URL of the login screen |
| `adminURL` | `/admin/` | The URL of bulk management |
| `adminImagesURL` | `/admin/images/` | The URL of image management |
| `postURL` | `/posts/{slug}/` | The URL pattern for posts. Replaces `{slug}` (file name), `{name}` (name without the leading date), `{yyyy}`, `{mm}` and `{dd}`. Used by the pending display |
| `lang` | the first part of `languageCode` (`en-us` → `en`) | The language of the admin screens. Falls back to `en` when there is no dictionary. Dictionaries are in `data/gl-admin/i18n/<lang>.toml` |
| `tokenProvider` | none | The URL of a module that provides the GitLab token (provided by the site). The module exports `async function getGitLabToken()` and returns a token string or null. The token is cleared when the tab closes (sessionStorage). Without it, you log in with an access token |

To change the URLs of the admin screens, put a `content/*.md` with the same path in the site, override `url:`, and set the same URL in these items.

```toml
[params.glAdmin]
  repo = "owner/articles"
  branch = "main"
```

### Overriding messages

The admin messages are in `data/gl-admin/i18n/<lang>.toml`. Keys are two levels, `<screen>.<item>` (for example `editor.publish`).

- A file with the same path in the site (`data/gl-admin/i18n/<lang>.toml`) takes priority over the module's file. The override is per file, so if you change only some keys, write all the keys of that file.
- In a string, `{name}` is replaced with the value. Keep the same names when you rewrite a message.
- The `<title>` of an admin page comes from `title:` in `content/*.md`. The module's default is a generic English name (for example `Admin`). To change it, put a `content/*.md` with the same path in the site and write `title:` there.

## Integration with the site (theme)

The site calls only these partials.

| Partial | Where it is called | Arguments | Role |
|---|---|---|---|
| `gl-admin/head.html` | `<head>` (after the CSS bundle) | `.` | `<meta name="gl-admin">`, the editor CSS, `admin.js` |
| `gl-admin/csp.html` | Where the CSP `script-src` is built | `.` | Extra sources for that page (cdnjs on the editor only) |
| `gl-admin/button.html` | Header, post cards, footer | `dict "kind" "edit\|new\|admin\|login\|logout\|footer" "page" . "class" "..." "label" "..." "text" true` | Entry buttons to the admin screens |
| `gl-admin/article-scripts.html` | The `scripts` block of a post | `.` | Loads the copy button for code blocks |

`csp.html` returns the values to add to `script-src`. It puts a leading space and outputs no trailing newline.

## What the theme provides (contract)

### Pending templates

Output `<template id="gl-admin-pending-card">` (for list cards) and `<template id="gl-admin-pending-article">` (for a post page) in the page's `<body>`. `pending.js` clones the templates and fills these elements.

- `data-field="thumb|band|date|categories|title|external|source|summary|tags|edit|crumbs|body"`: the elements that receive values. Only `textContent`, `src` and `href` are used.
- `data-item="tag|crumb"`: nested templates cloned once per item.
- Insertion points: `[data-pending-target="list"]` for the list, and `[data-pending-target="article"]` (the 404 box) or `article[data-slug]` for a post.

`data-field="edit"` in the post template is optional. If present, its `href` is set to the editor URL.

On pages without the templates, only the pending band is shown.

### Class names and CSS variables

- Headings use `.page-title`, post headings use `.post-title`, and the body uses `.post-body`. The preview uses the same classes.
- The editor CSS (`assets/gl-admin/editor.css`) uses these CSS variables, which the theme must define:
  `--text-primary`, `--text-secondary`, `--foreground`, `--foreground-rgb`, `--background`, `--border`, `--link`, `--danger`
- The math in the editor preview loads `lib/marked.min.js` (in the site's `static/lib/`).

### Index

- The admin screens read `/gl-admin/index.json`. It holds up to 50 items per file and follows `next`. Items have `slug`, `title`, `url`, `date`, `external`, `images`, `tags` and `categories`.
- The search index `/index.json` is handled by the site.

The theme must provide these two partials, which the index uses.

- `partials/external-meta.html`: returns a dict with `title`, `summary`, `image` and `images` of a post. `images` is an array of OGP image candidates for external links (https only).
- `partials/post-url.html`: returns the URL of a post. For an external link (with `external`), it returns the `external` value; otherwise `.RelPermalink`.

## Front matter

The admin screens read and write only these items. Other items are kept as they are.

`title`, `date`, `lastmod`, `author`, `categories`, `tags`, `summary`, `image`, `aliases`, `external`, `source`, `build`, `sitemap`

## Edit history

The "History" section in the editor lists the commit history of the post file on GitLab, newest first. It loads 30 items at a time; "Load more" shows the next ones.

- Renames (slug changes) are not followed. Only the history of the new path is shown. The history of the old path is not shown.
- Unsaved changes (drafts on this device) are not shown.
- A new post has no file yet, so the section shows "Not saved yet".

## Versioning

- Versions follow [Semantic Versioning](https://semver.org/) and are marked with tags (for example `v0.1.0`).
- A change to any of the following needs a major version and an entry in `CHANGELOG.md`: items in `params.glAdmin`, the names and arguments of partials, the `id` and `data-field` of the templates, CSS variables and class names, and the shape of the index JSON.
- Fixes that do not touch the contract are minor or patch versions.

## Security

- The Personal Access Token is stored in the browser's `localStorage`. Do not use it on shared devices.
- Use a project access token for the posts repository with only the `api` scope. The expiry must be 90 days or less.
- Showing the admin buttons is only for convenience. GitLab decides the permissions.
- The site's Content-Security-Policy must include the sources that `csp.html` returns.
- Include the GitLab URL (default `https://gitlab.com`) in `connect-src`.
- The editor shows unpublished images from `<gitlabURL>/<repo>/-/raw/...`, so the posts repository must be public.

## Changing the look

To change how a shortcode in a post looks, put a file with the same name in the site (for example `layouts/shortcodes/*.html`). It overrides the module's file.

## License

MIT ([LICENSE](LICENSE)).
