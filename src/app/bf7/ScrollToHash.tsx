'use client';

// /bf7#workshop で開いたとき、画像や上の欄の読み込みで位置がずれて欄まで届かないので、
// 読み込み後にもう一度その欄へ移動する(WS告知画像のQRが /bf7#workshop に飛ぶため)。
import { useEffect } from 'react';

export default function ScrollToHash({ id }: { id: string }) {
  useEffect(() => {
    if (window.location.hash !== `#${id}`) return;
    const go = () => document.getElementById(id)?.scrollIntoView({ block: 'start' });
    const t1 = window.setTimeout(go, 150);
    const t2 = window.setTimeout(go, 900);
    window.addEventListener('load', go, { once: true });
    return () => {
      window.clearTimeout(t1);
      window.clearTimeout(t2);
      window.removeEventListener('load', go);
    };
  }, [id]);
  return null;
}
