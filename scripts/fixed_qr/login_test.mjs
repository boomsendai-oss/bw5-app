// scripts/fixed_qr/login_test.mjs — 疎通テスト: ログイン + ML001エクスポートの行数だけ出す
import { launchAndLogin, downloadMl001Csv } from './hacomono.mjs';

const { browser, context } = await launchAndLogin();
console.log('LOGIN OK');
const csv = await downloadMl001Csv(context);
console.log(`ML001 EXPORT OK: ${csv.split('\n').filter((l) => l.trim()).length - 1} rows`);
await browser.close();
