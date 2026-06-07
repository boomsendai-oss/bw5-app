'use client';

import { useState, useEffect, useCallback } from 'react';
import { Save } from 'lucide-react';
import { Toast, useToast } from '../_components/AdminShared';
import type { SettingsMap } from '../_components/types';

export default function AdminSettingsPage() {
  const { toast, notify, clearToast } = useToast();
  const [settings, setSettings] = useState<SettingsMap>({});
  const [dirty, setDirty] = useState(false);

  const load = useCallback(async () => {
    const res = await fetch('/api/settings', { headers: { 'x-admin-auth': '1' } });
    setSettings(await res.json());
    setDirty(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const update = (key: string, value: string) => {
    setSettings(prev => ({ ...prev, [key]: value }));
    setDirty(true);
  };

  const saveAll = async () => {
    const payload: SettingsMap = { ...settings };
    if (!payload.admin_password) delete payload.admin_password;
    await fetch('/api/settings', {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    setDirty(false);
    notify('設定を保存しました');
  };

  const Field = ({ label, settingsKey, type = 'text' }: { label: string; settingsKey: string; type?: string }) => (
    <div>
      <label className="block text-xs mb-1 font-medium" style={{ color: 'var(--text-secondary)' }}>{label}</label>
      <input className="admin-input" type={type} value={settings[settingsKey] || ''} onChange={e => update(settingsKey, e.target.value)} />
    </div>
  );

  const Toggle = ({ label, settingsKey }: { label: string; settingsKey: string }) => {
    const enabled = settings[settingsKey] === '1' || settings[settingsKey] === 'true';
    return (
      <div className="flex items-center justify-between py-2">
        <span className="text-sm">{label}</span>
        <button
          onClick={() => update(settingsKey, enabled ? '0' : '1')}
          className="w-11 h-6 rounded-full transition-colors relative"
          style={{ background: enabled ? 'var(--accent-primary)' : 'var(--bg-hover)' }}
        >
          <div className="w-4 h-4 rounded-full bg-white absolute top-1 transition-all" style={{ left: enabled ? '24px' : '4px' }} />
        </button>
      </div>
    );
  };

  return (
    <div>
      {toast && <Toast message={toast} onClose={clearToast} />}
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-xl font-bold">設定</h2>
        <button onClick={saveAll} className={`btn-primary text-sm px-4 py-2 flex items-center gap-1 ${dirty ? '' : 'opacity-50'}`} disabled={!dirty}>
          <Save className="w-3 h-3" /> 保存
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Hero section */}
        <div className="card p-4 md:col-span-2">
          <h3 className="text-sm font-bold mb-4 pb-2" style={{ color: 'var(--text-secondary)', borderBottom: '1px solid var(--border-color)' }}>ヒーロー画像・テキスト</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs mb-1 font-medium" style={{ color: 'var(--text-secondary)' }}>メイン画像</label>
              <div className="flex items-center gap-3 mb-2">
                {settings.hero_image && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={settings.hero_image} alt="プレビュー" className="w-20 h-20 object-contain rounded" style={{ background: 'var(--bg-secondary)' }} />
                )}
                <div className="flex-1">
                  <input
                    type="file" accept="image/*"
                    onChange={async (e) => {
                      const file = e.target.files?.[0];
                      if (!file) return;
                      const fd = new FormData();
                      fd.append('file', file);
                      const res = await fetch('/api/upload', { method: 'POST', body: fd });
                      const data = await res.json();
                      if (data.url) { update('hero_image', data.url); notify('画像をアップロードしました'); }
                    }}
                    className="admin-input text-xs"
                  />
                  <p className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>PNG/JPG/GIF/WebP対応</p>
                </div>
              </div>
              <Field label="または画像URL" settingsKey="hero_image" />
              <div className="mt-3">
                <label className="block text-xs mb-1 font-medium" style={{ color: 'var(--text-secondary)' }}>画像サイズ: {settings.hero_image_size || '200'}px</label>
                <input type="range" min="80" max="500" step="10" value={settings.hero_image_size || '200'} onChange={e => update('hero_image_size', e.target.value)} className="w-full accent-[var(--accent-primary)]" />
                <div className="flex justify-between text-[10px]" style={{ color: 'var(--text-muted)' }}><span>80px</span><span>200px</span><span>350px</span><span>500px</span></div>
              </div>
            </div>
            <div className="space-y-3">
              <Field label="タイトル1行目" settingsKey="hero_title_line1" />
              <Field label="タイトル2行目" settingsKey="hero_title_line2" />
              <Field label="日付表示" settingsKey="hero_date" />
              <Field label="サブタイトル" settingsKey="hero_subtitle" />
            </div>
          </div>
        </div>

        {/* Event info */}
        <div className="card p-4">
          <h3 className="text-sm font-bold mb-4 pb-2" style={{ color: 'var(--text-secondary)', borderBottom: '1px solid var(--border-color)' }}>イベント情報</h3>
          <div className="space-y-3">
            <Field label="イベント名" settingsKey="event_name" />
            <Field label="開催日" settingsKey="event_date" type="date" />
            <Field label="会場" settingsKey="venue" />
          </div>
        </div>

        {/* Admin */}
        <div className="card p-4">
          <h3 className="text-sm font-bold mb-4 pb-2" style={{ color: 'var(--text-secondary)', borderBottom: '1px solid var(--border-color)' }}>管理者</h3>
          <p className="text-[11px] leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
            管理パスワードは Vercel の環境変数 <code>ADMIN_PASSWORD</code> で管理されています。
            変更する場合は Vercel ダッシュボード（Settings → Environment Variables）から行ってください。
          </p>
        </div>

        {/* Payment */}
        <div className="card p-4">
          <h3 className="text-sm font-bold mb-4 pb-2" style={{ color: 'var(--text-secondary)', borderBottom: '1px solid var(--border-color)' }}>決済設定</h3>
          <div className="space-y-3">
            <Field label="映像販売価格" settingsKey="video_price" type="number" />
            <Field label="Square App ID" settingsKey="square_app_id" />
            <Field label="Square Location ID" settingsKey="square_location_id" />
            <Field label="PayPal リンク" settingsKey="paypal_link" />
          </div>
        </div>

        {/* Time offset */}
        <div className="card p-4">
          <h3 className="text-sm font-bold mb-4 pb-2" style={{ color: 'var(--text-secondary)', borderBottom: '1px solid var(--border-color)' }}>🎭 舞台進行タイムオフセット</h3>
          <p className="text-xs mb-3" style={{ color: 'var(--text-muted)' }}>当日の進行が巻き/押しの場合に調整。+で遅れ、-で巻き。</p>
          <div className="flex items-center justify-center gap-3 mb-3">
            <button onClick={() => update('time_offset_min', String(Number(settings.time_offset_min || '0') - 5))} className="w-12 h-12 rounded-xl text-xl font-bold" style={{ background: 'var(--bg-hover)', color: 'var(--text-primary)', border: '1px solid var(--border-color)' }}>-5</button>
            <button onClick={() => update('time_offset_min', String(Number(settings.time_offset_min || '0') - 1))} className="w-10 h-10 rounded-lg text-lg font-bold" style={{ background: 'var(--bg-hover)', color: 'var(--text-primary)', border: '1px solid var(--border-color)' }}>-1</button>
            <div className="text-center min-w-[80px]">
              <div className="text-3xl font-black" style={{ color: Number(settings.time_offset_min || '0') === 0 ? 'var(--text-primary)' : Number(settings.time_offset_min || '0') > 0 ? '#e07b2d' : '#22c55e' }}>
                {Number(settings.time_offset_min || '0') > 0 ? '+' : ''}{settings.time_offset_min || '0'}
              </div>
              <div className="text-[10px] uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>分</div>
            </div>
            <button onClick={() => update('time_offset_min', String(Number(settings.time_offset_min || '0') + 1))} className="w-10 h-10 rounded-lg text-lg font-bold" style={{ background: 'var(--bg-hover)', color: 'var(--text-primary)', border: '1px solid var(--border-color)' }}>+1</button>
            <button onClick={() => update('time_offset_min', String(Number(settings.time_offset_min || '0') + 5))} className="w-12 h-12 rounded-xl text-xl font-bold" style={{ background: 'var(--bg-hover)', color: 'var(--text-primary)', border: '1px solid var(--border-color)' }}>+5</button>
          </div>
          <button onClick={() => update('time_offset_min', '0')} className="w-full py-1.5 rounded-lg text-xs font-medium" style={{ background: 'var(--bg-hover)', color: 'var(--text-secondary)', border: '1px solid var(--border-color)' }}>リセット（±0）</button>
        </div>

        {/* Section visibility */}
        <div className="card p-4 md:col-span-2">
          <h3 className="text-sm font-bold mb-2 pb-2" style={{ color: 'var(--text-secondary)', borderBottom: '1px solid var(--border-color)' }}>
            <span className="mr-2">👁️</span>公開制御（セクション表示/非表示）
          </h3>
          <p className="text-xs mb-4" style={{ color: 'var(--text-muted)' }}>OFFにしたセクションは「Coming Soon」表示になります。当日のタイミングでONに切り替えてください。</p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-1">
            <Toggle label="🗓️ タイムテーブル" settingsKey="section_schedule_visible" />
            <Toggle label="🛍️ グッズ販売" settingsKey="section_merch_visible" />
            <Toggle label="🎬 映像データ" settingsKey="section_video_visible" />
            <Toggle label="🎵 音源" settingsKey="section_music_visible" />
            <Toggle label="⭐ 投票" settingsKey="section_vote_visible" />
            <Toggle label="📱 SNS" settingsKey="section_sns_visible" />
            <Toggle label="🎰 くじ引きセクション" settingsKey="lottery_section_visible" />
          </div>
        </div>

        {/* Lottery */}
        <div className="card p-4 md:col-span-2" style={{ borderColor: 'rgba(242,122,26,0.5)', borderWidth: '2px' }}>
          <h3 className="text-sm font-bold mb-2 pb-2" style={{ color: 'var(--text-secondary)', borderBottom: '1px solid var(--border-color)' }}>
            <span className="mr-2">🎰</span>くじ引き運営コントロール
          </h3>
          <p className="text-xs mb-4" style={{ color: 'var(--text-muted)' }}>MCの合図でON、時間が来たらOFF。キーワードはMCが当日マイクで発表する文字列。</p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div><Toggle label="受付ON/OFF（くじ引き可能）" settingsKey="lottery_active" /></div>
            <Field label="キーワード（MCが当日発表）" settingsKey="lottery_keyword" />
            <Field label="景品名" settingsKey="lottery_prize_name" />
            <Field label="景品画像URL" settingsKey="lottery_prize_image" />
            <Field label="当選確率（0-1、例: 0.10 = 10%）" settingsKey="lottery_probability" />
            <Field label="当選数上限" settingsKey="lottery_winners_cap" type="number" />
          </div>
          <div className="mt-4 p-3 rounded-lg text-xs" style={{ background: 'var(--bg-hover)', color: 'var(--text-secondary)' }}>
            👉 当選者一覧は <a href="/admin/lottery-winners" className="underline" style={{ color: 'var(--accent-primary)' }}>/admin/lottery-winners</a> で確認できます
          </div>
        </div>

        {/* Feature toggles */}
        <div className="card p-4">
          <h3 className="text-sm font-bold mb-4 pb-2" style={{ color: 'var(--text-secondary)', borderBottom: '1px solid var(--border-color)' }}>機能トグル</h3>
          <div className="space-y-1">
            <Toggle label="投票機能" settingsKey="vote_enabled" />
            <Toggle label="音源セクション" settingsKey="music_enabled" />
            <Toggle label="グッズ販売" settingsKey="merch_enabled" />
            <Toggle label="映像販売" settingsKey="video_enabled" />
          </div>
        </div>
      </div>
    </div>
  );
}
