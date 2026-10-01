// Copyright (c) 2024-2026 SAYU
// This software is released under the MIT License, see LICENSE.

/**
 * @file 拡張機能が所有するKu-Portタブから掲示板の送信フォームを読み取る。
 * Service Workerが明示的に注入し、ジョブの所有確認後にフォームとPrimeFacesコマンドを返す。
 * 既存のユーザータブでの取得、一覧描画、掲示の編集は担当しない。
 */

/** 認証ジョブを所有するタブへだけ注入し、ホスト全体への自動注入は行わない。 */
(() => {
    'use strict';
    if (globalThis.klpfBulletinSessionBridgeInstalled) return;
    globalThis.klpfBulletinSessionBridgeInstalled = true;
    /**
     * 入力の全角・空白などをそろえ、照合用の文字列へ変換する。
     * @param {*} value - 検証・変換する入力値。
     * @returns {string} 照合用に整えた文字列。
     */
    const normalizeText = value => String(value || '').normalize('NFKC').replace(/[\s\u3000]+/g, ' ').trim();

    /**
     * 要素のonclickからPrimeFacesの送信コマンドを取り出す。
     * @param {Element} element - 操作または読み取りの対象要素。
     * @returns {object|null} 送信元とパラメーターの情報。読み取れなければnull。
     */
    function readKuportAjaxCommand(element) {
        const source = [element?.getAttribute('onclick'), element?.getAttribute('data-pfcommand')]
            .filter(Boolean).join('\n');
        const read = key => source.match(new RegExp(`(?:^|[,{])\\s*${key}\\s*:\\s*["']([^"']+)["']`))?.[1] || '';
        return {
            source: read('s') || element?.id || element?.getAttribute('name') || '',
            execute: read('p'),
            render: read('u'),
        };
    }

    /**
     * 掲示板ページのフォームとリンクから直接通信に必要な情報を取り出す。
     * @returns {object|null} 掲示板の送信フォーム情報。読み取れなければnull。
     */
    function readKuportBulletinBootstrap() {
        const form = document.getElementById('funcForm');
        if (!(form instanceof HTMLFormElement)) return null;
        const links = Array.from(form.querySelectorAll('a, button, [role="button"]'));
        const link = links.find(element => /掲示情報を表示/.test(normalizeText([
            element.getAttribute('aria-label'),
            element.getAttribute('title'),
        ].filter(Boolean).join(' '))))
            || links.find(element => /掲示情報/.test(normalizeText(element.textContent)));
        if (!link) return null;
        const command = readKuportAjaxCommand(link);
        if (!command.source) return null;
        return {
            action: form.action,
            fields: Array.from(new FormData(form).entries())
                .filter(([name, value]) => typeof name === 'string' && typeof value === 'string'),
            bulletinSource: command.source,
            bulletinExecute: command.execute || command.source,
            bulletinRender: command.render || '@(.dispTab_1)',
        };
    }


    chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
        if (message?.type !== 'klpf-bulletin-session-bootstrap') return false;
        chrome.runtime.sendMessage({ type: 'get-bulletin-fetch-job' }).then(response => {
            if (!response?.job?.requestId) {
                sendResponse({ status: 'stale' });
                return;
            }
            const bootstrap = readKuportBulletinBootstrap();
            sendResponse(bootstrap ? { status: 'session-ready', ...bootstrap } : { status: 'menu-not-ready' });
        }).catch(() => sendResponse({ status: 'error' }));
        return true;
    });
})();
