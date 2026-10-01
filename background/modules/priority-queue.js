// Copyright (c) 2024-2026 SAYU
// This software is released under the MIT License, see LICENSE.

/**
 * @file 実行中のジョブが終わってから待機要求を優先順位順に処理するキューを提供する。
 * 小さい数値を優先し、同じ優先順位は受付順に実行する。実行中の処理には割り込まない。
 * 待機条件と実行処理を関数で受け取るため、Chrome APIや個別機能には依存しない。
 */

/**
 * 待機条件を満たした順に優先順位付きで実行するキュー登録関数を作る。
 * キューはジョブが終わるまで待ち、待機条件の失敗は待機中の全要求へ通知する。
 * @param {Function} waitUntilIdle - 実行中のジョブがなくなるまで待つ処理。
 * @returns {function(number, Function): Promise<*>} 優先順位と実行関数を受け取る登録関数。Promiseは実行結果で解決する。
 */
export function createPriorityQueue(waitUntilIdle) {
    const pending = [];
    let draining = false;
    let sequence = 0;

    /**
     * 実行中のジョブが終わるのを待ち、優先順位と受付順に待機要求を処理する。
     * @returns {Promise<void>} 処理の完了を待つPromise。
     */
    async function drain() {
        if (draining) return;
        draining = true;
        try {
            while (pending.length) {
                try {
                    await waitUntilIdle();
                } catch (error) {
                    pending.splice(0).forEach(item => item.reject(error));
                    break;
                }
                pending.sort((a, b) => a.priority - b.priority || a.sequence - b.sequence);
                const item = pending.shift();
                try { item.resolve(await item.run()); }
                catch (error) { item.reject(error); }
            }
        } finally {
            draining = false;
        }
    }

    return (priority, run) => new Promise((resolve, reject) => {
        pending.push({ priority, run, resolve, reject, sequence: sequence++ });
        void drain();
    });
}
