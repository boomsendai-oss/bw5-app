#!/usr/bin/env node
// 出演者(performers) ↔ 会員(boom_members) の接続と、ハンドルの正本移行 (2026-08-17)
//
// やること:
//   ① performers.member_id を氏名一致で埋める(異体字を寄せる。読みや送り仮名は寄せない)
//   ② 会員に一致しなかった出演者に is_external=1 を立てる
//      (TARO確認済み: 諏訪GALS!!/Mini Wave/Little Wave は外部参加者、GRAFFITIは外部ゲスト、
//       講師は instructors 所属、木村奏真はTAROの家族。全員"繋がらなくて正常")
//   ③ performers 側のハンドルを boom_members.instagram_handle へ移す
//      優先度は 本人 > 母 > 父 (TARO決定 2026-08-17 / 20260805の設計と同じ)
//   ④ 移した会員分の performers 側ハンドルを NULL にする(棚を二重にしないため)
//      **非会員(is_external=1)のハンドルは残す** — 会員でない出演者は boom_members に置き場が無く、
//      かつ外部ゲストにもメンション対象が居るため
//
// 既に boom_members にハンドルが入っている会員は上書きしない(本人が /ig から出した値のほうが新しい)。
//
// 使い方:
//   node scripts/link_performers_to_members.mjs --dry-run   … 変更内容を表示するだけ
//   node scripts/link_performers_to_members.mjs             … 実行
// 環境変数: TURSO_DATABASE_URL / TURSO_AUTH_TOKEN
import { createClient } from '@libsql/client';

const DRY = process.argv.includes('--dry-run');
const c = createClient({
  url: process.env.TURSO_DATABASE_URL || 'file:./data/bw5.db',
  authToken: process.env.TURSO_AUTH_TOKEN,
});

// src/lib/instagramCollect.ts の normalizeName と同じ規則(あちらはテスト済み。ここは一度きりの移行用)
const normName = (s) =>
  String(s || '')
    .replace(/[\s　・,、.。\-ー－/]/g, '')
    .replace(/髙/g, '高').replace(/﨑/g, '崎').replace(/[邊邉]/g, '辺')
    .replace(/澤/g, '沢').replace(/[齋齊]/g, '斉').replace(/濵/g, '浜')
    .replace(/嶋/g, '島').replace(/冨/g, '富');

const pickHandle = (r) => {
  const self = (r.instagram_handle || '').trim();
  if (self) return { handle: self, kind: 'self' };
  const mo = (r.handle_mother || '').trim();
  if (mo) return { handle: mo, kind: 'mother' };
  const fa = (r.handle_father || '').trim();
  if (fa) return { handle: fa, kind: 'father' };
  return null;
};

async function main() {
  const members = (await c.execute('SELECT id, hacomono_member_id, full_name, status, instagram_handle FROM boom_members')).rows;
  const idx = new Map();
  for (const m of members) {
    const k = normName(m.full_name);
    if (!idx.has(k)) idx.set(k, []);
    idx.get(k).push(m);
  }

  const perfs = (await c.execute(
    'SELECT id, name, m_id, member_id, is_external, instagram_handle, handle_mother, handle_father FROM performers'
  )).rows;

  const stmts = [];
  const linked = new Map();   // memberId -> {name, handle, kind}
  const external = new Set();
  const ambiguous = [];
  let linkedRows = 0, externalRows = 0;

  for (const p of perfs) {
    const hits = idx.get(normName(p.name)) || [];
    if (hits.length === 1) {
      const m = hits[0];
      linkedRows++;
      if (Number(p.member_id) !== Number(m.id)) {
        stmts.push({ sql: 'UPDATE performers SET member_id = ?, is_external = 0 WHERE id = ?', args: [m.id, p.id] });
      }
      const h = pickHandle(p);
      // 既に会員側に値があるなら触らない(本人が出した値を尊重)
      if (h && !(m.instagram_handle || '').trim() && !linked.has(m.id)) {
        linked.set(m.id, { memberNo: m.hacomono_member_id, name: m.full_name, ...h });
      }
    } else if (hits.length > 1) {
      ambiguous.push(p.name);
    } else {
      externalRows++;
      external.add(p.name);
      if (Number(p.is_external) !== 1) {
        stmts.push({ sql: 'UPDATE performers SET is_external = 1, member_id = NULL WHERE id = ?', args: [p.id] });
      }
    }
  }

  // ③ 会員へハンドルを移す
  const at = new Date().toISOString();
  for (const [memberId, v] of linked) {
    stmts.push({
      sql: 'UPDATE boom_members SET instagram_handle = ?, instagram_owner_kind = ?, instagram_linked_at = ?, updated_at = ? WHERE id = ?',
      args: [v.handle, v.kind, at, at, memberId],
    });
  }
  // ④ 会員に移した分だけ performers 側を空にする。非会員の行は触らない
  stmts.push({
    sql: `UPDATE performers SET instagram_handle = NULL, handle_mother = NULL, handle_father = NULL
          WHERE member_id IS NOT NULL AND is_external = 0`,
    args: [],
  });

  console.log('--- 集計 ---');
  console.log('performers 行数:', perfs.length, '/ 会員に接続:', linkedRows, '/ 非会員:', externalRows);
  console.log('会員へ移すハンドル:', linked.size, '件');
  console.log('非会員(ユニーク名):', external.size, '名 — ハンドルは performers に残す');
  if (ambiguous.length) console.log('⚠️ 同姓同名で確定できず(手当て要):', [...new Set(ambiguous)].join(', '));
  console.log('実行するUPDATE文:', stmts.length);

  if (DRY) {
    console.log('\n--- dry-run のため書き込みなし ---');
    for (const [, v] of linked) console.log(`  会員#${v.memberNo} ${v.name} ← @${v.handle} (${v.kind})`);
    return;
  }

  for (let i = 0; i < stmts.length; i += 50) {
    await c.batch(stmts.slice(i, i + 50), 'write');
  }
  console.log('完了');
}

main().catch((e) => { console.error('FAILED:', e.message); process.exit(1); });
