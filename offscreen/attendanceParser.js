// Copyright (c) 2024-2026 SAYU
// This software is released under the MIT License, see LICENSE.

/**
 * @file KU-PORTから取得したHTMLを解析するOffscreen Document用スクリプト。
 *
 * Service WorkerにはDOMParserがないため、フォーム遷移情報と出席表の解析を
 * この非表示ドキュメントが担当し、結果だけをメッセージで返す。
 */

(function initializeAttendanceParser() {
    'use strict';

    const attendanceUtils = globalThis.KLPFAttendanceUtils;
    const formUtils = globalThis.KLPFFormUtils;
    if (!attendanceUtils || !formUtils) {
        console.error('[KLPF] 出席表またはフォーム解析モジュールを読み込めませんでした。');
        return;
    }

    const { normalizeText, parseAttendanceRecords } = attendanceUtils;
    const { resolveFormAction, serializeFormEntries } = formUtils;
    const MESSAGE_TARGET = 'attendance-parser';
    const ATTENDANCE_FORM_ID = 'funcForm';
    const ATTENDANCE_TERM_SELECT_ID = 'funcForm:kaikoNendoGakki_input';
    const MENU_FORM_ID = 'menuForm';
    const PARTIAL_RESPONSE_TAG = '<partial-response';

    function parseDocument(html, mimeType = 'text/html') {
        return new DOMParser().parseFromString(String(html || ''), mimeType);
    }

    function getRequiredForm(parsedDocument, formId, errorMessage) {
        const form = parsedDocument.getElementById(formId);
        if (!(form instanceof HTMLFormElement)) throw new Error(errorMessage);
        return form;
    }

    function createFormResult(form, baseUrl) {
        return {
            action: resolveFormAction(form, baseUrl),
            fields: serializeFormEntries(form),
        };
    }

    function parseAttendanceForm(html, baseUrl) {
        const parsedDocument = parseDocument(html);
        const form = getRequiredForm(
            parsedDocument,
            ATTENDANCE_FORM_ID,
            'Ku-portの出席フォームが見つかりませんでした。',
        );
        const termSelect = parsedDocument.getElementById(ATTENDANCE_TERM_SELECT_ID);

        return {
            ...createFormResult(form, baseUrl),
            academicTerm: termSelect instanceof HTMLSelectElement
                ? normalizeText(termSelect.selectedOptions[0]?.textContent)
                : '',
        };
    }

    function parseMenuBootstrap(html, baseUrl) {
        const parsedDocument = parseDocument(html);
        const form = getRequiredForm(
            parsedDocument,
            MENU_FORM_ID,
            'Ku-portのメニューフォームが見つかりませんでした。',
        );
        return createFormResult(form, baseUrl);
    }

    function isAutoNavigationForm(form) {
        if (form.method.toLowerCase() !== 'post') return false;
        const editableFields = form.querySelectorAll(
            'input:not([type="hidden"]):not([type="submit"]):not([type="button"]), select, textarea',
        );
        return editableFields.length === 0;
    }

    function parseAutoNavigationForm(html, baseUrl) {
        const parsedDocument = parseDocument(html);
        const form = Array.from(parsedDocument.forms).find(isAutoNavigationForm);
        if (!(form instanceof HTMLFormElement)) {
            throw new Error('Ku-portの自動遷移フォームが見つかりませんでした。');
        }
        return createFormResult(form, baseUrl);
    }

    function extractPartialHtml(html) {
        const source = String(html || '');
        if (!source.includes(PARTIAL_RESPONSE_TAG)) return source;

        const xmlDocument = parseDocument(source, 'application/xml');
        if (xmlDocument.querySelector('parsererror')) {
            throw new Error('Ku-portのAjax応答を解析できませんでした。');
        }
        return Array.from(xmlDocument.querySelectorAll('update'))
            .map(update => update.textContent || '')
            .join('\n');
    }

    function parseAttendanceRecordResponse(html) {
        const parsedDocument = parseDocument(extractPartialHtml(html));
        return parseAttendanceRecords(parsedDocument);
    }

    const MESSAGE_HANDLERS = Object.freeze({
        'parse-attendance-form': message => parseAttendanceForm(message.html, message.baseUrl),
        'parse-menu-bootstrap': message => parseMenuBootstrap(message.html, message.baseUrl),
        'parse-auto-navigation-form': message => parseAutoNavigationForm(message.html, message.baseUrl),
        'parse-attendance-records': message => parseAttendanceRecordResponse(message.html),
    });

    // Offscreenのmessage契約は維持しつつ、解析規則をDOM回帰テストから直接検証できるようにする。
    globalThis.KLPFAttendanceParser = Object.freeze({
        parseAttendanceForm,
        parseMenuBootstrap,
        parseAutoNavigationForm,
        parseAttendanceRecordResponse,
    });

    chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
        if (message.target !== MESSAGE_TARGET) return false;

        try {
            const handler = MESSAGE_HANDLERS[message.type];
            if (!handler) throw new Error('未対応の解析要求です。');
            sendResponse({ success: true, data: handler(message) });
        } catch (error) {
            sendResponse({ success: false, error: error.message });
        }
        return false;
    });
})();
