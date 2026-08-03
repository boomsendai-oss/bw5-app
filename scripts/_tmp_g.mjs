import fs from 'fs';
const env = Object.fromEntries(fs.readFileSync('.env.production.local','utf8').split('\n').filter(l=>l.includes('=')&&!l.trim().startsWith('#')).map(l=>{const i=l.indexOf('=');return [l.slice(0,i).trim(), l.slice(i+1).trim().replace(/^["']|["']$/g,'')];}));
const p = new URLSearchParams({client_id:env.GOOGLE_OAUTH_CLIENT_ID, client_secret:env.GOOGLE_OAUTH_CLIENT_SECRET, refresh_token:env.GBP_REFRESH_TOKEN, grant_type:'refresh_token'});
const tr = await fetch('https://oauth2.googleapis.com/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:p});
const {access_token}=await tr.json();
const base=`https://mybusiness.googleapis.com/v4/accounts/${env.GBP_ACCOUNT_ID}/locations/${env.GBP_LOCATION_ID}/localPosts`;
const r = await fetch(`${base}?pageSize=100`,{headers:{Authorization:`Bearer ${access_token}`}});
const j = await r.json();
const jst = d => new Date(new Date(d).getTime()+9*3600*1000).toISOString().replace('T',' ').slice(0,16);
console.log('現在(JST):', jst(new Date()));
console.log('');
for (const post of (j.localPosts??[]).slice(0,6)) {
  const sched = post.scheduledTime ? jst(post.scheduledTime)+' JST' : '(即時)';
  const media = (post.media??[]).map(m=>m.mediaFormat).join(',') || 'なし';
  const upd = post.updateTime ? jst(post.updateTime) : '-';
  console.log(`${(post.state||'').padEnd(10)} 予定:${sched.padEnd(21)} media=${media.padEnd(6)} 更新:${upd}`);
  console.log(`   id=${post.name?.split('/').pop()}  ${(post.summary??'').slice(0,34).replace(/\n/g,' ')}`);
}
