const express = require('express');
const cors = require('cors');
const path = require('path');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const PORT = process.env.PORT || 3000;
const OPENAPI = 'https://openapi.twse.com.tw/v1';
const TWSE = 'https://www.twse.com.tw/rwd/zh';
const cache = new Map();
const CACHE_MS = 5 * 60 * 1000;

function ymd(d) { return d.toISOString().slice(0,10).replaceAll('-',''); }
function sleep(ms){ return new Promise(r=>setTimeout(r,ms)); }
function num(v){ if(v===null||v===undefined||v===''||v==='-') return null; const n=Number(String(v).replaceAll(',','')); return Number.isFinite(n)?n:null; }
function jsonKey(u){return u.toString();}
async function getJson(url, ms=20000){
  const key=jsonKey(url), hit=cache.get(key);
  if(hit && Date.now()-hit.t<CACHE_MS) return hit.v;
  const r=await fetch(url,{headers:{'User-Agent':'TWSE-Compass/1.2'},signal:AbortSignal.timeout(ms)});
  if(!r.ok) throw new Error(`HTTP ${r.status}`);
  const v=await r.json(); cache.set(key,{t:Date.now(),v}); return v;
}

async function currentAll(){
  return getJson(`${OPENAPI}/exchangeReport/STOCK_DAY_ALL`);
}
async function dayTrade(){
  return getJson(`${OPENAPI}/exchangeReport/TWTB4U`);
}
async function holidays(){
  return getJson(`${OPENAPI}/holidaySchedule/holidaySchedule`);
}
async function institutional(date){
  const ds = date.replaceAll('-','');
  const u=`${TWSE}/fund/T86?date=${ds}&selectType=ALLBUT0999&response=json`;
  return getJson(u);
}
async function priceLimits(date){
  const ds=date.replaceAll('-','');
  const u=`${TWSE}/exchangeReport/TWT84U?date=${ds}&selectType=01&response=json`;
  return getJson(u);
}
async function latestInstitutional(){
  const today=new Date();
  for(let i=0;i<10;i++){
    const d=new Date(today); d.setUTCDate(d.getUTCDate()-i); const ds=d.toISOString().slice(0,10);
    try{const m=parseT86(await institutional(ds)); if(m.size)return {date:ds,map:m};}catch(e){}
  }
  return {date:null,map:new Map()};
}

async function historyMonth(stockNo, date){
  const ds = date.replaceAll('-','');
  const u=`${TWSE}/afterTrading/STOCK_DAY?date=${ds}&stockNo=${encodeURIComponent(stockNo)}&response=json`;
  return getJson(u,25000);
}

