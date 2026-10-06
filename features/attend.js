// Copyright (c) 2024-2026 SAYU
// This software is released under the MIT License, see LICENSE.

/**
 * @file 自動出席機能を担当するモジュール
 * 保存された授業・曜日時限・出席操作の設定を読み、タイマーとDOM操作で出席処理を補助する。
 */

let autoAttendIntervalId = null;
let autoAttendRunning = false;
let autoAttendRevision = 0;

/**
 * 自動出席の定期確認を停止する。
 * @returns {void} 戻り値はない。
 */
function stopAutoAttendPolling() {
    autoAttendRevision += 1;
    if (autoAttendIntervalId !== null) clearInterval(autoAttendIntervalId);
    autoAttendIntervalId = null;
}

/**
 * 保存設定に従って自動出席の定期確認を開始する。
 * @param {object} settings - 保存された機能設定。
 * @param {object} state - 機能内で共有する現在の状態。
 * @returns {void} 戻り値はない。
 */
function startAutoAttendPolling(settings, state) {
    stopAutoAttendPolling();
    autoAttendIntervalId = setInterval(() => {
        if (autoAttendRunning) return;
        state.ensureContext(settings);
        if (!shouldRun(settings) && !state.isReloaded()) return;
        void runAutoAttendSequence(settings, state);
    }, ATTEND_CHECK_INTERVAL_MS);
}
window.addEventListener('pagehide', stopAutoAttendPolling);

/**
 * 機能の状態をlocalStorageで管理するクラス
 */
class AttendState {
    constructor() {
        this.RETRY_LIMIT = 4; // 最初の失敗後、4回まで再試行する。
    }

