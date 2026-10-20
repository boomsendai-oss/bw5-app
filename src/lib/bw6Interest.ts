// BW6プレ告知LP(boom-sendai.com/bw6)の「出てみたい／ちょっと気になる」記録。
// 入力の検証(純関数)とDB操作をまとめる。公開API: src/app/api/public/bw6-interest/route.ts
// 集計画面: src/app/staff/bw6-interest/page.tsx
import { execute, getAll, getOne } from '@/lib/db';

export const BW6_KINDS = ['want', 'curious'] as const;
export type Bw6Kind = (typeof BW6_KINDS)[number];

export const BW6_KIND_LABEL: Record<Bw6Kind, string> = {
  want: '出てみたい！',
  curious: 'ちょっと気になる',
};

/** 流入元。配信ごとに `?src=` を付けて出し分ける。これ以外の値は 'other' に丸める */
export const BW6_SRCS = ['line', 'ig', 'hacomono', 'qr', 'group', 'hp', 'direct', 'other'] as const;
type Bw6BaseSrc = (typeof BW6_SRCS)[number];
/**
 * 記録する流入元のキー。MOCCHINスペシャルナンバー専用ページ(/bw6/mocchin)から押された分は
 * `mocchin_` を頭に付けて区別する（例: mocchin_line）。メインLP(/bw6)の値は従来どおり（後方互換）。
 */
export type Bw6Src = Bw6BaseSrc | `mocchin_${Bw6BaseSrc}`;
export const BW6_PAGE_PREFIX = 'mocchin_';

export const BW6_SRC_LABEL: Record<Bw6BaseSrc, string> = {
  line: '公式LINE配信',
  ig: 'Instagram',
  hacomono: 'HACOMONO',
  qr: 'QR(紙・掲示)',
  group: 'グループLINE',
  hp: '公式HP内',
  direct: '指定なし',
  other: 'その他',
};

export const BW6_AGE_GROUPS = ['kids', 'teen', 'adult'] as const;
export type Bw6AgeGroup = (typeof BW6_AGE_GROUPS)[number];
export const BW6_AGE_LABEL: Record<Bw6AgeGroup, string> = {
  kids: 'キッズ(小学生まで)',
  teen: '中高生',
  adult: '大人',
};

const DEVICE_ID_RE = /^[A-Za-z0-9-]{16,64}$/;

function str(v: unknown): string {
  return typeof v === 'string' ? v : '';
}

/** 制御文字を除いて前後の空白を落とし、最大長で切る */
function clean(v: unknown, max: number): string {
  return str(v).replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, max);
}

export function normalizeSrc(v: unknown): Bw6Src {
  let s = str(v).trim().toLowerCase();
  let prefix = '';
  if (s.startsWith(BW6_PAGE_PREFIX)) {
    prefix = BW6_PAGE_PREFIX;
    s = s.slice(BW6_PAGE_PREFIX.length);
  }
  const base: Bw6BaseSrc = !s ? 'direct' : (BW6_SRCS as readonly string[]).includes(s) ? (s as Bw6BaseSrc) : 'other';
  return `${prefix}${base}` as Bw6Src;
}

/** 集計画面の表示名（MOCCHINページ分は頭に付ける） */
export function srcLabel(src: string): string {
  const mocchin = src.startsWith(BW6_PAGE_PREFIX);
  const base = (mocchin ? src.slice(BW6_PAGE_PREFIX.length) : src) as Bw6BaseSrc;
  const label = BW6_SRC_LABEL[base] ?? base;
  return mocchin ? `MOCCHINページ／${label}` : label;
}

/** user-agent は端末の種類が分かる程度に縮める(個人の特定に使わない) */
export function summarizeUserAgent(ua: string): string {
  const os = /iPhone|iPad/.test(ua)
    ? 'iOS'
    : /Android/.test(ua)
      ? 'Android'
      : /Mac OS X/.test(ua)
        ? 'Mac'
        : /Windows/.test(ua)
          ? 'Windows'
          : 'other';
  const app = /Line\//.test(ua) ? 'LINE' : /Instagram/.test(ua) ? 'Instagram' : 'browser';
  return `${os}/${app}`;
}

export type PressInput = { deviceId: string; kind: Bw6Kind; src: Bw6Src };
export type DetailsInput = {
  deviceId: string;
  kind: Bw6Kind;
  src: Bw6Src;
  name: string;
  classLabel: string;
  ageGroup: Bw6AgeGroup | '';
};

type V<T> = { ok: true; data: T } | { ok: false; error: string };

export function validatePress(body: unknown): V<PressInput> {
  const b = (body ?? {}) as Record<string, unknown>;
  const deviceId = str(b.device_id);
  if (!DEVICE_ID_RE.test(deviceId)) return { ok: false, error: 'device' };
  const kind = str(b.kind);
  if (!(BW6_KINDS as readonly string[]).includes(kind)) return { ok: false, error: 'kind' };
  return { ok: true, data: { deviceId, kind: kind as Bw6Kind, src: normalizeSrc(b.src) } };
}

