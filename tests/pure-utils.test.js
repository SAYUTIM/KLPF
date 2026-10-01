// Copyright (c) 2024-2026 SAYU
// This software is released under the MIT License, see LICENSE.

/** @file 外部サービスへ接続せず検証できる共通処理の回帰テスト。 */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { JSDOM } from 'jsdom';

import { assertKuportUrl, isAllowedWebhookUrl } from '../background/modules/url-utils.js';
import {
    createFormBody,
    throwIfAttendanceFetchAborted,
} from '../background/modules/attendance-state.js';
import { createExportPayload, validateImportPayload } from '../setting/modules/backup-format.js';
import { isVersionNewer, parseVersionParts } from '../features/modules/version-utils.js';

await import('../features/modules/attendance-utils.js');
await import('../features/modules/form-utils.js');
await import('../features/modules/totp.js');

test('version comparison accepts release tags without changing semantic order', () => {
    assert.deepEqual(parseVersionParts('v4.4.2'), [4, 4, 2]);
    assert.equal(isVersionNewer('v4.5.0', '4.4.2'), true);
    assert.equal(isVersionNewer('4.4.2', '4.4.2'), false);
    assert.equal(isVersionNewer('4.3.9', '4.4.2'), false);
});

test('TOTP implementation matches the RFC 6238 SHA-1 vector', async () => {
    const originalNow = Date.now;
    Date.now = () => 59_000;
    try {
        const token = await globalThis.KLPFTotp.generateTOTP(
            'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ',
            { digits: 8 },
        );
        assert.equal(token, '94287082');
    } finally {
        Date.now = originalNow;
    }
});

test('attendance records keep normalization, rate and latest touch date', () => {
    const dom = new JSDOM(`
        <table><tbody><tr>
          <td>月 2</td><td>A1234567 ソフトウェア 工学（前期）</td><td>87.5%</td>
          <td><span class="jugyoDate">04/10</span><span class="syuketsuKbnMark">〇</span></td>
          <td><span class="jugyoDate">04/17</span><span class="syuketsuKbnMark">〇</span></td>
        </tr></tbody></table>
    `);
    const [record] = globalThis.KLPFAttendanceUtils.parseAttendanceRecords(dom.window.document);
    assert.deepEqual(record, {
        schedule: '月2',
        courseCode: 'A1234567',
        courseName: 'ソフトウェア 工学',
        normalizedName: 'ソフトウェア工学',
        rate: 87.5,
        lastAttendanceDate: '04/17',
    });
});

test('external URL allowlists reject credentials, HTTP and unrelated hosts', () => {
    assert.equal(isAllowedWebhookUrl('https://script.google.com/macros/s/example/exec'), true);
    assert.equal(isAllowedWebhookUrl('http://script.google.com/example'), false);
    assert.equal(isAllowedWebhookUrl('https://user:pass@example.com/hook'), false);
    assert.equal(
        assertKuportUrl('https://ku-port.sc.kogakuin.ac.jp/campusweb/'),
        'https://ku-port.sc.kogakuin.ac.jp/campusweb/',
    );
    assert.throws(() => assertKuportUrl('https://example.com/'), /Ku-port以外/);
});

test('background attendance form body keeps repeated string fields', () => {
    const body = createFormBody([
        ['token', 'a'],
        ['token', 'b'],
        ['ignored', { name: 'file' }],
    ]);
    assert.deepEqual(body.getAll('token'), ['a', 'b']);
    assert.equal(body.has('ignored'), false);
    assert.doesNotThrow(() => throwIfAttendanceFetchAborted(new AbortController().signal));
    const controller = new AbortController();
    controller.abort();
    assert.throws(
        () => throwIfAttendanceFetchAborted(controller.signal),
        error => error.name === 'AbortError',
    );
});

