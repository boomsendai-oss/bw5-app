// 発表会リールのCAST(出演者のタグ付け)。
//
// 「誰が出たか」は出演者名簿(performers)、ハンドルの正本は会員名簿(boom_members)の3枠
// (本人 > 母 > 父)。非会員の出演者だけは performers 側の3枠に入る。照合は氏名の正規化一致で、
// 同名2人は照合しない(誤タグ防止)。CLAUDE.md §10 の規則そのまま。
//
// この計算は2か所で使う。片方だけ直すと「画面の候補」と「実際に付くタグ」がズレるので、
// 必ずこのファイルを通すこと。
//   ① アプリの投稿待ちカードに出すCAST候補(api/staff/reel-drafts GET)
//   ② 投稿の直前にCASTを最新化する処理(api/cron/post-reel)
//      → 予約した後に出演者がハンドルを登録しても、投稿時に自動で載る
//        (TARO 2026-10-21: 出演者のLINEグループで登録を促すので、順次増えていく)
//
// 載せない人: performers.tag_consent = 0 。家庭から「タグ付けしないで」と言われたら
// その出演者の行に 0 を入れる。名簿から計算し直すたびに必ず外れる(予約済みの投稿からも外れる)。

import { normalizeJaName } from './castSuggest';

export type PerformerRow = {
  id: unknown; m_id: unknown; name: unknown;
  instagram_handle?: unknown; handle_mother?: unknown; handle_father?: unknown;
  tag_consent?: unknown;
};
export type MemberRow = { id: unknown; full_name: unknown; handle: unknown; owner_kind: unknown };

export type StageCast = {
  known: Array<{ kind: 'member' | 'performer'; id: number; name: string; handle: string }>;
  unknown: Array<{ kind: 'member' | 'performer'; id: number; name: string }>;
  /** tag_consent=0(載せないでと言われた人)のハンドル。最新化の時に保存済みCASTからも外す */
  declined: string[];
};

/** ファイル名「M06-2.mp4」→「M6」(出演者名簿の m_id の書式)。読めなければ null */
export function mIdFromDriveName(driveName: unknown): string | null {
  const m = String(driveName ?? '').match(/^M(\d+)/);
  return m ? 'M' + parseInt(m[1], 10) : null;
}

const pickOwn = (x: PerformerRow): { handle: string; label: string } | null => {
  for (const [h, label] of [
    [x.instagram_handle, ''],
    [x.handle_mother, '（母）'],
    [x.handle_father, '（父）'],
  ] as const) {
    if (h && String(h).trim()) return { handle: String(h).trim(), label };
  }
  return null;
};

/** 1演目ぶんのCASTを計算する(純関数)。performers はその演目の行だけを渡す。 */
export function computeStageCast(performers: PerformerRow[], members: MemberRow[]): StageCast {
  const memberByName = new Map<string, { id: number; handle: string | null; ownerKind: string | null } | 'DUP'>();
  for (const m of members) {
    const k = normalizeJaName(String(m.full_name));
    memberByName.set(k, memberByName.has(k) ? 'DUP' : {
      id: Number(m.id),
      handle: m.handle ? String(m.handle).trim() : null,
      ownerKind: m.owner_kind ? String(m.owner_kind) : null,
    });
  }

  const out: StageCast = { known: [], unknown: [], declined: [] };
  for (const x of performers) {
    const own = pickOwn(x);
    const hit = memberByName.get(normalizeJaName(String(x.name)));
    const memberHandle = hit && hit !== 'DUP' ? hit.handle : null;

    // 載せないでと言われた人は候補にも「ハンドルを聞いて」にも出さない
    // (NULL=未確認は「載せる」扱い。発表会は基本ON=TARO 2026-08-31。明示の0だけを除外)
    const tc = x.tag_consent;
    if (tc !== null && tc !== undefined && String(tc).trim() !== '' && Number(tc) === 0) {
      for (const h of [own?.handle, memberHandle]) if (h) out.declined.push(h);
      continue;
    }

    if (own) {
      out.known.push({ kind: 'performer', id: Number(x.id), name: String(x.name) + own.label, handle: own.handle });
    } else if (hit && hit !== 'DUP' && hit.handle) {
      const label = hit.ownerKind === 'mother' ? '（母）' : hit.ownerKind === 'father' ? '（父）' : '';
      out.known.push({ kind: 'member', id: hit.id, name: String(x.name) + label, handle: hit.handle });
    } else if (hit && hit !== 'DUP') {
      out.unknown.push({ kind: 'member', id: hit.id, name: String(x.name) });
    } else {
      out.unknown.push({ kind: 'performer', id: Number(x.id), name: String(x.name) });
    }
  }
  return out;
}

