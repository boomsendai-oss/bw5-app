import fs from 'fs';
const env = Object.fromEntries(fs.readFileSync('.env.production.local','utf8').split('\n').filter(l=>l.includes('=')&&!l.trim().startsWith('#')).map(l=>{const i=l.indexOf('=');return [l.slice(0,i).trim(), l.slice(i+1).trim().replace(/^["']|["']$/g,'')];}));
const p = new URLSearchParams({client_id:env.GOOGLE_OAUTH_CLIENT_ID, client_secret:env.GOOGLE_OAUTH_CLIENT_SECRET, refresh_token:env.GBP_REFRESH_TOKEN, grant_type:'refresh_token'});
const tr = await fetch('https://oauth2.googleapis.com/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:p});
const {access_token}=await tr.json();
const q=new URLSearchParams();
q.set('monthlyRange.start_month.year','2026'); q.set('monthlyRange.start_month.month','6');
q.set('monthlyRange.end_month.year','2026');   q.set('monthlyRange.end_month.month','7');
q.set('pageSize','60');
const url=`https://businessprofileperformance.googleapis.com/v1/locations/${env.GBP_LOCATION_ID}/searchkeywords/impressions/monthly?${q}`;
const r=await fetch(url,{headers:{Authorization:`Bearer ${access_token}`}});
console.log('status',r.status);
const j=await r.json();
if(!r.ok){console.log(JSON.stringify(j).slice(0,400));process.exit(0);}
const rows=(j.searchKeywordsCounts??[]).map(k=>({kw:k.searchKeyword, n: Number(k.insightsValue?.value ?? k.insightsValue?.threshold ?? 0), thr: k.insightsValue?.threshold!=null}));
rows.sort((a,b)=>b.n-a.n);
for(const x of rows.slice(0,30)) console.log(`${String(x.n).padStart(5)}${x.thr?'未満':'    '}  ${x.kw}`);
console.log('--- 総キーワード数:', rows.length);
