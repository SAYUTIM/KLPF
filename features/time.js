// Copyright (c) 2024-2025 SAYU
// This software is released under the MIT License, see LICENSE.

/**
 * @file ヘッダーに現在時刻と次の授業までの残り時間を表示する機能。
 */

(async function() {
    'use strict';

    // ログアウトボタンが表示されるまで待機
    const logoutButtonAnchor = await waitForElement('.lms-logout-button');
    if (!logoutButtonAnchor) return;

    const logoutListItem = logoutButtonAnchor.parentElement;
    const ulList = logoutListItem?.parentElement;
    if (!logoutListItem || !ulList) return;

    let currentSchedule = TIME_SCHEDULE_NORMAL;

    // --- DOM要素の生成 ---
    const timeLi = document.createElement('li');
    timeLi.className = 'time';

    const remainingTimeLi = document.createElement('li');
    remainingTimeLi.className = 'remaining-time';
    remainingTimeLi.style.cursor = 'pointer';
    remainingTimeLi.title = '通常授業/2-3限連続授業 切り替え';

    /**
     * 現在時刻を YYYY/MM/DD HH:mm:ss 形式で取得する。
     * @param {Date} now
     * @returns {string}
     */
    function getFormattedTime(now) {
        const pad = (num) => num.toString().padStart(2, '0');
        return `${now.getFullYear()}/${pad(now.getMonth() + 1)}/${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
    }

    /**
     * 現在時刻とスケジュールから、授業のステータスメッセージを計算する。
     * @param {Date} now
     * @returns {string}
     */
    function calculateStatusMessage(now) {
        const nowMinutes = now.getHours() * 60 + now.getMinutes();

        for (let i = 0; i < currentSchedule.length; i++) {
            const period = currentSchedule[i];
            const [startH, startM] = period.start.split(':').map(Number);
            const [endH, endM] = period.end.split(':').map(Number);
            const startMinutes = startH * 60 + startM;
            const endMinutes = endH * 60 + endM;

            // 現在の期間内 (授業または休憩)
            if (nowMinutes >= startMinutes && nowMinutes < endMinutes) {
                const remaining = endMinutes - nowMinutes;
                return `${period.label}終了まで残り${remaining}分`;
            }

            // 次の期間までの間
            if (i < currentSchedule.length - 1) {
                const nextPeriod = currentSchedule[i + 1];
                const [nextStartH, nextStartM] = nextPeriod.start.split(':').map(Number);
                const nextStartMinutes = nextStartH * 60 + nextStartM;
                if (nowMinutes >= endMinutes && nowMinutes < nextStartMinutes) {
                    const remainingToNext = nextStartMinutes - nowMinutes;
                    return `${nextPeriod.label}開始まで残り${remainingToNext}分`;
                }
            }
        }

        // 全ての授業スケジュール外
        return "授業時間外";
    }

    /**
     * 時刻表示を更新する。
     */
    function updateTime() {
        const now = new Date();
        timeLi.textContent = getFormattedTime(now);
        remainingTimeLi.textContent = calculateStatusMessage(now);
    }

    // --- イベントリスナーの設定 ---
    remainingTimeLi.addEventListener('click', () => {
        currentSchedule = (currentSchedule === TIME_SCHEDULE_NORMAL) ?
            TIME_SCHEDULE_23_CONTINUOUS :
            TIME_SCHEDULE_NORMAL;
        updateTime(); // 即時更新
        console.log("[KLPF] 授業スケジュールを切り替えました。");
    });

    // --- 初期化と定期実行 ---
    ulList.insertBefore(timeLi, logoutListItem.nextSibling);
    ulList.insertBefore(remainingTimeLi, timeLi.nextSibling);

    setInterval(updateTime, 1000);
    updateTime(); // 初回実行

    setTimeout(() => {
        location.reload();
    }, PAGE_RELOAD_INTERVAL_MS);

    console.log("[KLPF] 時刻表示機能を初期化しました。");
})();
