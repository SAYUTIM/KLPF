// Copyright (c) 2024-2026 SAYU
// MIT License; see LICENSE.

/**
 * @file Ku-Port学生時間割からシラバスをJSFフォームへの直接通信で取得する。
 * 学期と科目の照合をsyllabus-matchingへ、HTML解析を共通ランタイムへ委譲する。
 * 呼び出し元が要求ID・中断・進捗を管理し、選択済みの時間割では不要な表示POSTを省く。
 */

import { createFormBody } from '../modules/kuport-form.js';
import { assertKuportUrl } from '../modules/url-utils.js';
import { parseKuportDocument, createKuportHeaders } from '../modules/kuport-runtime.js';
import { getSyllabusTermCandidates, findSyllabusCourseButton, isSyllabusTermSelected } from './syllabus-matching.js';

const SYLLABUS_STUDENT_TIMETABLE_MENU_ID = '6_1_0_0';
const SYLLABUS_SEARCH_BUTTON_ID = 'funcForm:search';

/**
 * 呼び出し元の進捗・取消処理を組み込み、シラバスの直接通信関数を作る。
 * @param {object} options - この処理に必要な設定と依存処理。
 * @param {Function} options.reportPhase - 要求IDに対応する進捗段階を通知する処理。
 * @param {Function} options.ensureActive - 取得を続行できるか確認し、中断時に例外を投げる処理。
 * @returns {object} シラバス直接取得を行うfetchSyllabus関数。
 */
