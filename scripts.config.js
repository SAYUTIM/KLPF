// Copyright (c) 2024-2025 SAYU
// This software is released under the MIT License, see LICENSE.

/**
 * @file 拡張機能のコンテンツスクリプトと設定を管理する。
 */


// 注入するスクリプトが配置されているディレクトリのパス。
const PATHS = {
  FEATURES: 'features/',
  MODULES: `features/modules/`,
  GAS: 'gas/',
};

// 複数の機能で共有されるモジュールスクリプトのパス。
const MODULES = {
  CONSTANTS: `${PATHS.MODULES}constants.js`,
  DOM_UTILS: `${PATHS.MODULES}dom-utils.js`,
  TOTP: `${PATHS.MODULES}totp.js`,
};

// スクリプトを注入するURLパターン。
const URLS = {
  KOGAKUIN_LMS: 'https://study.ns.kogakuin.ac.jp/*',
  KOGAKUIN_LMS_HOME: 'https://study.ns.kogakuin.ac.jp/lms/homeHoml/*',
  KOGAKUIN_LMS_GENERAL: 'https://study.ns.kogakuin.ac.jp/lms/*',
  KOGAKUIN_LMS_hH_KYOZAI: 'https://study.ns.kogakuin.ac.jp/lms/homeHoml/doLinkKougi*',
  KOGAKUIN_LMS_cC: 'https://study.ns.kogakuin.ac.jp/lms/corsColl/*',
  KOGAKUIN_LMS_sS: 'https://study.ns.kogakuin.ac.jp/lms/srcsSrcl/*',
  KOGAKUIN_KUPORT: 'https://ku-port.sc.kogakuin.ac.jp/*',
  KOGAKUIN_AUTH: 'https://auth.kogakuin.ac.jp/*',
  SECIOSS: 'https://slink.secioss.com/*',
  GOOGLE_MEET: 'https://meet.google.com/*',
  GOOGLE_SCRIPT: 'https://script.google.com/*',
};


/**
 * @typedef {Object} ContentScriptConfig
 * @property {string} id - スクリプトの一意なID。
 * @property {string} storageKey - この機能の有効/無効を保存するchrome.storage.syncのキー。
 * @property {string[]} js - 注入するJavaScriptファイルのパスの配列。
 * @property {string[]} matches - スクリプトを注入するURLパターン。
 * @property {chrome.scripting.RunAt} runAt - スクリプトを注入するタイミング。
 * @property {boolean} [enabledByDefault=false] - デフォルトで有効にするか。
 * @property {string} [optionsPanelId] - 対応するオプションパネルのID。
*/

