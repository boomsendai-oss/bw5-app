// 配信の視聴ページで「横向き全画面」にするときの枠の見た目。DOMには触らない。
//
// ⚠️ iPhoneのSafariは動画以外の要素を本物の全画面にできず、埋め込みプレーヤー(別ドメインのiframe)の
//    中の動画にも手が届かない。なので画面に貼り付けた枠を、縦持ちなら90度回して横長に見せる。
//    本物の全画面・画面の向きの固定が使える端末(Android等)では、それも合わせて使う(呼び出し側)。
import type { CSSProperties } from 'react';

export function streamFullscreenStyle(portrait: boolean): CSSProperties {
  return {
    position: 'fixed',
    left: '50%',
    top: '50%',
    width: portrait ? '100dvh' : '100dvw',
    height: portrait ? '100dvw' : '100dvh',
    transform: portrait ? 'translate(-50%, -50%) rotate(90deg)' : 'translate(-50%, -50%)',
    zIndex: 60,
    background: '#000',
  };
}
