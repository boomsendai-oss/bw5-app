export type Studio = {
  id: number;
  name: string;
  address: string | null;
  google_map_url: string | null;
  pricing_model: string;
  hourly_rate: number;
  block_pricing: string | null;
  daily_buffer_minutes: number;
  notes: string | null;
  active: number;
  // HP公開情報
  is_public: number | null;
  map_embed_url: string | null;
  access_text: string | null;
};

export type Instructor = {
  id: number;
  name: string;
  name_kana: string | null;
  contact_email: string | null;
  contact_phone: string | null;
  instagram_handle: string | null;
  profile_text: string | null;
  profile_photo_url: string | null;
  shared_folder_url: string | null;
  bank_name: string | null;
  bank_branch: string | null;
  bank_account_type: string | null;
  bank_account_number: string | null;
  bank_account_holder: string | null;
  notes: string | null;
  active: number;
  salary_type: string | null;
  monthly_fixed_amount: number | null;
  // HP公開情報
  slug: string | null;
  genre: string | null;
  crews: string | null;
  career_text: string | null;
  public_display_order: number | null;
  video_url: string | null;
};

export type Rate = { id: number; instructor_id: number; duration_minutes: number; rate: number };
export type TransitFee = { id: number; instructor_id: number; studio_id: number; amount: number };
export type PhotoCount = { instructor_id: number; count: number };

export type Lesson = {
  id: number;
  class_name: string;
  target: string | null;
  level: string | null;
  default_studio_id: number | null;
  default_instructor_id: number | null;
  default_day_of_week: number | null;
  default_start_time: string | null;
  default_end_time: string | null;
  duration_minutes: number | null;
  frequency_type: string | null;
  override_rate: number | null;
  active: number;
  notes: string | null;
  start_date: string | null;
  end_date: string | null;
  // HP公開用
  description_text: string | null;
  studio_name: string | null;
  instructor_name: string | null;
  is_public: number | null;
  video_url: string | null;
  slug: string | null;
};

// スタジオの区分料金1行
export type PriceBlock = { label: string; start: string; end: string; price: number };

export const TARGET_OPTIONS = [
  { value: 'chibikko', label: 'ちびっこ（年中・年長）' },
  { value: 'kids', label: 'キッズ（小学生）' },
  { value: 'junior', label: 'ジュニア（中高生）' },
  { value: 'adult', label: '大人（18歳〜）' },
  { value: 'all', label: '全年齢' },
] as const;

export const LEVEL_OPTIONS = [
  { value: 'beginner', label: '入門（未経験OK）' },
  { value: 'elementary', label: '初級' },
  { value: 'intermediate', label: '中級' },
  { value: 'advanced', label: '上級' },
  { value: 'all', label: 'オールレベル' },
] as const;

export function targetLabels(csv: string | null): string {
  if (!csv) return '—';
  return csv.split(',').map(v => TARGET_OPTIONS.find(o => o.value === v)?.label ?? v).join('、');
}

export function levelLabel(val: string | null): string {
  if (!val) return '—';
  return LEVEL_OPTIONS.find(o => o.value === val)?.label ?? val;
}

export const DAY_NAMES = ['日', '月', '火', '水', '木', '金', '土'];

export const dayLabel = (d: number | null | undefined) =>
  d == null ? '—' : DAY_NAMES[d] ?? String(d);

// block_pricing(JSON文字列 or 配列)を PriceBlock[] にパース。失敗時は空配列
export function parseBlocks(raw: unknown): PriceBlock[] {
  let arr: unknown = raw;
  if (typeof raw === 'string') {
    if (!raw.trim()) return [];
    try { arr = JSON.parse(raw); } catch { return []; }
  }
  if (!Array.isArray(arr)) return [];
  return arr.map((b) => {
    const o = (b ?? {}) as Record<string, unknown>;
    return {
      label: typeof o.label === 'string' ? o.label : '',
      start: typeof o.start === 'string' ? o.start : '',
      end: typeof o.end === 'string' ? o.end : '',
      price: Number(o.price) || 0,
    };
  });
}
