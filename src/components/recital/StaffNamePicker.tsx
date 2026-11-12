'use client';

// BW6 発表会のスタッフの「だれが押したか」を選ぶ欄。最後に選んだ名前を localStorage に覚える
// （読めない・書けない時も画面は動く）。入力欄は文字色と下地色を両方決める（CLAUDE.md 11）。
import { useEffect } from 'react';
import { RECITAL_STAFF_NAMES } from '@/lib/recital';

const STORAGE_KEY = 'recital_staff_name';

export default function StaffNamePicker(props: { value: string; onChange: (name: string) => void }) {
  const { value, onChange } = props;

  useEffect(() => {
    let saved: string | null = null;
    try { saved = window.localStorage.getItem(STORAGE_KEY); } catch { /* 読めなくても動く */ }
    if (saved && RECITAL_STAFF_NAMES.includes(saved)) onChange(saved);
    // マウントの時に1回だけ入れる
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <select
      value={value}
      onChange={(e) => {
        const name = e.target.value;
        try { window.localStorage.setItem(STORAGE_KEY, name); } catch { /* 書けなくても動く */ }
        onChange(name);
      }}
      className="rounded-md border border-sand-300 bg-white px-2 py-1 text-base text-navy-900"
      aria-label="押す人の名前"
    >
      <option value="">名前を選んでください</option>
      {RECITAL_STAFF_NAMES.map((n) => (
        <option key={n} value={n}>{n}</option>
      ))}
    </select>
  );
}
