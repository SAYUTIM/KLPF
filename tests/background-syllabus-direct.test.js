

/**
 * @file Chrome APIとfetchを差し替え、シラバス直接通信と取消の契約を検証する。
 * 実際のKu-Portへは接続せず、Service Workerの要求と後片付けを検査する。
 */

import assert from 'node:assert/strict';
import test from 'node:test';

/**
 * Chromeのイベント登録を模したテスト用オブジェクトを作る。
 * @returns {object} リスナーの登録関数を持つ模擬イベント。
 */
function createEvent() {
    return {
        listener: null,
        addListener(listener) { this.listener = listener; },
    };
}

/**
 * Chromeストレージの読み書きを模したテスト用オブジェクトを作る。
 * @param {object} [initial] - テスト用ストレージの初期保存値。
 * @returns {object} 初期値を読み書きする模擬ストレージ。
 */
function createStorage(initial = {}) {
    const data = { ...initial };
    return {
        data,
        async get(keys) {
            if (typeof keys === 'string') return { [keys]: data[keys] };
            if (Array.isArray(keys)) return Object.fromEntries(keys.map(key => [key, data[key]]));
            if (keys && typeof keys === 'object') {
                return Object.fromEntries(Object.keys(keys).map(key => [key, data[key] ?? keys[key]]));
            }
            return { ...data };
        },
        async set(values) { Object.assign(data, values); },
        async remove(keys) {
            for (const key of (Array.isArray(keys) ? keys : [keys])) delete data[key];
        },
    };
}

/**
 * HTML本文とURLを持つ通信応答のテスト用オブジェクトを作る。
 * @param {string|URLSearchParams|null} body - 送信本文。診断ではnullの場合にGETする。
 * @param {string|URL} url - 判定または通信の対象URL。
 * @returns {object} 本文のtext読み取りとURLを持つ模擬通信応答。
 */
function response(body, url) {
    return {
        ok: true,
        status: 200,
        url,
        async text() { return body; },
    };
}

