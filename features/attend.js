// Copyright (c) 2024-2025 SAYU
// This software is released under the MIT License, see LICENSE.

/**
 * @file 自動出席機能を担当するモジュール
 */

/**
 * 機能の状態をlocalStorageで管理するクラス
 */
class AttendState {
    constructor() {
        this.RETRY_LIMIT = 4; // 4回 (約12秒) リトライ
    }

    /**
     * 指定されたフラグが設定されているか確認する
     * @param {string} flagKey
     * @returns {boolean}
     */
    _isFlagSet(flagKey) {
        return localStorage.getItem(flagKey) === 'true';
    }

    /**
     * フラグを設定/解除する
     * @param {string} flagKey
     * @param {boolean} value
     */
    _setFlag(flagKey, value) {
        if (value) {
            localStorage.setItem(flagKey, 'true');
        } else {
            localStorage.removeItem(flagKey);
        }
    }

    /**
     * リトライカウンターをインクリメントし、上限を超えたか判定する
     * @param {string} counterKey
     * @returns {boolean} 上限に達した場合はtrue
     */
    _incrementRetryCounter(counterKey) {
        let counter = parseInt(localStorage.getItem(counterKey) || '0', 10);
        counter++;
        localStorage.setItem(counterKey, counter.toString());
        return counter > this.RETRY_LIMIT;
    }

    isReloaded() { return this._isFlagSet(ATTEND_RELOAD_FLAG); }
    setReloaded(value) { this._setFlag(ATTEND_RELOAD_FLAG, value); }

    isLessonClicked() { return this._isFlagSet(ATTEND_LESSON_CLICK_FLAG); }
    setLessonClicked(value) { this._setFlag(ATTEND_LESSON_CLICK_FLAG, value); }

    isAttendSubmitted() { return this._isFlagSet(ATTEND_SUBMIT_BUTTON_FLAG); }
    setAttendSubmitted(value) { this._setFlag(ATTEND_SUBMIT_BUTTON_FLAG, value); }

    isOKClicked() { return this._isFlagSet(ATTEND_OK_BUTTON_FLAG); }
    setOKClicked(value) { this._setFlag(ATTEND_OK_BUTTON_FLAG, value); }

    isMeetJoined() { return this._isFlagSet(ATTEND_MEET_JOIN_FLAG); }
    setMeetJoined(value) { this._setFlag(ATTEND_MEET_JOIN_FLAG, value); }

    /**
     * すべての状態とカウンターをリセットする
     */
    resetAll() {
        Object.keys(localStorage).forEach(key => {
            if (key.startsWith('klpf-attend-')) {
                localStorage.removeItem(key);
            }
        });
    }

    /**
     * 指定したステップのリトライカウンターが上限に達したか確認する
     * @param {'lesson' | 'attend' | 'ok'} step
     * @returns {boolean}
     */
    isRetryLimitExceeded(step) {
        const key = `klpf-attend-retry-${step}`;
        return this._incrementRetryCounter(key);
    }
}

/**
 * ユーザー設定をchrome.storageから読み込み、管理するクラス
 */
class AttendSettings {
    constructor() {
        this.term = "";
        this.meetID = "";
        this.day = -1;
        this.time = "";
        this.shouldClickAttendButton = false;
        this.startTime = { hours: -1, minutes: -1 };
    }

    /**
     * 設定を非同期に読み込む
     * @returns {Promise<void>}
     */
    async load() {
        try {
            const result = await chrome.storage.sync.get(["attendC", "attendM", "attendD", "attendT", "attendA"]);
            this.term = result.attendC || "";
            this.meetID = result.attendM || "";
            this.day = parseInt(result.attendD, 10) || -1;
            this.time = result.attendT || "";
            this.shouldClickAttendButton = result.attendA || false;

            const schedulePeriod = SCHEDULE.find(item => item.label === this.time);
            if (schedulePeriod) {
                const [h, m] = schedulePeriod.start.split(":").map(Number);
                this.startTime = { hours: h, minutes: m };
            }
        } catch (error) {
            console.error("[KLPF] 設定の読み込みに失敗しました。", error);
        }
    }
}

/**
 * 自動出席処理を実行すべきか判定する
 * @param {AttendSettings} settings
 * @returns {boolean}
 */
function shouldRun(settings) {
    if (settings.day === -1 || settings.startTime.hours === -1) {
        return false;
    }
    const now = new Date();
    const targetTime = new Date();
    targetTime.setHours(settings.startTime.hours, settings.startTime.minutes - ATTEND_EXECUTION_MARGIN_MIN, 0, 0);

    return now.getDay() === settings.day &&
           now.getHours() === targetTime.getHours() &&
           now.getMinutes() === targetTime.getMinutes();
}

/**
 * [ステップ1] ページをリロードする
 */
function step1_reloadPage() {
    console.log("[KLPF] 自動出席シーケンス開始。ページをリロードします。");
    window.location.href = LMS_URL;
}

/**
 * [ステップ2] 授業カードをクリックする
 * @param {AttendSettings} settings
 * @returns {Promise<boolean>} 成功した場合はtrue
 */