function parseStockRows(rows){
  if(!Array.isArray(rows)) return [];
  return rows.map(x=>({
    code:x.Code||x['證券代號'], name:x.Name||x['證券名稱'],
    open:num(x.OpeningPrice||x['開盤價']), high:num(x.HighestPrice||x['最高價']), low:num(x.LowestPrice||x['最低價']), close:num(x.ClosingPrice||x['收盤價']),
    change:num(x.Change||x['漲跌價差']), volume:num(x.TradeVolume||x['成交股數'])
  })).filter(x=>x.code && x.close!==null);
}
function parseHistory(j){
  if(!j || !Array.isArray(j.data)) return [];
  return j.data.map(r=>({
    date:r[0], volume:num(r[1]), turnover:num(r[2]), open:num(r[3]), high:num(r[4]), low:num(r[5]), close:num(r[6]), change:r[7]
  })).filter(r=>r.close!==null);
}
function parseT86(j){
  if(!j || !Array.isArray(j.data)) return new Map();
  const h=j.fields||[];
  const idx=(names)=>{for(const n of names){const i=h.indexOf(n); if(i>=0)return i;} return -1;};
  const code=idx(['證券代號']), name=idx(['證券名稱']), foreign=idx(['外陸資買賣超股數(不含外資自營商)','外資及陸資買賣超股數']), trust=idx(['投信買賣超股數']), dealer=idx(['自營商買賣超股數']), total=idx(['三大法人買賣超股數']);
  const m=new Map();
  for(const r of j.data){ if(code<0||!r[code]) continue; m.set(String(r[code]),{code:String(r[code]),name:r[name],foreign:num(r[foreign]),trust:num(r[trust]),dealer:num(r[dealer]),total:num(r[total])}); }
  return m;
}
function closes(daily){ return daily.map(x=>x.close).filter(Number.isFinite); }
function sma(a,n){ return a.length<n?null:a.slice(-n).reduce((s,x)=>s+x,0)/n; }
function emaSeries(a,n){ const k=2/(n+1); let e=a[0]; const out=[e]; for(let i=1;i<a.length;i++){e=a[i]*k+e*(1-k);out.push(e);} return out; }
function macd(a){
  if(a.length<35) return null;
  const e12=emaSeries(a,12), e26=emaSeries(a,26);
  const dif=e12.map((v,i)=>v-e26[i]);
  const dea=emaSeries(dif.slice(25),9);
  const aligned=Array(25).fill(null).concat(dea);
  const osc=dif.map((v,i)=>aligned[i]===null?null:v-aligned[i]);
  return {dif:dif.at(-1),dea:aligned.at(-1),osc:osc.at(-1),prevOsc:osc.at(-2),series:{dif,dea:aligned,osc}};
}
function weeklyCloses(daily){
  const map=new Map();
  for(const x of daily){
    const d=new Date(x.date.replaceAll('/','-')); if(Number.isNaN(d.getTime())) continue;
    const day=d.getUTCDay(); const monday=new Date(Date.UTC(d.getUTCFullYear(),d.getUTCMonth(),d.getUTCDate()-(day||7)+1));
    const key=monday.toISOString().slice(0,10); map.set(key,x.close);
  }
  return [...map.entries()].sort((a,b)=>a[0].localeCompare(b[0])).map(x=>x[1]);
}
function trend(series,n=3){ if(series.length<n+1)return'資料不足'; const a=series.at(-n-1), b=series.at(-1), delta=b-a, pct=Math.abs(a)?delta/a*100:0; if(pct>0.25)return'上升'; if(pct<-0.25)return'下降'; return'走平'; }
function parseDateText(s){ const m=String(s).match(/(\d{2,3})[\\/\-.](\d{1,2})[\\/\-.](\d{1,2})/); if(!m)return null; let y=Number(m[1]); if(y<1911)y+=1911; return new Date(Date.UTC(y,Number(m[2])-1,Number(m[3]))); }
function isoDateText(s){const d=parseDateText(s); return d?d.toISOString().slice(0,10):null;}
function calcDaily(daily){
  const sorted=[...daily].sort((a,b)=>parseDateText(a.date)-parseDateText(b.date));
  const cs=closes(sorted), last=sorted.at(-1), prev=sorted.at(-2);
  return {sma5:sma(cs,5),sma20:sma(cs,20),high7:Math.max(...sorted.slice(-7).map(x=>x.high)),low7:Math.min(...sorted.slice(-7).map(x=>x.low)),high30:Math.max(...sorted.slice(-30).map(x=>x.high)),low30:Math.min(...sorted.slice(-30).map(x=>x.low)),close:last?.close,prevClose:prev?.close,date:last?.date,volume:last?.volume,macd:macd(cs),weeklyMacd:macd(weeklyCloses(sorted)),daily:sorted};
}
async function stockHistory(stockNo){
  const now=new Date(); const months=[];
  for(let i=0;i<9;i++){ const d=new Date(Date.UTC(now.getUTCFullYear(),now.getUTCMonth()-i,1)); months.push(d.toISOString().slice(0,7)+'-01'); }
  const all=[];
  for(let i=months.length-1;i>=0;i--){
    try{ const j=await historyMonth(stockNo,months[i]); all.push(...parseHistory(j)); }catch(e){}
    await sleep(40);
  }
  const seen=new Map(); for(const x of all) seen.set(x.date,x); return [...seen.values()].sort((a,b)=>parseDateText(a.date)-parseDateText(b.date));
}

app.get('/api/status', async (_req,res)=>res.json({ok:true,service:'台股羅盤',dataSource:'TWSE OpenAPI / TWSE public reports',time:new Date().toISOString()}));

app.get('/api/stock/:code', async (req,res)=>{
  try{
    const code=String(req.params.code).trim();
    const all=parseStockRows(await currentAll()); const cur=all.find(x=>x.code===code);
    if(!cur) return res.status(404).json({error:'股票代號不存在或目前無法取得資料'});
    const history=await stockHistory(code); if(history.length<30)return res.status(503).json({error:'歷史資料不足，無法完成技術指標計算'});
    const calc=calcDaily(history); const date=isoDateText(calc.date);
    let inst=[]; try{inst=parseT86(await institutional(date));}catch(e){}
    const recent=[];
    for(let i=0;i<3;i++){const d=new Date(Date.UTC(Number(date.slice(0,4)),Number(date.slice(5,7))-1,Number(date.slice(8,10))-i)); let found=false; for(let k=0;k<7 && !found;k++){const ds=d.toISOString().slice(0,10); try{const m=parseT86(await institutional(ds)); if(m.has(code)){recent.push({date:ds,...m.get(code)});found=true;}}catch(e){} d.setUTCDate(d.getUTCDate()-1);}}
    const latest=recent[0]||{foreign:null,trust:null,dealer:null,total:null};
    res.json({stock:{...cur, ...calc, dataDate:date, change:calc.close-calc.prevClose, changePct:calc.prevClose?((calc.close-calc.prevClose)/calc.prevClose*100):null},institutional:recent,latestInstitutional:latest});
  }catch(e){res.status(503).json({error:'資料暫時無法取得',detail:e.message});}
});

