#!/usr/bin/env python3
"""Health check for every Wirewalk site. Re-runnable; exits non-zero on any failure.

    python3 tools/check-sites.py            # all sites
    python3 tools/check-sites.py www ai     # named sites only

Checks, per site:
  1. DNS resolves to GitHub Pages
  2. GitHub Pages is enabled, built, has the right CNAME, and enforces HTTPS
  3. http:// redirects to https://
  4. Every page reachable from the homepage returns 200
  5. No stale baseurl path appears in any link or asset reference
  6. Every link resolves; every #fragment matches a real id on its target page
  7. The contact form carries action/method/name and posts to FormSubmit

Two mistakes this script exists to prevent, both of which shipped to production:

  * Crawling wirewalktech.github.io instead of the live custom domain. GitHub
    301s the old URL to the custom domain, which masked the fact that every
    /wirewalk-site/... link 404d for real visitors. Roots here are always the
    domains users land on.
  * Treating a rendered "Thank you" as proof of delivery. The old contact form
    had no action/method/name and its JS printed a success message without
    sending anything. Check 7 asserts the markup, not the message.

Requires: python3 (stdlib only) and, for the Pages checks, `gh` authenticated.
"""
import json
import re
import ssl
import subprocess
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

# "phone" is the number that site is expected to publish. The AI practice
# deliberately lists a different one from the engineering sites, so this is
# per-site rather than a single global expectation.
SITES = {
    "www":    {"domain": "www.wirewalk.com",    "repo": "wirewalk-site",
               "form": True, "phone": "917-217-7975"},
    "ai":     {"domain": "ai.wirewalk.com",     "repo": "AI-Extension",
               "form": True, "phone": "516-269-1517"},
    "print":  {"domain": "print.wirewalk.com",  "repo": "print-wirewalk",
               "form": True, "phone": "917-217-7975"},
    "studio": {"domain": "studio.wirewalk.com", "repo": "studio-wirewalk",
               "form": True, "phone": "917-217-7975"},
}
# Repo-name paths that must never appear in a rendered link (the baseurl bug).
STALE = ["/wirewalk-site/", "/AI-Extension/", "/print-wirewalk/", "/studio-wirewalk/"]
GH_PAGES_IPS = {"185.199.108.153", "185.199.109.153", "185.199.110.153", "185.199.111.153"}

UA = {"User-Agent": "Mozilla/5.0 (wirewalk-site-check)"}
CTX = ssl.create_default_context()


class _NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        raise urllib.error.HTTPError(req.full_url, code, newurl, headers, fp)


_FOLLOW = urllib.request.build_opener()
_NOFOLLOW = urllib.request.build_opener(_NoRedirect)

GREEN, RED, YELLOW, DIM, OFF = "\033[32m", "\033[31m", "\033[33m", "\033[2m", "\033[0m"
failures = []


def ok(msg):
    print(f"    {GREEN}PASS{OFF}  {msg}")


def bad(site, msg):
    print(f"    {RED}FAIL{OFF}  {msg}")
    failures.append(f"{site}: {msg}")


def note(msg):
    print(f"    {YELLOW}··{OFF}    {msg}")


def fetch(url, follow=True):
    """-> (status, body, location). status 0 means the request never completed."""
    opener = _FOLLOW if follow else _NOFOLLOW
    try:
        with opener.open(urllib.request.Request(url, headers=UA), timeout=25) as r:
            ctype = r.headers.get("Content-Type", "")
            body = r.read().decode("utf-8", "ignore") if ("html" in ctype or "xml" in ctype) else ""
            return r.status, body, None
    except urllib.error.HTTPError as e:
        loc = None
        if e.headers:
            loc = e.headers.get("Location")
        if not loc and isinstance(e.msg, str) and e.msg.startswith("http"):
            loc = e.msg
        return e.code, "", loc
    except Exception as e:
        return 0, "", f"{type(e).__name__}: {e}"[:80]


def sh(cmd):
    try:
        p = subprocess.run(cmd, shell=True, capture_output=True, text=True, timeout=45)
        return p.stdout.strip()
    except Exception:
        return ""


def is_real_link(href):
    """Skip hrefs that are actually fragments of JavaScript string concatenation.

    An earlier version of this check reported 12 phantom broken anchors by
    matching href="#'+h.id+'" inside a <script> block.
    """
    return href.strip() not in ("", "#") and not any(c in href for c in "'+{")


def crawl(root):
    """Fetch the homepage and every internal HTML page it links to."""
    pages, todo, seen = {}, [root], set()
    while todo:
        url = todo.pop(0)
        if url in seen:
            continue
        seen.add(url)
        status, body, _ = fetch(url)
        pages[url] = (status, body)
        if status != 200 or "<html" not in body.lower():
            continue
        for href in re.findall(r'href="([^"]+)"', body):
            if not is_real_link(href) or href.startswith(("mailto:", "tel:", "#", "javascript:")):
                continue
            full = urllib.parse.urljoin(url, href).split("?")[0].split("#")[0]
            if (full.startswith(root) and full not in seen
                    and not re.search(r"\.(png|jpe?g|svg|ico|webp|pptx|docx|pdf|xml|css|js|mp4|mp3|webm)$",
                                      full, re.I)):
                todo.append(full)
    return pages


