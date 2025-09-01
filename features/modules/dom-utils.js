// Copyright (c) 2024-2025 SAYU
// This software is released under the MIT License, see LICENSE.

/**
 * @file DOM操作に関する共通ユーティリティ関数
 */

/**
 * 指定されたセレクタに一致する要素がDOMに追加されるまで待機する。
 * @param {string} selector - 待機する要素のCSSセレクタ。
 * @param {Document|Element} [root=document] - 検索の起点となる要素。
 * @param {number} [timeout=5000] - タイムアウトまでの時間 (ミリ秒)。
 * @returns {Promise<Element|null>} 発見した要素。タイムアウトした場合はnullを返す。
 */
function waitForElement(selector, root = document, timeout = 5000) {
    return new Promise(resolve => {
        // すでに要素が存在すれば即座に解決
        const element = root.querySelector(selector);
        if (element) {
            return resolve(element);
        }

        let timeoutId = null;

        const observer = new MutationObserver((mutations, obs) => {
            const element = root.querySelector(selector);
            if (element) {
                if (timeoutId) clearTimeout(timeoutId);
                obs.disconnect();
                resolve(element);
            }
        });

        // タイムアウト処理
        timeoutId = setTimeout(() => {
            observer.disconnect();
            console.warn(`[KLPF] 要素の待機がタイムアウトしました: ${selector}`);
            resolve(null);
        }, timeout);

        // 監視を開始
        observer.observe(root, {
            childList: true,
            subtree: true
        });
    });
}

/**
 * querySelectorの安全なラッパー。要素が見つからない場合でもエラーを発生させない。
 * @param {string} selector - 検索する要素のCSSセレクタ。
 * @param {Document|Element} [root=document] - 検索の起点となる要素。
 * @returns {HTMLElement|null} 発見した要素。見つからない場合はnull。
 */
function safeQuerySelector(selector, root = document) {
    try {
        return root.querySelector(selector);
    } catch (error) {
        console.error(`[KLPF] safeQuerySelectorでエラーが発生しました: ${selector}`, error);
        return null;
    }
}

/**
 * querySelectorAllの安全なラッパー。常に配列を返す。
 * @param {string} selector - 検索する要素のCSSセレクタ。
 * @param {Document|Element} [root=document] - 検索の起点となる要素。
 * @returns {HTMLElement[]} 発見した要素の配列。
 */
function safeQuerySelectorAll(selector, root = document) {
    try {
        return Array.from(root.querySelectorAll(selector));
    } catch (error) {
        console.error(`[KLPF] safeQuerySelectorAllでエラーが発生しました: ${selector}`, error);
        return [];
    }
}

/**
 * URLからセッションID (SID) を取得する。
 * @returns {string | null} SID。見つからない場合はnull。
 */
function getSid() {
    const match = window.location.href.match(SID_REGEX);
    return match ? match[1] : null;
}