export function validateDetails(body: unknown): V<DetailsInput> {
  const b = (body ?? {}) as Record<string, unknown>;
  // ハニーポット(画面に出さない欄)に値が入っていたらボット
  if (clean(b.website, 200)) return { ok: false, error: 'spam' };
  const deviceId = str(b.device_id);
  if (!DEVICE_ID_RE.test(deviceId)) return { ok: false, error: 'device' };
  const ag = str(b.age_group);
  const ageGroup: Bw6AgeGroup | '' = (BW6_AGE_GROUPS as readonly string[]).includes(ag) ? (ag as Bw6AgeGroup) : '';
  const k = str(b.kind);
  const kind: Bw6Kind = (BW6_KINDS as readonly string[]).includes(k) ? (k as Bw6Kind) : 'want';
  const data = { deviceId, kind, src: normalizeSrc(b.src), name: clean(b.name, 60), classLabel: clean(b.class_label, 80), ageGroup };
  if (!data.name && !data.classLabel && !data.ageGroup) return { ok: false, error: 'empty' };
  return { ok: true, data };
}

/** ボタン1回ぶん。同じ端末は1行にまとめ、最後に押したボタンを kind に残す(src は最初の流入元を保持) */
export async function recordPress(p: PressInput, userAgent: string, now = new Date()): Promise<void> {
  const ts = now.toISOString();
  await execute(
    `INSERT INTO bw6_interest (device_id, kind, first_kind, src, press_count, user_agent, created_at, updated_at)
     VALUES (?, ?, ?, ?, 1, ?, ?, ?)
     ON CONFLICT(device_id) DO UPDATE SET
       kind = excluded.kind,
       press_count = bw6_interest.press_count + 1,
       src = CASE WHEN bw6_interest.src IN ('direct', 'other', 'mocchin_direct', 'mocchin_other') THEN excluded.src ELSE bw6_interest.src END,
       updated_at = excluded.updated_at`,
    [p.deviceId, p.kind, p.kind, p.src, summarizeUserAgent(userAgent), ts, ts],
  );
}

/**
 * 任意入力。ボタンの記録(press)より先に届くこともある(通信の追い越し)ので、
 * 行が無ければここで作る。押した回数は増やさない。
 */
export async function saveDetails(d: DetailsInput, userAgent = '', now = new Date()): Promise<void> {
  const ts = now.toISOString();
  await execute(
    `INSERT INTO bw6_interest (device_id, kind, first_kind, src, press_count, name, class_label, age_group, user_agent, created_at, updated_at)
     VALUES (?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(device_id) DO UPDATE SET
       name = excluded.name,
       class_label = excluded.class_label,
       age_group = excluded.age_group,
       updated_at = excluded.updated_at`,
    [d.deviceId, d.kind, d.kind, d.src, d.name, d.classLabel, d.ageGroup, summarizeUserAgent(userAgent), ts, ts],
  );
}

export type Bw6InterestRow = {
  id: number;
  kind: Bw6Kind;
  firstKind: Bw6Kind;
  src: Bw6Src;
  pressCount: number;
  name: string;
  classLabel: string;
  ageGroup: string;
  userAgent: string;
  createdAt: string;
  updatedAt: string;
};

export async function listBw6Interest(): Promise<Bw6InterestRow[]> {
  const rows = await getAll(
    `SELECT id, kind, first_kind, src, press_count, name, class_label, age_group, user_agent, created_at, updated_at
     FROM bw6_interest ORDER BY created_at DESC`,
  );
  return rows.map((r) => ({
    id: Number(r.id),
    kind: String(r.kind) as Bw6Kind,
    firstKind: String(r.first_kind) as Bw6Kind,
    src: String(r.src) as Bw6Src,
    pressCount: Number(r.press_count),
    name: String(r.name ?? ''),
    classLabel: String(r.class_label ?? ''),
    ageGroup: String(r.age_group ?? ''),
    userAgent: String(r.user_agent ?? ''),
    createdAt: String(r.created_at),
    updatedAt: String(r.updated_at),
  }));
}

export type Bw6Summary = {
  total: number;
  byKind: Record<Bw6Kind, number>;
  bySrc: { src: Bw6Src; want: number; curious: number; total: number }[];
  withName: number;
};

/** 集計(純関数)。端末単位=人数の目安。最後に押したボタンで数える */
export function summarizeBw6(rows: Pick<Bw6InterestRow, 'kind' | 'src' | 'name'>[]): Bw6Summary {
  const byKind: Record<Bw6Kind, number> = { want: 0, curious: 0 };
  const src = new Map<Bw6Src, { want: number; curious: number }>();
  let withName = 0;
  for (const r of rows) {
    byKind[r.kind] = (byKind[r.kind] ?? 0) + 1;
    const e = src.get(r.src) ?? { want: 0, curious: 0 };
    e[r.kind] += 1;
    src.set(r.src, e);
    if (r.name) withName += 1;
  }
  const bySrc = [...src.entries()]
    .map(([s, v]) => ({ src: s, ...v, total: v.want + v.curious }))
    .sort((a, b) => b.total - a.total);
  return { total: rows.length, byKind, bySrc, withName };
}

export async function countBw6Interest(): Promise<number> {
  const r = await getOne('SELECT COUNT(*) AS n FROM bw6_interest');
  return Number(r?.n ?? 0);
}
