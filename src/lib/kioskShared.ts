// kiosk のサーバ/クライアント共有定数。ここにはDBやNode専用APIをimportしない
// (クライアントコンポーネントのバンドルに入るため)。

/** QR表示中の仮押さえ時間(分)。超過でiPadが自動リセット+注文expired化。 */
export const KIOSK_HOLD_MINUTES = 5;

/** 1注文で買える合計点数の上限(公開APIの悪用対策を兼ねる)。 */
export const KIOSK_MAX_QTY_PER_ORDER = 10;
