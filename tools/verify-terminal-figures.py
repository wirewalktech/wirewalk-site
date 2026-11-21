#!/usr/bin/env python3
"""Check terminal assets, publication metadata and preservation of original article text.
Run after Jekyll build: python3 tools/verify-terminal-figures.py --build /path/to/output --baseline-ref COMMIT
"""
import argparse,json,re,struct,subprocess
from pathlib import Path
from html.parser import HTMLParser
class Page(HTMLParser):
    def __init__(self,s):
        super().__init__();self.images=[];self.scripts=[];self.in_json=False;self.buf='';self.figures=0;self.feed(s)
    def handle_starttag(self,t,a):
        a=dict(a)
        if t=='img':self.images.append(a)
        if t=='figure' and 'lab-figure' in a.get('class','').split():self.figures+=1
        if t=='script' and a.get('type')=='application/ld+json':self.in_json=True;self.buf=''
    def handle_data(self,s):
        if self.in_json:self.buf+=s
    def handle_endtag(self,t):
        if t=='script' and self.in_json:self.scripts.append(json.loads(self.buf));self.in_json=False
ap=argparse.ArgumentParser();ap.add_argument('--build',required=True);ap.add_argument('--baseline-ref',required=True);ap.add_argument('--report');args=ap.parse_args()
root=Path(__file__).resolve().parents[1];build=Path(args.build);data=json.loads((root/'_data/terminal_figures.json').read_text());fail=[];posts=0;images=0;sessions=0
for p in sorted((root/'_posts').glob('*.md')):
    posts+=1;slug=p.stem[11:];s=p.read_text();old=subprocess.check_output(['git','show',args.baseline_ref+':_posts/'+p.name],cwd=root,text=True)
    cleaned=re.sub(r'{% include terminal-figure.html key="[^"]+" %}\n\n<details class="terminal-source" markdown="1">\n<summary>[^<]+</summary>\n\n','',s).replace('\n\n</details>','')
    if cleaned!=old:fail.append('Original text changed: '+p.name)
    rendered=Page((build/'writing'/slug/'index.html').read_text())
    article=next(x for x in rendered.scripts if x.get('@type')=='TechArticle')
    if slug in data:
        t=data[slug];images+=1;sessions+=t['kind']=='Illustrative session';im=root/t['image'].lstrip('/');b=im.read_bytes()
        if b[:8]!=b'\x89PNG\r\n\x1a\n':fail.append('Invalid PNG: '+slug)
        w,h=struct.unpack('>II',b[16:24])
        if w!=t['width'] or abs(h-t['height'])>1:fail.append('Dimensions: '+slug)
        if len(b)>250000:fail.append('Asset exceeds 250KB: '+slug)
        if rendered.figures!=1:fail.append('Figure missing/duplicate: '+slug)
        matches=[x for x in rendered.images if x['src']==t['image']]
        if len(matches)!=1 or not matches[0].get('alt') or matches[0].get('loading')!='lazy':fail.append('Image semantics: '+slug)
        if article.get('image')!='https://www.wirewalk.com'+t['image']:fail.append('Article image schema: '+slug)
        if t['example_transcript'] and t['example_transcript']!=t['transcript']:fail.append('Illustrated session transcript mismatch: '+slug)
    elif rendered.figures or article.get('image')!='https://www.wirewalk.com/assets/og.png':fail.append('Unexpected figure: '+slug)
result={'posts':posts,'illustrated_articles':images,'command_output_sessions':sessions,'original_prose_commands_dates_metadata_preserved':not fail,'failures':fail}
if args.report:Path(args.report).write_text(json.dumps(result,indent=2))
print(json.dumps(result,indent=2));raise SystemExit(bool(fail))
