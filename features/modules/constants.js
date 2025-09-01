// Copyright (c) 2024-2025 SAYU
// This software is released under the MIT License, see LICENSE.

if (typeof LMS_URL === 'undefined') {
    /**
     * @file 共通の定数を管理するモジュール
     */

    // URL
    var LMS_URL = 'https://study.ns.kogakuin.ac.jp/';
    var LMS_HOME_URL = `${LMS_URL}lms/homeHoml/`;
    var LMS_ERROR_URL = `${LMS_URL}lms/error/`

    // ログインページ
    var LMS_LOGIN_URL = `${LMS_URL}lms/lginLgir/`;
    var KU_SSO = 'https://slink.secioss.com/';
    var SSO_PRELOGIN_URL = `${KU_SSO}pub/prelogin.cgi`;
    var SSO_LOGIN_URL = `${KU_SSO}pub/login.cgi`;
    var SSO_TIMEOUT_URL = `${KU_SSO}sso/timeout.cgi`;

    // 正規表現
    var SID_REGEX = /SID=([a-zA-Z0-9]+)/;

    // DOM要素のIDやクラス名
    var HOMEWORK_CONTAINER_ID = 'homework';
    var HOMEWORK_ITEM_CLASS = 'homeworkItem';
    var HOMEWORK_UPDATING_NOTICE_ID = 'updatingNotice';
    var HOMEWORK_RAW_DATA_IFRAME_ID = 'rawdata';

    // ローカルストレージのキー
    var ATTEND_RELOAD_FLAG = 'klpf-attend-reload';
    var ATTEND_LESSON_CLICK_FLAG = 'klpf-attend-lesson-click';
    var ATTEND_SUBMIT_BUTTON_FLAG = 'klpf-attend-submit-button';
    var ATTEND_OK_BUTTON_FLAG = 'klpf-attend-ok-button';
    var ATTEND_MEET_JOIN_FLAG = 'klpf-attend-meet-join';

    // 時間関連
    var SCHEDULE = [
        { start: "10:10", end: "11:40", label: "2限" },
        { start: "12:30", end: "14:00", label: "3限" },
        { start: "14:10", end: "15:40", label: "4限" },
        { start: "15:50", end: "17:20", label: "5限" }
    ];
    var DAY_LABELS = ["日曜日", "月曜日", "火曜日", "水曜日", "木曜日", "金曜日", "土曜日"];

    // 処理間隔 (ミリ秒)
    var ATTEND_CHECK_INTERVAL_MS = 3000;

    // 自動出席の実行タイミング（授業開始の何分前か）
    var ATTEND_EXECUTION_MARGIN_MIN = 3;

    // セッション送信間隔
    var SESSION_KEEP_ALIVE_INTERVAL_MS = 90 * 60 * 1000; // 90分

    // --- time.js --- 
    var TIME_SCHEDULE_NORMAL = [
        { start: "08:30", end: "10:00", label: "1限" },
        { start: "10:10", end: "11:40", label: "2限" },
        { start: "11:41", end: "12:29", label: "昼休み" },
        { start: "12:30", end: "14:00", label: "3限" },
        { start: "14:10", end: "15:40", label: "4限" },
        { start: "15:50", end: "17:20", label: "5限" },
        { start: "17:30", end: "19:00", label: "6限" }
    ];

    var TIME_SCHEDULE_23_CONTINUOUS = [
        { start: "08:30", end: "10:00", label: "1限" },
        { start: "10:10", end: "11:40", label: "2限" },
        { start: "11:50", end: "13:20", label: "3限" },
        { start: "13:21", end: "14:09", label: "昼休み" },
        { start: "14:10", end: "15:40", label: "4限" },
        { start: "15:50", end: "17:20", label: "5限" },
        { start: "17:30", end: "19:00", label: "6限" }
    ];

    var PAGE_RELOAD_INTERVAL_MS = 30 * 60 * 1000; // 30分

    // --- subject.js ---
    var SUBJECT_FILTER_STORAGE_KEY = 'klpf-course-filter-settings';
    var SUBJECT_HIGHLIGHT_CLASS = 'klpf-subject-highlight';
}