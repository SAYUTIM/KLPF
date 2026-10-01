// Copyright (c) 2024-2026 SAYU
// This software is released under the MIT License, see LICENSE.

/**
 * @file KU-Port掲示板をKU-LMSホームのお知らせ欄へ表示する。
 *
 * 既存のlms-news-blockと同じ見た目の3列目を追加し、上位5件と取得済み本文を表示する。
 * 認証用タブの読み取りはbulletinSessionBridge.js、通信はService Workerが担当する。
 */

(() => {
    'use strict';

    const FEATURE_ENABLED_KEY = 'bulletinBoardEnabled';
    const ALL_FEATURES_DISABLED_KEY = 'klpfInlineAllFeaturesDisabled';
    const CACHE_KEY = 'klpf-bulletin-board-cache';
    const CACHE_VERSION = 2;
    const MAX_ITEMS = 5;
    const LMS_HOME_PATHS = [
        '/lms/homeHoml/',
        '/lms/tpicTpic/doBack',
        '/lms/tpicTpil/doBack',
        '/lms/klmsKlil/doBack',
    ];
    const BLOCK_ATTRIBUTE = 'data-klpf-bulletin-block';
    const STYLE_ID = 'klpf-bulletin-board-style';
    const DIALOG_ID = 'klpf-bulletin-dialog-root';
    /**
     * 入力の全角・空白などをそろえ、照合用の文字列へ変換する。
     * @param {*} value - 検証・変換する入力値。
     * @returns {string} 照合用に整えた文字列。
     */
    const normalizeText = value => String(value || '')
        .normalize('NFKC')
        .replace(/[\s\u3000]+/g, ' ')
        .trim();

    let featureStateLoaded = false;
    let featureEnabled = true;
    let allFeaturesDisabled = false;
    let observer = null;
    let renderTimer = 0;
    let fetchStarted = false;
    let activeRequestId = '';
    let latestItems = [];

    /**
     * 現在のURLが機能の対象となるKU-LMSホームか判定する。
     * @returns {boolean} 条件を満たす場合はtrue。
     */
    function isLmsHome() {
        return window.location.hostname === 'study.ns.kogakuin.ac.jp'
            && LMS_HOME_PATHS.some(path => window.location.pathname.startsWith(path));
    }

    /**
     * 機能設定と一括停止状態から機能が有効か判定する。
     * @returns {boolean} 条件を満たす場合はtrue。
     */
    function isEnabled() {
        return featureEnabled && !allFeaturesDisabled && globalThis.KLPFKuportAccess.ready;
    }

    /**
     * 機能の表示用スタイルを重複なく追加する。
     * @returns {void} 戻り値はない。
     */
    function ensureStyles() {
        if (document.getElementById(STYLE_ID)) return;
        const style = document.createElement('style');
        style.id = STYLE_ID;
        style.textContent = `
            html.klpf-bulletin-dialog-open,
            html.klpf-bulletin-dialog-open body {
                overflow: hidden !important;
                overscroll-behavior: none !important;
            }
            .lms-news-container.klpf-bulletin-news-layout {
                display: flex !important;
                flex-wrap: nowrap;
                align-items: stretch;
                gap: 8px;
                background-color: #fff !important;
            }
            .lms-news-container.klpf-bulletin-news-layout > .lms-news-block {
                box-sizing: border-box;
                flex: 1 1 0% !important;
                width: auto !important;
                height: auto !important;
                min-width: 0;
            }
            [${BLOCK_ATTRIBUTE}] .lms-news-subO {
                overflow: hidden;
                text-overflow: ellipsis;
                white-space: nowrap;
            }
            [${BLOCK_ATTRIBUTE}] .klpf-bulletin-date {
                display: inline-block;
                margin-right: 3px;
                white-space: nowrap;
            }
            [${BLOCK_ATTRIBUTE}] .klpf-bulletin-loading,
            [${BLOCK_ATTRIBUTE}] .klpf-bulletin-empty,
            [${BLOCK_ATTRIBUTE}] .klpf-bulletin-error {
                display: block;
                color: #667085;
                line-height: 1.6;
                overflow: hidden;
                text-overflow: ellipsis;
                white-space: nowrap;
            }
            [${BLOCK_ATTRIBUTE}] .klpf-bulletin-error { color: #b42318; }
            #${DIALOG_ID} {
                position: fixed;
                inset: 0;
                z-index: 2147483647;
            }
            #${DIALOG_ID} .klpf-bulletin-overlay {
                display: flex;
                align-items: flex-start;
                justify-content: center;
                min-height: 100%;
                padding: 51px 18px 18px;
                box-sizing: border-box;
                background: rgba(0, 0, 0, .42);
            }
            #${DIALOG_ID} .klpf-bulletin-dialog {
                display: flex;
                flex-direction: column;
                width: min(960px, 100%);
                height: min(640px, calc(100vh - 69px));
                overflow: hidden;
                border: 1px solid #9aa8b3;
                border-radius: 4px;
                background: #fff;
                box-shadow: 0 8px 28px rgba(0, 0, 0, .32);
                color: #303c45;
                font-family: Arial, "Yu Gothic", Meiryo, sans-serif;
            }
            #${DIALOG_ID} .klpf-bulletin-head {
                display: flex;
                align-items: center;
                gap: 8px;
                min-height: 34px;
                padding: 4px 5px 4px 10px;
                box-sizing: border-box;
                background: #005882;
                color: #fff;
            }
            #${DIALOG_ID} .klpf-bulletin-title {
                min-width: 0;
                flex: 1 1 auto;
                overflow: hidden;
                font-size: 14px;
                font-weight: 700;
                line-height: 1.4;
                text-overflow: ellipsis;
                white-space: nowrap;
            }
            #${DIALOG_ID} .klpf-bulletin-close {
                display: inline-flex;
                align-items: center;
                justify-content: center;
                width: 24px;
                height: 24px;
                flex: 0 0 auto;
                border: 1px solid rgba(255, 255, 255, .75);
                border-radius: 3px;
                background: transparent;
                color: #fff;
                cursor: pointer;
                font-size: 18px;
                line-height: 1;
            }
            #${DIALOG_ID} .klpf-bulletin-close:hover { background: rgba(255, 255, 255, .16); }
            #${DIALOG_ID} .klpf-bulletin-content {
                flex: 1 1 auto;
                min-height: 0;
                overflow: auto;
                padding: 8px 10px 18px;
            }
            #${DIALOG_ID} .klpf-bulletin-table {
                width: 100%;
                border-collapse: collapse;
                table-layout: fixed;
                color: #12334a;
                font-size: 12px;
                line-height: 1.45;
            }
            #${DIALOG_ID} .klpf-bulletin-table th,
            #${DIALOG_ID} .klpf-bulletin-table td {
                border: 1px solid #a8c5d2;
                padding: 3px 6px;
                vertical-align: top;
                overflow-wrap: anywhere;
            }
            #${DIALOG_ID} .klpf-bulletin-table th {
                width: 25%;
                background: #005882;
                color: #fff;
                text-align: left;
                font-weight: normal;
            }
            #${DIALOG_ID} .klpf-bulletin-table td {
                background: #fff;
                white-space: pre-wrap;
            }
            @media (max-width: 640px) {
                #${DIALOG_ID} .klpf-bulletin-overlay { padding: 8px; }
                #${DIALOG_ID} .klpf-bulletin-dialog { height: calc(100vh - 16px); }
            }
            @media (max-width: 900px) {
                .lms-news-container.klpf-bulletin-news-layout {
                    flex-wrap: wrap;
                }
                .lms-news-container.klpf-bulletin-news-layout > .lms-news-block {
                    flex: 0 0 calc((100% - 8px) / 2) !important;
                    width: calc((100% - 8px) / 2) !important;
                }
            }
            @media (max-width: 600px) {
                .lms-news-container.klpf-bulletin-news-layout > .lms-news-block {
                    flex-basis: 100% !important;
                    width: 100% !important;
                }
            }
        `;
        (document.head || document.documentElement).appendChild(style);
    }

    /**
     * KU-LMSのお知らせ・Topicsを含む表示コンテナを取得する。
     * @returns {Element|null} お知らせ欄の親要素。見つからなければnull。
     */
    function getNewsContainer() {
        return document.querySelector('.lms-news-container');
    }

    /**
     * 掲示板一覧の表示枠を作り、KU-LMSのお知らせ欄へ追加する。
     * @returns {HTMLElement} 掲示板の表示枠。
     */
    function createBlock() {
        const block = document.createElement('div');
        block.className = 'lms-news-block';
        block.setAttribute(BLOCK_ATTRIBUTE, '');
        block.innerHTML = `
            <div class="lms-news-title"><span>掲示板</span><span data-klpf-bulletin-updating hidden style="margin-left:8px;font-size:11px;font-weight:normal">更新中</span></div>
            <div class="lms-news-contents">
                <div class="lms-news-line">
                    <ul class="lms-news-sub"></ul>
                </div>
            </div>
        `;
        block.addEventListener('click', event => {
            const target = event.target instanceof Element
                ? event.target.closest('[data-klpf-bulletin-index]')
                : null;
            if (!target) return;
            event.preventDefault();
            event.stopPropagation();
            const index = Number(target.getAttribute('data-klpf-bulletin-index'));
            const item = latestItems[index];
            if (item) showBulletinDialog(item);
        }, true);
        return block;
    }

    /**
     * 掲示板枠へ案内文と表示クラスを設定する。
     * @param {HTMLElement} block - 掲示板一覧の表示枠。
     * @param {string} text - 表示または照合する文字列。
     * @param {string} className - 作成または更新する要素のCSSクラス。
     * @returns {void} 戻り値はない。
     */
    function setBlockMessage(block, text, className) {
        const list = block?.querySelector('.lms-news-sub');
        if (!list) return;
        list.replaceChildren();
        const message = document.createElement('li');
        message.className = className;
        message.textContent = text;
        list.appendChild(message);
    }

    /**
     * 掲示一覧の日付を表示用に整える。
     * @param {object} item - 件名・本文・掲示日時などの取得済み掲示情報。
     * @returns {string} 表示または識別に使う文字列。
     */
    function formatBulletinDate(item) {
        const source = normalizeText(item?.date || item?.period || '');
        return source.match(/\d{4}[\/-]\d{1,2}[\/-]\d{1,2}/)?.[0] || '';
    }

    /**
     * 取得済みの掲示から最大5件の一覧を描画する。
     * @param {object[]} items - 掲示一覧または表示対象の項目。
     * @returns {void} 戻り値はない。
     */
    function renderItems(items) {
        const block = getNewsContainer()?.querySelector(`[${BLOCK_ATTRIBUTE}]`);
        if (!block) return;
        latestItems = Array.isArray(items) ? items.slice(0, MAX_ITEMS) : [];
        const list = block.querySelector('.lms-news-sub');
        if (!list) return;
        list.replaceChildren();
        if (latestItems.length === 0) {
            setBlockMessage(block, '掲示はありません', 'klpf-bulletin-empty');
            return;
        }
        latestItems.forEach((item, index) => {
            const row = document.createElement('li');
            row.className = 'lms-news-subO';
            const date = formatBulletinDate(item);
            if (date) {
                const dateElement = document.createElement('span');
                dateElement.className = 'klpf-bulletin-date';
                dateElement.textContent = date;
                row.appendChild(dateElement);
            }
            const link = document.createElement('a');
            link.href = '#';
            link.setAttribute('data-klpf-bulletin-index', String(index));
            link.title = normalizeText(item?.title) || '掲示';
            link.textContent = normalizeText(item?.title) || '掲示';
            row.appendChild(link);
            list.appendChild(row);
        });
    }

    /**
     * 掲示板枠を用意し、有効状態とキャッシュ内容を反映する。
     * @returns {HTMLElement|null} 有効時の掲示板枠。表示対象外ならnull。
     */
    function ensureBlock() {
        const container = getNewsContainer();
        if (!container) return null;
        if (!isEnabled()) {
            activeRequestId = '';
            fetchStarted = false;
            document.getElementById(DIALOG_ID)?.querySelector('.klpf-bulletin-close')?.click();
            container.querySelector(`[${BLOCK_ATTRIBUTE}]`)?.remove();
            container.classList.remove('klpf-bulletin-news-layout');
            return null;
        }
        ensureStyles();
        container.classList.add('klpf-bulletin-news-layout');
        const blocks = container.querySelectorAll(`[${BLOCK_ATTRIBUTE}]`);
        blocks.forEach((block, index) => {
            if (index > 0) block.remove();
        });
        let block = container.querySelector(`[${BLOCK_ATTRIBUTE}]`);
        if (!block) {
            block = createBlock();
            container.appendChild(block);
            setBlockMessage(block, '掲示板を取得中…', 'klpf-bulletin-loading');
        }
        return block;
    }

    /**
     * 取得済みの掲示本文とメタデータをポップアップに表示する。
     * @param {object} item - 件名・本文・掲示日時などの取得済み掲示情報。
     * @returns {void} 戻り値はない。
     */
    function showBulletinDialog(item) {
        if (!isEnabled()) return;
        document.getElementById(DIALOG_ID)?.remove();
        const root = document.createElement('div');
        root.id = DIALOG_ID;
        const overlay = document.createElement('div');
        overlay.className = 'klpf-bulletin-overlay';
        const dialog = document.createElement('section');
        dialog.className = 'klpf-bulletin-dialog';
        dialog.setAttribute('role', 'dialog');
        dialog.setAttribute('aria-modal', 'true');
        dialog.innerHTML = `
            <div class="klpf-bulletin-head">
                <div class="klpf-bulletin-title"></div>
                <button type="button" class="klpf-bulletin-close" aria-label="閉じる">×</button>
            </div>
            <div class="klpf-bulletin-content"><table class="klpf-bulletin-table"><tbody></tbody></table></div>
        `;
        dialog.querySelector('.klpf-bulletin-title').textContent = '掲示内容';
        const tableBody = dialog.querySelector('tbody');
        for (const [label, value] of [
            ['差出人', item?.sender],
            ['カテゴリ', item?.category],
            ['件名', item?.title],
            ['本文', item?.body || '本文を取得できませんでした。'],
            ['掲示期間', item?.period],
        ]) {
            const row = document.createElement('tr');
            const heading = document.createElement('th');
            heading.scope = 'row';
            heading.textContent = label;
            const cell = document.createElement('td');
            cell.textContent = String(value || '');
            row.append(heading, cell);
            tableBody.appendChild(row);
        }
        const close = () => {
            root.remove();
            document.documentElement.classList.remove('klpf-bulletin-dialog-open');
        };
        dialog.querySelector('.klpf-bulletin-close').addEventListener('click', close, { once: true });
        overlay.addEventListener('click', event => {
            if (event.target === overlay) close();
        });
        overlay.appendChild(dialog);
        root.appendChild(overlay);
        document.documentElement.classList.add('klpf-bulletin-dialog-open');
        document.body?.appendChild(root);
        dialog.querySelector('.klpf-bulletin-close').focus({ preventScroll: true });
    }

    /**
     * 取得要求を識別するIDを生成する。
     * @returns {string} 表示または識別に使う文字列。
     */
    function getRequestId() {
        return globalThis.crypto?.randomUUID?.()
            || `bulletin-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    }

    /**
     * 掲示板見出しの更新中表示を切り替える。
     * @param {boolean} updating - 掲示板を更新中として表示するかどうか。
     * @returns {void} 戻り値はない。
     */
    function setUpdating(updating) {
        const label = getNewsContainer()?.querySelector('[data-klpf-bulletin-updating]');
        if (label) label.hidden = !updating;
    }

    /**
     * 掲示板取得に関する案内またはエラーを表示する。
     * @param {string|object} message - 表示する案内文、または受信した機能メッセージ。
     * @param {boolean} [isError=false] - エラーとして表示するかどうか。
     * @returns {void} 戻り値はない。
     */
    function showFetchMessage(message, isError = false) {
        const block = ensureBlock();
        if (!block) return;
        setUpdating(!isError);
        if (latestItems.length > 0) { renderItems(latestItems); return; }
        setBlockMessage(block, message, isError ? 'klpf-bulletin-error' : 'klpf-bulletin-loading');
    }

    /**
     * 保存された掲示板キャッシュを読み取り、形式を確認する。
     * @returns {Promise<void>} 処理の完了を待つPromise。
     */
    async function loadCache() {
        try {
            const stored = await chrome.storage.local.get(CACHE_KEY);
            const cache = stored[CACHE_KEY];
            if (cache?.version === CACHE_VERSION && Array.isArray(cache.items)) {
                renderItems(cache.items);
            }
        } catch (error) {
            console.debug('[KLPF] 掲示板キャッシュを読み込めませんでした。', error);
        }
    }

    /**
     * キャッシュ表示を維持したまま、必要な掲示板更新をバックグラウンドへ要求する。
     * @returns {Promise<void>} 処理の完了を待つPromise。
     */
    async function requestBulletins() {
        if (!isEnabled() || fetchStarted) return;
        fetchStarted = true;
        await loadCache();
        if (!isEnabled()) { fetchStarted = false; return; }
        setUpdating(true);
        const requestId = getRequestId();
        activeRequestId = requestId;
        try {
            const response = await chrome.runtime.sendMessage({
                type: 'request-bulletin-board',
                requestId,
            });
            if (activeRequestId !== requestId || !isEnabled()) return;
            if (response?.status === 'cached' && response.result) {
                renderItems(response.result.items);
                setUpdating(false);
                activeRequestId = '';
                return;
            }
            if (['started', 'already-running'].includes(response?.status)) {
                showFetchMessage('掲示板を更新中…');
                return;
            }
            const messages = {
                'kuport-open': 'Ku-Portが開いているため取得できません。',
                busy: 'Ku-Portを使う別の取得処理が実行中です。',
                'auto-login-disabled': '自動ログインが無効なため取得できません。',
                'feature-disabled': '掲示板表示がOFFになっています。',
            };
            showFetchMessage(response?.message || messages[response?.status] || '掲示板を取得できませんでした。', true);
            activeRequestId = '';
        } catch (error) {
            activeRequestId = '';
            showFetchMessage('掲示板の通信を開始できませんでした。', true);
            console.debug('[KLPF] 掲示板取得の開始に失敗しました。', error);
        }
    }

    /**
     * 連続した変更をまとめ、次の表示更新を予約する。
     * @returns {void} 戻り値はない。
     */
    function scheduleRender() {
        if (renderTimer) return;
        renderTimer = window.requestAnimationFrame(() => {
            renderTimer = 0;
            if (!featureStateLoaded) return;
            const block = ensureBlock();
            if (block && !fetchStarted) void requestBulletins();
        });
    }

    /**
     * バックグラウンドからの掲示板取得結果と進捗を表示へ反映する。
     * @param {string|object} message - 表示する案内文、または受信した機能メッセージ。
     * @returns {void} 戻り値はない。
     */
    function handleLmsMessage(message) {
        if (message?.type === 'bulletin-board-phase' && message.requestId === activeRequestId) {
            showFetchMessage(message.phase === 'loading-bulletin-details'
                ? '掲示本文を取得中…'
                : '掲示板を取得中…');
            return;
        }
        if (message?.type !== 'bulletin-board-result' || message.requestId !== activeRequestId) return;
        activeRequestId = '';
        setUpdating(false);
        if (message.ok) {
            renderItems(message.result?.items || []);
        } else if (latestItems.length > 0) {
            renderItems(latestItems);
        } else {
            showFetchMessage(message.message || '掲示板を取得できませんでした。', true);
        }
    }

    /**
     * 保存された設定と表示状態を読み取り、機能内の状態へ反映する。
     * @returns {Promise<void>} 処理の完了を待つPromise。
     */
    async function loadState() {
        const [syncSettings, localSettings] = await Promise.all([
            chrome.storage.sync.get(FEATURE_ENABLED_KEY),
            chrome.storage.local.get(ALL_FEATURES_DISABLED_KEY),
        ]);
        featureEnabled = syncSettings[FEATURE_ENABLED_KEY] !== false;
        allFeaturesDisabled = localSettings[ALL_FEATURES_DISABLED_KEY] === true;
        featureStateLoaded = true;
        scheduleRender();
    }

    /**
     * 設定・キャッシュを読み込み、掲示板枠と変更監視を初期化する。
     * @returns {void} 戻り値はない。
     */
    function initializeLms() {
        globalThis.KLPFKuportAccess.subscribe(access => {
            if (!access.ready) {
                fetchStarted = false;
                activeRequestId = '';
                document.getElementById(DIALOG_ID)?.querySelector('.klpf-bulletin-close')?.click();
            }
            scheduleRender();
        });
        ensureStyles();
        observer = new MutationObserver(scheduleRender);
        observer.observe(document.documentElement, { childList: true, subtree: true });
        chrome.runtime.onMessage.addListener(handleLmsMessage);
        chrome.storage.onChanged.addListener((changes, area) => {
            if (area === 'sync' && changes[FEATURE_ENABLED_KEY]) {
                featureEnabled = changes[FEATURE_ENABLED_KEY].newValue !== false;
                if (!featureEnabled) fetchStarted = false;
                scheduleRender();
            }
            if (area === 'local' && changes[ALL_FEATURES_DISABLED_KEY]) {
                allFeaturesDisabled = changes[ALL_FEATURES_DISABLED_KEY].newValue === true;
                if (allFeaturesDisabled) fetchStarted = false;
                scheduleRender();
            }
        });
        void loadState();
    }

    if (isLmsHome()) initializeLms();
})();
