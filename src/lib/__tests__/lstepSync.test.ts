import { describe, it, expect } from 'vitest';
import { lstepMissingColumns, buildLstepUpsertSql } from '../lstepSync';

// 2026-07-27 に実際に起きた事故:
// Lstep友だちCSVのエクスポート項目が「ID / 表示名」の2列だけに縮んでいたため、
// 6時間ごとの同期が system_display_name / line_register_name / real_name /
// last_message_at を null で、blocked を 0 で上書きし続け、813人全員のデータが消えた。
// 「CSVに列が無い」は「値が空」とは別物なので、列が無いなら DB を触らないのが正しい。
describe('buildLstepUpsertSql', () => {
  const ALL = ['ID', '表示名', 'システム表示名', 'LINE登録名', '本名', 'ユーザーブロック', '最終メッセージ日時'];

  it('全項目そろったCSVなら全列を更新する', () => {
    const sql = buildLstepUpsertSql(ALL);
    for (const col of ['display_name', 'system_display_name', 'line_register_name', 'real_name', 'blocked', 'last_message_at']) {
      expect(sql).toContain(`${col}=excluded.${col}`);
    }
  });

  it('CSVに無い列は UPDATE 対象から外す(既存値を消さない)', () => {
    const sql = buildLstepUpsertSql(['ID', '表示名']);
    expect(sql).toContain('display_name=excluded.display_name');
    for (const col of ['system_display_name', 'line_register_name', 'real_name', 'blocked', 'last_message_at']) {
      expect(sql).not.toContain(`${col}=excluded.${col}`);
    }
  });

  it('display_name も無い極端なCSVでも SQL として成立する(updated_at は常に更新)', () => {
    const sql = buildLstepUpsertSql(['ID']);
    expect(sql).toContain('updated_at=CURRENT_TIMESTAMP');
    expect(sql).not.toContain('=excluded.');
    expect(sql).toContain('ON CONFLICT(lstep_id) DO UPDATE SET');
  });

  it('INSERT 側は常に全列を並べる(新規行は消すべき既存値が無い)', () => {
    const sql = buildLstepUpsertSql(['ID', '表示名']);
    expect(sql).toContain('lstep_id, display_name, system_display_name, line_register_name, real_name');
    expect(sql).toContain('VALUES (?,?,?,?,?,?,?,?, CURRENT_TIMESTAMP)');
  });
});

describe('lstepMissingColumns', () => {
  it('欠けているCSV列名を返す(運用に見せて黙って壊れないようにする)', () => {
    expect(lstepMissingColumns(['ID', '表示名'])).toEqual([
      'システム表示名', 'LINE登録名', '本名', 'ユーザーブロック', '最終メッセージ日時',
    ]);
  });

  it('全部そろっていれば空配列', () => {
    expect(lstepMissingColumns(['ID', '表示名', 'システム表示名', 'LINE登録名', '本名', 'ユーザーブロック', '最終メッセージ日時'])).toEqual([]);
  });
});
