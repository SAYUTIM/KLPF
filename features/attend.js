// Copyright (c) 2024 SAYU
// This software is released under the MIT License, see LICENSE.

// 授業スケジュール（将来的に自動退出機能を実装するため、endフィールドも保持）
const schedule = [
    { start: "10:10", end: "11:40", label: "2限" },
    { start: "12:30", end: "14:00", label: "3限" },
    { start: "14:10", end: "15:40", label: "4限" },
    { start: "19:36", end: "17:20", label: "5限" }
];

const CHECK_INTERVAL = 3000; // チェック間隔：3秒
const margin_time = 3; // 授業開始の3分前に処理を実行

// ページ遷移時のデータ保持に使用するフラグ
const FLAG_reload = 'reload';
const FLAG_lesson = 'lesson';
const FLAG_attend = 'attend';
const FLAG_ok = 'ok';
const FLAG_meet = 'meet';


let attendbutton; // 自動出席ボタンの有無
let term = "";    // 学期
let time = "";    // 時限
let meetID = "";  // Meetのリンク
let day;
let hours;
let minutes;

let counter = 0;  // 処理カウンター（リトライ制御）

// 設定をChromeストレージから取得
chrome.storage.sync.get(["attendC", "attendM", "attendD", "attendT", "attendA"], (result) => {
    attendbutton = result.attendA || false;
    term = result.attendC || term;
    meetID = result.attendM || meetID;
    day = parseInt(result.attendD, 10) || day;
    time = result.attendT || time;

    // スケジュールから開始時刻を取得
    const schedulePeriod = schedule.find(item => item.label === result.attendT);
    if (schedulePeriod) {
        const [h, m] = schedulePeriod.start.split(":").map(Number);
        hours = h;
        minutes = m;
    }
});

// 自動出席処理
function autoAttend() {
    const now = new Date();
    const currentDay = now.getDay();      
    const currentHours = now.getHours();
    const currentMinutes = now.getMinutes();

    // 指定時間に自動出席処理を実行
    if (currentDay === day && currentHours === hours && currentMinutes === minutes - margin_time) {
        if (attendbutton) { // 出席ボタンを押すかどうか

            // 自動ログアウトを考慮してページをリロード
            if (!(localStorage.getItem(FLAG_reload) === 'true')) {
                localStorage.setItem(FLAG_reload, 'true');
                window.location.href = 'https://study.ns.kogakuin.ac.jp/';
            }

            // 授業カードのクリック
            if (!(localStorage.getItem(FLAG_lesson) === 'true')) {
                const dayLabels = ["日曜日", "月曜日", "火曜日", "水曜日", "木曜日", "金曜日", "土曜日"];
                const targetDayLabel = dayLabels[day];
                const courseCards = document.querySelectorAll(".lms-daybox .lms-category-title");

                courseCards.forEach((label) => {

                    // 一致する日付
                    if (label.textContent.trim() === targetDayLabel) {
                        const courseCard = label.closest(".lms-daybox").querySelectorAll(".lms-card");

                        courseCard.forEach((card) => {
                            const courseCardInfo = card.querySelector(".courseCardInfo");
                            const courseTerm = courseCardInfo.querySelector(".term").textContent.trim();

                            // 学期と時限
                            if (courseTerm === term && courseCardInfo.textContent.includes(time)) {
                                const lessonLink = card.querySelector(".lms-cardname a");

                                if (lessonLink) {
                                    localStorage.setItem(FLAG_lesson, 'true');
                                    lessonLink.click();
                                }
                            }
                        });
                    }
                });
            }

            // 出席ボタンのクリック
            if (!(localStorage.getItem(FLAG_attend) === 'true')) {
                const attendpush = document.querySelector("input[onclick^=\"syussekiSentakuAdd();\"]");
                counter++;

                if (attendpush) {
                    localStorage.setItem(FLAG_attend, 'true');
                    counter = 0;
                    attendpush.click();
                } 
                else if (counter > 4) { // CHECK_INTERVAL x 4 秒待っても出現しなければスキップ
                    localStorage.setItem(FLAG_attend, 'true');
                    localStorage.setItem(FLAG_ok, 'true');
                    if (meetID) {
                        chrome.runtime.sendMessage({ action: "openTab", url: meetID });
                        alert("回線不良か、出席ボタンが見つからなかったためMeetへの接続を開始します。");
                    }
                }
            }

            // OKボタンのクリック
            if (!(localStorage.getItem(FLAG_ok) === 'true')) {
                const iframe = document.querySelector('iframe[name="dispCosa"]');
                counter++;

                if (iframe) {
                    const iframeDoc = iframe.contentDocument || iframe.contentWindow.document;
                    const okButton = iframeDoc.querySelector('input[type="button"][value="OK"]');
                    if (okButton) {
                        localStorage.setItem(FLAG_ok, 'true');
                        okButton.click();
                        if (meetID) chrome.runtime.sendMessage({ action: "openTab", url: meetID });
                    }
                } 
                else if (counter > 4) { // CHECK_INTERVAL x 4 秒待っても出現しなければスキップ
                    localStorage.setItem(FLAG_ok, 'true');
                    if (meetID) {
                        chrome.runtime.sendMessage({ action: "openTab", url: meetID });
                        alert("回線不良か、OKが見つからなかったためMeetへの接続を開始します。");
                    }
                }
            }
        } else if (!(localStorage.getItem(FLAG_meet) === 'true')) { // 出席ボタンなしの場合はmeet接続
            localStorage.setItem(FLAG_meet, 'true');
            if (meetID) chrome.runtime.sendMessage({ action: "openTab", url: meetID });
            else alert("Meetへの自動出席を試みましたが、Meetのリンクが設定されていないため失敗しました。");
        }
    } else {
        // 状態をリセット
        localStorage.removeItem(FLAG_reload);
        localStorage.removeItem(FLAG_lesson);
        localStorage.removeItem(FLAG_attend);
        localStorage.removeItem(FLAG_ok);
        localStorage.removeItem(FLAG_meet);
    }
}

// 定期実行
setInterval(autoAttend, CHECK_INTERVAL);