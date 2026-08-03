#!/usr/bin/env node
// GBP(Googleビジネスプロフィール)投稿の状態を確認する。
//
//   node scripts/check_gbp_posts.mjs              # 予約・公開中の投稿を一覧
//   node scripts/check_gbp_posts.mjs <投稿ID>      # 1件の詳細
//
// なぜ要るか: 動画つき投稿は state が PROCESSING のまま**永久に止まることがある**。
// APIはエラーを一切返さないので、state を見にいく以外に気づく手段がない。
// 実際に2026-08-03、元動画の color_space が bt2020nc だったせいで26時間止まった。
// 出す前に ffprobe で bt709 に揃っているか確認すること（メモ: gbp-video-colorspace）。
//
// PROCESSING が数十分を超えたら異常。止まった投稿は復帰しないので削除して作り直す。
import fs from 'fs';

const env = Object.fromEntries(
  fs
    .readFileSync('.env.production.local', 'utf8')
    .split('\n')
    .filter((l) => l.includes('=') && !l.trim().startsWith('#'))
    .map((l) => {
      const i = l.indexOf('=');
      return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, '')];
    })
);

async function accessToken() {
  const body = new URLSearchParams({
    client_id: env.GOOGLE_OAUTH_CLIENT_ID,
    client_secret: env.GOOGLE_OAUTH_CLIENT_SECRET,
    refresh_token: env.GBP_REFRESH_TOKEN,
    grant_type: 'refresh_token',
  });
  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  const j = await r.json();
  if (!j.access_token) throw new Error(`トークン取得に失敗: ${JSON.stringify(j)}`);
  return j.access_token;
}

const base = `https://mybusiness.googleapis.com/v4/accounts/${env.GBP_ACCOUNT_ID}/locations/${env.GBP_LOCATION_ID}/localPosts`;
const jst = (d) =>
  new Date(new Date(d).getTime() + 9 * 3600 * 1000).toISOString().replace('T', ' ').slice(0, 16);

// PROCESSING だけ目立たせる。ここが止まっていることに気づけないのが一番怖い
const mark = (s) => (s === 'PROCESSING' ? '⏳' : s === 'REJECTED' ? '🔴' : '  ');

const token = await accessToken();
const id = process.argv[2];

if (id) {
  const r = await fetch(`${base}/${id}`, { headers: { Authorization: `Bearer ${token}` } });
  if (r.status === 404) {
    console.log(`投稿 ${id} は見つかりません（削除済み？）`);
    process.exit(1);
  }
  const p = await r.json();
  console.log(`state    : ${mark(p.state)} ${p.state}`);
  console.log(`予定日時 : ${p.scheduledTime ? jst(p.scheduledTime) + ' JST' : '(即時)'}`);
  console.log(`更新     : ${jst(p.updateTime)} JST`);
  console.log(`メディア : ${(p.media ?? []).map((m) => m.mediaFormat).join(', ') || 'なし'}`);
  console.log(`本文     : ${(p.summary ?? '').slice(0, 60)}…`);
} else {
  const r = await fetch(`${base}?pageSize=100`, { headers: { Authorization: `Bearer ${token}` } });
  const posts = (await r.json()).localPosts ?? [];
  if (posts.length === 0) {
    console.log('投稿がありません');
  }
  for (const p of posts) {
    const when = p.scheduledTime ? jst(p.scheduledTime) : jst(p.createTime);
    const media = (p.media ?? []).some((m) => m.mediaFormat === 'VIDEO') ? '🎬' : '  ';
    console.log(
      `${mark(p.state)}${media} ${when} ${String(p.state).padEnd(9)} ${p.name.split('/').pop()}  ${(p.summary ?? '').replace(/\n/g, ' ').slice(0, 34)}`
    );
  }
  const stuck = posts.filter((p) => p.state === 'PROCESSING');
  if (stuck.length > 0) {
    console.log(`\n⏳ PROCESSING が ${stuck.length}件あります。`);
    console.log('   数十分を超えているなら動画のメタデータを疑うこと（色空間を bt709 に揃える）。');
  }
}
