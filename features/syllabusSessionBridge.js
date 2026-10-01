// Copyright (c) 2024-2026 SAYU
// This software is released under the MIT License, see LICENSE.

/**
 * @file シラバス直接取得用のKu-Portセッション引き渡しブリッジ。
 *
 * Ku-Portの画面を操作せず、ログイン後に表示されたmenuFormの送信情報だけを
 * Service Workerへ渡す。シラバスの画面操作や表示処理はここでは行わない。
 */

(() => {
    'use strict';

    chrome.runtime.sendMessage({ type: 'get-syllabus-lookup-job' }).then(async (response) => {
        const job = response?.job;
        if (!job || job.transport !== 'direct-fetch') return;

        const menuForm = document.getElementById('menuForm');
        if (!(menuForm instanceof HTMLFormElement)) return;

        const fields = Array.from(new FormData(menuForm).entries())
            .filter(([name, value]) => typeof name === 'string' && typeof value === 'string');
        await chrome.runtime.sendMessage({
            type: 'kuport-syllabus-session-ready',
            requestId: job.requestId,
            action: menuForm.action,
            fields,
        });
    }).catch((error) => {
        console.debug('[KLPF] シラバス用Ku-Portセッションを確認できませんでした。', error);
    });
})();