const norm = (h: string) => h.replace(/^@+/, '').trim().toLowerCase();

/**
 * 投稿直前のCAST最新化(純関数)。
 *   結果 = (今キャプションに入っているCAST ∪ 名簿で新しく登録された人) − 共同投稿者 − 載せない人
 * 手で足したハンドル(名簿に居ない人)は消さない。並びは「今のCAST → 新しく足した人」の順。
 * Instagramのキャプション内メンション上限(20)を超える分は足さない。
 */
export function mergeStageCast(
  current: string[],
  latestKnown: string[],
  collaborators: string[],
  declined: string[],
  max = 20
): { handles: string[]; added: string[]; removed: string[] } {
  const drop = new Set([...collaborators, ...declined].map(norm));
  const seen = new Set<string>();
  const handles: string[] = [];
  const removed: string[] = [];
  for (const h of current) {
    const k = norm(h);
    if (!k || seen.has(k)) continue;
    seen.add(k);
    if (drop.has(k)) { removed.push(h.replace(/^@+/, '')); continue; }
    handles.push(h.replace(/^@+/, ''));
  }
  const added: string[] = [];
  for (const h of latestKnown) {
    const k = norm(h);
    if (!k || seen.has(k) || drop.has(k)) continue;
    if (handles.length >= max) break;
    seen.add(k);
    handles.push(h.replace(/^@+/, ''));
    added.push(h.replace(/^@+/, ''));
  }
  return { handles, added, removed };
}

/** 会員名簿のハンドル(本人 > 母 > 父)。CLAUDE.md §10 の正本の読み方。 */
export const MEMBER_HANDLE_SQL = `SELECT id, full_name,
        COALESCE(NULLIF(trim(instagram_handle), ''),
                 NULLIF(trim(instagram_handle_mother), ''),
                 NULLIF(trim(instagram_handle_father), '')) AS handle,
        CASE WHEN NULLIF(trim(instagram_handle), '') IS NOT NULL THEN 'self'
             WHEN NULLIF(trim(instagram_handle_mother), '') IS NOT NULL THEN 'mother'
             WHEN NULLIF(trim(instagram_handle_father), '') IS NOT NULL THEN 'father'
        END AS owner_kind
   FROM boom_members`;

export const PERFORMER_SQL =
  'SELECT id, m_id, name, instagram_handle, handle_mother, handle_father, tag_consent FROM performers';

/**
 * 予約済みリールのCASTを、投稿の直前に名簿の最新状態で入れ直す(cron/post-reel から呼ぶ)。
 * 発表会リール以外・下書きが見つからない時は null(何もしない=予約時のキャプションのまま出す)。
 * 変化があれば reel_queue.caption と reel_draft.mention_handles も書き戻す(アプリの表示と揃える)。
 */
export async function refreshStageCastForQueue(
  queueId: unknown,
  caption: string,
  collaborators: string[]
): Promise<{ caption: string; added: string[]; removed: string[] } | null> {
  const { getOne, getAll, execute } = await import('./db');
  const { upsertCastLine, normalizeCastHandles } = await import('./reelCaption');

  const d = await getOne(
    "SELECT id, kind, drive_name FROM reel_draft WHERE reel_queue_id = ? AND kind IN ('発表会','stage') LIMIT 1",
    [String(queueId)]
  );
  if (!d) return null;
  const mid = mIdFromDriveName(d.drive_name);
  if (!mid) return null;

  const ps = await getAll(PERFORMER_SQL + ' WHERE m_id = ?', [mid]);
  if (ps.length === 0) return null;
  const members = await getAll(MEMBER_HANDLE_SQL);
  const cast = computeStageCast(ps, members);

  // 「今入っているCAST」はキャプションのCAST行を正とする(実際に投稿される文面そのもの)
  const castLine = caption.split('\n').find((l) => l.startsWith('CAST : ')) ?? '';
  const current = normalizeCastHandles(castLine.replace(/^CAST : /, ''));
  const merged = mergeStageCast(current, cast.known.map((k) => k.handle), collaborators, cast.declined);
  if (merged.added.length === 0 && merged.removed.length === 0) {
    return { caption, added: [], removed: [] };
  }

  const next = upsertCastLine(caption, merged.handles.join(' '));
  await execute('UPDATE reel_queue SET caption = ? WHERE id = ?', [next, queueId]);
  await execute('UPDATE reel_draft SET mention_handles = ? WHERE id = ?', [merged.handles.join(' ') || null, d.id]);
  return { caption: next, added: merged.added, removed: merged.removed };
}
