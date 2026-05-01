import { NextRequest, NextResponse } from 'next/server';
import { getAll, getOne, execute } from '@/lib/db';

export const dynamic = 'force-dynamic';

// GET /api/lottery — return public lottery status
// GET /api/lottery?fingerprint=XXX — also include this user's entry (if any)
export async function GET(req: NextRequest) {
  try {
    const settings = await getAll(
      "SELECT key, value FROM settings WHERE key LIKE 'lottery_%'"
    );
    const map: Record<string, string> = {};
    for (const row of settings as { key: string; value: string }[]) {
      map[row.key] = row.value;
    }

    // Count winners so far (atomic-ish for fairness display)
    const winsRow = await getOne('SELECT COUNT(*) as c FROM lottery_entries WHERE won = 1');
    const winners_count = Number(winsRow?.c ?? 0);
    const cap = Number(map.lottery_winners_cap || 10);

    const fingerprint = req.nextUrl.searchParams.get('fingerprint');
    let entry = null;
    if (fingerprint) {
      entry = await getOne(
        'SELECT won, prize_name, prize_tier, winner_name, created_at FROM lottery_entries WHERE fingerprint = ?',
        [fingerprint]
      );
    }

    return NextResponse.json({
      active: map.lottery_active === '1',
      visible: map.lottery_section_visible === '1',
      prize_name: map.lottery_prize_name || '',
      prize_image: map.lottery_prize_image || '',
      winners_count,
      winners_cap: cap,
      sold_out: winners_count >= cap,
      probability: Number(map.lottery_probability || 0.1),
      entry,
    });
  } catch (e) {
    console.error('lottery GET err', e);
    return NextResponse.json({ error: 'Failed' }, { status: 500 });
  }
}

// PATCH /api/lottery — set winner name on an existing entry
export async function PATCH(req: NextRequest) {
  try {
    const body = await req.json();
    const { fingerprint, winner_name } = body;
    if (!fingerprint || !winner_name) {
      return NextResponse.json({ error: 'fingerprint & winner_name required' }, { status: 400 });
    }
    await execute(
      'UPDATE lottery_entries SET winner_name = ? WHERE fingerprint = ?',
      [String(winner_name).slice(0, 50), fingerprint]
    );
    return NextResponse.json({ success: true });
  } catch (e) {
    console.error('lottery PATCH err', e);
    return NextResponse.json({ error: 'Failed' }, { status: 500 });
  }
}

// POST /api/lottery — submit an entry
// body: { fingerprint, keyword }
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { fingerprint, keyword } = body;
    if (!fingerprint) {
      return NextResponse.json({ error: 'fingerprint required' }, { status: 400 });
    }

    // Load lottery settings
    const settingsRows = await getAll(
      "SELECT key, value FROM settings WHERE key LIKE 'lottery_%'"
    );
    const m: Record<string, string> = {};
    for (const row of settingsRows as { key: string; value: string }[]) {
      m[row.key] = row.value;
    }

    // 開始時刻ゲート — 5/5 14:30 (JST) 以降のみ
    // ?stage= プレビューでテスト中は通す
    const url = new URL(req.url);
    const stagePreview = url.searchParams.get('stage');
    const isPreviewBypass = stagePreview === 'show' || stagePreview === 'closed';
    const LOTTERY_START_MS = new Date('2026-05-05T14:30:00+09:00').getTime();
    if (!isPreviewBypass && Date.now() < LOTTERY_START_MS) {
      return NextResponse.json({
        error: '5/5 14:30 から解禁します',
        reason: 'not_started',
        starts_at: '2026-05-05T14:30:00+09:00',
      }, { status: 403 });
    }

    if (m.lottery_active !== '1') {
      return NextResponse.json({ error: '現在くじ引きは受付していません' }, { status: 403 });
    }

    if ((keyword || '').trim() !== (m.lottery_keyword || '')) {
      return NextResponse.json({
        error: 'シークレットコードが違います',
        reason: 'wrong_keyword',
      }, { status: 400 });
    }

    // Check if already entered
    const existing = await getOne(
      'SELECT id, won, prize_name FROM lottery_entries WHERE fingerprint = ?',
      [fingerprint]
    );
    if (existing) {
      return NextResponse.json(
        {
          error: 'すでに参加済みです',
          already: true,
          won: existing.won === 1,
          prize_name: existing.prize_name,
        },
        { status: 409 }
      );
    }

    // Get IP for logging
    const ip =
      req.headers.get('x-forwarded-for')?.split(',')[0].trim() ||
      req.headers.get('x-real-ip') ||
      '';

    // Roll dice
    const probability = Number(m.lottery_probability || 0.1);
    const roll = Math.random();
    const passedRoll = roll < probability;

    // If won the dice, check cap and assign tier (jackpot vs normal)
    let won = 0;
    let prize_name = '';
    let prize_tier: 'normal' | 'jackpot' = 'normal';
    if (passedRoll) {
      const cap = Number(m.lottery_winners_cap || 10);
      const winsNow = await getOne('SELECT COUNT(*) as c FROM lottery_entries WHERE won = 1');
      const current = Number(winsNow?.c ?? 0);
      if (current < cap) {
        won = 1;
        // Determine if THIS winner (position = current + 1) is the jackpot
        const jackpotPos = Number(m.lottery_jackpot_position || 0);
        const myPosition = current + 1;
        if (jackpotPos > 0 && myPosition === jackpotPos) {
          prize_tier = 'jackpot';
          prize_name = m.lottery_jackpot_prize_name || '🎊 大当たり！物販で好きなアイテム1つ無料 🎊';
        } else {
          prize_tier = 'normal';
          prize_name = m.lottery_normal_prize_name || m.lottery_prize_name || 'きらきらシール スペシャルバージョン';
        }
      }
    }

    const result = await execute(
      'INSERT INTO lottery_entries (fingerprint, ip, won, prize_name, keyword_used, prize_tier) VALUES (?, ?, ?, ?, ?, ?)',
      [fingerprint, ip, won, prize_name, keyword || '', prize_tier]
    );

    return NextResponse.json({
      success: true,
      entry_id: Number(result.lastInsertRowid ?? 0),
      won: won === 1,
      prize_name,
      prize_tier,
      message: won === 1
        ? (prize_tier === 'jackpot' ? `🎊 大当たり！「${prize_name}」` : `🎉 当選！「${prize_name}」`)
        : 'はずれ…またチャレンジしてね',
    });
  } catch (e) {
    console.error('lottery POST err', e);
    return NextResponse.json({ error: 'Failed' }, { status: 500 });
  }
}
