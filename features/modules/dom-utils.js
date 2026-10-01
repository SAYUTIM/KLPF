// Copyright (c) 2024-2026 SAYU
// This software is released under the MIT License, see LICENSE.

/**
 * @file DOM操作に関する共通ユーティリティ関数
 * DOM検索・要素待機・スタイル注入・SID取得をclassic scriptの共通関数とKLPFDomUtilsへ公開する。
 * 注入順によりconstants.jsの定数を参照するため、ESモジュールとして直接importしない。
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
            resolve(element);
            return;
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
            console.debug(`[KLPF] 要素の待機がタイムアウトしました: ${selector}`);
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
 * 同じIDのstyle要素を重複させずにCSSを注入する。
 * 動的content scriptが設定変更などで再実行されても、同一スタイルを増やさないために使う。
 * @param {string} styleId - style要素へ設定する一意なID。
 * @param {string} cssText - 注入するCSS。
 * @param {HTMLElement} [root] - style要素の追加先。
 * @returns {HTMLStyleElement|null} 既存または新規のstyle要素。
 */
function ensureStyleElement(
    styleId,
    cssText,
    root = document.head || document.documentElement,
) {
    const existingStyle = document.getElementById(styleId);
    if (existingStyle instanceof HTMLStyleElement) return existingStyle;
    if (!root) return null;

    const style = document.createElement('style');
    style.id = styleId;
    style.textContent = cssText;
    root.appendChild(style);
    return style;
}

/**
 * URLからセッションID (SID) を取得する。
 * @returns {string | null} SID。見つからない場合はnull。
 */
function getSid() {
    const match = window.location.href.match(SID_REGEX);
    return match ? match[1] : null;
}

// 従来のトップレベル関数を維持しながら、追加機能では名前空間経由で依存を明示できる。
globalThis.KLPFDomUtils = Object.freeze({
    waitForElement,
    safeQuerySelector,
    safeQuerySelectorAll,
    ensureStyleElement,
    getSid,
});
