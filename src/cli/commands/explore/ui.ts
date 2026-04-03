// ph explore — single-page HTML UI template

export function getExploreUI(port: number): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>ph explore — Repository Explorer</title>
<style>
/* ── reset ───────────────────────────────────── */
*{box-sizing:border-box;margin:0;padding:0}
body{background:#0d1117;color:#c9d1d9;font-family:'SF Mono','Fira Code','Consolas',monospace;font-size:12px;height:100vh;overflow:hidden}

/* ── shell / titlebar ────────────────────────── */
.shell{background:#0d1117;border-radius:10px;overflow:hidden;border:1px solid #30363d;height:100vh;display:flex;flex-direction:column}
.titlebar{background:#161b22;padding:9px 14px;display:flex;align-items:center;gap:8px;border-bottom:1px solid #30363d;flex-shrink:0}
.dot{width:12px;height:12px;border-radius:50%;flex-shrink:0}

/* ── grid layout ─────────────────────────────── */
.app{display:grid;grid-template-columns:300px 1fr;flex:1;overflow:hidden}

/* ── sidebar ─────────────────────────────────── */
.sidebar{background:#0d1117;border-right:1px solid #21262d;display:flex;flex-direction:column;overflow:hidden}
.sb-hdr{padding:10px 12px;border-bottom:1px solid #21262d;flex-shrink:0}
.sb-lbl{color:#484f58;font-size:10px;text-transform:uppercase;letter-spacing:.08em;margin-bottom:6px}
.search{background:#161b22;border:1px solid #30363d;border-radius:5px;padding:5px 8px;width:100%;color:#c9d1d9;font-size:11px;font-family:inherit;outline:none}
.search:focus{border-color:#58a6ff}
.legend{display:flex;gap:3px;align-items:center;margin-top:6px}
.lb{width:9px;height:9px;border-radius:2px;flex-shrink:0}
.lt{font-size:9px;color:#484f58;margin-left:2px}
.tree{padding:6px 0;flex:1;overflow-y:auto}

/* ── tree nodes ──────────────────────────────── */
.node{display:flex;align-items:center;gap:5px;padding:3px 8px;cursor:pointer;border-left:2px solid transparent;user-select:none}
.node:hover{background:#161b22}
.node.sel{background:#1c2128;border-left-color:#58a6ff}
.indent{flex-shrink:0;width:14px}
.caret{width:14px;height:14px;display:flex;align-items:center;justify-content:center;font-size:9px;color:#484f58;flex-shrink:0;transition:transform .15s;cursor:pointer}
.caret.open{transform:rotate(90deg)}
.fi{width:13px;height:13px;border-radius:2px;display:flex;align-items:center;justify-content:center;font-size:8px;font-weight:700;flex-shrink:0}
.nm{flex:1;color:#c9d1d9;font-size:11px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.nm.dir-nm{color:#8b949e;font-weight:500}
.hb{width:24px;height:12px;border-radius:2px;display:flex;align-items:center;justify-content:center;font-size:8px;font-weight:700;flex-shrink:0}
.av{width:14px;height:14px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:7px;font-weight:700;flex-shrink:0;margin-left:1px}

/* ── main pane ───────────────────────────────── */
.main{display:flex;flex-direction:column;overflow:hidden}
.topbar{background:#161b22;padding:8px 14px;display:flex;align-items:center;gap:6px;border-bottom:1px solid #21262d;flex-wrap:wrap;flex-shrink:0}
.bc{color:#58a6ff;font-size:11px;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.pill{background:#21262d;border:1px solid #30363d;border-radius:100px;padding:2px 8px;font-size:10px;color:#8b949e;white-space:nowrap}
.pill b{color:#c9d1d9}
.toolbar-btn{background:#1f6feb;border:1px solid #388bfd;color:#f0f6fc;border-radius:6px;padding:5px 10px;font-size:10px;font-family:inherit;cursor:pointer}
.toolbar-btn:hover{background:#388bfd}

/* ── tabs ────────────────────────────────────── */
.tab-bar{display:flex;gap:0;border-bottom:1px solid #21262d;flex-shrink:0}
.tab{padding:6px 14px;font-size:10px;color:#8b949e;cursor:pointer;border-bottom:2px solid transparent;font-family:inherit;background:none;border-top:none;border-left:none;border-right:none}
.tab:hover{color:#c9d1d9}
.tab.active{color:#58a6ff;border-bottom-color:#58a6ff}

/* ── content area ────────────────────────────── */
.content{flex:1;padding:14px;overflow-y:auto}
.loading{color:#484f58;text-align:center;padding:20px;font-size:11px}
.error{color:#f85149;text-align:center;padding:20px;font-size:11px}
.empty{color:#484f58;text-align:center;padding:40px 20px;font-size:12px}
.empty-icon{font-size:24px;margin-bottom:8px}

/* ── overview ────────────────────────────────── */
.overview{display:grid;gap:14px}
.hero{background:linear-gradient(135deg,#111927 0%,#18263f 48%,#132034 100%);border:1px solid #223a5f;border-radius:12px;padding:18px}
.hero-title{font-size:18px;font-weight:700;color:#f0f6fc;margin-bottom:8px}
.hero-copy{font-size:12px;color:#9fb3c8;line-height:1.6;max-width:900px}
.hero-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px;margin-top:14px}
.metric{background:rgba(13,17,23,.64);border:1px solid rgba(88,166,255,.16);border-radius:10px;padding:10px 12px}
.metric-label{font-size:10px;letter-spacing:.08em;text-transform:uppercase;color:#6e89a9;margin-bottom:6px}
.metric-value{font-size:18px;font-weight:700;color:#f0f6fc}
.metric-sub{font-size:11px;color:#8b949e;margin-top:4px}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:14px}
.panel{background:#161b22;border:1px solid #21262d;border-radius:10px;padding:14px}
.panel h3{font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:#8b949e;margin-bottom:12px}
.list{display:grid;gap:8px}
.row{display:flex;gap:10px;align-items:flex-start;justify-content:space-between;background:#0f141b;border:1px solid #1f2937;border-radius:8px;padding:10px}
.row-main{min-width:0;flex:1}
.row-title{font-size:12px;color:#e6edf3;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.row-sub{font-size:11px;color:#8b949e;margin-top:4px;line-height:1.4}
.score-chip{min-width:42px;text-align:center;border-radius:999px;padding:4px 8px;font-size:11px;font-weight:700}
.sev{display:inline-flex;align-items:center;border-radius:999px;padding:2px 6px;font-size:10px;font-weight:700;margin-right:8px}
.symbol{font-family:inherit;color:#58a6ff}

/* ── file header ─────────────────────────────── */
.fhead{margin-bottom:14px}
.ftitle{color:#c9d1d9;font-size:15px;font-weight:600;margin-bottom:6px}
.fmeta{display:flex;gap:12px;flex-wrap:wrap}
.fm{display:flex;align-items:center;gap:5px;font-size:11px;color:#8b949e}

/* ── sections ────────────────────────────────── */
.sec{font-size:10px;font-weight:600;color:#484f58;text-transform:uppercase;letter-spacing:.06em;margin:14px 0 8px;padding-bottom:5px;border-bottom:1px solid #21262d}

/* ── heat bars ───────────────────────────────── */
.hbars{margin-bottom:12px}
.hbar-row{display:flex;align-items:center;gap:8px;margin-bottom:5px}
.hbar-lbl{font-size:10px;color:#8b949e;width:72px;flex-shrink:0}
.hbar-track{flex:1;height:5px;background:#21262d;border-radius:3px;overflow:hidden}
.hbar-fill{height:100%;border-radius:3px}

/* ── timeline ────────────────────────────────── */
.tl{padding-left:18px;position:relative}
.tl::before{content:'';position:absolute;left:5px;top:0;bottom:0;width:1px;background:#21262d}
.commit{position:relative;margin-bottom:10px;cursor:pointer}
.commit::before{content:'';position:absolute;left:-16px;top:7px;width:7px;height:7px;border-radius:50%;background:#21262d;border:2px solid #30363d}
.commit.act::before{background:#3fb950;border-color:#56d364}
.commit:hover::before{background:#388bfd;border-color:#58a6ff}
.cc{background:#161b22;border:1px solid #21262d;border-radius:6px;padding:9px 11px}
.commit:hover .cc,.commit.act .cc{border-color:#30363d}
.commit.act .cc{border-color:#1a3d1a}
.ctop{display:flex;align-items:flex-start;gap:7px;margin-bottom:5px}
.cmsg{color:#c9d1d9;font-size:12px;font-weight:500;flex:1;line-height:1.4}
.chash{background:#1a3a6b;color:#58a6ff;padding:1px 6px;border-radius:3px;font-size:10px;flex-shrink:0;cursor:pointer}
.chash:hover{background:#2555a8}
.cmeta{display:flex;align-items:center;gap:8px}
.cav{width:16px;height:16px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:7px;font-weight:700;flex-shrink:0}
.cauth{font-size:10px;color:#8b949e}
.ctime{font-size:10px;color:#484f58;margin-left:auto}
.cchg{display:flex;gap:5px;margin-top:5px}
.chg{font-size:9px;padding:1px 6px;border-radius:100px}
.ca{background:#1a3d1a;color:#56d364}
.cd{background:#3d1414;color:#f85149}

/* ── diff ────────────────────────────────────── */
.diff{display:none;background:#0d1117;border:1px solid #21262d;border-radius:4px;margin-top:7px;overflow:hidden}
.diff.show{display:block}
.dh{background:#161b22;padding:4px 10px;font-size:10px;color:#8b949e;border-bottom:1px solid #21262d}
.dl{padding:1px 10px;font-size:10px;white-space:pre-wrap;word-break:break-all}
.dl-a{background:rgba(26,61,26,.3);color:#56d364}
.dl-d{background:rgba(61,20,20,.3);color:#f85149}
.dl-h{background:rgba(26,58,107,.3);color:#58a6ff;font-weight:600}
.dl-c{color:#484f58}

/* ── file content ────────────────────────────── */
.file-content{background:#161b22;border:1px solid #21262d;border-radius:6px;padding:0;overflow:auto;max-height:400px;font-size:11px;line-height:1.5}
.file-content pre{padding:10px;margin:0;white-space:pre-wrap;word-break:break-all}
.ln{color:#484f58;user-select:none;display:inline-block;width:36px;text-align:right;margin-right:12px;font-size:10px}

/* ── command bar ─────────────────────────────── */
.cmd-bar{background:#0a0d12;border-top:1px solid #21262d;padding:7px 14px;display:flex;gap:14px;flex-wrap:wrap;flex-shrink:0}
.ck{font-size:10px;color:#484f58}
.ck span{color:#58a6ff}
</style>
</head>
<body>
<div class="shell">
  <div class="titlebar">
    <div class="dot" style="background:#ff5f57"></div>
    <div class="dot" style="background:#febc2e"></div>
    <div class="dot" style="background:#28c840"></div>
    <span style="color:#8b949e;margin-left:8px;font-size:11px">ph explore — localhost:${port}</span>
    <span style="margin-left:auto;font-size:10px;color:#484f58" id="stats">loading…</span>
  </div>
  <div class="app">
    <div class="sidebar">
      <div class="sb-hdr">
        <div class="sb-lbl">Repository Explorer</div>
        <input class="search" placeholder="filter files…" id="si">
        <div class="legend">
          <div class="lb" style="background:#3d1414"></div>
          <div class="lb" style="background:#3d2214"></div>
          <div class="lb" style="background:#3d3214"></div>
          <div class="lb" style="background:#2d3a14"></div>
          <div class="lb" style="background:#1a3d1a"></div>
          <span class="lt">hot → cold</span>
        </div>
      </div>
      <div class="tree" id="tree"><div class="loading">Loading files…</div></div>
    </div>
    <div class="main">
      <div class="topbar">
        <div class="bc" id="bc">project overview</div>
        <div class="pill"><span id="ccLabel">commits</span>: <b id="cc">0</b></div>
        <div class="pill"><span id="aaLabel">authors</span>: <b id="aa">0</b></div>
        <div class="pill"><span id="laLabel">last</span>: <b id="la">–</b></div>
        <button class="toolbar-btn" onclick="refreshFiles()">Refresh</button>
      </div>
      <div class="tab-bar" id="tabBar">
        <button class="tab active" data-tab="overview" onclick="switchTab('overview')">Overview</button>
        <button class="tab" data-tab="timeline" onclick="switchTab('timeline')">Timeline</button>
        <button class="tab" data-tab="content" onclick="switchTab('content')">File Content</button>
      </div>
      <div class="content" id="content"><div class="loading"><div class="empty-icon">📁</div>Building repository analysis…</div></div>
      <div class="cmd-bar">
        <div class="ck"><span>Click</span> select file</div>
        <div class="ck"><span>▶</span> expand folder</div>
        <div class="ck"><span>Hash</span> view diff</div>
        <div class="ck"><span>ph ask</span> "explain this file"</div>
      </div>
    </div>
  </div>
</div>
<script>
// ─── constants ─────────────────────────────────────────────────
const HC={h1:'#3d1414',h2:'#3d2214',h3:'#3d3214',h4:'#2d3a14',h5:'#1a3d1a'};
const HT={h1:'#f85149',h2:'#f0883e',h3:'#f0c84b',h4:'#8acd38',h5:'#56d364'};
const ICONS={
  ts:{bg:'#1a3a6b',col:'#58a6ff',lbl:'TS'},tsx:{bg:'#1a3a6b',col:'#58a6ff',lbl:'TS'},
  js:{bg:'#3d3214',col:'#f0c84b',lbl:'JS'},jsx:{bg:'#3d3214',col:'#f0c84b',lbl:'JS'},mjs:{bg:'#3d3214',col:'#f0c84b',lbl:'JS'},
  json:{bg:'#1a3d1a',col:'#56d364',lbl:'{}'},
  md:{bg:'#3d2a1a',col:'#f0883e',lbl:'MD'},
  yml:{bg:'#3d1a3d',col:'#d2a8ff',lbl:'YML'},yaml:{bg:'#3d1a3d',col:'#d2a8ff',lbl:'YML'},
  css:{bg:'#1a3d3d',col:'#56d4d4',lbl:'CSS'},scss:{bg:'#1a3d3d',col:'#56d4d4',lbl:'CSS'},
  html:{bg:'#3d1a1a',col:'#ff7b72',lbl:'<>'},
  py:{bg:'#1a2d3d',col:'#79c0ff',lbl:'PY'},
  rs:{bg:'#3d2a1a',col:'#f0883e',lbl:'RS'},
  go:{bg:'#1a3d2a',col:'#56d364',lbl:'GO'},
  sh:{bg:'#2d333b',col:'#8b949e',lbl:'$>'},bash:{bg:'#2d333b',col:'#8b949e',lbl:'$>'},
};
const DEFAULT_ICON={bg:'#2d333b',col:'#8b949e',lbl:'·'};
const DIR_ICON={bg:'#2d333b',col:'#8b949e',lbl:'▸'};

// ─── state ────────────────────────────────────────────────────
let treeData=[], analysis=null, selected=null, commits=[], diffs={}, expanded=new Set(), tab='overview', contentLoaded=false;

// ─── escape ───────────────────────────────────────────────────
function esc(s){if(!s)return '';return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');}

// ─── API ──────────────────────────────────────────────────────
async function loadFiles(){
  try{
    const r=await fetch('/api/files');if(!r.ok)throw new Error('HTTP '+r.status);
    const d=await r.json();if(!d||!Array.isArray(d.files))throw new Error(d?.error||'bad payload');
    treeData=d.files;analysis=d.analysis||null;
    $('stats').textContent=count(treeData)+' files';
    renderTree();renderOverview();
  }catch(e){$('tree').innerHTML='<div class="error">'+esc(e.message)+'</div>';$('content').innerHTML='<div class="error">'+esc(e.message)+'</div>';}
}

async function refreshFiles(){
  $('stats').textContent='refreshing…';$('content').innerHTML='<div class="loading">Refreshing…</div>';
  try{
    const r=await fetch('/api/files/refresh',{method:'POST'});if(!r.ok)throw new Error('HTTP '+r.status);
    const d=await r.json();treeData=d.files||[];analysis=d.analysis||null;
    $('stats').textContent=count(treeData)+' files';renderTree();
    if(!selected||tab==='overview'){tab='overview';updateTabs();renderOverview();return;}
    if(tab==='content'){renderContent();return;}
    selectFile(selected);
  }catch(e){$('content').innerHTML='<div class="error">'+esc(e.message)+'</div>';}
}

// ─── tree ─────────────────────────────────────────────────────
function count(entries){let n=0;for(const e of entries){if(e.type==='file')n++;if(e.children)n+=count(e.children);}return n;}

function renderTree(){
  const el=$('tree'),f=$('si').value.toLowerCase();
  el.innerHTML='';
  if(!treeData.length){el.innerHTML='<div class="empty"><div class="empty-icon">📁</div>No files</div>';return;}
  if(!expanded.size){for(const d of treeData)if(d.type==='dir')expanded.add(d.path);}
  renderLevel(el,treeData,0,f);
}

function renderLevel(container,entries,depth,filter){
  for(const f of entries){
    if(filter){
      if(f.type==='dir'&&!hasMatch(f.children,filter)&&!f.name.toLowerCase().includes(filter))continue;
      if(f.type==='file'&&!f.name.toLowerCase().includes(filter)&&!f.path.toLowerCase().includes(filter))continue;
    }
    const isDir=f.type==='dir',isOpen=expanded.has(f.path);
    const node=document.createElement('div');
    node.className='node'+(f.path===selected?' sel':'');
    node.style.paddingLeft=(8+depth*16)+'px';
    const ic=isDir?DIR_ICON:(ICONS[f.name.split('.').pop()?.toLowerCase()]||DEFAULT_ICON);
    let h='';
    if(isDir)h+='<div class="caret'+(isOpen?' open':'')+'" data-dir="'+esc(f.path)+'">▶</div>';
    else h+='<div class="indent"></div>';
    h+='<div class="fi" style="background:'+ic.bg+';color:'+ic.col+'">'+ic.lbl+'</div>';
    h+='<div class="nm'+(isDir?' dir-nm':'')+'">'+esc(f.name)+'</div>';
    if(!isDir||f.changeCount>0)h+='<div class="hb" style="background:'+HC[f.heat]+';color:'+HT[f.heat]+'">'+(f.changeCount||'')+'</div>';
    if(f.lastCommit?.author)h+='<div class="av" style="background:#1a3a6b;color:#58a6ff">'+esc(f.lastCommit.author.slice(0,2).toUpperCase())+'</div>';
    node.innerHTML=h;
    if(isDir){
      node.querySelector('.caret').addEventListener('click',e=>{e.stopPropagation();expanded.has(f.path)?expanded.delete(f.path):expanded.add(f.path);renderTree();});
      node.addEventListener('click',()=>{if(!isOpen){expanded.add(f.path);renderTree();}});
    }else{node.addEventListener('click',()=>selectFile(f.path));}
    container.appendChild(node);
    if(isDir&&isOpen&&f.children)renderLevel(container,f.children,depth+1,filter);
  }
}

function hasMatch(entries,filter){for(const e of entries){if(e.type==='file'&&(e.name.toLowerCase().includes(filter)||e.path.toLowerCase().includes(filter)))return true;if(e.type==='dir'&&e.children&&hasMatch(e.children,filter))return true;}return false;}

function setTopbarStats(primaryLabel,primaryValue,secondaryLabel,secondaryValue,lastLabel,lastValue){
  $('ccLabel').textContent=primaryLabel;
  $('cc').textContent=String(primaryValue ?? 0);
  $('aaLabel').textContent=secondaryLabel;
  $('aa').textContent=String(secondaryValue ?? 0);
  $('laLabel').textContent=lastLabel;
  $('la').textContent=lastValue || '-';
}

// ─── selection ────────────────────────────────────────────────
async function selectFile(path){
  selected=path;diffs={};contentLoaded=false;tab='timeline';updateTabs();renderTree();
  const parts=path.split('/');
  $('bc').innerHTML=parts.map((p,i)=>i===parts.length-1?'<b style="color:#e3b341">'+esc(p)+'</b>':esc(p)).join(' / ');
  $('content').innerHTML='<div class="loading">Loading commits...</div>';
  try{
    const r=await fetch('/api/commits/'+encodeURIComponent(path));if(!r.ok)throw new Error('HTTP '+r.status);
    commits=await r.json();
    setTopbarStats('commits',commits.length,'authors',[...new Set(commits.map(c=>c.author))].length,'last',commits[0]?.age||'-');
    renderTimeline();
  }catch(e){$('content').innerHTML='<div class="error">'+esc(e.message)+'</div>';}
}

// ─── tabs ─────────────────────────────────────────────────────
function switchTab(t){tab=t;updateTabs();if(t==='overview')renderOverview();else if(t==='timeline')renderTimeline();else renderContent();}
function updateTabs(){document.querySelectorAll('.tab').forEach(b=>b.classList.toggle('active',b.dataset.tab===tab));}

// ─── overview ─────────────────────────────────────────────────
function renderOverview(){
  $('bc').textContent='project overview';
  if(!analysis){$('content').innerHTML='<div class="empty">Run <b>ph scan</b> to generate analysis.</div>';return;}
  const repoStats=analysis.repositoryStats||{};
  setTopbarStats('active files',repoStats.activeFileCount||0,'dirty',repoStats.dirtyFileCount||0,'last commit',repoStats.lastCommitAge||'-');
  const d=analysis.descriptor||{},s=analysis.healthScore;
  const sc=s===null?'#8b949e':s>=85?'#56d364':s>=65?'#f0c84b':'#f85149';
  const scanColor=analysis.scanStatus==='fresh'?'#56d364':analysis.scanStatus==='stale'?'#f0c84b':'#8b949e';
  const chip=(v,bg,tx)=>'<div class="score-chip" style="background:'+bg+';color:'+tx+'">'+v+'</div>';
  const sevBg=s=>s==='CRITICAL'?'rgba(248,81,73,.16)':s==='HIGH'?'rgba(240,136,62,.16)':s==='MEDIUM'?'rgba(240,200,75,.16)':'rgba(86,211,100,.16)';
  const sevCo=s=>s==='CRITICAL'?'#f85149':s==='HIGH'?'#f0883e':s==='MEDIUM'?'#f0c84b':'#56d364';
  const scBg=v=>v>=85?'rgba(86,211,100,.16)':v>=65?'rgba(240,200,75,.16)':'rgba(248,81,73,.16)';
  const scTx=v=>v>=85?'#56d364':v>=65?'#f0c84b':'#f85149';

  const hot=(analysis.hotFiles||[]).map(f=>'<div class="row"><div class="row-main"><div class="row-title">'+esc(f.path)+'</div><div class="row-sub">'+esc(f.lastAge)+' | '+f.changeCount+' historical changes</div></div>'+chip(esc(f.heat.toUpperCase()),HC[f.heat],HT[f.heat])+'</div>').join('')||'<div class="empty">No recent git activity found.</div>';

  const findings=(analysis.topFindings||[]).map(f=>'<div class="row"><div class="row-main"><div class="row-title"><span class="sev" style="background:'+sevBg(f.severity)+';color:'+sevCo(f.severity)+'">'+esc(f.severity)+'</span>'+esc(f.type)+'</div><div class="row-sub">'+esc(f.message)+(f.file?' | '+esc(f.file):'')+'</div></div></div>').join('')||'<div class="empty">No findings.</div>';

  const mods=(analysis.moduleScores||[]).map(m=>'<div class="row"><div class="row-main"><div class="row-title">'+esc(m.moduleId+' '+m.moduleName)+'</div><div class="row-sub">'+esc(m.status)+' | '+m.findingCount+' findings</div></div>'+chip(m.score,scBg(m.score),scTx(m.score))+'</div>').join('')||'<div class="empty">Run <b>ph scan</b> to populate module scores.</div>';

  const actions=(analysis.topActions||[]).map(a=>'<div class="row"><div class="row-main"><div class="row-title">'+esc(a)+'</div></div></div>').join('')||'<div class="empty">No actions.</div>';

  const syms=(analysis.symbolSummary?.sample||[]).map(s=>'<div class="row"><div class="row-main"><div class="row-title"><span class="symbol">'+esc(s.name)+'</span></div><div class="row-sub">'+esc(s.kind+' | '+s.file+':'+s.line)+'</div></div></div>').join('')||'<div class="empty">Run <b>ph scan</b> to build AST index.</div>';

  $('content').innerHTML='<div class="overview"><div class="hero"><div class="hero-title">'+esc(d.name||'Repository')+'</div><div class="hero-copy">'+esc(analysis.overview||'No overview.')+'</div><div class="hero-grid">'+metric('Health Score',s===null?'N/A':s,analysis.scanSummary||'Run ph scan',sc)+metric('Scan Cache',(analysis.scanStatus||'missing').toUpperCase(),analysis.generatedAt?('generated '+analysis.generatedAt.slice(0,10)):'no cached scan',scanColor)+metric('Source Files',d.fileCount||0,d.language+' | '+(d.framework||'?'))+metric('Explorer Scope',d.visibleFileCount||0,(d.directoryCount||0)+' dirs | '+(d.docCount||0)+' docs | '+(d.configCount||0)+' config')+metric('Dependencies',d.dependencyCount||0,d.type+' | '+(d.moduleCount||0)+' code areas')+metric('Indexed Symbols',analysis.symbolSummary?.totalSymbols||0,(analysis.symbolSummary?.uniqueFiles||0)+' files')+'</div></div><div class="grid"><div class="panel"><h3>Hot Files</h3><div class="list">'+hot+'</div></div><div class="panel"><h3>Module Scores</h3><div class="list">'+mods+'</div></div><div class="panel"><h3>Top Findings</h3><div class="list">'+findings+'</div></div><div class="panel"><h3>Priority Actions</h3><div class="list">'+actions+'</div></div><div class="panel"><h3>Indexed Symbols</h3><div class="list">'+syms+'</div></div></div></div>';
}

function metric(l,v,sub,ac){return '<div class="metric"><div class="metric-label">'+esc(l)+'</div><div class="metric-value"'+(ac?' style="color:'+ac+'"':'')+'>'+esc(String(v))+'</div><div class="metric-sub">'+esc(sub||'')+'</div></div>';}

// ─── timeline ─────────────────────────────────────────────────
function renderTimeline(){
  const c=$('content'),file=find(treeData,selected);
  if(!file){c.innerHTML='<div class="empty">Select a file.</div>';return;}
  let h='<div class="fhead"><div class="ftitle">'+esc(file.name)+'</div><div class="fmeta">';
  if(file.lastCommit)h+='<div class="fm"><div class="cav" style="background:#1a3a6b;color:#58a6ff">'+esc(file.lastCommit.author.slice(0,2).toUpperCase())+'</div><span>'+esc(file.lastCommit.author)+'</span></div><div class="fm">modified <b>'+esc(file.lastCommit.age)+'</b></div>';
  h+='<div class="fm" style="color:'+HT[file.heat]+'">heat: <b>'+file.heat+'</b></div>';
  h+='<div class="fm">'+file.changeCount+' changes</div></div></div>';

  // heat bars
  h+='<div class="hbars">';
  [{k:'h1',l:'Very hot',c:'#f85149'},{k:'h2',l:'Hot',c:'#f0883e'},{k:'h3',l:'Warm',c:'#f0c84b'},{k:'h4',l:'Cool',c:'#8acd38'},{k:'h5',l:'Cold',c:'#56d364'}].forEach(b=>{
    h+='<div class="hbar-row"><div class="hbar-lbl">'+b.l+'</div><div class="hbar-track"><div class="hbar-fill" style="width:'+(file.heat===b.k?100:0)+'%;background:'+b.c+'"></div></div></div>';
  });
  h+='</div>';

  h+='<div class="sec">Commit timeline — click hash for diff</div><div class="tl" id="tl">';
  if(!commits.length)h+='<div class="empty"><div class="empty-icon">📭</div>No commits for this file</div>';
  commits.forEach((c,i)=>{
    h+='<div class="commit'+(i===0?' act':'')+'" data-idx="'+i+'"><div class="cc"><div class="ctop"><div class="cmsg">'+esc(c.message)+'</div><div class="chash" onclick="event.stopPropagation();toggleDiff('+i+',&#39;'+c.hash+'&#39;)">'+c.hash+'</div></div><div class="cmeta"><div class="cav" style="background:#1a3a6b;color:#58a6ff">'+esc(c.author.slice(0,2).toUpperCase())+'</div><div class="cauth">'+esc(c.author)+'</div><div class="ctime">'+esc(c.age)+'</div></div><div class="cchg"><span class="chg ca">+'+c.additions+'</span><span class="chg cd">-'+c.deletions+'</span></div><div class="diff'+(i===0&&diffs[c.hash]?' show':'')+'" id="df'+i+'">';
    if(i===0&&diffs[c.hash])h+=renderDiff(c.hash,diffs[c.hash]);
    else h+='<div class="dh">Click hash <b>'+c.hash+'</b> for diff</div>';
    h+='</div></div></div>';
  });
  h+='</div>';
  c.innerHTML=h;
  if(commits.length>0&&!diffs[commits[0].hash])toggleDiff(0,commits[0].hash);
}

// ─── diff ─────────────────────────────────────────────────────
async function toggleDiff(i,hash){
  const el=$('df'+i);if(!el)return;
  if(diffs[hash]){
    const vis=el.classList.contains('show');
    document.querySelectorAll('.diff').forEach(d=>d.classList.remove('show'));
    document.querySelectorAll('.commit').forEach(c=>c.classList.remove('act'));
    if(!vis){el.classList.add('show');el.closest('.commit').classList.add('act');}
    return;
  }
  el.innerHTML='<div class="dh">Loading diff for '+hash+'…</div>';el.classList.add('show');
  document.querySelectorAll('.commit').forEach(c=>c.classList.remove('act'));
  el.closest('.commit').classList.add('act');
  try{
    const r=await fetch('/api/diff/'+hash+'/'+encodeURIComponent(selected));if(!r.ok)throw new Error('HTTP '+r.status);
    const d=await r.json();diffs[hash]=d.diff;el.innerHTML=renderDiff(hash,d.diff);
  }catch(e){el.innerHTML='<div class="dh" style="color:#f85149">'+esc(e.message)+'</div>';}
}

function renderDiff(hash,lines){
  let h='<div class="dh">'+esc(hash)+' — diff</div>';
  if(!lines||!lines.length){h+='<div class="dl dl-c">(empty diff)</div>';return h;}
  for(const l of lines){
    let cls='dl-c';
    if(l.startsWith('+++')||l.startsWith('---'))cls='dl-h';
    else if(l.startsWith('@@'))cls='dl-h';
    else if(l.startsWith('+'))cls='dl-a';
    else if(l.startsWith('-'))cls='dl-d';
    h+='<div class="dl '+cls+'">'+esc(l)+'</div>';
  }
  return h;
}

// ─── file content ─────────────────────────────────────────────
async function renderContent(){
  const c=$('content'),file=find(treeData,selected);
  if(!file){c.innerHTML='<div class="empty">Select a file.</div>';return;}
  let h='<div class="fhead"><div class="ftitle">'+esc(file.name)+'</div><div class="fmeta"><div class="fm">'+esc(selected)+'</div></div></div>';
  h+='<div class="sec">File content (local)</div>';
  if(contentLoaded){/* already in DOM */}
  else{h+='<div class="loading" id="fcL">Loading…</div><div class="file-content" id="fcA" style="display:none"><pre id="fcP"></pre></div>';}
  c.innerHTML=h;
  if(!contentLoaded){
    try{
      const r=await fetch('/api/content/local/'+encodeURIComponent(selected));if(!r.ok)throw new Error('HTTP '+r.status);
      const d=await r.json();
      const ld=$('fcL'),ar=$('fcA'),pr=$('fcP');
      if(ld)ld.style.display='none';if(ar)ar.style.display='block';
      const lines=(d.content||'').split('\\n');
      let ch='';for(let i=0;i<lines.length;i++)ch+='<span class="ln">'+(i+1)+'</span>'+esc(lines[i])+'\\n';
      if(pr)pr.innerHTML=ch;contentLoaded=true;
    }catch(e){const ld=$('fcL');if(ld){ld.textContent='Error: '+e.message;ld.className='error';}}
  }
}

// ─── search ───────────────────────────────────────────────────
$('si').addEventListener('input',function(){if(this.value.toLowerCase())expandAll(treeData);renderTree();});
function expandAll(entries){for(const e of entries){if(e.type==='dir'){expanded.add(e.path);if(e.children)expandAll(e.children);}}}

// ─── helpers ──────────────────────────────────────────────────
function $(id){return document.getElementById(id);}
function find(entries,path){for(const e of entries){if(e.path===path)return e;if(e.children){const f=find(e.children,path);if(f)return f;}}return null;}

// ─── init ─────────────────────────────────────────────────────
loadFiles();
</script>
</body>
</html>`;
}
