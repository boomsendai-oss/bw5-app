'use client';

// 入力欄を離れたときに形式をその場でチェックする(メール・電話・ふりがな)。
// 判定は純関数 contactFieldError(vitest対象)。送信時のサーバ側チェックは別に必ず行われる。
import { useState } from 'react';
import { contactFieldError, type ContactField } from '@/lib/party';

export function useFieldErrors() {
  const [errs, setErrs] = useState<Record<string, string>>({});
  return {
    errs,
    /** onBlur で呼ぶ */
    check: (key: string, field: ContactField, value: string) =>
      setErrs((p) => ({ ...p, [key]: contactFieldError(field, value) })),
    /** onChange で呼ぶ(直し始めたら消す) */
    clear: (key: string) => setErrs((p) => (p[key] ? { ...p, [key]: '' } : p)),
  };
}
