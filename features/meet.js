// Copyright (c) 2024-2025 SAYU
// This software is released under the MIT License, see LICENSE.

/**
 * @file Google Meetの参加前画面で、カメラとマイクを自動でオフにし、「今すぐ参加」ボタンを自動でクリックする。
 */

(function() {
    'use strict';

    // 各処理が完了したかを追跡するフラグ
    let isCameraMicDisabled = false;
    let isJoinButtonClicked = false;

    /**
     * カメラとマイクをオフにするボタンを探してクリックする。
     * 一度実行されたら、フラグが立ち、再実行されない。
     */
    function disableCameraAndMic() {
        if (isCameraMicDisabled) return;

        // すでに入室済みの場合は、このスクリプトの役割ではないため何もしない
        if (safeQuerySelector('[aria-label*="通話から退出"]')) {
            isCameraMicDisabled = true;
            isJoinButtonClicked = true; // 後続の処理も不要にする
            return;
        }

        // "カメラをオフにする" または "カメラをオフ" にマッチするボタン
        const cameraButton = safeQuerySelector('[aria-label*="カメラをオフ"]');
        if (cameraButton) {
            cameraButton.click();
        }

        // "マイクをオフにする" または "マイクをオフ" にマッチするボタン
        const micButton = safeQuerySelector('[aria-label*="マイクをオフ"]');
        if (micButton) {
            micButton.click();
        }

        // どちらかのボタンが見つかって処理されたら、完了とみなす
        if (cameraButton || micButton) {
            console.log('[KLPF] カメラとマイクを自動でオフにしました。');
            isCameraMicDisabled = true;
        }
    }

    /**
     * 「今すぐ参加」ボタンを探してクリックする。
     * 一度実行されたら、フラグが立ち、再実行されない。
     */
    function clickJoinButton() {
        if (isJoinButtonClicked) return;

        const joinButton = safeQuerySelectorAll('button').find(
            button => button.textContent?.includes('今すぐ参加')
        );

        if (joinButton) {
            console.log('[KLPF] 「今すぐ参加」ボタンを自動でクリックします。');
            joinButton.click();
            if (safeQuerySelector('[aria-label*="通話から退出"]')) isJoinButtonClicked = true;
        }
    }

    // すべてのタスクが完了したかチェックする。
    function allTasksCompleted() {
        return isCameraMicDisabled && isJoinButtonClicked && safeQuerySelector('[aria-label*="通話から退出"]');
    }

    console.log('[KLPF] Google Meet 自動参加機能の監視を開始します。');

    const observer = new MutationObserver(() => {
        disableCameraAndMic();
        clickJoinButton();

        // すべての処理が完了したら、監視を停止して負荷をなくす
        if (allTasksCompleted()) {
            observer.disconnect();
            console.log('[KLPF] Google Meetの自動処理が完了したため、監視を停止します。');
        }
    });

    observer.observe(document.body, {
        childList: true,
        subtree: true
    });

    // 念のため、30秒後に監視を強制停止するタイムアウトを設定
    setTimeout(() => {
        observer.disconnect();
    }, 30000);

})();