test('syllabus direct communication posts JSF menu, timetable and dialog requests safely', async () => {
    const today = new Date();
    const academicYear = String(today.getFullYear() - (today.getMonth() < 3 ? 1 : 0));
    const originalChrome = globalThis.chrome;
    const originalFetch = globalThis.fetch;
    const session = createStorage();
    const sync = createStorage({ syllabusLookupEnabled: true, autoLogin: true });
    const local = createStorage({ username: 'fixture-user', password: 'fixture-password' });
    const tabs = [{ id: 1, url: 'https://study.ns.kogakuin.ac.jp/lms/homeHoml/doIndex' }];
    const sentMessages = [];
    const fetchRequests = [];
    const windowsCreated = [];
    let addExternalTabOnMenu = false;

    const parserResults = {
        'parse-syllabus-menu': {
            action: 'https://ku-port.sc.kogakuin.ac.jp/uprx/up/bs/bsa001/Bsa00101.xhtml',
            fields: [['menuForm', 'menuForm'], ['javax.faces.ViewState', 'menu-state']],
            studentTimetableMenuId: '6_1_0_0',
        },
        'parse-syllabus-timetable': {
            action: 'https://ku-port.sc.kogakuin.ac.jp/uprx/up/km/kmd008/Kmd00801.xhtml',
            fields: [['funcForm', 'funcForm'], ['javax.faces.ViewState', 'timetable-state']],
            yearFieldName: 'funcForm:nendo_input',
            termFieldName: 'funcForm:gakki_input',
            searchButtonName: 'funcForm:search',
            termOptions: [{ value: '3', label: '後期(3Q)' }],
            syllabusButtons: [],
        },
        'parse-syllabus-timetable-response': {
            action: 'https://ku-port.sc.kogakuin.ac.jp/uprx/up/km/kmd008/Kmd00801.xhtml',
            fields: [['funcForm', 'funcForm'], ['javax.faces.ViewState', 'timetable-state-2']],
            yearFieldName: 'funcForm:nendo_input',
            termFieldName: 'funcForm:gakki_input',
            searchButtonName: 'funcForm:search',
            termOptions: [{ value: '3', label: '後期(3Q)' }],
            syllabusButtons: [{
                id: 'funcForm:j_idt260:0:j_idt269:1:j_idt273:2:j_idt277:0:j_idt297',
                courseCode: 'A1900034',
                courseName: '対象科目',
                text: '対象科目 担当教員 A1900034',
            }],
        },
        'parse-syllabus-response': {
            text: '科目名\n対象科目\n授業計画\n第1回',
            rows: [{ type: 'row', cells: [
                { header: true, width: 25, text: '科目名' },
                { header: false, width: 75, text: '対象科目' },
            ] }],
        },
    };

    const runtime = {
        onInstalled: createEvent(),
        onMessage: createEvent(),
        lastError: null,
        getURL(path) { return `chrome-extension://test/${path}`; },
        async getContexts() { return []; },
        async sendMessage(message) {
            if (message.target === 'kuport-parser') {
                return { success: true, data: parserResults[message.type] };
            }
            return { status: 'accepted' };
        },
    };
    const chrome = {
        runtime,
        alarms: {
            onAlarm: createEvent(),
            async get() {},
            async create() {},
            async clear() {},
        },
        storage: {
            session,
            sync,
            local,
            onChanged: createEvent(),
        },
        tabs: {
            onUpdated: createEvent(),
            onRemoved: createEvent(),
            onCreated: createEvent(),
            async query() { return tabs.slice(); },
            async get(tabId) {
                const tab = tabs.find(candidate => candidate.id === tabId);
                if (!tab) throw new Error("Tab closed");
                return tab;
            },
            async sendMessage(tabId, message) {
                sentMessages.push({ tabId, message });
                return { status: 'accepted' };
            },
            async create() {},
            async update(tabId, update) {
                if (tabId === 101) {
                    setTimeout(() => {
                        const job = session.data['klpf-syllabus-lookup-job'];
                        chrome.runtime.onMessage.listener({
                            type: 'kuport-syllabus-session-ready',
                            requestId: job.requestId,
                            action: 'https://ku-port.sc.kogakuin.ac.jp/uprx/up/bs/bsa001/Bsa00101.xhtml',
                            fields: [['javax.faces.ViewState', 'test-view-state']],
                        }, { tab: { id: 101 } }, () => {});
                    }, 0);
                }
                const tab = tabs.find(candidate => candidate.id === tabId);
                if (tab) Object.assign(tab, update);
                return tab;
            },
            async remove() {},
        },
        windows: {
            onRemoved: createEvent(),
            async create(options) {
                windowsCreated.push(options);
                return { id: 100, tabs: [{ id: 101, windowId: 100 }] };
            },
            async remove() {},
        },
        offscreen: {
            async createDocument() {},
            async closeDocument() {},
        },
        scripting: {
            async getRegisteredContentScripts() { return []; },
            async registerContentScripts() {},
            async unregisterContentScripts() {},
            async executeScript() {},
        },
        contextMenus: { create() {}, onClicked: createEvent() },
    };

    globalThis.chrome = chrome;
    globalThis.fetch = async (url, options = {}) => {
        const body = options.body instanceof URLSearchParams ? options.body.toString() : '';
        fetchRequests.push({ url, method: options.method || 'GET', body });
        if (!options.method) return response('<html>menu</html>', url);
        if (body.includes('menuForm%3AmainMenu_menuid=6_1_0_0')) {
            if (addExternalTabOnMenu) {
                tabs.push({ id: 2, url: 'https://ku-port.sc.kogakuin.ac.jp/uprx/up/xu/xuk004/Xuk00401.xhtml' });
            }
            return response('<html>timetable</html>', url);
        }
        if (body.includes('javax.faces.source=funcForm%3Asearch')) {
            return response('<partial-response>timetable</partial-response>', url);
        }
        return response('<partial-response>syllabus</partial-response>', url);
    };

    try {
        await import(`../background.js?syllabus-direct-test=${Date.now()}`);
        const resultPromise = new Promise(resolve => {
            const originalSend = chrome.tabs.sendMessage;
            chrome.tabs.sendMessage = async (tabId, message) => {
                const result = await originalSend(tabId, message);
                if (message.type === 'syllabus-lookup-result') resolve(message);
                return result;
            };
        });
        const send = message => new Promise(resolve => {
            chrome.runtime.onMessage.listener(message, { tab: { id: 1 } }, resolve);
        });

        const started = await send({
            type: 'request-syllabus-lookup',
            requestId: 'direct-1',
            course: {
                academicYear,
                termText: '後期',
                courseName: '対象科目',
                instructor: '担当教員',
            },
        });
        assert.equal(started.status, 'started');
        const completed = await resultPromise;
        assert.equal(completed.ok, true);
        assert.deepEqual(fetchRequests.map(request => request.method), ['POST', 'POST', 'POST']);
        assert.match(fetchRequests[0].body, /menuForm%3AmainMenu_menuid=6_1_0_0/);
        assert.match(fetchRequests[1].body, /javax.faces.source=funcForm%3Asearch/);
        assert.match(fetchRequests[2].body, /javax.faces.source=funcForm%3Aj_idt260%3A0%3Aj_idt269%3A1%3Aj_idt273%3A2%3Aj_idt277%3A0%3Aj_idt297/);
        assert.equal(windowsCreated.length, 1);
        assert.equal(windowsCreated[0].state, 'minimized');
        assert.equal(windowsCreated[0].focused, false);

        const currentAcademicYear = String(new Date().getFullYear()
            - (new Date().getMonth() < 3 ? 1 : 0));
        const unsupported = await send({
            type: 'request-syllabus-lookup',
            requestId: 'direct-old-year',
            course: {
                academicYear: String(Number(currentAcademicYear) - 1),
                termText: '後期',
                courseName: '対象科目',
            },
        });
        assert.equal(unsupported.status, 'unsupported-academic-year');

        tabs.push({ id: 3, url: 'https://ku-port.sc.kogakuin.ac.jp/uprx/up/xu/xuk004/Xuk00401.xhtml' });
        const blocked = await send({
            type: 'request-syllabus-lookup',
            requestId: 'direct-blocked',
            course: { academicYear, termText: '後期', courseName: '対象科目' },
        });
        assert.equal(blocked.status, 'kuport-open');
        tabs.splice(1);

        addExternalTabOnMenu = true;
        const cancelledPromise = new Promise(resolve => {
            const originalSend = chrome.tabs.sendMessage;
            chrome.tabs.sendMessage = async (tabId, message) => {
                const result = await originalSend(tabId, message);
                if (message.type === 'syllabus-lookup-result' && message.requestId === 'direct-race') resolve(message);
                return result;
            };
        });
        const raceStarted = await send({
            type: 'request-syllabus-lookup',
            requestId: 'direct-race',
            course: { academicYear, termText: '後期', courseName: '対象科目' },
        });
        assert.equal(raceStarted.status, 'started');
        const cancelled = await cancelledPromise;
        assert.equal(cancelled.ok, false);
        assert.match(cancelled.message, /別のタブ/);
        assert.equal(fetchRequests.filter(request => request.body.includes('javax.faces.source=funcForm%3Aj_idt260')).length, 1);
    } finally {
        globalThis.chrome = originalChrome;
        globalThis.fetch = originalFetch;
    }
});