test('form serialization keeps text fields and resolves relative actions', () => {
    const dom = new JSDOM(`
        <form action="/submit">
          <input name="token" value="abc">
          <input name="empty" value="">
        </form>
    `, { url: 'https://ku-port.sc.kogakuin.ac.jp/base/' });
    const previousFormData = globalThis.FormData;
    globalThis.FormData = dom.window.FormData;
    try {
        const form = dom.window.document.querySelector('form');
        assert.deepEqual(globalThis.KLPFFormUtils.serializeFormEntries(form), [
            ['token', 'abc'],
            ['empty', ''],
        ]);
        assert.deepEqual(globalThis.KLPFFormUtils.serializeFormObject(form), {
            token: 'abc',
            empty: '',
        });
        assert.equal(
            globalThis.KLPFFormUtils.resolveFormAction(
                form,
                'https://ku-port.sc.kogakuin.ac.jp/base/',
            ),
            'https://ku-port.sc.kogakuin.ac.jp/submit',
        );
    } finally {
        globalThis.FormData = previousFormData;
    }
});

test('shared style injection remains idempotent across repeated initialization', async () => {
    const source = await readFile(
        new URL('../features/modules/dom-utils.js', import.meta.url),
        'utf8',
    );
    const dom = new JSDOM('<!doctype html><html><head></head><body></body></html>', {
        runScripts: 'outside-only',
    });
    dom.window.eval(source);
    const first = dom.window.KLPFDomUtils.ensureStyleElement('klpf-test-style', 'body { color: red; }');
    const second = dom.window.KLPFDomUtils.ensureStyleElement('klpf-test-style', 'body { color: blue; }');
    assert.equal(first, second);
    assert.equal(dom.window.document.querySelectorAll('#klpf-test-style').length, 1);
    assert.match(first.textContent, /color: red/);
});

test('offscreen parser preserves the KU-PORT form message payload', async () => {
    const dom = new JSDOM('', { url: 'https://ku-port.sc.kogakuin.ac.jp/' });
    const previousGlobals = new Map();
    for (const [name, value] of Object.entries({
        DOMParser: dom.window.DOMParser,
        FormData: dom.window.FormData,
        HTMLElement: dom.window.HTMLElement,
        HTMLFormElement: dom.window.HTMLFormElement,
        HTMLInputElement: dom.window.HTMLInputElement,
        HTMLSelectElement: dom.window.HTMLSelectElement,
        chrome: { runtime: { onMessage: { addListener() {} } } },
    })) {
        previousGlobals.set(name, globalThis[name]);
        globalThis[name] = value;
    }

    try {
        await import('../offscreen/kuportParser.js');
        const result = globalThis.KLPFKuportParser.parseAttendanceForm(`
            <form id="funcForm" action="/attendance">
              <input name="javax.faces.ViewState" value="state-token">
              <select id="funcForm:kaikoNendoGakki_input" name="term">
                <option selected value="2026">2026年度 前期</option>
              </select>
            </form>
        `, 'https://ku-port.sc.kogakuin.ac.jp/menu');
        assert.equal(result.action, 'https://ku-port.sc.kogakuin.ac.jp/attendance');
        assert.deepEqual(result.fields, [
            ['javax.faces.ViewState', 'state-token'],
            ['term', '2026'],
        ]);
        assert.equal(result.academicTerm, '2026年度 前期');
    } finally {
        for (const [name, value] of previousGlobals) globalThis[name] = value;
    }
});

