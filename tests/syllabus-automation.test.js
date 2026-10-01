

/**
 * @file jsdomとChrome APIの模擬環境でKU-LMS側のシラバス操作を検証する。
 * カードへのボタン配置、メッセージ処理、表示年度などを検査し、実サイトには接続しない。
 */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { JSDOM } from 'jsdom';

const today = new Date();
const currentAcademicYear = String(today.getFullYear() - (today.getMonth() < 3 ? 1 : 0));

const source = await readFile(new URL('../features/syllabus.js', import.meta.url), 'utf8');

/**
 * KU-LMSのDOMと拡張機能APIを模したシラバス表示用の検証環境を作る。
 * @param {string} html - 解析対象のHTMLまたはJSF部分応答。
 * @returns {object} DOM、操作記録、開始・終了処理を持つ模擬環境。
 */
function lmsHarness(html) {
    const dom = new JSDOM(html, {
        url: 'https://study.ns.kogakuin.ac.jp/lms/homeHoml/doIndex;SID=test',
        runScripts: 'outside-only',
        pretendToBeVisual: true,
    });
    const { window } = dom;
    window.HTMLElement.prototype.getClientRects = () => [{ width: 100, height: 20 }];
    Object.defineProperty(window.HTMLElement.prototype, 'innerText', { get() { return this.textContent; } });
    const scrollCalls = [];
    window.scrollTo = (x, y) => { scrollCalls.push([x, y]); };
    const timers = new Set();
    window.setTimeout = (callback, delay = 0) => {
        const timer = setTimeout(() => { timers.delete(timer); callback(); }, Math.min(delay, 1));
        timers.add(timer);
        return timer;
    };
    window.clearTimeout = timer => { clearTimeout(timer); timers.delete(timer); };
    const messages = [];
    let resultListener;
    window.KLPFKuportAccess = {
        ready: true,
        subscribe(listener) { listener({ ready: true }); return () => {}; },
    };
    window.chrome = {
        storage: {
            sync: { get: async () => ({}) },
            local: { get: async () => ({}), set: async () => {} },
            onChanged: { addListener() {} },
        },
        runtime: {
            sendMessage: async (message) => {
                messages.push(message);
                return message.type === 'request-syllabus-lookup'
                    ? { status: 'started' }
                    : { status: 'accepted' };
            },
            onMessage: { addListener(listener) { resultListener = listener; } },
        },
    };
    return {
        window,
        messages,
        get resultListener() { return resultListener; },
        scrollCalls,
        start() { window.eval(source); },
        close() {
            timers.forEach(clearTimeout);
            timers.clear();
            dom.window.close();
        },
    };
}

test('取得結果を表示し、Shadow DOMの閉じるボタンでモーダルを破棄する', { timeout: 5000 }, async () => {
    const app = lmsHarness(`<div class="lms-search-condition-detail">${currentAcademicYear}年度</div>
        <div class="lms-daybox"><div class="lms-category-title"><h3>水曜日</h3></div>
        <div class="lms-card"><div class="lms-cardname">ソフトウェア工学I</div>
        <div class="courseCardInfo">3限 前期</div><div class="lms-carduser">位野木 万里</div></div></div>`);
    try {
        app.start();
        Object.defineProperty(app.window, 'scrollX', { configurable: true, value: 24 });
        Object.defineProperty(app.window, 'scrollY', { configurable: true, value: 480 });
        await new Promise((resolve) => { setTimeout(resolve, 10); });
        const button = app.window.document.querySelector('[data-klpf-syllabus-button]');
        assert.ok(button);
        button.click();
        await new Promise((resolve) => { setTimeout(resolve, 10); });
        const request = app.messages.find((message) => message.type === 'request-syllabus-lookup');
        assert.ok(request);
        app.resultListener({
            type: 'syllabus-lookup-result',
            requestId: request.requestId,
            ok: true,
            result: { text: '授業概要\n授業計画\n具体的な到達目標\n教育課程コード' },
        });
        const host = app.window.document.getElementById('klpf-syllabus-modal-root');
        assert.ok(host);
        assert.equal(host.shadowRoot.querySelector('.raw-source'), null);
        assert.ok(host.shadowRoot.querySelector('.syllabus-table').textContent.includes('教育課程コード'));
        host.shadowRoot.querySelector('.close').click();
        assert.equal(app.window.document.getElementById('klpf-syllabus-modal-root'), null);
        assert.deepEqual(app.scrollCalls.at(-1), [24, 480]);
    } finally {
        await new Promise((resolve) => { setTimeout(resolve, 10); });
        app.close();
    }
});

test('今年度以外の授業カードではシラバスボタンを表示せずKu-Port通信も開始しない', { timeout: 5000 }, async () => {
    const app = lmsHarness(`<div class="lms-search-condition-detail">${Number(currentAcademicYear) - 1}年度</div>
        <div class="lms-daybox"><div class="lms-category-title"><h3>水曜日</h3></div>
        <div class="lms-card"><div class="lms-cardname">過去科目</div>
        <div class="courseCardInfo">3限 前期</div><div class="lms-carduser">担当教員</div></div></div>`);
    try {
        app.start();
        await new Promise((resolve) => { setTimeout(resolve, 10); });
        assert.equal(app.window.document.querySelector('[data-klpf-syllabus-button]'), null);
        assert.equal(app.messages.some((message) => message.type === 'request-syllabus-lookup'), false);
    } finally { app.close(); }
});
