// Copyright (c) 2024-2025 SAYU
// This software is released under the MIT License, see LICENSE.

/**
 * @file LMSに独自のテーマを適用し、レイアウトを2カラムに変更します。
 * また、homework.jsによって生成された課題パネルを左カラムに移動
 */
(function() {
    'use strict';

    const STYLE_ID = 'klpf-custom-theme-style';
    const LEFT_PANEL_ID = 'klpf-custom-left-panel';
    const HOMEWORK_CONTAINER_ID = 'klpf-homework-container';

    /**
     * カスタムテーマのCSS文字列を返す。
     * @returns {string}
     */
    function getThemeCss() {
        return `
        `;
    }

    /**
     * スタイルをDOMに注入する。
     */
    function injectStyles() {
        if (document.getElementById(STYLE_ID)) return;
        const styleElement = document.createElement('style');
        styleElement.id = STYLE_ID;
        // NOTE: CSSが長いため、元の実装通りinnerHTMLを使用しますが、内容は静的なので安全です。
        styleElement.innerHTML = getThemeCss();
        document.head.appendChild(styleElement);
    }

    /**
     * 2カラムレイアウトをセットアップする。
     */
    function setupLayout() {
        if (document.getElementById(LEFT_PANEL_ID)) return;

        const mainWrap = document.querySelector('.lms-wrap');
        if (!mainWrap) return;

        const leftPanel = document.createElement('div');
        leftPanel.id = LEFT_PANEL_ID;
        
        const homeworkContainer = document.createElement('div');
        homeworkContainer.id = HOMEWORK_CONTAINER_ID;
        
        const newsContents = document.querySelector('.lms-news-contents');
        if (newsContents) {
            leftPanel.appendChild(newsContents);
        }

        leftPanel.appendChild(homeworkContainer);
        mainWrap.prepend(leftPanel);
        console.log("[KLPF] カスタムテーマのレイアウトを初期化しました。");
    }

    /**
     * homework.jsによって生成される要素を監視し、左パネルに移動させる。
     */
    function observeAndMoveHomeworkPanel() {
        const container = document.getElementById(HOMEWORK_CONTAINER_ID);
        if (!container) return;

        const observer = new MutationObserver(() => {
            const homeworkPanel = document.getElementById('homework');
            if (homeworkPanel && homeworkPanel.parentElement !== container) {
                container.appendChild(homeworkPanel);
            }
            
            const noticePanel = document.getElementById('updatingNotice');
            if (noticePanel && noticePanel.parentElement !== container) {
                container.prepend(noticePanel);
            }
        });

        // body全体ではなく、より限定的な範囲を監視する
        const targetNode = document.querySelector('.lms-contents-main') || document.body;
        observer.observe(targetNode, { childList: true, subtree: true });
    }

    // --- メイン処理 ---
    injectStyles();
    setupLayout();
    observeAndMoveHomeworkPanel();
})();
