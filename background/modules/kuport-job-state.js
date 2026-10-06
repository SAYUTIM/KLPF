// Copyright (c) 2024-2026 SAYU
// This software is released under the MIT License, see LICENSE.

/**
 * @file Ku-Port取得ジョブの作成・更新・終了を直列化する。
 * storage.sessionを正本とし、終了後に古い進捗や所有タブ情報でジョブを復活させない。
 * 終了処理が失敗した場合は保存情報を残し、期限監視による再試行を可能にする。
 */

/**
 * 取得ジョブの保存キーに対応する操作窓口を作る。
 * updateの変更関数とfinishの終了関数では、同じ窓口の更新・終了を再度呼び出さない。
 * 読み取りは可能だが、同じ更新キューへの再登録を待つと相互待ちになる。
 * @param {string} key - storage.sessionの保存キー。
 * @param {string} [idField='requestId'] - ジョブを識別するフィールド名。
 * @returns {{get: Function, create: Function, update: Function, finish: Function}}
 * getは現在のジョブ、createは新規ジョブを返す。
 * updateはIDと変更関数、finishはIDと終了関数を受け取り、対応するジョブがなければnullを返す。
 * 変更・終了関数の非同期処理も完了を待ってから次の操作へ進む。
 */
export function createKuportJobStore(key, idField = 'requestId') {
    let pending = Promise.resolve();
    const get = async () => (await chrome.storage.session.get(key))[key] || null;
    const run = operation => {
        const result = pending.then(operation);
        pending = result.catch(() => {});
        return result;
    };
    return {
        get,
        create: job => run(async () => {
            if (await get()) throw new Error('Ku-Port取得ジョブが既に存在します。');
            await chrome.storage.session.set({ [key]: job });
            return job;
        }),
        update: (id, change) => run(async () => {
            const current = await get();
            if (!current || current[idField] !== id) return null;
            const next = await change(current);
            await chrome.storage.session.set({ [key]: next });
            return next;
        }),
        finish: (id, cleanup) => run(async () => {
            const current = await get();
            if (!current || current[idField] !== id) return null;
            await cleanup(current);
            await chrome.storage.session.remove(key);
            return current;
        }),
    };
}
