'use client';

import { Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

// ─── Types ───────────────────────────────────────────────────────────────────

type MemberInfo = {
  id: number;
  hacomono_member_id: string;
  full_name: string;
  full_name_kana: string;
  status: string;
  plan_name: string | null;
};

type AutoCandidate = {
  lstep_id: string;
  system_display_name: string;
  line_register_name: string;
  score: number;
  confidence: '高' | '中';
  reasons: string[];
  relation_suggestion: '本人' | '保護者' | '講師';
  line_type: string;
  source: string;
};

type SearchResult = {
  lstep_id: string;
  display_name: string | null;
  system_display_name: string | null;
  real_name: string | null;
  line_register_name: string | null;
};

// ─── Page Component ──────────────────────────────────────────────────────────

export default function ManualLinkPage() {
  return (
    <Suspense fallback={<div className="p-6 text-center text-muted-foreground">読み込み中...</div>}>
      <ManualLinkPageInner />
    </Suspense>
  );
}

function ManualLinkPageInner() {
  const searchParams = useSearchParams();
  const memberId = searchParams.get('member_id');
  const notificationId = searchParams.get('notification_id');

  // Member info
  const [member, setMember] = useState<MemberInfo | null>(null);
  const [memberLoading, setMemberLoading] = useState(true);
  const [memberError, setMemberError] = useState('');

  // Search
  const [query, setQuery] = useState('');
  const [autoCandidates, setAutoCandidates] = useState<AutoCandidate[]>([]);
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Link action
  const [linkingId, setLinkingId] = useState<string | null>(null);
  const [selectedRelation, setSelectedRelation] = useState<string>('');
  const [parentName, setParentName] = useState(''); // 保護者選択時の親名(カナ推奨)
  const [linking, setLinking] = useState(false);
  const [success, setSuccess] = useState(false);
  const [linkError, setLinkError] = useState('');

  // ─── Load member info + auto-suggestions ─────────────────────────────────
  useEffect(() => {
    if (!memberId) {
      setMemberLoading(false);
      setMemberError('member_id が指定されていません');
      return;
    }
    (async () => {
      try {
        const res = await fetch(
          `/api/staff/notifications/link-search?member_id=${memberId}`
        );
        if (!res.ok) throw new Error('会員情報の取得に失敗しました');
        const data = await res.json();
        if (data.member) {
          setMember(data.member as MemberInfo);
        } else {
          setMemberError('会員が見つかりませんでした');
        }
        setAutoCandidates(data.auto_suggestions ?? []);
      } catch (e) {
        setMemberError(e instanceof Error ? e.message : '読み込みエラー');
      } finally {
        setMemberLoading(false);
      }
    })();
  }, [memberId]);

  // ─── Debounced search ───────────────────────────────────────────────────
  const doSearch = useCallback(
    async (q: string) => {
      if (q.length < 1) {
        setSearchResults([]);
        setSearching(false);
        return;
      }
      setSearching(true);
      try {
        const params = new URLSearchParams({ q });
        if (memberId) params.set('member_id', memberId);
        const res = await fetch(
          `/api/staff/notifications/link-search?${params.toString()}`
        );
        if (res.ok) {
          const data = await res.json();
          setSearchResults(data.search_results ?? []);
          // Also update auto-suggestions if they come back
          if (data.auto_suggestions?.length > 0) {
            setAutoCandidates(data.auto_suggestions);
          }
        }
      } catch {
        // silent
      } finally {
        setSearching(false);
      }
    },
    [memberId]
  );

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => doSearch(query), 300);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query, doSearch]);

  // ─── Link action ────────────────────────────────────────────────────────
  const handleLink = async (lstepId: string) => {
    if (!member || !selectedRelation) return;
    setLinking(true);
    setLinkError('');
    try {
      const res = await fetch('/api/staff/operations/link', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          member_id: member.id,
          lstep_id: lstepId,
          relation: selectedRelation,
          confidence: '確実',
          parent_name: selectedRelation === '保護者' ? parentName : '',
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({ error: '紐付けに失敗しました' }));
        throw new Error(data.error ?? '紐付けに失敗しました');
      }

      // Acknowledge notification if notification_id is provided
      if (notificationId) {
        try {
          await fetch('/api/staff/notifications', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id: Number(notificationId) }),
          });
        } catch {
          // non-critical — linking succeeded
        }
      }

      setSuccess(true);
      setLinkingId(null);
    } catch (e) {
      setLinkError(e instanceof Error ? e.message : '紐付けに失敗しました');
    } finally {
      setLinking(false);
    }
  };

  // ─── Start link flow for a candidate ────────────────────────────────────
  const startLink = (lstepId: string, suggestedRelation?: string) => {
    setLinkingId(lstepId);
    setSelectedRelation(suggestedRelation ?? '');
    setLinkError('');
  };

  // ─── Render ─────────────────────────────────────────────────────────────

  if (success) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-6">
        <div className="rounded-xl border border-green-200 bg-green-50 p-8 text-center">
          <p className="mb-2 text-2xl">&#x2705;</p>
          <h2 className="mb-2 text-lg font-bold text-green-800">
            紐付けが完了しました
          </h2>
          <p className="mb-6 text-sm text-green-600">
            {member?.full_name} の LINE 紐付けが保存されました。
          </p>
          <Link href="/staff/notifications">
            <Button variant="outline">通知フィードに戻る</Button>
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl px-4 py-6">
      {/* Header */}
      <div className="mb-6 flex items-center gap-3">
        <Link
          href="/staff/notifications"
          className="text-sm text-gray-500 hover:text-orange-600"
        >
          &larr; 通知フィード
        </Link>
      </div>
      <h1 className="mb-6 text-2xl font-bold text-gray-900">
        手動 LINE 紐付け
      </h1>

      {/* Member Info Card */}
      {memberLoading && (
        <div className="mb-6 rounded-xl border border-gray-200 bg-gray-50 p-4 text-center text-gray-500">
          読み込み中...
        </div>
      )}
      {memberError && (
        <div className="mb-6 rounded-xl border border-red-200 bg-red-50 p-4 text-center text-red-600">
          {memberError}
        </div>
      )}
      {member && (
        <Card className="mb-6">
          <CardContent>
            <div className="flex items-start justify-between">
              <div>
                <p className="text-lg font-bold text-gray-900">
                  {member.full_name}
                </p>
                <p className="text-sm text-gray-500">{member.full_name_kana}</p>
              </div>
              <Badge
                variant={member.status === 'active' ? 'default' : 'secondary'}
                className={
                  member.status === 'active'
                    ? 'bg-green-100 text-green-800'
                    : ''
                }
              >
                {member.status === 'active' ? '在籍' : member.status}
              </Badge>
            </div>
            <div className="mt-3 flex flex-wrap gap-x-6 gap-y-1 text-xs text-gray-500">
              <span>HACOMONO ID: {member.hacomono_member_id}</span>
              {member.plan_name && <span>プラン: {member.plan_name}</span>}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Search Box */}
      {member && (
        <>
          <div className="mb-4">
            <label
              htmlFor="search-friends"
              className="mb-1 block text-sm font-medium text-gray-700"
            >
              Lstep 友だちを検索
            </label>
            <Input
              id="search-friends"
              type="text"
              placeholder="名前で検索..."
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="w-full"
            />
            {searching && (
              <p className="mt-1 text-xs text-gray-400">検索中...</p>
            )}
          </div>

          {/* Auto Suggestions */}
          {autoCandidates.length > 0 && (
            <div className="mb-6">
              <h2 className="mb-3 flex items-center gap-2 text-sm font-bold text-gray-700">
                <span>&#x1F916;</span> 自動候補
              </h2>
              <div className="flex flex-col gap-2">
                {autoCandidates.map((c) => (
                  <Card key={`auto-${c.lstep_id}`} className="border-orange-200 bg-orange-50/30">
                    <CardContent>
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="text-sm font-semibold text-gray-900">
                            LINE「{c.line_register_name || c.system_display_name || '(名前なし)'}」
                          </p>
                          <p className="text-xs text-gray-600">
                            現在の表示名: {c.system_display_name || '(未設定)'}
                          </p>
                          <p className="mt-1 text-xs text-gray-400">
                            ID: {c.lstep_id}
                          </p>
                        </div>
                        <div className="flex shrink-0 flex-col items-end gap-1">
                          <div className="flex items-center gap-1">
                            <Badge
                              variant={c.confidence === '高' ? 'default' : 'secondary'}
                              className={
                                c.confidence === '高'
                                  ? 'bg-orange-500 text-white'
                                  : 'bg-amber-100 text-amber-800'
                              }
                            >
                              {c.confidence === '高' ? '高確度' : '中確度'}
                            </Badge>
                            <span className="text-xs text-gray-400">
                              {c.score}pt
                            </span>
                          </div>
                          <span className="text-xs text-gray-500">
                            {c.relation_suggestion} / {c.source}
                          </span>
                        </div>
                      </div>
                      {c.reasons.length > 0 && (
                        <div className="mt-2 flex flex-wrap gap-1">
                          {c.reasons.map((r, i) => (
                            <span
                              key={i}
                              className="rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-600"
                            >
                              {r}
                            </span>
                          ))}
                        </div>
                      )}
                      {/* Link action */}
                      <div className="mt-3">
                        {linkingId === c.lstep_id ? (
                          <div className="flex items-center gap-2">
                            <Select
                              value={selectedRelation}
                              onValueChange={setSelectedRelation}
                            >
                              <SelectTrigger className="h-8 w-32 text-xs">
                                <SelectValue placeholder="関係を選択" />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="本人">本人</SelectItem>
                                <SelectItem value="保護者">保護者</SelectItem>
                                <SelectItem value="講師">講師</SelectItem>
                              </SelectContent>
                            </Select>
                            {selectedRelation === '保護者' && (
                              <input
                                type="text"
                                value={parentName}
                                placeholder="親の名前(カナ) 例: コムカイ アサミ"
                                onChange={(e) => setParentName(e.target.value)}
                                className="h-8 w-44 rounded border px-2 text-xs"
                              />
                            )}
                            <Button
                              size="xs"
                              disabled={!selectedRelation || linking}
                              onClick={() => handleLink(c.lstep_id)}
                              className="bg-orange-500 text-white hover:bg-orange-600"
                            >
                              {linking ? '処理中...' : '確定'}
                            </Button>
                            <Button
                              size="xs"
                              variant="ghost"
                              onClick={() => setLinkingId(null)}
                            >
                              キャンセル
                            </Button>
                          </div>
                        ) : (
                          <Button
                            size="xs"
                            variant="outline"
                            className="border-orange-300 text-orange-600 hover:bg-orange-50"
                            onClick={() =>
                              startLink(c.lstep_id, c.relation_suggestion)
                            }
                          >
                            紐付け
                          </Button>
                        )}
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            </div>
          )}

          {/* Search Results */}
          {searchResults.length > 0 && (
            <div className="mb-6">
              <h2 className="mb-3 flex items-center gap-2 text-sm font-bold text-gray-700">
                <span>&#x1F50D;</span> 検索結果
              </h2>
              <div className="flex flex-col gap-2">
                {searchResults.map((r) => (
                  <Card key={`search-${r.lstep_id}`}>
                    <CardContent>
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="text-sm font-semibold text-gray-900">
                            LINE「{r.line_register_name || r.display_name || '(名前なし)'}」
                          </p>
                          <p className="text-xs text-gray-600">
                            現在の表示名: {r.system_display_name || r.display_name || '(未設定)'}
                          </p>
                          {r.real_name && (
                            <p className="text-xs text-gray-500">
                              本名: {r.real_name}
                            </p>
                          )}
                          <p className="mt-1 text-xs text-gray-400">
                            ID: {r.lstep_id}
                          </p>
                        </div>
                      </div>
                      {/* Link action */}
                      <div className="mt-3">
                        {linkingId === r.lstep_id ? (
                          <div className="flex items-center gap-2">
                            <Select
                              value={selectedRelation}
                              onValueChange={setSelectedRelation}
                            >
                              <SelectTrigger className="h-8 w-32 text-xs">
                                <SelectValue placeholder="関係を選択" />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="本人">本人</SelectItem>
                                <SelectItem value="保護者">保護者</SelectItem>
                                <SelectItem value="講師">講師</SelectItem>
                              </SelectContent>
                            </Select>
                            {selectedRelation === '保護者' && (
                              <input
                                type="text"
                                value={parentName}
                                placeholder="親の名前(カナ) 例: コムカイ アサミ"
                                onChange={(e) => setParentName(e.target.value)}
                                className="h-8 w-44 rounded border px-2 text-xs"
                              />
                            )}
                            <Button
                              size="xs"
                              disabled={!selectedRelation || linking}
                              onClick={() => handleLink(r.lstep_id)}
                              className="bg-orange-500 text-white hover:bg-orange-600"
                            >
                              {linking ? '処理中...' : '確定'}
                            </Button>
                            <Button
                              size="xs"
                              variant="ghost"
                              onClick={() => setLinkingId(null)}
                            >
                              キャンセル
                            </Button>
                          </div>
                        ) : (
                          <Button
                            size="xs"
                            variant="outline"
                            className="border-orange-300 text-orange-600 hover:bg-orange-50"
                            onClick={() => startLink(r.lstep_id)}
                          >
                            紐付け
                          </Button>
                        )}
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            </div>
          )}

          {/* Empty search state */}
          {query.length >= 1 &&
            !searching &&
            searchResults.length === 0 &&
            autoCandidates.length === 0 && (
              <div className="py-8 text-center text-gray-400">
                該当する友だちが見つかりませんでした
              </div>
            )}

          {/* Link error */}
          {linkError && (
            <div className="mt-4 rounded-lg border border-red-200 bg-red-50 p-3 text-center text-sm text-red-600">
              {linkError}
            </div>
          )}
        </>
      )}
    </div>
  );
}