    /**
     * 日付や授業設定が変わった場合に、前の授業の操作済み状態を解除する。
     * 同じ授業でのページ遷移・再読み込みでは状態を引き継ぐ。
     * @param {AttendSettings} settings - 現在の授業設定。
     * @returns {void} 状態の切り替え。
     */
    ensureContext(settings) {
        const now = new Date();
        const date = `${now.getFullYear()}-${now.getMonth() + 1}-${now.getDate()}`;
        const context = JSON.stringify([date, settings.term, settings.day, settings.time,
            settings.meetID, settings.shouldClickAttendButton]);
        if (localStorage.getItem('klpf-attend-context') === context) return;
        this.resetAll();
        localStorage.setItem('klpf-attend-context', context);
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

    /**
     * 現在の自動出席で再読み込み済みか判定する。
     * @returns {boolean} 条件を満たす場合はtrue。
     */
    isReloaded() { return this._isFlagSet(ATTEND_RELOAD_FLAG); }
    /**
     * 自動出席の再読み込み済み状態を保存する。
     * @param {boolean} value - 対応する操作を完了済みとして記録するかどうか。
     * @returns {void} 戻り値はない。
     */
    setReloaded(value) { this._setFlag(ATTEND_RELOAD_FLAG, value); }

    /**
     * 対象授業を選択済みか判定する。
     * @returns {boolean} 条件を満たす場合はtrue。
     */
    isLessonClicked() { return this._isFlagSet(ATTEND_LESSON_CLICK_FLAG); }
    /**
     * 対象授業の選択済み状態を保存する。
     * @param {boolean} value - 対応する操作を完了済みとして記録するかどうか。
     * @returns {void} 戻り値はない。
     */
    setLessonClicked(value) { this._setFlag(ATTEND_LESSON_CLICK_FLAG, value); }

    /**
     * 出席の送信が完了しているか判定する。
     * @returns {boolean} 条件を満たす場合はtrue。
     */
    isAttendSubmitted() { return this._isFlagSet(ATTEND_SUBMIT_BUTTON_FLAG); }
    /**
     * 出席の送信済み状態を保存する。
     * @param {boolean} value - 対応する操作を完了済みとして記録するかどうか。
     * @returns {void} 戻り値はない。
     */
    setAttendSubmitted(value) { this._setFlag(ATTEND_SUBMIT_BUTTON_FLAG, value); }

    /**
     * 出席確認のOK操作が完了しているか判定する。
     * @returns {boolean} 条件を満たす場合はtrue。
     */
    isOKClicked() { return this._isFlagSet(ATTEND_OK_BUTTON_FLAG); }
    /**
     * 出席確認のOK操作済み状態を保存する。
     * @param {boolean} value - 対応する操作を完了済みとして記録するかどうか。
     * @returns {void} 戻り値はない。
     */
    setOKClicked(value) { this._setFlag(ATTEND_OK_BUTTON_FLAG, value); }

    /**
     * Meetへの参加処理が完了しているか判定する。
     * @returns {boolean} 条件を満たす場合はtrue。
     */
    isMeetJoined() { return this._isFlagSet(ATTEND_MEET_JOIN_FLAG); }
    /**
     * Meetへの参加済み状態を保存する。
     * @param {boolean} value - 対応する操作を完了済みとして記録するかどうか。
     * @returns {void} 戻り値はない。
     */
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
     * @param {object|null} [savedSettings=null] - 監視側が読み取った最新設定。省略時はsyncから取得する。
     * @returns {Promise<void>}
     */
    async load(savedSettings = null) {
        try {
            const result = savedSettings || await chrome.storage.sync.get(["attendC", "attendM", "attendD", "attendT", "attendA"]);
            this.term = result.attendC || "";
            this.meetID = result.attendM || "";
            const day = Number.parseInt(result.attendD, 10);
            this.day = Number.isInteger(day) && day >= 0 && day <= 6 ? day : -1;
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
    console.debug("[KLPF] 対象の授業カードが見つかりませんでした。");
    return false;
}

/**
 * [ステップ3] 出席ボタンをクリックする
 * @param {Function} isActive - 設定変更・停止で古い処理になっていないかを判定する関数。
 * @returns {Promise<boolean>} 成功した場合はtrue
 */
async function step3_clickAttendButton(isActive) {
    console.log("[KLPF] ステップ3: 出席ボタンの検索とクリック");
    const attendButton = await waitForElement("input[onclick^=\"syussekiSentakuAdd();\"]");
    if (attendButton && isActive()) {
        console.log("[KLPF] 出席ボタンを発見。クリックします。");
        attendButton.click();
        return true;
    }
    console.debug("[KLPF] 出席ボタンが見つかりませんでした。");
    return false;
}

/**
 * [ステップ4] OKボタンをクリックする
 * @param {Function} isActive - 設定変更・停止で古い処理になっていないかを判定する関数。
 * @returns {Promise<boolean>} 成功した場合はtrue
 */
async function step4_clickOKButton(isActive) {
    console.log("[KLPF] ステップ4: OKボタンの検索とクリック");
    const iframe = await waitForElement('iframe[name="dispCosa"]');
    if (!isActive() || !iframe || !iframe.contentWindow) {
        console.debug("[KLPF] 確認ダイアログのiframeが見つかりませんでした。");
        return false;
    }
    const okButton = await waitForElement('input[type="button"][value="OK"]', iframe.contentWindow.document);
    if (okButton && isActive()) {
        console.log("[KLPF] OKボタンを発見。クリックします。");
        okButton.click();
        return true;
    }
    console.debug("[KLPF] OKボタンが見つかりませんでした。");
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
        console.debug("[KLPF] Meetのリンクが未設定のため、Meetを開けませんでした。");
    }
}

/**
 * 自動出席のメインシーケンス
 * @param {AttendSettings} settings
 * @param {AttendState} state
 */
async function runAutoAttendSequence(settings, state) {
    if (autoAttendRunning || autoAttendIntervalId === null) return;
    autoAttendRunning = true;
    const revision = autoAttendRevision;
    const isActive = () => revision === autoAttendRevision && autoAttendIntervalId !== null;
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
                if (!isActive()) return;
                if (success) state.setLessonClicked(true);
                else if (state.isRetryLimitExceeded('lesson')) state.setLessonClicked(true); // リトライ上限で見つからなければスキップ
                return;
            }
            if (!state.isAttendSubmitted()) {
                const success = await step3_clickAttendButton(isActive);
                if (!isActive()) return;
                if (success) state.setAttendSubmitted(true);
                else if (state.isRetryLimitExceeded('attend')) {
                    console.debug("[KLPF] 出席ボタンの検索を諦め、Meetへの参加を試みます。");
                    state.setAttendSubmitted(true); // スキップ
                    state.setOKClicked(true); // OKボタンもスキップ
                    joinMeet(settings.meetID);
                }
                return;
            }
            if (!state.isOKClicked()) {
                const success = await step4_clickOKButton(isActive);
                if (!isActive()) return;
                if (success) {
                    state.setOKClicked(true);
                    joinMeet(settings.meetID);
                } else if (state.isRetryLimitExceeded('ok')) {
                    console.debug("[KLPF] OKボタンの検索を諦め、Meetへの参加を試みます。");
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
        if (!isActive()) return;
        console.error("[KLPF] 自動出席シーケンスで予期せぬエラーが発生しました。", error);
        // 例外後に再読み込みから無限にやり直さず、次の設定変更まで停止する。
        stopAutoAttendPolling();
    } finally {
        autoAttendRunning = false;
    }
}

/**
 * メイン処理
 */
async function main() {
    const state = new AttendState();
    globalThis.KLPFFeatureState.watch(
        ['autoAttend', 'attendC', 'attendM', 'attendD', 'attendT', 'attendA'],
        settings => settings.autoAttend === true,
        (enabled, savedSettings) => {
            stopAutoAttendPolling();
            if (!enabled) {
                state.resetAll();
                return;
            }
            const revision = autoAttendRevision;
            const settings = new AttendSettings();
            void settings.load(savedSettings).then(() => {
                if (revision !== autoAttendRevision) return;
                state.ensureContext(settings);
                if (!shouldRun(settings) && !state.isReloaded()) state.resetAll();
                startAutoAttendPolling(settings, state);
            });
        },
    );
}

// トップレベルawaitを避けるため、非同期の即時実行関数でラップする
(async () => {
    await main();
})();