def check_site(key, cfg):
    domain, repo = cfg["domain"], cfg["repo"]
    root = f"https://{domain}/"
    print(f"\n{'=' * 70}\n  {key}  —  {domain}  ({repo})\n{'=' * 70}")

    # 1. DNS
    resolved = set(sh(f"dig +short {domain} @8.8.8.8").split())
    if GH_PAGES_IPS & resolved:
        ok(f"DNS -> GitHub Pages ({len(GH_PAGES_IPS & resolved)}/4 edge IPs)")
    else:
        bad(key, f"DNS does not resolve to GitHub Pages (got: {resolved or 'nothing'})")
        return

    # 2. Pages configuration
    raw = sh(f"gh api repos/wirewalktech/{repo}/pages 2>/dev/null")
    if not raw:
        bad(key, "GitHub Pages is not enabled on the repo")
    else:
        try:
            p = json.loads(raw)
        except json.JSONDecodeError:
            p = {}
        if p.get("status") == "built":
            ok("Pages build status: built")
        else:
            bad(key, f"Pages build status: {p.get('status')}")
        if p.get("cname") == domain:
            ok(f"CNAME configured: {domain}")
        else:
            bad(key, f"CNAME is {p.get('cname')!r}, expected {domain!r}")
        cert = (p.get("https_certificate") or {}).get("state")
        if p.get("https_enforced"):
            ok(f"HTTPS enforced (cert {cert})")
        else:
            bad(key, f"HTTPS NOT enforced (cert state: {cert}) — "
                     f"fix: gh api -X PUT /repos/wirewalktech/{repo}/pages -F https_enforced=true")

    # 3. http -> https
    st, _, loc = fetch(f"http://{domain}/", follow=False)
    if st in (301, 302, 307, 308) and loc and loc.startswith("https://"):
        ok(f"http:// redirects to https:// ({st})")
    elif st == 200:
        bad(key, "http:// serves 200 instead of redirecting to https://")
    else:
        note(f"http:// returned {st} {loc or ''}")

    # 4. pages reachable
    pages = crawl(root)
    broken_pages = [(u, s) for u, (s, _) in pages.items() if s != 200]
    if broken_pages:
        for u, s in broken_pages:
            bad(key, f"page {s}: {u}")
    else:
        ok(f"all {len(pages)} pages return 200")

    # 5. stale baseurl paths
    stale = [(u, h) for u, (_, b) in pages.items()
             for h in re.findall(r'(?:href|src)="([^"]+)"', b)
             if any(p in h for p in STALE)]
    if stale:
        for u, h in stale[:6]:
            bad(key, f"stale baseurl link {h}  (on {u})")
        if len(stale) > 6:
            bad(key, f"...and {len(stale) - 6} more stale links")
    else:
        ok("no stale baseurl paths in any link or asset")

    # 6. links and fragments
    checked, broken, n_links = {}, [], 0
    for page_url, (status, body) in sorted(pages.items()):
        if status != 200:
            continue
        ids = set(re.findall(r'id="([^"]+)"', body))
        for href in sorted(set(re.findall(r'href="([^"]+)"', body))):
            if not is_real_link(href) or href.startswith(("mailto:", "tel:", "javascript:")):
                continue
            n_links += 1
            if href.startswith("#"):
                if href[1:] not in ids:
                    broken.append((page_url, href, "no matching id on page"))
                continue
            target = urllib.parse.urljoin(page_url, href)
            base, _, frag = target.partition("#")
            if base not in checked:
                checked[base] = fetch(base)
                time.sleep(0.03)
            st, tbody, _ = checked[base]
            if st != 200:
                broken.append((page_url, href, f"HTTP {st}"))
            elif frag and tbody and f'id="{frag}"' not in tbody:
                broken.append((page_url, href, "fragment missing on target page"))
    if broken:
        for page_url, href, why in broken:
            bad(key, f"{href} — {why}  (on {page_url})")
    else:
        ok(f"{n_links} links checked, {len(checked)} distinct targets, 0 broken")

    # 7. contact form
    if cfg.get("form"):
        home = pages.get(root, (0, ""))[1]
        forms = re.findall(r"<form\b.*?</form>", home, re.S)
        target = next((f for f in forms if "formsubmit.co" in f), None)
        if not target:
            bad(key, "no FormSubmit form found on the homepage")
        else:
            for label, cond in [
                ("form action -> formsubmit.co", "formsubmit.co" in target),
                ('method="POST"', re.search(r'method="post"', target, re.I) is not None),
                ('input name="name"', 'name="name"' in target),
                ('input name="email"', 'name="email"' in target),
                ("honeypot present", "_honey" in target),
                ("_next -> /thanks/", "/thanks/" in target),
            ]:
                (ok if cond else lambda m: bad(key, m))(label)
            st, _, _ = fetch(urllib.parse.urljoin(root, "/thanks/"))
            (ok if st == 200 else lambda m: bad(key, m))(f"/thanks/ returns {st}")
        phone = cfg.get("phone")
        if phone:
            tel = "tel:+1" + phone.replace("-", "")
            if phone in home and tel in home:
                ok(f"phone {phone} present as a tel: link")
            else:
                bad(key, f"phone {phone} missing or not a tel: link")


def main():
    wanted = sys.argv[1:] or list(SITES)
    unknown = [w for w in wanted if w not in SITES]
    if unknown:
        print(f"unknown site(s): {', '.join(unknown)}\nknown: {', '.join(SITES)}")
        return 2
    for key in wanted:
        check_site(key, SITES[key])

    print(f"\n{'=' * 70}")
    if failures:
        print(f"  {RED}{len(failures)} FAILURE(S){OFF}")
        for f in failures:
            print(f"    - {f}")
        return 1
    print(f"  {GREEN}ALL CHECKS PASSED{OFF}")
    print(f"{DIM}  Note: this verifies wiring, not delivery. FormSubmit activation is\n"
          f"  per-domain — the first submission from a new domain sends an\n"
          f"  'Activate FormSubmit' email to sales@wirewalk.com that must be clicked\n"
          f"  before enquiries are delivered.{OFF}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