test('offscreen parser extracts direct timetable fields, syllabus button and partial dialog rows', async () => {
    const parser = globalThis.KLPFKuportParser;
    const dom = new JSDOM('');
    const previousGlobals = new Map();
    for (const [name, value] of Object.entries({
        DOMParser: dom.window.DOMParser,
        FormData: dom.window.FormData,
        HTMLElement: dom.window.HTMLElement,
        HTMLFormElement: dom.window.HTMLFormElement,
        HTMLInputElement: dom.window.HTMLInputElement,
        HTMLSelectElement: dom.window.HTMLSelectElement,
    })) {
        previousGlobals.set(name, globalThis[name]);
        globalThis[name] = value;
    }
    try {
        const timetable = parser.parseStudentTimetableForm(`
        <form id="funcForm" action="/uprx/up/km/kmd008/Kmd00801.xhtml">
          <input name="funcForm" value="funcForm">
          <input id="funcForm:nendo_input" name="funcForm:nendo_input" value="2026">
          <select id="funcForm:gakki_input" name="funcForm:gakki_input">
            <option value="1">前期(1Q)</option><option value="3" selected>後期(3Q)</option>
          </select>
          <input id="funcForm:search" name="funcForm:search" value="表示">
          <table><tr><td><div class="fontB">対象科目 [J1]</div>
            <span>担当教員 A1900034</span>
            <button id="funcForm:course" name="funcForm:course" title="シラバス照会画面を表示します。"></button>
          </td></tr></table>
          <input name="javax.faces.ViewState" value="state-1">
        </form>
        `, 'https://ku-port.sc.kogakuin.ac.jp/uprx/up/km/kmd008/Kmd00801.xhtml');
        assert.equal(timetable.action, 'https://ku-port.sc.kogakuin.ac.jp/uprx/up/km/kmd008/Kmd00801.xhtml');
        assert.equal(timetable.yearFieldName, 'funcForm:nendo_input');
        assert.deepEqual(timetable.termOptions, [
            { value: '1', label: '前期(1Q)' },
            { value: '3', label: '後期(3Q)' },
        ]);
        assert.equal(timetable.syllabusButtons[0].id, 'funcForm:course');
        assert.equal(timetable.syllabusButtons[0].courseCode, 'A1900034');

        const timetableResponse = `<partial-response><changes>
          <update id="funcForm"><![CDATA[
            <form id="funcForm" action="/uprx/up/km/kmd008/Kmd00801.xhtml">
              <input id="funcForm:nendo_input" name="funcForm:nendo_input" value="2026">
              <select id="funcForm:gakki_input" name="funcForm:gakki_input"><option value="3">後期(3Q)</option></select>
              <button id="funcForm:search" name="funcForm:search">表示</button>
              <div class="jugyo-info"><div class="fontB">対象科目 [J1]</div>
                <span>担当教員 A1900034</span>
                <button id="funcForm:course" name="funcForm:course" title="シラバス照会画面を表示します。"></button>
              </div>
            </form>
          ]]></update>
          <update id="j_id1:javax.faces.ViewState:0"><![CDATA[state-2]]></update>
        </changes></partial-response>`;
        const updatedTimetable = parser.parseSyllabusTimetableResponse(
            timetableResponse,
            'https://ku-port.sc.kogakuin.ac.jp/uprx/up/km/kmd008/Kmd00801.xhtml',
        );
        assert.equal(updatedTimetable.fields.find(([name]) => name === 'javax.faces.ViewState')?.[1], 'state-2');
        assert.equal(updatedTimetable.syllabusButtons[0].id, 'funcForm:course');

        const response = `<partial-response><changes>
      <update id="pkx02301:dialogPanel"><![CDATA[
        <div id="pkx02301:dialogPanel"><div class="table">
          <div class="rowStyle"><div class="ui-widget-header" style="width:25%">科目名</div>
            <div class="ui-widget-content" style="width:75%"><div class="fr-box fr-view">対象科目</div></div></div>
          <div class="rowStyle"><div class="ui-widget-header" style="width:25%">授業計画</div>
            <div class="ui-widget-content" style="width:75%"><div class="fr-box fr-view">第1回</div></div></div>
        </div></div>
      ]]></update>
      <update id="j_id1:javax.faces.ViewState:0"><![CDATA[state-2]]></update>
    </changes></partial-response>`;
        const syllabus = parser.parseSyllabusResponse(response);
        assert.equal(syllabus.viewState, 'state-2');
        assert.equal(syllabus.rows[0].cells[0].text, '科目名');
        assert.equal(syllabus.rows[1].cells[1].text, '第1回');
        assert.match(syllabus.text, /対象科目/);
    } finally {
        for (const [name, value] of previousGlobals) globalThis[name] = value;
    }
});

test('backup schema version 1 round-trips without renaming storage keys', () => {
    const exportedAt = new Date('2026-08-06T00:00:00.000Z');
    const payload = createExportPayload(
        { autoLogin: true, optionsOrder: ['auto-login-options'] },
        { username: 'student' },
        exportedAt,
    );
    assert.equal(validateImportPayload(JSON.parse(JSON.stringify(payload))).schemaVersion, 1);
    assert.deepEqual(payload.sync, { autoLogin: true, optionsOrder: ['auto-login-options'] });
    assert.deepEqual(payload.local, { username: 'student' });
    assert.throws(
        () => validateImportPayload({ ...payload, schemaVersion: 2 }),
        /対応していない/,
    );
});