app.get('/api/screener', async (req,res)=>{
  try{
    const minPrice=req.query.minPrice?Number(req.query.minPrice):0, maxPrice=req.query.maxPrice?Number(req.query.maxPrice):Infinity;
    const keyword=String(req.query.q||'').trim();
    const all=parseStockRows(await currentAll()).filter(x=>x.volume!==null && x.volume/1000>=3000 && x.close>=minPrice && x.close<=maxPrice);
    const latest=await latestInstitutional();
    const date=latest.date;
    const instMap=latest.map;
    if(!date || !instMap.size) return res.json({dataDate:null,results:[],status:'最新法人資料暫時無法取得'});
    let dtSet=new Set(); try{const j=await dayTrade(); const rows=Array.isArray(j)?j:(j.data||[]); for(const r of rows){const c=r.Code||r['證券代號']||r[0]; if(c)dtSet.add(String(c));}}catch(e){}
    // If TWTB4U is temporarily unavailable, do not silently classify all stocks as eligible.
    if(!dtSet.size) return res.json({dataDate:null,results:[],status:'當沖標的資料暫時無法取得'});
    const candidates=all.sort((a,b)=>b.volume-a.volume).filter(x=>dtSet.has(x.code)).filter(x=>{const i=instMap.get(x.code); return i && Number.isFinite(i.foreign) && i.foreign>=0;}).filter(x=>{
      const name=x.name||''; return !/ETF/i.test(name) && !/^00/.test(x.code);
    }).filter(x=>!keyword || x.code.includes(keyword)||x.name.includes(keyword));
    const out=[];
    let limitMap=new Map(); try{const lj=await priceLimits(date); const h=lj.fields||[]; const ci=h.indexOf('證券代號'), lp=h.indexOf('漲停價'), cc=h.indexOf('收盤價'); for(const r of (lj.data||[])){if(ci>=0&&r[ci])limitMap.set(String(r[ci]),{limit:num(r[lp]),close:num(r[cc])});}}catch(e){}
    for(const c of candidates.slice(0,60)){
      try{
        const h=await stockHistory(c.code); if(h.length<60)continue; const calc=calcDaily(h); const dm=calc.macd, wm=calc.weeklyMacd;
        if(!dm||!wm||!(dm.osc>dm.prevOsc)||!(wm.osc>wm.prevOsc))continue;
        const pct=calc.prevClose?((calc.close-calc.prevClose)/calc.prevClose*100):0;
        const lp=limitMap.get(c.code);
        if((lp && lp.limit!==null && Math.abs(c.close-lp.limit)<0.001) || (!lp && c.close===calc.daily.at(-1).high && pct>=9.5)) continue;
        out.push({code:c.code,name:c.name,close:c.close,volume:c.volume,volumeLots:c.volume/1000,foreign:instMap.get(c.code)?.foreign,macdDailyOsc:dm.osc,macdWeeklyOsc:wm.osc});
        if(out.length>=10)break;
      }catch(e){}
    }
    res.json({dataDate:date,results:out,status:out.length?'OK':'符合條件股票暫時不足或資料未更新'});
  }catch(e){res.status(503).json({error:'篩選資料暫時無法取得',detail:e.message});}
});

app.get('/api/institutional-ranking', async (_req,res)=>{
  try{
    const today=new Date(); let map=new Map(), date=null;
    for(let i=0;i<7 && !map.size;i++){ const d=new Date(today); d.setUTCDate(d.getUTCDate()-i); const ds=d.toISOString().slice(0,10); try{map=parseT86(await institutional(ds)); if(map.size)date=ds;}catch(e){} }
    if(!map.size)return res.status(503).json({error:'最新法人排行資料暫時無法取得'});
    const rows=[...map.values()].filter(x=>x.code && /^\d{4}$/.test(x.code) && Number.isFinite(x.total));
    const buy=[...rows].sort((a,b)=>b.total-a.total).slice(0,5); const sell=[...rows].sort((a,b)=>a.total-b.total).slice(0,5);
    res.json({dataDate:date,buy,sell});
  }catch(e){res.status(503).json({error:'法人排行資料暫時無法取得'});}
});

if (require.main === module) app.listen(PORT,()=>console.log(`台股羅盤 running on http://localhost:${PORT}`));
module.exports = app;
