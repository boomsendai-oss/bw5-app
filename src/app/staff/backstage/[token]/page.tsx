'use client';

import { useState, useEffect } from 'react';
import { useParams } from 'next/navigation';
import { Camera, Upload, Trash2, Loader2, ImageOff } from 'lucide-react';
import Image from 'next/image';

interface Photo {
  id: number;
  image_url: string;
  caption: string;
  uploaded_at: string;
}

export default function BackstageUploadPage() {
  const params = useParams();
  const token = params.token as string;

  const [photos, setPhotos] = useState<Photo[]>([]);
  const [uploading, setUploading] = useState(false);
  const [caption, setCaption] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [error, setError] = useState('');

  const load = async () => {
    const res = await fetch('/api/backstage');
    const data = await res.json();
    setPhotos(data.photos || []);
  };

  useEffect(() => {
    load();
    const id = setInterval(load, 10000);
    return () => clearInterval(id);
  }, []);

  const handleFile = (f: File | null) => {
    setFile(f);
    setPreview(f ? URL.createObjectURL(f) : null);
  };

  const submit = async () => {
    if (!file || uploading) return;
    setUploading(true);
    setError('');
    try {
      const fd = new FormData();
      fd.append('file', file);
      fd.append('caption', caption);
      const res = await fetch(`/api/backstage?token=${encodeURIComponent(token)}`, {
        method: 'POST',
        body: fd,
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || 'Upload failed');
      } else {
        setFile(null);
        setPreview(null);
        setCaption('');
        load();
      }
    } catch (e) {
      setError('ネットワークエラー');
    } finally {
      setUploading(false);
    }
  };

  const remove = async (id: number) => {
    if (!confirm('この写真を削除しますか？')) return;
    await fetch(`/api/backstage?token=${encodeURIComponent(token)}&id=${id}`, {
      method: 'DELETE',
    });
    load();
  };

  return (
    <div className="min-h-screen p-4 sm:p-6" style={{ background: 'linear-gradient(135deg, #1f2937 0%, #111827 100%)' }}>
      <div className="max-w-2xl mx-auto">
        <div className="flex items-center gap-3 mb-4">
          <Camera size={28} className="text-orange-400" />
          <h1 className="text-2xl font-black text-white">舞台裏写真アップロード</h1>
        </div>

        {/* Upload form */}
        <div className="rounded-2xl p-4 mb-6" style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.12)' }}>
          <input
            type="file"
            accept="image/*"
            capture="environment"
            onChange={(e) => handleFile(e.target.files?.[0] || null)}
            className="hidden"
            id="backstage-camera"
          />
          <input
            type="file"
            accept="image/*"
            onChange={(e) => handleFile(e.target.files?.[0] || null)}
            className="hidden"
            id="backstage-gallery"
          />

          {!preview ? (
            <div className="grid grid-cols-2 gap-3">
              <label
                htmlFor="backstage-camera"
                className="block py-10 rounded-xl text-center cursor-pointer transition-all"
                style={{ background: 'rgba(242,122,26,0.18)', border: '2px dashed rgba(242,122,26,0.4)' }}
              >
                <Camera size={28} className="mx-auto mb-2 text-orange-400" />
                <p className="text-xs font-bold text-orange-200">📷 カメラで撮影</p>
              </label>
              <label
                htmlFor="backstage-gallery"
                className="block py-10 rounded-xl text-center cursor-pointer transition-all"
                style={{ background: 'rgba(96,165,250,0.18)', border: '2px dashed rgba(96,165,250,0.4)' }}
              >
                <Camera size={28} className="mx-auto mb-2 text-blue-400" />
                <p className="text-xs font-bold text-blue-200">🖼 ライブラリから選ぶ</p>
              </label>
            </div>
          ) : (
            <div>
              <div className="relative w-full" style={{ aspectRatio: '4 / 3' }}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={preview} alt="preview" className="w-full h-full object-cover rounded-xl" />
              </div>
              <input
                type="text"
                value={caption}
                onChange={(e) => setCaption(e.target.value)}
                placeholder="スタッフ用メモ（任意・非公開）"
                className="mt-3 w-full px-3 py-2 rounded-xl text-sm bg-white/10 text-white placeholder:text-white/40 outline-none border border-white/15"
                maxLength={80}
              />
              <p className="mt-1.5 text-[10px] text-white/50 leading-snug">
                🔒 このメモはスタッフ画面でしか見えません。お客さん側のアプリには<strong className="text-white/80">表示されない</strong>ので、整理用に自由に書いてOK（誰が・いつ・どこで など）。
              </p>
              <div className="flex gap-2 mt-3">
                <button
                  onClick={() => { setFile(null); setPreview(null); setCaption(''); }}
                  className="flex-1 py-3 rounded-xl text-sm font-bold text-white/80"
                  style={{ background: 'rgba(255,255,255,0.08)' }}
                  disabled={uploading}
                >
                  キャンセル
                </button>
                <button
                  onClick={submit}
                  disabled={uploading}
                  className="flex-[2] py-3 rounded-xl text-sm font-bold text-white flex items-center justify-center gap-2"
                  style={{ background: '#f27a1a' }}
                >
                  {uploading ? <Loader2 size={16} className="animate-spin" /> : <Upload size={16} />}
                  {uploading ? 'アップ中...' : 'アップロード'}
                </button>
              </div>
            </div>
          )}

          {error && <p className="mt-2 text-xs text-red-400">{error}</p>}
        </div>

        {/* Recent uploads */}
        <h2 className="text-sm font-bold text-white/80 mb-3">最近の投稿（{photos.length}枚）</h2>
        {photos.length === 0 ? (
          <div className="text-center py-12 text-white/40">
            <ImageOff size={32} className="mx-auto mb-2" />
            <p className="text-sm">まだ写真がありません</p>
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            {photos.map((p) => (
              <div key={p.id} className="relative rounded-xl overflow-hidden group" style={{ background: 'rgba(255,255,255,0.06)' }}>
                <div className="relative w-full" style={{ aspectRatio: '1 / 1' }}>
                  <Image src={p.image_url} alt={p.caption} fill className="object-cover" sizes="(max-width: 640px) 50vw, 200px" unoptimized />
                </div>
                {p.caption && (
                  <p className="px-2 py-1.5 text-[10px] text-white/80 truncate">{p.caption}</p>
                )}
                <button
                  onClick={() => remove(p.id)}
                  className="absolute top-1.5 right-1.5 w-7 h-7 rounded-full bg-black/60 flex items-center justify-center"
                >
                  <Trash2 size={12} className="text-red-400" />
                </button>
              </div>
            ))}
          </div>
        )}

        <div className="mt-6 p-3 rounded-xl text-[11px] text-white/60" style={{ background: 'rgba(0,0,0,0.3)' }}>
          📌 このページのURLはスタッフ間で共有OK。客側のアプリにはタブ表示されません。<br />
          📌 アップロードした写真は自動でアプリに反映されます（4-5秒ごとに切り替わり表示）。
        </div>
      </div>
    </div>
  );
}