/**
 * コンテンツスクリプトの設定一覧。
 * background.jsは、この設定に基づいて動的にスクリプトを登録・解除します。
 * @type {ContentScriptConfig[]}
*/
export const CONTENT_SCRIPTS_CONFIG = [
    {
        id: 'AutoLoginScript',
        storageKey: 'autoLogin',
        displayName: '自動ログイン',
        displayOrder: 10,
        js: [MODULES.CONSTANTS, MODULES.DOM_UTILS, MODULES.TOTP, `${PATHS.FEATURES}AutoLogin.js`],
        matches: [URLS.KOGAKUIN_LMS, URLS.SECIOSS],
        runAt: 'document_start',
        enabledByDefault: true,
        optionsPanelId: 'auto-login-options',
    },
    {
        id: 'TimeDisplayScript',
        storageKey: 'showTime',
        displayName: '授業時間表示',
        displayOrder: 100,
        js: [MODULES.CONSTANTS, MODULES.DOM_UTILS, `${PATHS.FEATURES}time.js`],
        matches: [URLS.KOGAKUIN_LMS],
        runAt: 'document_idle',
    },
    {
        id: 'AutoAttendScript',
        storageKey: 'autoAttend',
        displayName: '[β] 自動出席',
        displayOrder: 50,
        js: [MODULES.CONSTANTS, MODULES.DOM_UTILS, `${PATHS.FEATURES}attend.js`],
        matches: [URLS.KOGAKUIN_LMS, URLS.GOOGLE_MEET],
        runAt: 'document_idle',
        optionsPanelId: 'auto-attend-options',
    },
    {
        id: 'MeetJoinScript',
        storageKey: 'autoMeet',
        displayName: 'Meetミュート参加',
        displayOrder: 40,
        js: [MODULES.DOM_UTILS, `${PATHS.FEATURES}meet.js`],
        matches: [URLS.GOOGLE_MEET],
        runAt: 'document_idle',
        enabledByDefault: true,
    },
    {
        id: 'KuPortDialogCloseScript',
        storageKey: 'kuportDialogOutsideClose',
        displayName: 'KP枠外簡易閉',
        displayOrder: 90,
        js: [MODULES.DOM_UTILS, `${PATHS.FEATURES}kuportDialogClose.js`],
        matches: [URLS.KOGAKUIN_KUPORT],
        runAt: 'document_end',
        enabledByDefault: true,
    },
    {
        id: 'SearchSubject',
        storageKey: 'searchSubject',
        displayName: '履修中科目のみ表示',
        displayOrder: 80,
        js: [MODULES.CONSTANTS, MODULES.DOM_UTILS, `${PATHS.FEATURES}subject.js`],
        matches: [URLS.KOGAKUIN_LMS_HOME],
        runAt: 'document_start',
        enabledByDefault: true,
    },
    {
        id: 'DarkMode',
        storageKey: 'darkMode',
        displayName: '[β] ダークモード',
        displayOrder: 110,
        js: [`${PATHS.FEATURES}darkmode.js`],
        matches: [URLS.KOGAKUIN_LMS],
        runAt: 'document_start',
    },
    {
        id: 'Homework',
        storageKey: 'homework',
        displayName: '課題リストアップ',
        displayOrder: 30,
        js: [MODULES.CONSTANTS, MODULES.DOM_UTILS, `${PATHS.FEATURES}homework.js`],
        matches: [URLS.KOGAKUIN_LMS_HOME],
        runAt: 'document_end',
        enabledByDefault: true,
        optionsPanelId: 'homework-options',
    },
    {
        id: 'HomeAttendanceBadge',
        storageKey: 'homeAttendanceBadge',
        displayName: 'ホーム出席表示',
        displayOrder: 60,
        js: [MODULES.CONSTANTS, MODULES.DOM_UTILS, `${PATHS.FEATURES}homeAttendance.js`],
        matches: [URLS.KOGAKUIN_LMS_HOME],
        runAt: 'document_idle',
        enabledByDefault: true,
    },
    {
        id: 'logoutblock',
        storageKey: 'logoutblock',
        displayName: '自動ログアウト無効',
        displayOrder: 20,
        js: [MODULES.CONSTANTS, MODULES.DOM_UTILS, `${PATHS.FEATURES}LMSlogoutblock.js`],
        matches: [URLS.KOGAKUIN_LMS_GENERAL],
        runAt: 'document_end',
        enabledByDefault: true,
    },
    /*{
        id: 'customtheme',
        storageKey: 'customtheme',
        js: [`${PATHS.FEATURES}customtheme.js`],
        matches: [URLS.KOGAKUIN_LMS_GENERAL],
        runAt: 'document_end',
    },*/
    {
        id: 'kyozaiopen',
        storageKey: 'kyozaiopen',
        displayName: '教材一括開封',
        displayOrder: 70,
        js: [MODULES.CONSTANTS, MODULES.DOM_UTILS, `${PATHS.FEATURES}kyozaiopen.js`],
        matches: [URLS.KOGAKUIN_LMS_hH_KYOZAI,URLS.KOGAKUIN_LMS_cC,URLS.KOGAKUIN_LMS_sS],
        runAt: 'document_end',
        enabledByDefault: true,
    },
    /*
    --- 新機能追加テンプレート ---
    {
        id: 'TodoFeatureScript',
        storageKey: 'todoFeature',
        js: [MODULES.CONSTANTS, MODULES.DOM_UTILS, `${PATHS.FEATURES}TodoFeature.js`],
        matches: [URLS.KOGAKUIN_LMS],
        runAt: 'document_end',
        enabledByDefault: false,
        optionsPanelId: 'todo-feature-options',
    },
    */
];

/**
 * GAS自動設定用スクリプトの設定。
 * これは通常の有効/無効とは異なり、特定のメッセージによって一時的に注入されます。
 */
export const GAS_SETUP_CONFIG = {
    id: 'gasautosetup',
    js: [`${PATHS.GAS}autosetup.js`],
    matches: [URLS.GOOGLE_SCRIPT],
    runAt: 'document_end',
};

/**
 * コンテキストメニューのID
 */
export const CONTEXT_MENU_ID = 'openOptions';
