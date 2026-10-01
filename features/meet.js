// Copyright (c) 2024-2026 SAYU
// This software is released under the MIT License, see LICENSE.

/**
 * @file Google Meetの参加前画面で、カメラとマイクを自動でオフにし、「今すぐ参加」ボタンを自動でクリックする。
 * MeetのDOMと状態ラベルを監視して操作し、参加済みまたは処理完了時に監視とタイマーを止める。
 */

(function() {
    'use strict';

    const CONTROL_KIND = {
        CAMERA: 'camera',
        MIC: 'mic',
    };

    const CONTROL_LABELS = {
        [CONTROL_KIND.CAMERA]: ['カメラ', 'camera'],
        [CONTROL_KIND.MIC]: ['マイク', 'microphone', 'mic'],
    };

    const JOIN_TEXTS = ['今すぐ参加', '参加をリクエスト'];
    const EXIT_LABEL_PATTERNS = ['通話から退出', '退出', 'leave call'];
    const CONTROL_SELECTORS = {
        [CONTROL_KIND.CAMERA]: [
            'button[role="button"][aria-label^="カメラを"][data-is-muted]',
            '[role="button"][aria-label^="カメラを"][data-is-muted]',
            'button[role="button"][aria-label^="Turn off camera"][data-is-muted]',
            'button[role="button"][aria-label^="Turn on camera"][data-is-muted]',
            '[role="button"][aria-label^="Turn off camera"][data-is-muted]',
            '[role="button"][aria-label^="Turn on camera"][data-is-muted]',
        ].join(','),
        [CONTROL_KIND.MIC]: [
            'button[role="button"][aria-label^="マイクを"][data-is-muted]',
            '[role="button"][aria-label^="マイクを"][data-is-muted]',
            'button[role="button"][aria-label^="Turn off microphone"][data-is-muted]',
            'button[role="button"][aria-label^="Turn on microphone"][data-is-muted]',
            '[role="button"][aria-label^="Turn off microphone"][data-is-muted]',
            '[role="button"][aria-label^="Turn on microphone"][data-is-muted]',
        ].join(','),
    };
    const CHECK_INTERVAL_MS = 400;
    const MAX_RUNTIME_MS = 30000;

    let isJoinButtonClicked = false;
    let intervalId = null;
    let timeoutId = null;

    /**
     * 参加後の画面かを判定する。
     * 退出ボタンがある場合、このスクリプトは何もしない。
     */
    function isInMeeting() {
        return safeQuerySelectorAll('[aria-label]').some((element) => {
            const ariaLabel = normalizeText(element.getAttribute('aria-label'));
            return EXIT_LABEL_PATTERNS.some((pattern) => ariaLabel.includes(pattern));
        });
    }

    /**
     * 要素の表示文から前後の空白を除き、小文字にそろえる。
     * @param {*} value - 検証・変換する入力値。
     * @returns {string} 照合用に整えた文字列。
     */
    function normalizeText(value) {
        return (value || '').trim().toLowerCase();
    }

    /**
     * 要素が画面上で表示されているか判定する。
     * @param {Element} element - 操作または読み取りの対象要素。
     * @returns {boolean} 条件を満たす場合はtrue。
     */
    function isVisible(element) {
        if (!element) return false;

        const style = window.getComputedStyle(element);
        return style.display !== 'none'
            && style.visibility !== 'hidden'
            && element.getClientRects().length > 0;
    }

    /**
     * ボタンが表示され、操作可能な状態か判定する。
     * @param {Element} element - 操作または読み取りの対象要素。
     * @returns {boolean} 条件を満たす場合はtrue。
     */
    function isEnabledButton(element) {
        return isVisible(element) && !element.disabled && element.getAttribute('aria-disabled') !== 'true';
    }

    /**
     * Meetの状態通知領域から現在の案内文を読み取る。
     * @returns {string} Meetの状態通知を連結した文字列。
     */
    function getLiveAnnouncementText() {
        return safeQuerySelectorAll('[aria-live]').map((element) => normalizeText(element.textContent)).join(' ');
    }

    /**
     * カメラまたはマイクに対応するMeetの操作ボタンを列挙する。
     * @param {string} kind - 操作対象のカメラまたはマイク。
     * @returns {Element[]} 対象機能の表示中かつ操作可能なボタン。
     */
    function getControlButtons(kind) {
        return safeQuerySelectorAll(CONTROL_SELECTORS[kind]).filter((button) => {
            if (!isEnabledButton(button)) return false;

            const ariaLabel = normalizeText(button.getAttribute('aria-label'));
            if (!ariaLabel) return false;
            return true;
        });
    }

    /**
     * Meetの表示とラベルからカメラまたはマイクの現在状態を判定する。
     * @param {string} kind - 操作対象のカメラまたはマイク。
     * @returns {object} muted・unmuted・unknownの状態と対応ボタン。
     */
    function getControlState(kind) {
        const buttons = getControlButtons(kind);
        const liveText = getLiveAnnouncementText();
        const kindPatterns = CONTROL_LABELS[kind];
        const mutedByAttribute = buttons.find((button) => button.getAttribute('data-is-muted') === 'true');
        if (mutedByAttribute) return { state: 'muted', button: mutedByAttribute };

        const unmutedByAttribute = buttons.find((button) => button.getAttribute('data-is-muted') === 'false');
        if (unmutedByAttribute) return { state: 'unmuted', button: unmutedByAttribute };

        const mutedButton = buttons.find((button) => {
            const label = normalizeText(button.getAttribute('aria-label'));
            return label.includes('オン') || label.includes('on');
        });
        if (mutedButton) return { state: 'muted', button: mutedButton };

        const unmutedButton = buttons.find((button) => {
            const label = normalizeText(button.getAttribute('aria-label'));
            return label.includes('オフ') || label.includes('off');
        });
        if (unmutedButton) return { state: 'unmuted', button: unmutedButton };

        const isMutedByAnnouncement = kindPatterns.some((pattern) => (
            liveText.includes(`${pattern}はオフ`)
            || liveText.includes(`${pattern} is off`)
        ));
        if (isMutedByAnnouncement) return { state: 'muted', button: null };

        const isUnmutedByAnnouncement = kindPatterns.some((pattern) => (
            liveText.includes(`${pattern}はオン`)
            || liveText.includes(`${pattern} is on`)
        ));
        if (isUnmutedByAnnouncement) return { state: 'unmuted', button: null };

        return { state: 'unknown', button: null };
    }

    /**
     * 指定したカメラまたはマイクがオンならオフにする。
     * @param {string} kind - 操作対象のカメラまたはマイク。
     * @returns {boolean} オフにする操作を実行した場合はtrue。
     */
    function forceMuteControl(kind) {
        const { state, button } = getControlState(kind);
        if (state === 'unmuted' && button) {
            button.click();
            return true;
        }
        return false;
    }

    /**
     * カメラとマイクが両方オフになっているか判定する。
     * @returns {boolean} 条件を満たす場合はtrue。
     */
    function areCameraAndMicMuted() {
        const cameraState = getControlState(CONTROL_KIND.CAMERA).state;
        const micState = getControlState(CONTROL_KIND.MIC).state;
        return cameraState === 'muted' && micState === 'muted';
    }

    /**
     * 参加前画面で、カメラとマイクをオフにする。
     */
    function disableCameraAndMic() {
        if (isInMeeting()) {
            isJoinButtonClicked = true;
            return;
        }

        const cameraClicked = forceMuteControl(CONTROL_KIND.CAMERA);
        const micClicked = forceMuteControl(CONTROL_KIND.MIC);

        if (cameraClicked || micClicked) {
            console.log('[KLPF] Google Meet の参加前画面でカメラ/マイクをオフにします。');
        }
    }

    /**
     * 「今すぐ参加」ボタンを探してクリックする。
     * 一度実行されたら、フラグが立ち、再実行されない。
     */
    function clickJoinButton() {
        if (isJoinButtonClicked) return;
        if (isInMeeting()) {
            isJoinButtonClicked = true;
            return;
        }
        if (!areCameraAndMicMuted()) return;

        const joinButton = safeQuerySelectorAll('button').find(
            (button) => isEnabledButton(button)
                && JOIN_TEXTS.some((text) => normalizeText(button.textContent).includes(normalizeText(text)))
        );

        if (joinButton) {
            console.log('[KLPF] 「今すぐ参加」ボタンを自動でクリックします。');
            joinButton.click();
            isJoinButtonClicked = true;
        }
    }

    // すべてのタスクが完了したかチェックする。
    /**
     * Meet参加前の自動操作がすべて完了したか判定する。
     * @returns {boolean} 条件を満たす場合はtrue。
     */
    function allTasksCompleted() {
        return isJoinButtonClicked || isInMeeting();
    }

    /**
     * Meet参加前の自動操作の監視とタイマーを停止する。
     * @returns {void} 戻り値はない。
     */
    function stopProcessing() {
        if (intervalId !== null) {
            clearInterval(intervalId);
            intervalId = null;
        }
        if (timeoutId !== null) {
            clearTimeout(timeoutId);
            timeoutId = null;
        }
    }

    console.log('[KLPF] Google Meet 自動参加機能の監視を開始します。');

    const processMeetPage = () => {
        disableCameraAndMic();
        clickJoinButton();

        if (allTasksCompleted()) {
            stopProcessing();
            console.log('[KLPF] Google Meetの自動処理が完了したため、監視を停止します。');
        }
    };

    processMeetPage();
    if (!allTasksCompleted()) {
        intervalId = window.setInterval(processMeetPage, CHECK_INTERVAL_MS);
        timeoutId = window.setTimeout(stopProcessing, MAX_RUNTIME_MS);
    }

})();
