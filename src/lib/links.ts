// お客さん向けの導線URL。ここが唯一の正とする。
//
// 各所にベタ書きすると、LINEを作り直した時などに直し漏れが出て
// 「どこかの導線だけ古いURLのまま」という無言の穴になる。

/** 公式LINE(@007nsdtb)の友だち追加リンク */
export const OFFICIAL_LINE_URL = 'https://lin.ee/4EYB9zZ';

/** ホームページ */
export const WEBSITE_URL = 'https://www.boom-sendai.com/';

/** YouTube「BOOM チャンネル」。人が読む場所(LINE配信・印刷物)はハンドル形式が分かりやすい */
export const YOUTUBE_CHANNEL_URL = 'https://www.youtube.com/@boom_sendai';

/** チャンネルID。ハンドル(@boom_sendai)と違って**改名しても変わらない** */
export const YOUTUBE_CHANNEL_ID = 'UCcHMEFmqpzyGkKew05NmvGA';

/**
 * チャンネル登録の確認ダイアログを開くURL。
 * `?sub_confirmation=1` を付けるとチャンネルを開いた瞬間に登録ダイアログが出るため、
 * 素のチャンネルURLより1タップ短い。登録者1,000人(パートナープログラム)に向けた導線。
 *
 * ⚠️ **ハンドル形式(@boom_sendai)ではなくチャンネルID形式を使う。** 理由は2つ:
 *   1. YouTubeの説明欄に `@なにか` を出さないという不変条件を守るため。
 *      説明欄の @ は別アカウントへのリンクとして解釈されうるので、crosspost 側で
 *      Instagramのハンドルを全て名前へ置換している(sanitizeHandlesForOtherPlatform)。
 *      自分のハンドルとはいえ例外を作ると、その不変条件を検査で守れなくなる。
 *   2. ハンドルは後から変更できるがチャンネルIDは不変。過去の投稿の説明欄が
 *      改名で一斉にリンク切れになるのを防げる。
 */
export const YOUTUBE_SUBSCRIBE_URL = `https://www.youtube.com/channel/${YOUTUBE_CHANNEL_ID}?sub_confirmation=1`;
