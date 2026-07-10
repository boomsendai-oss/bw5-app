'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';

// ─── Types ───────────────────────────────────────────────────────────────────

type Notification = {
  id: number;
  type: string;
  title: string;
  message: string | null;
  severity: 'info' | 'warning' | 'error';
  member_id: number | null;
  member_name: string | null;
  member_name_kana: string | null;
  acknowledged: boolean;
  created_at: string;
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'たった今';
  if (mins < 60) return `${mins}分前`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}時間前`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}日前`;
  return new Date(iso).toLocaleDateString('ja-JP');
}

function typeIcon(type: string): string {
  switch (type) {
    case 'lstep_linked':
      return '✅';
    case 'lstep_unlinked':
    case 'warning':
      return '⚠️';
    case 'new_member':
      return '👤';
    case 'plan_change':
      return '🔄';
    case 'member_withdrew':
      return '👋';
    default:
      return '📌';
  }
}

function severityColor(severity: string): string {
  switch (severity) {
    case 'info':
      return 'bg-green-100 text-green-800';
    case 'warning':
      return 'bg-amber-100 text-amber-800';
    case 'error':
      return 'bg-red-100 text-red-800';
    default:
      return 'bg-gray-100 text-gray-700';
  }
}

function severityLabel(severity: string): string {
  switch (severity) {
    case 'info':
      return '情報';
    case 'warning':
      return '注意';
    case 'error':
      return 'エラー';
    default:
      return severity;
  }
}

// ─── Page Component ──────────────────────────────────────────────────────────

export default function NotificationsPage() {
  const router = useRouter();
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<'unacknowledged' | 'all'>('unacknowledged');
  const [acknowledging, setAcknowledging] = useState<Set<number>>(new Set());

  const fetchNotifications = useCallback(async (status: 'unacknowledged' | 'all') => {
    setLoading(true);
    try {
      const res = await fetch(`/api/staff/notifications?status=${status}`);
      if (res.ok) {
        const data = await res.json();
        setNotifications(data.notifications ?? data ?? []);
      }
    } catch {
      // silently fail — user sees empty state
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchNotifications(filter);
  }, [filter, fetchNotifications]);

  const acknowledge = async (id: number) => {
    // Optimistic update
    setAcknowledging((prev) => new Set(prev).add(id));
    setNotifications((prev) =>
      prev.map((n) => (n.id === id ? { ...n, acknowledged: true } : n))
    );

    try {
      await fetch('/api/staff/notifications', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id }),
      });
    } catch {
      // Revert on error
      setNotifications((prev) =>
        prev.map((n) => (n.id === id ? { ...n, acknowledged: false } : n))
      );
    } finally {
      setAcknowledging((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    }
  };

  const acknowledgeAll = async () => {
    const unacked = notifications.filter((n) => !n.acknowledged);
    if (unacked.length === 0) return;

    const ids = unacked.map((n) => n.id);

    // Optimistic update
    setNotifications((prev) =>
      prev.map((n) => (ids.includes(n.id) ? { ...n, acknowledged: true } : n))
    );

    try {
      await Promise.all(
        ids.map((id) =>
          fetch('/api/staff/notifications', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id }),
          })
        )
      );
    } catch {
      // Refetch on error to get true state
      fetchNotifications(filter);
    }
  };

  const unacknowledgedCount = notifications.filter((n) => !n.acknowledged).length;

  return (
    <div className="mx-auto max-w-2xl px-4 py-6">
      {/* Header */}
      <div className="mb-6 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-bold text-gray-900">
            📋 通知フィード
          </h1>
          {unacknowledgedCount > 0 && (
            <span className="inline-flex h-6 min-w-6 items-center justify-center rounded-full bg-brand-500 px-2 text-xs font-bold text-white">
              {unacknowledgedCount}
            </span>
          )}
        </div>
        {unacknowledgedCount > 0 && (
          <Button
            variant="outline"
            size="sm"
            onClick={acknowledgeAll}
          >
            すべて確認
          </Button>
        )}
      </div>

      {/* Filter Tabs */}
      <div className="mb-4 flex gap-1 rounded-lg bg-gray-100 p-1">
        <button
          className={`flex-1 rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
            filter === 'unacknowledged'
              ? 'bg-white text-brand-600 shadow-sm'
              : 'text-gray-600 hover:text-gray-900'
          }`}
          onClick={() => setFilter('unacknowledged')}
        >
          未確認のみ
        </button>
        <button
          className={`flex-1 rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
            filter === 'all'
              ? 'bg-white text-brand-600 shadow-sm'
              : 'text-gray-600 hover:text-gray-900'
          }`}
          onClick={() => setFilter('all')}
        >
          すべて
        </button>
      </div>

      {/* Loading */}
      {loading && (
        <div className="py-12 text-center text-gray-500">読み込み中...</div>
      )}

      {/* Empty State */}
      {!loading && notifications.length === 0 && (
        <div className="py-12 text-center text-gray-400">
          {filter === 'unacknowledged'
            ? '未確認の通知はありません'
            : '通知はまだありません'}
        </div>
      )}

      {/* Notification List */}
      {!loading && notifications.length > 0 && (
        <div className="flex flex-col gap-3">
          {notifications.map((n) => (
            <Card
              key={n.id}
              className={`transition-opacity ${
                n.acknowledged ? 'bg-gray-50 opacity-60' : ''
              }`}
            >
              <CardContent className="flex flex-col gap-2">
                {/* Top row: icon + title + severity + time */}
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-start gap-2 min-w-0">
                    <span className="mt-0.5 text-lg leading-none">
                      {typeIcon(n.type)}
                    </span>
                    <div className="min-w-0">
                      <p
                        className={`text-sm font-semibold ${
                          n.acknowledged
                            ? 'text-gray-400 line-through'
                            : 'text-gray-900'
                        }`}
                      >
                        {n.title}
                      </p>
                      {n.message && (
                        <p className="mt-0.5 text-xs text-gray-500">
                          {n.message}
                        </p>
                      )}
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <span
                      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${severityColor(
                        n.severity
                      )}`}
                    >
                      {severityLabel(n.severity)}
                    </span>
                    <span className="whitespace-nowrap text-xs text-gray-400">
                      {relativeTime(n.created_at)}
                    </span>
                  </div>
                </div>

                {/* Member info */}
                {n.member_name && (
                  <div className="ml-7 text-xs text-gray-500">
                    👤 {n.member_name}
                    {n.member_name_kana && (
                      <span className="ml-1 text-gray-400">
                        ({n.member_name_kana})
                      </span>
                    )}
                  </div>
                )}

                {/* Actions */}
                <div className="ml-7 flex items-center gap-2">
                  {!n.acknowledged && (
                    <Button
                      variant="outline"
                      size="xs"
                      onClick={() => acknowledge(n.id)}
                      disabled={acknowledging.has(n.id)}
                    >
                      ✅ 確認しました
                    </Button>
                  )}
                  {n.acknowledged && (
                    <Badge variant="secondary" className="text-xs text-gray-400">
                      確認済み
                    </Badge>
                  )}
                  {n.type === 'lstep_unlinked' && n.member_id && (
                    <Button
                      variant="outline"
                      size="xs"
                      className="border-brand-300 text-brand-600 hover:bg-brand-50"
                      onClick={() =>
                        router.push(
                          `/staff/notifications/link?member_id=${n.member_id}&notification_id=${n.id}`
                        )
                      }
                    >
                      手動で紐付け
                    </Button>
                  )}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
