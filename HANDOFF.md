# Wirewalk web properties — handoff

State as of 2026-09-04. Everything below is verified against the live sites and
the repositories, not from memory.

---

## 1. Two sites, two repositories

### Main site — Wirewalk Advisory

| | |
|---|---|
| Repository | `https://github.com/wirewalktech/wirewalk-site` |
| Live URL | `https://www.wirewalk.com/` |
| Articles | `https://www.wirewalk.com/writing/` |
| Feed | `https://www.wirewalk.com/feed.xml` |
| Engine | Jekyll, built by GitHub Pages. No plugins, no external requests at runtime. |
| Local clone | `~/Downloads/site` on the Mac |
| Pages config | Deploy from branch `main`, root |

`baseurl` in `_config.yml` is `/wirewalk-site` and **must match the repository
name**. If the repo is renamed, change `baseurl` in the same commit or every
link on the site breaks. With a custom domain attached, set `baseurl` to an
empty string and `url` to the domain.

### AI site — Wirewalk AI, "The Operating Review"

| | |
|---|---|
| Repository | `https://github.com/wirewalktech/AI-Extension` |
| Live URL | `https://ai.wirewalk.com/` |
| Also reachable | `http://ai.wirewalk.com` (HTTP only — see §5) |
| Engine | Single self-contained `index.html`. No build step. `.nojekyll` present. |
| Local clone | `~/Downloads/wirewalkai` on the Mac |
| Contact form | Posts to `https://formsubmit.co/sales@wirewalk.com` |

---

## 2. Immediate outstanding action

**One commit is applied and committed on the Mac but not pushed.**

```
cd ~/Downloads/site
git push
```

`4d6e992  Reframe the front page around HPC and AI` — changes `_config.yml`,
`_includes/footer.html`, `_includes/header.html`, `_includes/home-js.html`,
`index.html`. Working tree is clean. One commit ahead of `origin/main`.

Until this is pushed the live front page still leads with security audits.

---

## 3. Repository layout (main site)

```
_config.yml               title, baseurl, permalink, markdown settings
index.html                front page. Carries `is_home: true`
writing/index.html        article index
_posts/                   articles, one Markdown file each
_layouts/base.html        page shell: head, style, header, footer, core JS
_layouts/home.html        wraps base, used by index.html
_layouts/post.html        article header, prose body, contents rail, prev/next
_layouts/page.html        simple content page
_includes/site-style.html main stylesheet, shared by every page
_includes/prose.html      article typography, code theme, contents rail, index list
_includes/header.html     nav. Switches between in-page anchors and absolute links
_includes/footer.html     footer
_includes/core-js.html    smooth scroll, reveals, header state, menu, contact form
_includes/home-js.html    nav pill + scrollspy (home page only)
feed.xml                  Atom feed, hand-written so no plugin is required
Gemfile                   local preview only; Pages uses its own toolchain
```

### Publishing an article

Add one Markdown file to `_posts/`, commit, push. Live in about a minute.

```
_posts/2026-09-18-slurm-gres-and-cgroups.md
```

Filename must begin `YYYY-MM-DD-`; the remainder becomes the URL slug. The date
must not be in the future or Jekyll silently skips the file.

```yaml
---
title: "Slurm gres and cgroups: what actually pins a GPU to a job"
date: 2026-09-18
category: Fabric              # eyebrow on the article, label in the index
tags: [Slurm, GPU, cgroups]   # small pills under the title
summary: >-
  One or two sentences. Used as the standfirst, the index blurb,
  the meta description and the RSS summary.
---
```

Available in the body beyond ordinary Markdown:

- Fenced code blocks with a language tag get syntax highlighting on a dark block.
- `<div class="note" markdown="1"> … </div>` renders a callout with a clay left
  rule. The `markdown="1"` attribute is required for Markdown inside it.
- Tables get the site's table styling and scroll horizontally when narrow.
- A contents rail builds itself from the article's `##` headings on wide screens,
  and appears only when there are three or more.

### Local preview

```
cd ~/Downloads/site
bundle install
bundle exec jekyll serve
# http://localhost:4000/
```

---

## 4. Articles published (10)

All at `https://www.wirewalk.com/writing/<slug>/`.

| Date | Slug | Title |
|---|---|---|
| 2026-09-04 | `infiniband-lid-budget-lmc` | LID budgets: what happens to addressing when the endpoint count changes |
| 2026-09-04 | `opensm-routing-engines` | Changing the OpenSM routing engine: updn, ftree, and the silent fallback |
| 2026-09-04 | `quantum-switch-port-splitting` | Splitting ports on Quantum switches: what it costs you |
| 2026-09-04 | `connectx-firmware-management-mft` | ConnectX firmware management: PSID, burn, reset, verify |
| 2026-09-04 | `nccl-tests-collective-bandwidth` | nccl-tests: bus bandwidth, and the one column worth reading |
| 2026-09-03 | `ior-mdtest-parallel-storage` | IOR and mdtest: why your storage benchmark says the filesystem is fine |
| 2026-09-01 | `hpl-mxp-mixed-precision` | HPL-MxP: reading a mixed-precision result without fooling yourself |
| 2026-08-26 | `hpcg-benchmarking` | HPCG: the benchmark that tells you what the memory system can do |
| 2026-08-19 | `hpl-benchmarking` | HPL: what Linpack actually measures, and what it is good for |
| 2026-08-12 | `osu-micro-benchmarks` | OSU Micro-Benchmarks: measuring the fabric before you blame the application |

