// ⚠️ 公開API(認証なし)。理由: クリスマスパーティー2026の出演チーム(外部の子を含む)が
// 控えページ /xmas/my から音源をアップロードするため。
// 認可は申込の edit_token(clientPayload)で行う: 確定済み(paid/cash_due)のエントリー・
// 音源締切前・音声ファイル・50MBまでのときだけ、そのチーム専用の保存先へのトークンを発行する。
// 音源は関数の本文上限(4.5MB)を超えるため、Vercel Blob のクライアント直接アップロードを使う。
import { NextRequest, NextResponse } from 'next/server';
import { handleUpload, type HandleUploadBody } from '@vercel/blob/client';
import { checkRateLimit, clientIp, tooManyRequests } from '@/lib/eventAuth';
import { PARTY_EVENT_KEY, audioOpen } from '@/lib/party';
import { getPartySettings, loadConfirmedEntryById, savePartyAudioById } from '@/lib/partyDb';
import { resolveAudioCredential } from '@/lib/partyAudio';

export const dynamic = 'force-dynamic';

const MAX_BYTES = 50 * 1024 * 1024;

export async function POST(req: NextRequest) {
  if (!(await checkRateLimit(`xmasaudio:${clientIp(req)}`, 30, 3600))) return tooManyRequests();
  let body: HandleUploadBody;
  try {
    body = (await req.json()) as HandleUploadBody;
  } catch {
    return NextResponse.json({ error: 'invalid body' }, { status: 400 });
  }
  try {
    const result = await handleUpload({
      body,
      request: req,
      onBeforeGenerateToken: async (pathname, clientPayload) => {
        // clientPayload = 控えページのトークン or 提出ページで発行した短時間の通行証
        const o = await resolveAudioCredential(clientPayload ?? '');
        if (!o) throw new Error('エントリーが確定していないか、時間が経ちすぎました。もう一度チームを探してください');
        if (!audioOpen(await getPartySettings(PARTY_EVENT_KEY), new Date())) {
          throw new Error('音源の提出は締め切りました');
        }
        if (!pathname.startsWith(`${PARTY_EVENT_KEY}/audio/${o.id}-`)) throw new Error('保存先が正しくありません');
        return {
          allowedContentTypes: ['audio/*', 'video/mp4'],
          maximumSizeInBytes: MAX_BYTES,
          addRandomSuffix: true,
          // tokenPayload はブラウザから読めるので、控えページのトークンではなく申込IDだけを載せる
          tokenPayload: String(o.id),
        };
      },
      // 本番では完了通知でも保存する(画面側の保存が通信切れで落ちたときの保険)。冪等
      onUploadCompleted: async ({ blob, tokenPayload }) => {
        if (!tokenPayload || !/^\d+$/.test(tokenPayload)) return;
        // 画面側の保存(元のファイル名つき)が先に済んでいれば何もしない
        const cur = await loadConfirmedEntryById(Number(tokenPayload));
        if (!cur || cur.audioUrl === blob.url) return;
        const name = decodeURIComponent(blob.pathname.split('/').pop() ?? '')
          .replace(/^\d+-/, '')
          .replace(/-[A-Za-z0-9]{16,}(?=\.[^.]+$)/, '');
        await savePartyAudioById(cur.id, blob.url, name);
      },
    });
    return NextResponse.json(result);
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'upload failed' }, { status: 400 });
  }
}
