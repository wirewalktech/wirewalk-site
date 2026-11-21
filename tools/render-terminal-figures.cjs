/* Run from repo root. Requires Playwright + Chromium, e.g. NODE_PATH=/path/to/node_modules node tools/render-terminal-figures.cjs.
   Renders authored examples, never executes displayed commands. */
const fs=require('fs'),path=require('path');
const {chromium}=require('playwright');
const file='_data/terminal_figures.json';
const data=JSON.parse(fs.readFileSync(file,'utf8'));
const esc=s=>s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
(async()=>{
 const selected=new Set(process.argv.slice(2));let rendered=0;
 const browser=await chromium.launch();const page=await browser.newPage({viewport:{width:960,height:1200},deviceScaleFactor:1.5});
 fs.mkdirSync('assets/lab',{recursive:true});
 for(const [slug,t] of Object.entries(data)){
  if(selected.size&&!selected.has(slug))continue;
  rendered++;
  const lines=t.transcript.split('\n').map(line=>{const kind=line.startsWith('$ ')?'command':line.startsWith('#')?'comment':/AccessDenied|INCOMPLETE|FAILED|scrape_error 1/.test(line)?'attention':t.kind.startsWith('Command')?'command':'';return '<div class="line '+kind+'">'+(esc(line)||' ')+'</div>'}).join('');
  await page.setContent(`<!doctype html><meta charset="utf-8"><style>
  *{box-sizing:border-box}body{margin:0;background:#141c23;color:#e4edf0;font-family:Menlo,Consolas,monospace;width:960px}.terminal{width:960px;border:1px solid #34424d;border-radius:14px;overflow:hidden}.bar{display:flex;align-items:center;gap:8px;padding:17px 24px;background:#1d2831;border-bottom:1px solid #34424d;font-size:13px;color:#aab9c3}.dot{width:9px;height:9px;border-radius:50%;background:#6b7d88}.dot:first-child{background:#d98771}.dot:nth-child(2){background:#d5ba78}.dot:nth-child(3){background:#85b8a4}.brand{margin-left:10px;letter-spacing:.04em}.label{margin-left:auto;color:#b5c5ce}.title{padding:23px 28px 0;font:500 15px/1.5 Menlo,monospace;color:#92a8b7;max-width:900px}.screen{padding:20px 28px 30px;font-size:18px;line-height:1.65}.line{white-space:pre-wrap;overflow-wrap:anywhere;min-height:29.7px}.command{color:#a9dec8}.comment{color:#9aacb7}.attention{color:#f2bd84}.footer{padding:12px 28px;border-top:1px solid #2e3a44;color:#a7b6bf;font-size:12px;letter-spacing:.035em}
  </style><div class="terminal"><div class="bar"><i class="dot"></i><i class="dot"></i><i class="dot"></i><span class="brand">WIREWALK / LAB NOTES</span><span class="label">${esc(t.kind)}</span></div><div class="title">${esc(t.title)}</div><div class="screen">${lines}</div><div class="footer">ILLUSTRATIVE EXAMPLE · NOT A CAPTURED PRODUCTION RUN</div></div>`);
  const box=await page.locator('.terminal').boundingBox();
  t.image='/assets/lab/'+slug+'.png';t.width=1440;t.height=Math.round(box.height*1.5);
  await page.locator('.terminal').screenshot({path:path.join('.',t.image)});
  const png=fs.readFileSync(path.join('.',t.image));t.width=png.readUInt32BE(16);t.height=png.readUInt32BE(20);
 }
 await browser.close();fs.writeFileSync(file,JSON.stringify(data,null,2)+'\n');console.log(JSON.stringify({figures:rendered,totalFigures:Object.keys(data).length,commandsExecuted:0}));
})().catch(e=>{console.error(e);process.exit(1)});