**Provenance, and it matters.** These were written from documented tool and
protocol behaviour, not from engagement notes — no site, cluster, host,
organisation or person is named or inferable in any of them. They are accurate
and useful as reference material, but they do not contain specific findings from
any particular piece of work. Anything that would make them distinctive still
needs to be added.

Dates are editorial placeholders in the filename and front matter. Change freely.

---

## 5. Known issues, open

### AI-Extension: four footer links 404

The "Also from Wirewalk" footer links point at `wirewalk-site.html`, which does
not exist in that repository. All four 404 on the live site. A patch exists that
fixes this, removes a byte-identical duplicate page (`wirewalk-ai_3.html`) and
adds `.nojekyll`. It was delivered as `~/Downloads/ib-articles.patch`-era work
under the name `ai-extension-fix.patch`; regenerate if lost.

### AI-Extension: horizontal overflow on phones

Measured on the live page: 9px of horizontal scroll at 420px viewport width,
39px at 390px, 69px at 360px. Cause is the header — brand, call-to-action button
and burger do not fit on one line below roughly 560px. The main site has the fix
already (two media queries: move the CTA into the collapsed menu below 560px,
hide the wordmark below 380px); it has not been applied to AI-Extension.

### ai.wirewalk.com has no HTTPS

```
http://ai.wirewalk.com   301 →  http://wirewalktech.github.io/AI-Extension/   works
https://ai.wirewalk.com  connection reset, no certificate presented
http://wirewalk.com      301 →  http://wirewalk.net/   (separate, pre-existing rule)
```

The no-ip URL-forwarding host (34.199.8.144) presents no TLS certificate for the
name. Browsers that try HTTPS first will fail. Proper fix, in this order:

1. At DNS, make `ai.wirewalk.com` a **CNAME to `wirewalktech.github.io`** rather
   than a URL redirect.
2. Repo Settings → Pages → Custom domain → `ai.wirewalk.com`. This writes a
   `CNAME` file into the repository.
3. Once the check goes green, enable **Enforce HTTPS**.

Do step 1 before step 2. A `CNAME` file landing while DNS still points at no-ip
takes the site dark until DNS catches up.

### Contact forms

Main site: `CONTACT.endpoint` near the bottom of `_includes/core-js.html` is an
empty string, so the form shows its confirmation without delivering anything.
Point it at a handler to make it live, and keep the destination address in that
handler's configuration rather than in the repository — anything in the HTML is
readable in view-source.

AI site: already wired to FormSubmit, delivering to `sales@wirewalk.com`.

---

## 6. Front page content, and where it came from

The front page was reframed on 2026-09-04 from security audits to HPC and AI
infrastructure. Every figure traces to a line in the CV
(`lshovskyhpc1130.docx`):

| Figure | Source |
|---|---|
| 5,000 nodes, liquid-cooled Cray/HPE, federal weather modelling | 2,500 + 2,500 node clusters |
| 1,680 nodes, three sites, two continents, semiconductor | 1,200 + 480 nodes |
| 520 nodes migrated from Linux and HP-UX to cloud, automotive | 400 + 120 nodes |
| 12,000 users, mixed research and clinical estate | academic medicine role |

No employer is named on the front page. Sectors and scale carry it instead.
This is a deliberate departure from the Operating Review deck, which lists
organisations by name; that list is his employment history rather than a client
list, and naming them on an indexed public page is a different exposure from
showing them in a room. Restoring the names is a content decision, not a
technical one.

---

## 7. Backlog

- Push `4d6e992` (§2).
- Apply the AI-Extension footer/duplicate fix, and port the mobile header fix.
- Move `ai.wirewalk.com` to a CNAME so it gets real HTTPS.
- Wire the main site contact form to a handler.
- Fold real engagement findings into the ten articles (§4).
- Requested but not yet written, one article per tool: UFM, GPFS erasure coding,
  VAST, Spectrum-X, GB200. GB300 and Vera Rubin need source material — they sit
  past reliable knowledge and should not be written from inference.
- The Operating Review deck carries three unsourced figures (65% of denied claims
  never reworked; 51–75 hours per week on denial rework; 13 of 20 enforcement
  matters citing one missing document). Fine in a room, exposed on a public page.
  Source or cut them.

---

## 8. Why this session could not push

This Cowork session runs in a cloud sandbox and reaches the Mac through a
separate sandboxed Linux VM. That VM has git, has `~/Downloads` mounted, and has
network access to GitHub — reads work. It has no credential helper and cannot
see the macOS keychain, so `git push` fails with:

```
fatal: could not read Username for 'https://github.com': terminal prompts disabled
```

Claude Code running in a terminal on the Mac has no such boundary: it runs as
the user, with the user's credentials, and can push directly. That is the
practical difference between the two.
