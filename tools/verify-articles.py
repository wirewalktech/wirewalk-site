#!/usr/bin/env python3
"""Verify source-to-output completeness locally or on the live custom domain.
Requires PyYAML: python3 -m pip install PyYAML
Usage: python3 tools/verify-articles.py --build /path/to/jekyll/output
       python3 tools/verify-articles.py --live https://www.wirewalk.com
Optional --external checks article source links; --report saves JSON evidence.
"""
import argparse, collections, concurrent.futures, datetime, hashlib, json, re, subprocess
from pathlib import Path
from html.parser import HTMLParser
from urllib.parse import urljoin, urlsplit, unquote
import xml.etree.ElementTree as ET
import yaml

class Page(HTMLParser):
    def __init__(self, text):
        super().__init__(convert_charrefs=True)
        self.ids=set(); self.links=[]; self.h1=[]; self.in_h1=False
        self.canonical=None; self.description=None; self.text=[]; self.h2=[]; self.in_h2=False
        self.feed(text)
    def handle_starttag(self, tag, attrs):
        a=dict(attrs)
        if 'id' in a: self.ids.add(a['id'])
        if tag=='a' and 'href' in a: self.links.append(a['href'])
        if tag=='h1': self.in_h1=True
        if tag=='h2': self.in_h2=True; self.h2.append('')
        if tag=='link' and a.get('rel')=='canonical': self.canonical=a.get('href')
        if tag=='meta' and a.get('name')=='description': self.description=a.get('content')
    def handle_endtag(self,tag):
        if tag=='h1': self.in_h1=False
        if tag=='h2': self.in_h2=False
    def handle_data(self,data):
        if self.in_h1: self.h1.append(data)
        if self.in_h2: self.h2[-1]+=data
        self.text.append(data)

def request(url):
    p=subprocess.run(['curl','-sS','-L','--max-redirs','6','--connect-timeout','10','--max-time','30','-A','Mozilla/5.0 (Wirewalk article verification)','-w','\n%{http_code}\n%{url_effective}',url],capture_output=True,text=True)
    try:
        body,status,final=p.stdout.rsplit('\n',2)
        return {'status':int(status),'final':final,'body':body,'error':p.stderr if p.returncode else ''}
    except ValueError:
        return {'status':0,'final':url,'body':'','error':p.stderr}

