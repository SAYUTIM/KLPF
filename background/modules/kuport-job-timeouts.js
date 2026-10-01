// Copyright (c) 2024-2026 SAYU
// This software is released under the MIT License, see LICENSE.

/**
 * @file Ku-Port取得ジョブの期限を、認証待ちから取得終了まで監視する。
 * 保存済みの開始時刻とChromeアラームを使い、Service Workerの再起動後も期限を引き継ぐ。
 * 期限切れの通知と所有画面の終了は、各機能から渡された終了関数へ委譲する。
 */

const TIMEOUT_ALARM_NAME = 'klpf-kuport-job-timeout';
const RETRY_INTERVAL_MS = 30 * 1000;

/**
 * 取得ジョブの期限監視を登録し、保存済みのジョブから監視を復元する。
 * @param {Array<{key: string, timeoutMs: number, finish: Function}>} definitions - 保存キー、制限時間、期限切れ時の終了関数。
 * @returns {void} 戻り値はない。
 */
export function registerKuportJobTimeouts(definitions) {
    const keys = definitions.map(definition => definition.key);
    let pending = Promise.resolve();
    let timerId = null;

    /**
     * 現在のジョブと、保存された開始時刻に基づく期限を読み出す。
     * @returns {Promise<Array<object>>} 終了関数と期限を付けた実行中のジョブ一覧。
     */
    async function readJobs() {
        const stored = await chrome.storage.session.get(keys);
        return definitions.filter(definition => stored[definition.key]).map(definition => {
            const job = stored[definition.key];
            return {
                ...definition,
                job,
                deadline: Number.isFinite(job.startedAt) ? job.startedAt + definition.timeoutMs : 0,
            };
        });
    }

    /**
     * 期限切れのジョブを終了し、残ったジョブの最も早い期限へ監視を設定する。
     * @returns {Promise<void>} 終了処理と次の監視設定の完了。
     */
    async function reconcile() {
        clearTimeout(timerId);
        timerId = null;
        for (const entry of await readJobs()) {
            if (entry.deadline > Date.now()) continue;
            try {
                await entry.finish(entry.job);
            } catch (error) {
                // 閉じられなかった画面のジョブは保持し、次のアラームで再試行する。
                console.error('[KLPF] 期限切れのKu-Port取得を終了できませんでした。', error);
            }
        }
        const remaining = await readJobs();
        if (remaining.length === 0) {
            await chrome.alarms.clear(TIMEOUT_ALARM_NAME);
            return;
        }
        const now = Date.now();
        const deadline = Math.min(...remaining.map(entry => entry.deadline));
        const when = deadline > now ? deadline : now + RETRY_INTERVAL_MS;
        // Workerが動いている間は通常のタイマーでも監視し、アラームの遅延を補う。
        timerId = setTimeout(queueReconcile, Math.max(0, when - Date.now()));
        const alarm = await chrome.alarms.get(TIMEOUT_ALARM_NAME);
        if (!alarm || alarm.scheduledTime !== when) {
            await chrome.alarms.create(TIMEOUT_ALARM_NAME, { when, periodInMinutes: 0.5 });
        }
    }

    /**
     * ストレージ更新とアラームによる期限確認を直列化する。
     * @returns {void} 戻り値はない。
     */
    function queueReconcile() {
        pending = pending.then(reconcile).catch(error => {
            console.error('[KLPF] Ku-Port取得の期限監視を設定できませんでした。', error);
        });
    }

    chrome.alarms.onAlarm.addListener(alarm => {
        if (alarm.name === TIMEOUT_ALARM_NAME) queueReconcile();
    });
    chrome.storage.onChanged.addListener((changes, area) => {
        if (area === 'session' && keys.some(key => Object.hasOwn(changes, key))) queueReconcile();
    });
    queueReconcile();
}
