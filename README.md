# Wirewalk Advisory — site

Jekyll site published with GitHub Pages. The marketing pages and the articles
share one design system; there is no build tooling beyond what Pages runs
itself, and no external requests at runtime.

## Publishing an article

Add one Markdown file to `_posts/`. Commit. Push. That is the whole workflow —
GitHub Pages rebuilds on every push to `main`, usually inside a minute.

    _posts/2026-09-18-slurm-gres-and-cgroups.md

The filename must start with the date in `YYYY-MM-DD-` form; the rest becomes
the URL slug. Front matter:

```yaml
---
title: "Slurm gres and cgroups: what actually pins a GPU to a job"
date: 2026-09-18
category: Benchmarking      # shown as the eyebrow and in the index
tags: [Slurm, GPU, cgroups] # small pills under the title
summary: >-
  One or two sentences. Used as the standfirst, the index blurb,
  the meta description and the RSS summary.
---
```

Then write Markdown. Available beyond the usual:

- Fenced code blocks with a language tag get syntax highlighting.
- `<div class="note" markdown="1"> ... </div>` renders a callout with a clay
  left rule. The `markdown="1"` attribute is required for Markdown inside it.
- Tables render with the site's table styling and scroll horizontally on narrow
  screens.
- A contents rail builds itself from the article's `##` headings on wide
  screens, and appears only when there are three or more.

## Layout of the repository

| Path | What it is |
|---|---|
| `index.html` | The marketing home page. Carries `is_home: true`, which is what turns on the mega menu, the sliding nav pill and the home-only JavaScript. |
| `writing/index.html` | Article index. |
| `_posts/` | Articles. |
| `_layouts/` | `base` (shell), `home`, `post`, `page`. |
| `_includes/site-style.html` | The main stylesheet, shared by every page. |
| `_includes/prose.html` | Article typography, code theme, contents rail, index list. |
| `_includes/header.html`, `footer.html` | Site chrome. Switches between in-page anchors and absolute links depending on `is_home`. |
| `_includes/core-js.html` | Smooth scrolling, reveals, header state, menu, contact form. Runs everywhere. |
| `_includes/home-js.html` | Home page data and rendering. Runs only on the home page. |
| `feed.xml` | Atom feed, hand-written so the site needs no plugins. |

## Local preview

    bundle install
    bundle exec jekyll serve

Then open `http://localhost:4000/wirewalk/`.

## Deploying

Settings → Pages → Build and deployment → Deploy from a branch → `main` / root.

`baseurl` in `_config.yml` must match the repository name. If the repository is
renamed, change `baseurl` in the same commit or every link will break. When a
custom domain is attached, set `baseurl` to an empty string and `url` to the
domain.

## Contact form

`CONTACT.endpoint` near the bottom of `_includes/core-js.html` is empty, so the
form shows its confirmation without delivering anything. Point it at a form
handler to make it live, and keep the destination address in that handler's
configuration rather than in this repository.