def main():
    ap=argparse.ArgumentParser(); mode=ap.add_mutually_exclusive_group(required=True)
    mode.add_argument('--build');mode.add_argument('--live');ap.add_argument('--external',action='store_true');ap.add_argument('--report')
    args=ap.parse_args(); root=Path(__file__).resolve().parents[1]
    failures=[]; evidence=[]; sources=set(); posts=[]
    for f in sorted((root/'_posts').glob('*.md')):
        _,front,body=f.read_text().split('---',2); m=yaml.safe_load(front)
        slug=f.name[11:-3];path='/writing/'+slug+'/'
        dt=datetime.date.fromisoformat(f.name[:10])
        if dt>datetime.date.today():failures.append(f'Future filename: {f.name}')
        if m.get('archive_date'):
            if len(body.split())<350:failures.append(f'Short article: {f.name}')
            if body.count('\n## ')<4:failures.append(f'Insufficient sections: {f.name}')
            if not m.get('published_on') or not m.get('last_reviewed'):failures.append(f'Missing provenance: {f.name}')
            sources.update(re.findall(r'\]\((https://[^)]+)\)',body))
        posts.append((path,m,body))
    if len({p for p,_,_ in posts})!=len(posts): failures.append('Duplicate post URL')
    cache={}
    def get(path):
        if path not in cache:
            if args.live:
                r=request(args.live.rstrip('/')+path)
                if r['status']!=200:failures.append(f'HTTP {r["status"]}: {path}')
                if urlsplit(r['final']).path!=path or urlsplit(r['final']).netloc!=urlsplit(args.live).netloc:failures.append(f'Unexpected redirect: {path} -> {r["final"]}')
                cache[path]=r['body']
            else:
                f=Path(args.build)/path.lstrip('/')
                if path.endswith('/'):f=f/'index.html'
                if not f.is_file():failures.append(f'Missing output: {path}');cache[path]=''
                else:cache[path]=f.read_text()
        return cache[path]
    index=Page(get('/writing/')); home=Page(get('/'))
    for path,m,body in posts:
        rendered=get(path); page=Page(rendered)
        if ''.join(page.h1)!=m['title']:failures.append(f'Title mismatch: {path}')
        if page.canonical!='https://www.wirewalk.com'+path:failures.append(f'Canonical mismatch: {path}')
        if path not in index.links:failures.append(f'Absent from index: {path}')
        if m.get('archive_date'):
            for heading in re.findall(r'^## (.+)$',body,re.M):
                if heading.replace("’", "'") not in [h.replace("’", "'") for h in page.h2]:failures.append(f'Missing section {heading}: {path}')
            if 'Archive date is an editorial placement' not in rendered:failures.append(f'Missing date disclosure: {path}')
            if m['summary']!=page.description:failures.append(f'Description mismatch: {path}')
        if re.search(r'{%|{{\s*(?:page|site|post)\.',rendered):failures.append(f'Unrendered Liquid: {path}')
        for link in page.links:
            u=urlsplit(urljoin('https://www.wirewalk.com'+path,link))
            if u.netloc=='www.wirewalk.com':
                target=Page(get(u.path or '/'))
                if u.fragment and unquote(u.fragment) not in target.ids:failures.append(f'Missing fragment {link} on {path}')
        evidence.append({'path':path,'title':m['title'],'html_sha256':hashlib.sha256(rendered.encode()).hexdigest()})
    for base, link in [("/",l) for l in home.links]+[("/writing/",l) for l in index.links]:
        u=urlsplit(urljoin('https://www.wirewalk.com'+base,link))
        if u.netloc=='www.wirewalk.com' and u.fragment:
            if unquote(u.fragment) not in Page(get(u.path or '/')).ids:failures.append(f'Index/home fragment: {link}')
    try:
        feed=ET.fromstring(get('/feed.xml')); ns={'a':'http://www.w3.org/2005/Atom'}
        entries=feed.findall('a:entry',ns)
        ids={e.find('a:id',ns).text:e for e in entries}
        if len(entries)!=len(posts):failures.append(f'Feed count {len(entries)} != {len(posts)}')
        for path,m,_ in posts:
            e=ids.get('https://www.wirewalk.com'+path)
            if e is None:failures.append(f'Missing feed entry: {path}');continue
            if m.get('archive_date') and not e.find('a:published',ns).text.startswith(str(m['published_on'])):failures.append(f'Feed publication mismatch: {path}')
    except ET.ParseError as e:failures.append(f'Invalid Atom XML: {e}')
    external=[]
    if args.external:
        with concurrent.futures.ThreadPoolExecutor(max_workers=8) as pool:
            for url,r in zip(sorted(sources),pool.map(request,sorted(sources))):
                row={k:r[k] for k in ('status','final','error')};row['url']=url
                external.append(row)
                if r['status']!=200:failures.append(f'External HTTP {r["status"]}: {url}')
    result={'posts':len(posts),'new_articles':sum(bool(m.get('archive_date')) for _,m,_ in posts),'source_urls':len(sources),'checked_pages':len(cache),'external':external,'failures':sorted(set(failures)),'evidence':evidence}
    if args.report:Path(args.report).write_text(json.dumps(result,indent=2))
    print(f'{len(posts)} source posts; {result["new_articles"]} new articles; {len(cache)} pages checked; {len(sources)} source URLs')
    for fail in result['failures']:print('FAIL:',fail)
    print(f'{len(result["failures"])} failure(s)')
    return bool(result['failures'])
if __name__=='__main__':raise SystemExit(main())
