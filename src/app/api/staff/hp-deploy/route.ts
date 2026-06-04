import { NextRequest, NextResponse } from 'next/server';
import { isAuthorized, unauthorized } from '@/lib/eventAuth';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * BOOM HP (boom-hp.pages.dev) の再ビルドを GitHub Actions 経由でトリガー
 *
 * 必要な環境変数 (Vercel側):
 * - GITHUB_TOKEN_HP_DEPLOY: GitHub Personal Access Token (repo, workflow スコープ)
 *
 * 必要な GitHub secrets (boom-hp リポジトリ側):
 * - TURSO_DATABASE_URL
 * - TURSO_AUTH_TOKEN
 * - CLOUDFLARE_API_TOKEN
 * - CLOUDFLARE_ACCOUNT_ID
 */

const REPO_OWNER = 'boomsendai-oss';
const REPO_NAME = 'boom-hp';
const WORKFLOW_FILE = 'deploy.yml';
const BRANCH = 'design-pattern-b';

// POST /api/staff/hp-deploy → ワークフロー手動トリガー
export async function POST(req: NextRequest) {
  if (!(await isAuthorized(req))) return unauthorized();

  const token = process.env.GITHUB_TOKEN_HP_DEPLOY;
  if (!token) {
    return NextResponse.json(
      {
        error: 'GITHUB_TOKEN_HP_DEPLOY が未設定です。Vercel の Environment Variables で設定してください。',
      },
      { status: 500 }
    );
  }

  const url = `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/actions/workflows/${WORKFLOW_FILE}/dispatches`;
  const r = await fetch(url, {
    method: 'POST',
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${token}`,
      'X-GitHub-Api-Version': '2022-11-28',
    },
    body: JSON.stringify({ ref: BRANCH }),
  });

  if (!r.ok) {
    const text = await r.text().catch(() => '');
    return NextResponse.json(
      { error: `GitHub API エラー (${r.status}): ${text.slice(0, 200)}` },
      { status: 502 }
    );
  }

  return NextResponse.json({
    ok: true,
    message: 'HPの再デプロイを開始しました。3〜5分後に boom-hp.pages.dev へ反映されます。',
    progressUrl: `https://github.com/${REPO_OWNER}/${REPO_NAME}/actions`,
  });
}

// GET /api/staff/hp-deploy → 最新ワークフロー実行ステータスを取得
export async function GET(req: NextRequest) {
  if (!(await isAuthorized(req))) return unauthorized();

  const token = process.env.GITHUB_TOKEN_HP_DEPLOY;
  if (!token) {
    return NextResponse.json({
      runs: [],
      error: 'GITHUB_TOKEN_HP_DEPLOY 未設定',
    });
  }

  const url = `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/actions/workflows/${WORKFLOW_FILE}/runs?per_page=5`;
  const r = await fetch(url, {
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${token}`,
      'X-GitHub-Api-Version': '2022-11-28',
    },
  });

  if (!r.ok) {
    return NextResponse.json({ runs: [], error: `GitHub API: ${r.status}` });
  }

  const data = (await r.json()) as {
    workflow_runs: Array<{
      id: number;
      status: string;
      conclusion: string | null;
      created_at: string;
      html_url: string;
      event: string;
    }>;
  };

  const runs = (data.workflow_runs || []).map((run) => ({
    id: run.id,
    status: run.status,
    conclusion: run.conclusion,
    createdAt: run.created_at,
    htmlUrl: run.html_url,
    event: run.event,
  }));

  return NextResponse.json({ runs });
}
