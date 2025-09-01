// Copyright (c) 2024-2025 SAYU
// This software is released under the MIT License, see LICENSE.

/**
 * @file LMSの自動ログアウトを防止する機能を提供するモジュール。
 * 定期的にセッション維持APIを叩き、セッションタイムアウトのダイアログを自動で閉じる。
 */

(function() {
    'use strict';

    // iframe内で実行されるのを防ぐ
    if (window.self !== window.top) {
        return;
    }

    let keepAliveIntervalId = null;

    

    // セッションを維持するためのリクエストをサーバーに送信する
    async function sendKeepAliveRequest() {
        const sid = getSid();
        if (!sid) {
            console.warn("[KLPF] セッション維持に必要なSIDが取得できませんでした。定期実行を停止します。");
            if (keepAliveIntervalId) {
                clearInterval(keepAliveIntervalId);
            }
            return;
        }

        const timestamp = new Date().toLocaleString('ja-JP');
        try {
            const response = await fetch(`/lms/cmmnAjax/keepSession;SID=${sid}`, {
                method: 'POST',
                headers: {
                    'X-Requested-With': 'XMLHttpRequest'
                }
            });

            if (!response.ok) {
                throw new Error(`サーバーエラー (ステータス: ${response.status})`);
            }

            const text = await response.text();
            if (text.trim() === 'true') {
                console.log(`[KLPF][${timestamp}] セッション維持成功。`);
            } else {
                console.warn(`[KLPF][${timestamp}] セッション維持の応答が予期せぬ値でした。応答: [${text}]`);
            }
        } catch (error) {
            console.error(`[KLPF][${timestamp}] セッション維持リクエスト中にエラーが発生しました:`, error);
        }
    }

    // セッションタイムアウトの警告ダイアログを監視し、表示されたら「継続」ボタンを自動でクリックする。
    function observeSessionDialog() {
        const observer = new MutationObserver((mutationsList) => {
            for (const mutation of mutationsList) {
                if (mutation.type === 'childList' && mutation.addedNodes.length > 0) {
                    const continueButton = safeQuerySelector('#sessionExpirationAlertDialog .continueButton');
                    if (continueButton) {
                        console.log("[KLPF] セッションタイムアウトの警告ダイアログを検知。自動で継続します。");
                        continueButton.click();
                    }
                }
            }
        });

        observer.observe(document.body, {
            childList: true,
            subtree: true
        });
    }

    // メイン処理
    keepAliveIntervalId = setInterval(sendKeepAliveRequest, SESSION_KEEP_ALIVE_INTERVAL_MS);
    observeSessionDialog();
    console.log("[KLPF] 自動ログアウト防止機能を初期化しました。");
})();