export function createSyllabusTransport({ reportPhase, ensureActive }) {
    /**
     * 時間割の対象ボタンへ直接POSTし、シラバスダイアログの応答を解析する。
     * @param {string} requestId - 処理と結果を対応付ける取得要求ID。
     * @param {object} timetable - 解析済みの時間割、選択年度学期、送信情報。
     * @param {object} button - 操作するボタン、または解析済みのボタン情報。
     * @param {object} course - 授業カードから読み取った科目・年度学期・曜日時限・教員情報。
     * @param {AbortSignal} signal - 取得の中断を通知するシグナル。
     * @returns {Promise<object>} 表の行・本文・科目名を含む取得結果。
     */
    async function fetchSyllabusDialogForButton(requestId, timetable, button, course, signal) {
        await reportPhase(requestId, 'opening-syllabus-dialog');
        await ensureActive(requestId, signal);
        const syllabusBody = createFormBody(timetable.fields);
        syllabusBody.set('javax.faces.partial.ajax', 'true');
        syllabusBody.set('javax.faces.source', button.id);
        syllabusBody.set('javax.faces.partial.execute', button.id);
        syllabusBody.set('javax.faces.partial.render', '@none');
        syllabusBody.set(button.id, button.id);
        const syllabusResponse = await fetch(assertKuportUrl(timetable.action), {
            method: 'POST',
            credentials: 'include',
            headers: createKuportHeaders(true),
            body: syllabusBody,
            redirect: 'follow',
            signal,
        });
        if (!syllabusResponse.ok) {
            throw new Error(`Ku-portのシラバス取得エラー: ${syllabusResponse.status}`);
        }
        await ensureActive(requestId, signal);
        const syllabus = await parseKuportDocument('parse-syllabus-response', {
            html: await syllabusResponse.text(),
        });
        return {
            title: 'シラバス照会',
            text: String(syllabus.text || '').slice(0, 60000),
            rows: Array.isArray(syllabus.rows) ? syllabus.rows : [],
            courseName: course?.courseName || '',
        };
    }

    /**
     * 対象学期の時間割から科目を照合し、シラバスを取得する。選択済みなら表示要求を省く。
     * @param {string} requestId - 処理と結果を対応付ける取得要求ID。
     * @param {object} timetable - 解析済みの時間割、選択年度学期、送信情報。
     * @param {object} course - 授業カードから読み取った科目・年度学期・曜日時限・教員情報。
     * @param {AbortSignal} signal - 取得の中断を通知するシグナル。
     * @returns {Promise<object>} 対象科目のシラバス取得結果。
     */
    async function fetchSyllabusFromTimetable(requestId, timetable, course, signal) {
        const termCandidates = getSyllabusTermCandidates(course, timetable.termOptions);
        if (termCandidates.length === 0) {
            throw new Error('授業カードの年度・学期に合う開講年度学期を選べませんでした。');
        }
        const year = String(course?.academicYear || '').trim();
        if (!/^\d{4}$/.test(year)) throw new Error('授業カードの年度を確認できませんでした。');

        // 既に対象年度・学期が選択され、時間割に対象ボタンが描画済みなら、
        // 表示ボタンのAjax要求を省略してシラバス要求へ直行する。
        const selectedTerm = termCandidates.find(term => isSyllabusTermSelected(timetable, year, term));
        if (selectedTerm) {
            const currentButton = findSyllabusCourseButton(course, timetable.syllabusButtons);
            if (currentButton?.error) throw new Error(currentButton.error);
            if (currentButton) {
                return fetchSyllabusDialogForButton(requestId, timetable, currentButton, course, signal);
            }
        }

        for (let index = 0; index < termCandidates.length; index += 1) {
            const term = termCandidates[index];
            await reportPhase(
                requestId,
                index === 0 ? 'loading-student-timetable' : 'retrying-student-timetable',
            );
            await ensureActive(requestId, signal);
            const displayBody = createFormBody(timetable.fields);
            displayBody.set(timetable.yearFieldName || 'funcForm:nendo_input', year);
            displayBody.set(timetable.termFieldName || 'funcForm:gakki_input', term.value);
            displayBody.set('javax.faces.partial.ajax', 'true');
            displayBody.set('javax.faces.source', timetable.searchButtonName || SYLLABUS_SEARCH_BUTTON_ID);
            displayBody.set('javax.faces.partial.execute', '@all');
            displayBody.set('javax.faces.partial.render', 'funcForm');
            displayBody.set(
                timetable.searchButtonName || SYLLABUS_SEARCH_BUTTON_ID,
                timetable.searchButtonName || SYLLABUS_SEARCH_BUTTON_ID,
            );
            const timetableResponse = await fetch(assertKuportUrl(timetable.action), {
                method: 'POST',
                credentials: 'include',
                headers: createKuportHeaders(true),
                body: displayBody,
                redirect: 'follow',
                signal,
            });
            if (!timetableResponse.ok) {
                throw new Error(`Ku-port ${term.label || term.value}の時間割取得エラー: ${timetableResponse.status}`);
            }
            timetable = await parseKuportDocument('parse-syllabus-timetable-response', {
                html: await timetableResponse.text(),
                baseUrl: timetableResponse.url,
            });
            await ensureActive(requestId, signal);
            const button = findSyllabusCourseButton(course, timetable.syllabusButtons);
            if (button?.error) throw new Error(button.error);
            if (!button) continue;
            return fetchSyllabusDialogForButton(requestId, timetable, button, course, signal);
        }
        throw new Error('指定した年度・学期の学生時間割に対象科目が見つかりませんでした。');
    }

    /**
     * 認証後のメニューフォームから学生時間割へ遷移し、対象科目のシラバスを直接取得する。
     * @param {string} requestId - 処理と結果を対応付ける取得要求ID。
     * @param {object} bootstrap - 認証後に読み取った送信先とフォームフィールド。
     * @param {object} course - 授業カードから読み取った科目・年度学期・曜日時限・教員情報。
     * @param {AbortSignal} signal - 取得の中断を通知するシグナル。
     * @returns {Promise<object>} 対象科目のシラバス取得結果。
     */
    async function fetchKuportSyllabusInBackground(requestId, bootstrap, course, signal) {
        await reportPhase(requestId, 'opening-student-schedule');
        await ensureActive(requestId, signal);
        const menuAction = assertKuportUrl(bootstrap.action);
        const menuBody = createFormBody(bootstrap.fields);
        menuBody.set('menuForm:mainMenu', 'menuForm:mainMenu');
        menuBody.set(
            'menuForm:mainMenu_menuid',
            bootstrap.studentTimetableMenuId || SYLLABUS_STUDENT_TIMETABLE_MENU_ID,
        );
        const timetablePageResponse = await fetch(menuAction, {
            method: 'POST',
            credentials: 'include',
            headers: createKuportHeaders(false),
            body: menuBody,
            redirect: 'follow',
            signal,
        });
        if (!timetablePageResponse.ok) {
            throw new Error(`Ku-port学生時間割への遷移エラー: ${timetablePageResponse.status}`);
        }
        await ensureActive(requestId, signal);
        const timetable = await parseKuportDocument('parse-syllabus-timetable', {
            html: await timetablePageResponse.text(),
            baseUrl: timetablePageResponse.url,
        });
        return fetchSyllabusFromTimetable(requestId, timetable, course, signal);
    }

    return { fetchSyllabus: fetchKuportSyllabusInBackground };
}
