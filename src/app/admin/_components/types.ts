// ── Admin shared types ──────────────────────────────────────────────

export interface ScheduleItem {
  id: number; time: string; title: string; description: string; sort_order: number;
}
export interface MerchVariant {
  id: number; merch_id: number; color: string; size: string; stock: number; sort_order: number;
}
export interface MerchItem {
  id: number; name: string; price: number; image_url: string;
  stock: number; description: string; sort_order: number; active: number;
  variants?: MerchVariant[];
}
export interface MerchOrder {
  id: number; merch_id: number; variant_id?: number | null;
  color?: string; size?: string; email?: string;
  buyer_name: string; payment_method: string;
  status: string; created_at: string; merch_name: string; merch_price?: number;
  square_payment_id?: string;
}
export interface MusicRelease {
  id: number; artist: string; title: string; jacket_url: string;
  apple_music_url: string; spotify_url: string; amazon_music_url: string;
  youtube_music_url: string; release_at: string; sort_order: number;
}
export interface VideoOrder {
  id: number; buyer_name: string; email: string; phone?: string; note?: string;
  payment_method: string;
  status: string; created_at: string;
}
export interface VoteCandidate {
  id: number; name: string; votes: number; sort_order: number;
}
export interface SnsLink {
  id: number; platform: string; url: string; sort_order: number;
}
export type SettingsMap = Record<string, string>;