async function step2_clickLessonCard(settings) {
    console.log("[KLPF] ステップ2: 授業カードの検索とクリック");
    const targetDayLabel = DAY_LABELS[settings.day];
    const dayBoxes = safeQuerySelectorAll(".lms-daybox");

    for (const box of dayBoxes) {
        const titleElement = safeQuerySelector(".lms-category-title", box);
        if (titleElement?.textContent?.trim() !== targetDayLabel) continue;

        const courseCards = safeQuerySelectorAll(".lms-card", box);
        for (const card of courseCards) {
            const info = card.querySelector(".courseCardInfo")?.textContent || "";
            const term = card.querySelector(".term")?.textContent?.trim() || "";

            if (term === settings.term && info.includes(settings.time)) {
                const lessonLink = card.querySelector(".lms-cardname a");
                if (lessonLink) {
                    console.log(`[KLPF] 授業カード[${settings.term} ${settings.time}]を発見。クリックします。`);
                    lessonLink.click();
                    return true;
                }
            }
        }
    }
    console.warn("[KLPF] 対象の授業カードが見つかりませんでした。");
    return false;
}

/**
 * [ステップ3] 出席ボタンをクリックする
 * @returns {Promise<boolean>} 成功した場合はtrue
 */
async function step3_clickAttendButton() {
    console.log("[KLPF] ステップ3: 出席ボタンの検索とクリック");
    const attendButton = await waitForElement("input[onclick^=\"syussekiSentakuAdd();\"]");
    if (attendButton) {
        console.log("[KLPF] 出席ボタンを発見。クリックします。");
        attendButton.click();
        return true;
    }
    console.warn("[KLPF] 出席ボタンが見つかりませんでした。");
    return false;
}

/**
 * [ステップ4] OKボタンをクリックする
 * @returns {Promise<boolean>} 成功した場合はtrue
 */
async function step4_clickOKButton() {
    console.log("[KLPF] ステップ4: OKボタンの検索とクリック");
    const iframe = await waitForElement('iframe[name="dispCosa"]');
    if (!iframe || !iframe.contentWindow) {
        console.warn("[KLPF] 確認ダイアログのiframeが見つかりませんでした。");
        return false;
    }
    const okButton = await waitForElement('input[type="button"][value="OK"]', iframe.contentWindow.document);
    if (okButton) {
        console.log("[KLPF] OKボタンを発見。クリックします。");
        okButton.click();
        return true;
    }
    console.warn("[KLPF] OKボタンが見つかりませんでした。");
    return false;
}

/**
 * Google Meetのタブを開く
 * @param {string} meetID
 */
function joinMeet(meetID) {
    if (meetID) {
        console.log(`[KLPF] Google Meet (ID: ${meetID}) を開きます。`);
        chrome.runtime.sendMessage({ action: "openTab", url: meetID });
    } else {
        console.warn("[KLPF] Meetのリンクが未設定のため、Meetを開けませんでした。");
    }
}

/**
 * 自動出席のメインシーケンス
 * @param {AttendSettings} settings
 * @param {AttendState} state
 */
async function runAutoAttendSequence(settings, state) {
    try {
        if (settings.shouldClickAttendButton) {
            // --- 出席ボタンを押すフロー ---
            if (!state.isReloaded()) {
                state.setReloaded(true);
                step1_reloadPage();
                return; // リロード後は処理を中断
            }
            if (!state.isLessonClicked()) {
                const success = await step2_clickLessonCard(settings);
                if (success) state.setLessonClicked(true);
                else if (state.isRetryLimitExceeded('lesson')) state.setLessonClicked(true); // リトライ上限で見つからなければスキップ
                return;
            }
            if (!state.isAttendSubmitted()) {
                const success = await step3_clickAttendButton();
                if (success) state.setAttendSubmitted(true);
                else if (state.isRetryLimitExceeded('attend')) {
                    console.warn("[KLPF] 出席ボタンの検索を諦め、Meetへの参加を試みます。");
                    state.setAttendSubmitted(true); // スキップ
                    state.setOKClicked(true); // OKボタンもスキップ
                    joinMeet(settings.meetID);
                }
                return;
            }
            if (!state.isOKClicked()) {
                const success = await step4_clickOKButton();
                if (success) {
                    state.setOKClicked(true);
                    joinMeet(settings.meetID);
                } else if (state.isRetryLimitExceeded('ok')) {
                    console.warn("[KLPF] OKボタンの検索を諦め、Meetへの参加を試みます。");
                    state.setOKClicked(true); // スキップ
                    joinMeet(settings.meetID);
                }
            }
        } else {
            // --- Meetに直行するフロー ---
            if (!state.isMeetJoined()) {
                state.setMeetJoined(true);
                joinMeet(settings.meetID);
            }
        }
    } catch (error) {
        console.error("[KLPF] 自動出席シーケンスで予期せぬエラーが発生しました。", error);
        state.resetAll(); // エラー発生時は状態をリセット
    }
}

/**
 * メイン処理
 */
async function main() {
    const settings = new AttendSettings();
    await settings.load();
    const state = new AttendState();

    // 実行条件を満たしている場合、または既にシーケンスが進行中の場合
    if (shouldRun(settings) || state.isReloaded()) {
        console.log("[KLPF] 自動出席処理を開始します。");
        setInterval(async () => {
            await runAutoAttendSequence(settings, state);
        }, ATTEND_CHECK_INTERVAL_MS);
    } else {
        state.resetAll();
    }
}

// トップレベルawaitを避けるため、非同期の即時実行関数でラップする
(async () => {
    await main();
})();
