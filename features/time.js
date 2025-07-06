//Copyright (c) 2024-2025 SAYU
//This software is released under the MIT License, see LICENSE.

const interval = setInterval(() => {
    const logoutButtonAnchor = document.querySelector('.lms-logout-button');

    if (logoutButtonAnchor) {
        const logoutListItem = logoutButtonAnchor.parentElement;
        const ulList = logoutListItem.parentElement;

        const time = document.createElement('li');
        const remainingTime = document.createElement('li');
        time.className = 'time';
        remainingTime.className = 'remaining-time';
        remainingTime.style.cursor = 'pointer';
        remainingTime.title = '通常授業/2-3限連続授業 切り替え';


        const scheduleNormal = [
            { start: "08:30", end: "10:00", label: "1限" },
            { start: "10:10", end: "11:40", label: "2限" },
            { start: "11:41", end: "12:29", label: "昼休み" },
            { start: "12:30", end: "14:00", label: "3限" },
            { start: "14:10", end: "15:40", label: "4限" },
            { start: "15:50", end: "17:20", label: "5限" },
            { start: "17:30", end: "19:00", label: "6限" }
        ];

        const schedule23 = [
            { start: "08:30", end: "10:00", label: "1限" },
            { start: "10:10", end: "11:40", label: "2限" },
            { start: "11:50", end: "13:20", label: "3限" },
            { start: "13:21", end: "14:09", label: "昼休み" },
            { start: "14:10", end: "15:40", label: "4限" },
            { start: "15:50", end: "17:20", label: "5限" },
            { start: "17:30", end: "19:00", label: "6限" }
        ];

        let currentSchedule = scheduleNormal; // 初期スケジュールはnormal

        const updateTime = () => {
            const now = new Date();
            time.textContent = `${now.getFullYear()}/${(now.getMonth() + 1).toString().padStart(2, '0')}/${now.getDate().toString().padStart(2, '0')} ${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}:${now.getSeconds().toString().padStart(2, '0')}`;

            const nowMinutes = now.getHours() * 60 + now.getMinutes();
            let message = "授業時間外"; // デフォルトメッセージ
            let periodFound = false; // 現在の期間または期間の間が見つかったか

            for (let i = 0; i < currentSchedule.length; i++) {
                const period = currentSchedule[i];
                const start = period.start.split(":").map(Number);
                const end = period.end.split(":").map(Number);
                const startMinutes = start[0] * 60 + start[1];
                const endMinutes = end[0] * 60 + end[1];

                if (nowMinutes >= startMinutes && nowMinutes < endMinutes) {
                    // 現在の期間内 (授業または定義された休憩)
                    periodFound = true;
                    const remaining = endMinutes - nowMinutes;
                    if (period.label === "昼休み" && (i + 1 < currentSchedule.length)) {
                        // 「昼休み」期間中で、次に授業がある場合
                        const nextPeriod = currentSchedule[i+1];
                        const nextStart = nextPeriod.start.split(":").map(Number);
                        const nextStartMinutes = nextStart[0] * 60 + nextStart[1];
                        const timeToNextClassStart = nextStartMinutes - nowMinutes;
                        message = `${period.label}終了まで残り${remaining}分 (${nextPeriod.label}開始まで${timeToNextClassStart}分)`;
                    } else {
                        message = `${period.label}終了まで残り${remaining}分`;
                    }
                    break; // メッセージ確定
                }

                // 現在の期間は過ぎていて、次の期間が始まるまでの間か
                if (i < currentSchedule.length - 1) {
                    const nextPeriod = currentSchedule[i+1];
                    const nextStart = nextPeriod.start.split(":").map(Number);
                    const nextStartMinutes = nextStart[0] * 60 + nextStart[1];
                    // endMinutes は currentSchedule[i] (現在のループのperiod) の終了時刻
                    if (nowMinutes >= endMinutes && nowMinutes < nextStartMinutes) {
                        periodFound = true;
                        const remainingToNext = nextStartMinutes - nowMinutes;
                        message = `${nextPeriod.label}開始まで残り${remainingToNext}分`;
                        break; // メッセージ確定
                    }
                }
            }

            // ループで見つからなかった場合（＝全授業終了後、または最初の授業開始前）
            if (!periodFound && currentSchedule.length > 0) {
                const firstPeriodStart = currentSchedule[0].start.split(":").map(Number);
                const firstPeriodStartMinutes = firstPeriodStart[0] * 60 + firstPeriodStart[1];
                const lastPeriodEnd = currentSchedule[currentSchedule.length - 1].end.split(":").map(Number);
                const lastPeriodEndMinutes = lastPeriodEnd[0] * 60 + lastPeriodEnd[1];

                if (nowMinutes < firstPeriodStartMinutes) {
                    const remainingToFirst = firstPeriodStartMinutes - nowMinutes;
                    message = `${currentSchedule[0].label}開始まで残り${remainingToFirst}分`;
                } else if (nowMinutes >= lastPeriodEndMinutes) {
                    message = "授業時間外";
                }
            } else if (!periodFound && currentSchedule.length === 0) {
                message = "スケジュールがありません";
            }

            remainingTime.textContent = message;
        };

        remainingTime.addEventListener('click', () => {
            if (currentSchedule === scheduleNormal) currentSchedule = schedule23;
            else currentSchedule = scheduleNormal;
            updateTime();
        });

        ulList.insertBefore(time, logoutListItem.nextSibling);
        ulList.insertBefore(remainingTime, time.nextSibling);

        setInterval(updateTime, 1000);
        updateTime();

        clearInterval(interval);
    }
}, 100);