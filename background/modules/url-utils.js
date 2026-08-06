// Copyright (c) 2024-2026 SAYU
// This software is released under the MIT License, see LICENSE.

/**
 * @file Service Workerから外部URLを扱う際の許可判定を集約する。
 * 認証情報の漏えいと想定外ホストへのPOSTを防ぐため、通信直前にも検証する。
 */

const KUPORT_HOSTNAME = 'ku-port.sc.kogakuin.ac.jp';

/**
 * KU-PORTのHTTPS URLだけを受理する。
 * @param {string|URL} value - 検証するURL。
 * @returns {string} 正規化済みURL。
 * @throws {Error} KU-PORT以外のURLの場合。
 */
export function assertKuportUrl(value) {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.hostname !== KUPORT_HOSTNAME) {
        throw new Error('Ku-port以外への通信を拒否しました。');
    }
    return url.href;
}

/**
 * Webhookとして認める、認証情報を含まないHTTPS URLか判定する。
 * @param {unknown} value - 設定画面から渡された値。
 * @returns {boolean} 送信可能ならtrue。
 */
export function isAllowedWebhookUrl(value) {
    if (typeof value !== 'string') return false;

    try {
        const url = new URL(value);
        return url.protocol === 'https:'
            && Boolean(url.hostname)
            && !url.username
            && !url.password;
    } catch {
        return false;
    }
}
