// Copyright (c) 2024-2026 SAYU
// This software is released under the MIT License, see LICENSE.

/**
 * @file KU-PORTから取得したHTMLを解析するOffscreen Document用スクリプト。
 *
 * Service WorkerにはDOMParserがないため、フォーム遷移情報・出席表・シラバス・掲示板の解析を
 * この非表示ドキュメントが担当し、結果だけをメッセージで返す。
 * attendance-utilsとform-utilsを先に読み込む。認証画面の操作やネットワーク通信は担当しない。
 */

(function initializeKuportParser() {
    'use strict';

    const attendanceUtils = globalThis.KLPFAttendanceUtils;
    const formUtils = globalThis.KLPFFormUtils;
    if (!attendanceUtils || !formUtils) {
        console.error('[KLPF] 出席表またはフォーム解析モジュールを読み込めませんでした。');
        return;
    }

    const { normalizeText, parseAttendanceRecords } = attendanceUtils;
    const { resolveFormAction, serializeFormEntries } = formUtils;
    const MESSAGE_TARGET = 'kuport-parser';
    const ATTENDANCE_FORM_ID = 'funcForm';
    const ATTENDANCE_TERM_SELECT_ID = 'funcForm:kaikoNendoGakki_input';
    const MENU_FORM_ID = 'menuForm';
    const PARTIAL_RESPONSE_TAG = '<partial-response';
    const SYLLABUS_TERM_SELECT_ID = 'funcForm:gakki_input';
    const SYLLABUS_YEAR_INPUT_ID = 'funcForm:nendo_input';
    const SYLLABUS_SEARCH_BUTTON_ID = 'funcForm:search';
    const SYLLABUS_DIALOG_UPDATE_ID = 'pkx02301:dialogPanel';
    const MAX_SYLLABUS_TEXT_LENGTH = 60000;
    const BULLETIN_FORM_ID = 'funcForm';
    const BULLETIN_TAB_AREA_ID = 'funcForm:tabArea';
    const BULLETIN_DETAIL_UPDATE_ID = 'bsd00702:dialogPanel';
    const MAX_BULLETIN_BODY_LENGTH = 30000;

    /**
     * 取得したHTMLまたはXML文字列をDOMParserで文書へ変換する。
     * @param {string} html - 解析対象のHTMLまたはJSF部分応答。
     * @param {string} [mimeType="text/html"] - DOMParserで解釈する文書形式。
     * @returns {Document} HTMLまたはXMLとして解析した文書。
     */
    function parseDocument(html, mimeType = 'text/html') {
        return new DOMParser().parseFromString(String(html || ''), mimeType);
    }

    /**
     * 文書内から指定IDのフォームを取り出し、見つからない場合は例外を投げる。
     * @param {Document} parsedDocument - DOMParserで解析した文書。
     * @param {string} formId - 文書内で検索するフォームのID。
     * @param {string} errorMessage - 必要なフォームが見つからない場合のエラー文。
     * @returns {HTMLFormElement} 指定IDのフォーム。
     */
    function getRequiredForm(parsedDocument, formId, errorMessage) {
        const form = parsedDocument.getElementById(formId);
        if (!(form instanceof HTMLFormElement)) throw new Error(errorMessage);
        return form;
    }

    /**
     * フォームの絶対送信先と文字列フィールドを解析結果へまとめる。
     * @param {HTMLFormElement} form - 読み取りまたは送信の対象フォーム。
     * @param {string} baseUrl - 相対URLを解決するための応答元URL。
     * @returns {object} 絶対送信先のactionと送信フィールドのfields。
     */
    function createFormResult(form, baseUrl) {
        return {
            action: resolveFormAction(form, baseUrl),
            fields: serializeFormEntries(form),
        };
    }

    /**
     * 出席画面から送信フォームと年度学期の選択肢を取り出す。
     * @param {string} html - 解析対象のHTMLまたはJSF部分応答。
     * @param {string} baseUrl - 相対URLを解決するための応答元URL。
     * @returns {object} 出席フォームの送信先・フィールド・選択年度学期。
     */
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
            termFieldName: termSelect instanceof HTMLSelectElement ? termSelect.name : '',
            selectedTermValue: termSelect instanceof HTMLSelectElement ? termSelect.value : '',
            termOptions: termSelect instanceof HTMLSelectElement
                ? Array.from(termSelect.options).map(option => ({
                    value: option.value,
                    label: normalizeText(option.textContent),
                }))
                : [],
            academicTerm: termSelect instanceof HTMLSelectElement
                ? normalizeText(termSelect.selectedOptions[0]?.textContent)
                : '',
        };
    }

    /**
     * メニュー画面から送信フォームと学生時間割の遷移情報を取り出す。
     * @param {string} html - 解析対象のHTMLまたはJSF部分応答。
     * @param {string} baseUrl - 相対URLを解決するための応答元URL。
     * @returns {object} メニューフォームと学生時間割の遷移情報。
     */
    function parseMenuBootstrap(html, baseUrl) {
        const parsedDocument = parseDocument(html);
        const form = getRequiredForm(
            parsedDocument,
            MENU_FORM_ID,
            'Ku-portのメニューフォームが見つかりませんでした。',
        );
        const studentScheduleLink = Array.from(parsedDocument.querySelectorAll('a, button, [role="menuitem"]'))
            .find(element => normalizeText(element.textContent).includes('学生時間割'));
        const commandValues = studentScheduleLink
            ? [
                studentScheduleLink,
                studentScheduleLink.parentElement,
                studentScheduleLink.parentElement?.parentElement,
            ].flatMap(element => element
                ? Array.from(element.attributes)
                    .filter(attribute => /pfconfirmcommand|pfcommand|menuid/i.test(attribute.name)
                        || /menuForm.*menuid/i.test(attribute.value))
                    .map(attribute => attribute.value)
                : [])
            : [];
        const decodeHtml = value => String(value || '')
            .replace(/&quot;/gi, '"')
            .replace(/&#39;|&apos;/gi, "'")
            .replace(/&amp;/gi, '&');
        const command = commandValues.map(decodeHtml).join('\n');
        const studentTimetableMenuId = command.match(
            /menuForm:mainMenu_menuid[^0-9A-Za-z]+([0-9]+(?:_[0-9]+)+)/,
        )?.[1] || null;
        return {
            ...createFormResult(form, baseUrl),
            studentTimetableMenuId,
        };
    }

    /**
     * 要素のonclickからPrimeFacesの送信コマンドを取り出す。
     * @param {Element} element - 操作または読み取りの対象要素。
     * @returns {object} PrimeFacesの送信元とパラメーター。
     */
    function getPrimeFacesCommand(element) {
        if (!(element instanceof Element)) return {};
        const source = [
            element.getAttribute('onclick'),
            element.getAttribute('data-pfconfirmcommand'),
            element.getAttribute('data-pfcommand'),
        ].filter(Boolean).join('\n');
        const read = key => source.match(new RegExp(`(?:^|[,{])\\s*${key}\\s*:\\s*["']([^"']+)["']`))?.[1] || '';
        return {
            source: read('s') || read('source'),
            execute: read('p') || read('process'),
            render: read('u') || read('update'),
        };
    }

    /**
     * 文書内の掲示板メニューリンクを探す。
     * @param {HTMLFormElement} form - 読み取りまたは送信の対象フォーム。
     * @returns {Element|null} 掲示板のメニューリンク。見つからなければnull。
     */
    function findBulletinLink(form) {
        const candidates = Array.from(form.querySelectorAll('a, button, [role="button"]')).filter(element => {
            const label = normalizeText([
                element.getAttribute('aria-label'),
                element.getAttribute('title'),
                element.textContent,
            ].filter(Boolean).join(' '));
            return /掲示情報を表示|掲示板/.test(label);
        });
        return candidates.find(element => /掲示情報を表示/.test(normalizeText([
            element.getAttribute('aria-label'),
            element.getAttribute('title'),
        ].filter(Boolean).join(' ')))) || candidates[0] || null;
    }

    /**
     * ホーム画面から掲示板への遷移に必要なフォーム情報を取り出す。
     * @param {string} html - 解析対象のHTMLまたはJSF部分応答。
     * @param {string} baseUrl - 相対URLを解決するための応答元URL。
     * @returns {object} 掲示板に遷移する送信先・フィールド・コマンド。
     */
    function parseBulletinHomeForm(html, baseUrl) {
        const parsedDocument = parseDocument(html);
        const form = getRequiredForm(
            parsedDocument,
            BULLETIN_FORM_ID,
            'Ku-portの掲示板ホームフォームが見つかりませんでした。',
        );
        const link = findBulletinLink(form);
        if (!link) throw new Error('Ku-portの掲示板表示リンクが見つかりませんでした。');
        const command = getPrimeFacesCommand(link);
        const source = command.source || link.id || link.getAttribute('name') || '';
        if (!source) throw new Error('Ku-portの掲示板表示要求を特定できませんでした。');
        return {
            ...createFormResult(form, baseUrl),
            bulletinSource: source,
            bulletinExecute: command.execute || source,
            bulletinRender: command.render || '@(.dispTab_1)',
        };
    }

    /**
     * 自動遷移用のフォームか判定する。
     * @param {HTMLFormElement} form - 読み取りまたは送信の対象フォーム。
     * @returns {boolean} 条件を満たす場合はtrue。
     */
    function isAutoNavigationForm(form) {
        if (form.method.toLowerCase() !== 'post') return false;
        const editableFields = form.querySelectorAll(
            'input:not([type="hidden"]):not([type="submit"]):not([type="button"]), select, textarea',
        );
        return editableFields.length === 0;
    }

    /**
     * 中間ページから次の遷移先と送信フィールドを取り出す。
     * @param {string} html - 解析対象のHTMLまたはJSF部分応答。
     * @param {string} baseUrl - 相対URLを解決するための応答元URL。
     * @returns {object} 次の遷移先と送信フィールド。
     */
    function parseAutoNavigationForm(html, baseUrl) {
        const parsedDocument = parseDocument(html);
        const form = Array.from(parsedDocument.forms).find(isAutoNavigationForm);
        if (!(form instanceof HTMLFormElement)) {
            throw new Error('Ku-portの自動遷移フォームが見つかりませんでした。');
        }
        return createFormResult(form, baseUrl);
    }

    /**
     * JSFの部分応答から解析対象のHTMLを取り出す。
     * @param {string} html - 解析対象のHTMLまたはJSF部分応答。
     * @returns {string} 部分応答から取り出したHTML。
     */
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

    /**
     * 応答に含まれる出席表を解析して出席記録の配列を返す。
     * @param {string} html - 解析対象のHTMLまたはJSF部分応答。
     * @returns {object[]} 応答内の表から読み取った出席記録。
     */
    function parseAttendanceRecordResponse(html) {
        const parsedDocument = parseDocument(extractPartialHtml(html));
        return parseAttendanceRecords(parsedDocument);
    }

    /**
     * 出席画面の応答から出席記録と更新されたViewStateを取り出す。
     * @param {string} html - 解析対象のHTMLまたはJSF部分応答。
     * @returns {object} 出席記録recordsと、部分応答で更新されたviewState。
     */
    function parseAttendanceResponse(html) {
        const source = String(html || '');
        if (!source.includes(PARTIAL_RESPONSE_TAG)) {
            return {
                records: parseAttendanceRecords(parseDocument(source), { includeSessionCount: true }),
                viewState: '',
            };
        }

        const xmlDocument = parseDocument(source, 'application/xml');
        if (xmlDocument.querySelector('parsererror')) {
            throw new Error('Ku-portのAjax応答を解析できませんでした。');
        }
        const updates = Array.from(xmlDocument.querySelectorAll('update'));
        const viewState = updates.find(update => update.getAttribute('id') === 'javax.faces.ViewState')
            ?.textContent?.trim() || '';
        const responseHtml = updates.map(update => update.textContent || '').join('\n');
        return {
            records: parseAttendanceRecords(parseDocument(responseHtml), { includeSessionCount: true }),
            viewState,
        };
    }

    /**
     * JSF部分応答のupdate要素を取得する。
     * @param {string} html - 解析対象のHTMLまたはJSF部分応答。
     * @returns {Element[]} 部分応答に含まれるupdate要素。
     */
    function getPartialUpdates(html) {
        const xmlDocument = parseDocument(String(html || ''), 'application/xml');
        if (xmlDocument.querySelector('parsererror')) {
            throw new Error('Ku-portのAjax応答を解析できませんでした。');
        }
        return Array.from(xmlDocument.querySelectorAll('update'));
    }

    /**
     * 指定IDのupdate要素に含まれるHTMLを取り出す。
     * @param {Element[]} updates - JSF部分応答のupdate要素一覧。
     * @param {string} id - 対象を識別するID。
     * @returns {string} 指定IDに対応する更新HTML。見つからなければ空文字列。
     */
    function getPartialUpdateHtml(updates, id) {
        const update = updates.find(candidate => candidate.getAttribute('id') === id);
        return update?.textContent || '';
    }

    /**
     * JSF部分応答から更新されたViewStateを取り出す。
     * @param {Element[]} updates - JSF部分応答のupdate要素一覧。
     * @returns {string} 部分応答内のViewState。見つからなければ空文字列。
     */
    function getPartialViewState(updates) {
        return updates.find(update => /javax\.faces\.ViewState/.test(update.getAttribute('id') || ''))
            ?.textContent?.trim() || '';
    }

    /**
     * 文書の名前付き入力要素を送信フィールドの配列へ変換する。
     * @param {Document} parsedDocument - DOMParserで解析した文書。
     * @returns {Array<Array<string>>} 名前と文字列値のフィールド一覧。
     */
    function extractNamedFields(parsedDocument) {
        const form = parsedDocument.querySelector('form');
        if (form instanceof HTMLFormElement) return serializeFormEntries(form);
        const fields = [];
        for (const element of parsedDocument.querySelectorAll('input, select, textarea')) {
            const name = element.getAttribute('name');
            if (!name) continue;
            if (element instanceof HTMLInputElement
                && ['checkbox', 'radio'].includes(element.type)
                && !element.checked) continue;
            if (element instanceof HTMLSelectElement) {
                for (const option of Array.from(element.selectedOptions)) {
                    fields.push([name, option.value]);
                }
                continue;
            }
            fields.push([name, element.value || '']);
        }
        return fields;
    }

    /**
     * 掲示板一覧を含むパネルを文書から取得する。
     * @param {Document} parsedDocument - DOMParserで解析した文書。
     * @returns {Element|null} 掲示板一覧の表示領域。見つからなければnull。
     */
    function getBulletinPanel(parsedDocument) {
        const panels = Array.from(parsedDocument.querySelectorAll('[id^="funcForm:tabArea:1:"]'));
        return panels.find(element => element.getAttribute('role') === 'tabpanel'
            || element.classList.contains('ui-tabs-panel'))
            || panels.find(element => element.id.endsWith(':allScr'))
            || null;
    }

    /**
     * 掲示一覧の行からID・件名・日付などの表示情報を取り出す。
     * @param {Element} panel - 操作または解析の対象パネル。
     * @returns {object[]} ID・件名・日付などの掲示情報。
     */
    function parseBulletinItems(panel) {
        if (!panel) return [];
        const anchors = Array.from(panel.querySelectorAll('a'))
            .filter(element => element.closest('dl.keiji')
                && (element.id || '').startsWith(`${BULLETIN_TAB_AREA_ID}:1:`)
                && getPrimeFacesCommand(element).source);
        const seen = new Set();
        return anchors.map((element, index) => {
            const command = getPrimeFacesCommand(element);
            const source = command.source || element.id;
            if (!source || seen.has(source)) return null;
            seen.add(source);
            return {
                id: source,
                title: extractElementText(element).slice(0, 500),
                date: '',
                category: '',
                sender: '',
                body: '',
                index,
            };
        }).filter(Boolean);
    }

    /**
     * 掲示板応答から一覧と次の通信に必要なフォーム情報を取り出す。
     * @param {string} html - 解析対象のHTMLまたはJSF部分応答。
     * @param {string} baseUrl - 相対URLを解決するための応答元URL。
     * @returns {object} 掲示一覧、送信先・フィールド、全表示タブの識別情報。
     */
    function parseBulletinBoardResponse(html, baseUrl) {
        const source = String(html || '');
        const updates = source.includes(PARTIAL_RESPONSE_TAG)
            ? getPartialUpdates(source)
            : [];
        const responseHtml = updates.length > 0
            ? updates.map(update => update.textContent || '').join('\n')
            : source;
        const parsedDocument = parseDocument(responseHtml);
        const tabArea = parsedDocument.getElementById(BULLETIN_TAB_AREA_ID)
            || parsedDocument.querySelector(`[id="${BULLETIN_TAB_AREA_ID}"]`);
        const allPanelLink = tabArea
            ? Array.from(tabArea.querySelectorAll('[role="tab"] a, li a')).find(link => normalizeText(link.textContent) === '全表示')
            : null;
        const panel = getBulletinPanel(parsedDocument);
        const allPanelId = allPanelLink?.getAttribute('aria-controls')
            || allPanelLink?.getAttribute('data-target')?.replace(/^#/, '')
            || allPanelLink?.getAttribute('href')?.replace(/^#/, '')
            || panel?.id
            || '';
        const fields = extractNamedFields(parsedDocument);
        const viewState = updates.length > 0 ? getPartialViewState(updates) : '';
        if (viewState) {
            for (let index = fields.length - 1; index >= 0; index -= 1) {
                if (fields[index][0] === 'javax.faces.ViewState') fields.splice(index, 1);
            }
            fields.push(['javax.faces.ViewState', viewState]);
        }
        const form = parsedDocument.getElementById(BULLETIN_FORM_ID);
        return {
            action: form instanceof HTMLFormElement ? resolveFormAction(form, baseUrl) : baseUrl,
            fields,
            viewState,
            tabAreaId: tabArea?.id || BULLETIN_TAB_AREA_ID,
            allPanelId,
            items: parseBulletinItems(panel),
        };
    }

    /**
     * 掲示本文の改行を保ちながら要素から文字列を取り出す。
     * @param {Element} element - 操作または読み取りの対象要素。
     * @returns {string} 改行を保った掲示本文。
     */
    function extractBulletinText(element) {
        const copy = element.cloneNode(true);
        copy.querySelectorAll('br').forEach(node => node.replaceWith('\n'));
        copy.querySelectorAll('p, div, li').forEach(node => node.append('\n'));
        return extractElementText(copy);
    }

    /**
     * 掲示内容の表から指定ラベルに対応する値を取り出す。
     * @param {Document|Element} root - 要素を検索する起点。
     * @param {string} label - 値の検索または読み上げに使うラベル。
     * @returns {string} 指定ラベルの値。見つからなければ空文字列。
     */
    function extractBulletinLabeledValue(root, label) {
        const normalizedLabel = normalizeText(label);
        for (const row of root.querySelectorAll('tr, .rowStyle, dl')) {
            const cells = Array.from(row.children)
                .filter(element => element instanceof HTMLElement)
                .map(element => extractBulletinText(element));
            if (cells.length >= 2 && normalizeText(cells[0]).replace(/[：:]$/, '') === normalizedLabel) {
                return cells.slice(1).join('\n').trim().slice(0, MAX_BULLETIN_BODY_LENGTH);
            }
        }
        const lines = extractElementText(root).split('\n').map(line => line.trim()).filter(Boolean);
        const index = lines.findIndex(line => line.replace(/[：:]$/, '') === normalizedLabel);
        return index >= 0
            ? (lines[index + 1] || '').slice(0, MAX_BULLETIN_BODY_LENGTH)
            : '';
    }

    /**
     * 掲示ダイアログの部分応答から本文と項目別情報を取り出す。
     * @param {string} html - 解析対象のHTMLまたはJSF部分応答。
     * @returns {object} 掲示本文と項目別の情報。
     */
    function parseBulletinDetailResponse(html) {
        const source = String(html || '');
        const updates = source.includes(PARTIAL_RESPONSE_TAG)
            ? getPartialUpdates(source)
            : [];
        const dialogHtml = updates.length > 0
            ? getPartialUpdateHtml(updates, BULLETIN_DETAIL_UPDATE_ID)
            : source;
        if (!dialogHtml) throw new Error('Ku-portの掲示詳細が応答に含まれていませんでした。');
        const parsedDocument = parseDocument(dialogHtml);
        const dialog = parsedDocument.getElementById(BULLETIN_DETAIL_UPDATE_ID)
            || parsedDocument.querySelector('[role="dialog"], .ui-dialog, .rx-dialog')
            || parsedDocument.body;
        const text = extractElementText(dialog).slice(0, MAX_BULLETIN_BODY_LENGTH);
        const result = {
            subject: extractBulletinLabeledValue(dialog, '件名'),
            sender: extractBulletinLabeledValue(dialog, '差出人'),
            category: extractBulletinLabeledValue(dialog, 'カテゴリ'),
            body: extractBulletinLabeledValue(dialog, '本文'),
            period: extractBulletinLabeledValue(dialog, '掲示期間'),
            text,
            viewState: updates.length > 0 ? getPartialViewState(updates) : '',
        };
        if (!result.body && text) result.body = text;
        return result;
    }

    /**
     * 要素のテキストを取り出し、表示用に空白などを整える。
     * @param {Element} element - 操作または読み取りの対象要素。
     * @returns {string} 表示用に整えた要素のテキスト。
     */
    function extractElementText(element) {
        return String(element?.innerText || element?.textContent || '')
            .replace(/\r\n?/g, '\n')
            .replace(/[ \t]+\n/g, '\n')
            .replace(/\n{3,}/g, '\n\n')
            .trim();
    }

    /**
     * シラバス表のセルから改行を保った表示文字列を取り出す。
     * @param {Element} cell - 解析対象の表のセル。
     * @returns {string} 改行を保ったシラバスセルのテキスト。
     */
    function extractSyllabusCellText(cell) {
        return extractElementText(cell.querySelector('.fr-box, .fr-view') || cell)
            .slice(0, MAX_SYLLABUS_TEXT_LENGTH);
    }

    /**
     * シラバスの表を項目名と内容の行配列へ変換する。
     * @param {Element} element - 操作または読み取りの対象要素。
     * @returns {object[]} シラバスの項目名と内容の行一覧。
     */
    function extractSyllabusRows(element) {
        const firstRow = element?.querySelector('.rowStyle');
        const table = firstRow?.parentElement;
        if (!table) return [];
        let remaining = MAX_SYLLABUS_TEXT_LENGTH;
        const rows = [];
        for (const child of Array.from(table.children)) {
            if (child.classList.contains('rowStyle')) {
                const cells = Array.from(child.children)
                    .filter(cell => cell instanceof HTMLElement)
                    .map(cell => {
                        const width = Number(cell.getAttribute('style')
                            ?.match(/width\s*:\s*([\d.]+)%/i)?.[1]);
                        const text = extractSyllabusCellText(cell)
                            .slice(0, Math.max(0, remaining));
                        remaining -= text.length;
                        return {
                            header: cell.classList.contains('ui-widget-header'),
                            width: Number.isFinite(width) ? width : null,
                            text,
                        };
                    });
                if (cells.length > 0) rows.push({ type: 'row', cells });
                if (remaining <= 0) break;
                continue;
            }
            const height = Number(child.getAttribute('style')
                ?.match(/height\s*:\s*([\d.]+)px/i)?.[1]);
            if (Number.isFinite(height) && height > 0) {
                rows.push({ type: 'spacer', height: Math.min(height, 80) });
            }
        }
        return rows;
    }

    /**
     * シラバスボタンに対応する科目情報を含む要素を取得する。
     * @param {object} button - 操作するボタン、または解析済みのボタン情報。
     * @returns {Element} 科目情報を含むボタン周辺の要素。
     */
    function getSyllabusButtonContext(button) {
        const component = button.closest('.jugyo-info');
        if (component) return component;
        const cell = button.closest('td, th');
        if (cell) return cell;
        return button.parentElement || button;
    }

    /**
     * シラバスボタン周辺の要素から科目名を取り出す。
     * @param {Element} context - 科目名を含むボタン周辺の要素。
     * @returns {string} ボタンに対応する科目名。
     */
    function getSyllabusButtonCourseName(context) {
        const title = context.querySelector('.fontB')
            || context.querySelector('[class*="course" i]');
        const source = extractElementText(title || context).replace(/\b[A-Z]\d{7}\b/g, '');
        return source.split(/\s+担当(?:教員)?\s*[:：]?/)[0]
            .replace(/\s*\[[^\]]+\]\s*$/, '')
            .trim();
    }

    /**
     * 文字列から日〜土曜日を取り出し、曜日名の表記をそろえる。
     * @param {*} value - 検証・変換する入力値。
     * @returns {string} 照合用に整えた文字列。
     */
    function normalizeSyllabusDay(value) {
        const match = normalizeText(value).match(/[月火水木金土日](?:曜日|曜)?/);
        return match ? `${match[0].charAt(0)}曜日` : '';
    }

    /**
     * 文字列から時限番号を取り出す。
     * @param {*} value - 検証・変換する入力値。
     * @returns {string} 照合用に整えた文字列。
     */
    function normalizeSyllabusPeriod(value) {
        const source = normalizeText(value).normalize('NFKC').replace(/\s+/g, '');
        const match = source.match(/^(?:第)?([1-9]|1[0-5])(?:限|時限)?$/);
        return match?.[1] || '';
    }

    /**
     * シラバスボタンに対応する時間割の曜日と時限を読み取る。
     * @param {object} button - 操作するボタン、または解析済みのボタン情報。
     * @returns {object} 曜日と時限の情報。
     */
    function getSyllabusButtonSchedule(button) {
        const cell = button.closest('td, th');
        const row = cell?.closest('tr');
        const table = cell?.closest('table');
        let dayText = '';
        if (cell && table && Number.isInteger(cell.cellIndex)) {
            const rows = Array.from(table.rows || []);
            const heading = rows.find(candidate => {
                const headingCell = candidate.cells?.[cell.cellIndex];
                return headingCell && normalizeSyllabusDay(extractElementText(headingCell));
            })?.cells?.[cell.cellIndex];
            dayText = normalizeSyllabusDay(extractElementText(heading));
        }

        let period = normalizeSyllabusPeriod(extractElementText(row?.cells?.[0]));
        if (!period && row) {
            period = Array.from(row.cells || [])
                .map(candidate => normalizeSyllabusPeriod(extractElementText(candidate)))
                .find(Boolean) || '';
        }
        return { dayText, period };
    }

    /**
     * 時間割の各シラバスボタンから照合用の科目情報と送信IDを取り出す。
     * @param {HTMLFormElement} form - 読み取りまたは送信の対象フォーム。
     * @returns {object[]} 送信IDと照合用の科目情報を持つボタン一覧。
     */
    function extractSyllabusButtons(form) {
        return Array.from(form.querySelectorAll(
            'button[title*="シラバス"], input[title*="シラバス"], '
                + 'button[aria-label*="シラバス"], input[aria-label*="シラバス"]',
        )).map(button => {
            const context = getSyllabusButtonContext(button);
            const text = extractElementText(context);
            const id = button.name || button.id || '';
            const schedule = getSyllabusButtonSchedule(button);
            return {
                id,
                courseCode: text.match(/\b[A-Z]\d{7}\b/)?.[0] || '',
                courseName: getSyllabusButtonCourseName(context),
                text,
                dayText: schedule.dayText,
                period: schedule.period,
            };
        }).filter(button => button.id);
    }

    /**
     * 学生時間割のフォームと年度学期・科目ボタンを解析結果へまとめる。
     * @param {HTMLFormElement} form - 読み取りまたは送信の対象フォーム。
     * @param {string} baseUrl - 相対URLを解決するための応答元URL。
     * @returns {object} 送信情報・選択年度学期・シラバスボタン一覧。
     */
    function createStudentTimetableResult(form, baseUrl) {
        const yearInput = form.ownerDocument.getElementById(SYLLABUS_YEAR_INPUT_ID);
        const termSelect = form.ownerDocument.getElementById(SYLLABUS_TERM_SELECT_ID);
        const searchButton = form.ownerDocument.getElementById(SYLLABUS_SEARCH_BUTTON_ID);
        return {
            ...createFormResult(form, baseUrl),
            yearFieldName: yearInput instanceof HTMLInputElement
                ? yearInput.name || yearInput.id : SYLLABUS_YEAR_INPUT_ID,
            termFieldName: termSelect instanceof HTMLSelectElement
                ? termSelect.name || termSelect.id : SYLLABUS_TERM_SELECT_ID,
            searchButtonName: searchButton?.name || SYLLABUS_SEARCH_BUTTON_ID,
            selectedYear: yearInput instanceof HTMLInputElement ? yearInput.value : '',
            selectedTermValue: termSelect instanceof HTMLSelectElement ? termSelect.value : '',
            termOptions: termSelect instanceof HTMLSelectElement
                ? Array.from(termSelect.options).map(option => ({
                    value: option.value,
                    label: normalizeText(option.textContent),
                }))
                : [],
            syllabusButtons: extractSyllabusButtons(form),
        };
    }

    /**
     * 学生時間割ページから送信情報と科目ボタンを解析する。
     * @param {string} html - 解析対象のHTMLまたはJSF部分応答。
     * @param {string} baseUrl - 相対URLを解決するための応答元URL。
     * @returns {object} 解析した学生時間割のフォームと科目情報。
     */
    function parseStudentTimetableForm(html, baseUrl) {
        const source = String(html || '');
        if (source.includes(PARTIAL_RESPONSE_TAG)) {
            const updates = getPartialUpdates(source);
            const fragment = getPartialUpdateHtml(updates, 'funcForm');
            const parsedDocument = parseDocument(fragment);
            const formCandidate = parsedDocument.getElementById('funcForm')
                || parsedDocument.querySelector('form');
            if (!(formCandidate instanceof HTMLFormElement)) {
                throw new Error('Ku-portの学生時間割フォームが見つかりませんでした。');
            }
            const form = formCandidate;
            const result = createStudentTimetableResult(form, baseUrl);
            const viewState = getPartialViewState(updates);
            if (viewState) {
                result.fields = result.fields.filter(([name]) => name !== 'javax.faces.ViewState');
                result.fields.push(['javax.faces.ViewState', viewState]);
            }
            return result;
        }
        const parsedDocument = parseDocument(source);
        const form = getRequiredForm(
            parsedDocument,
            'funcForm',
            'Ku-portの学生時間割フォームが見つかりませんでした。',
        );
        return createStudentTimetableResult(form, baseUrl);
    }

    /**
     * 学期変更後の部分応答から学生時間割と送信情報を解析する。
     * @param {string} html - 解析対象のHTMLまたはJSF部分応答。
     * @param {string} baseUrl - 相対URLを解決するための応答元URL。
     * @returns {object} 学期変更後の時間割とフォーム更新情報。
     */
    function parseSyllabusTimetableResponse(html, baseUrl) {
        const source = String(html || '');
        if (!source.includes(PARTIAL_RESPONSE_TAG)) {
            return parseStudentTimetableForm(source, baseUrl);
        }
        return parseStudentTimetableForm(source, baseUrl);
    }

    /**
     * シラバスダイアログの部分応答から表形式の項目と本文を解析する。
     * @param {string} html - 解析対象のHTMLまたはJSF部分応答。
     * @returns {object} シラバスの本文と項目別の行。
     */
    function parseSyllabusResponse(html) {
        const source = String(html || '');
        let dialogHtml = source;
        let viewState = '';
        if (source.includes(PARTIAL_RESPONSE_TAG)) {
            const updates = getPartialUpdates(source);
            dialogHtml = getPartialUpdateHtml(updates, SYLLABUS_DIALOG_UPDATE_ID);
            viewState = getPartialViewState(updates);
        }
        if (!dialogHtml) throw new Error('Ku-portのシラバスダイアログが応答に含まれていませんでした。');
        const parsedDocument = parseDocument(dialogHtml);
        const dialog = parsedDocument.getElementById(SYLLABUS_DIALOG_UPDATE_ID)
            || parsedDocument.querySelector('[role="dialog"], .ui-dialog, .rx-dialog')
            || parsedDocument.body;
        const text = extractElementText(dialog).slice(0, MAX_SYLLABUS_TEXT_LENGTH);
        const rows = extractSyllabusRows(dialog);
        if (!text && rows.length === 0) {
            throw new Error('Ku-portのシラバス内容が空でした。');
        }
        return { text, rows, viewState };
    }

    const MESSAGE_HANDLERS = Object.freeze({
        'parse-attendance-form': message => parseAttendanceForm(message.html, message.baseUrl),
        'parse-menu-bootstrap': message => parseMenuBootstrap(message.html, message.baseUrl),
        'parse-auto-navigation-form': message => parseAutoNavigationForm(message.html, message.baseUrl),
        'parse-attendance-records': message => parseAttendanceRecordResponse(message.html),
        'parse-attendance-response': message => parseAttendanceResponse(message.html),
        'parse-syllabus-menu': message => parseMenuBootstrap(message.html, message.baseUrl),
        'parse-syllabus-timetable': message => parseStudentTimetableForm(message.html, message.baseUrl),
        'parse-syllabus-timetable-response': message => parseSyllabusTimetableResponse(message.html, message.baseUrl),
        'parse-syllabus-response': message => parseSyllabusResponse(message.html),
        'parse-bulletin-home-form': message => parseBulletinHomeForm(message.html, message.baseUrl),
        'parse-bulletin-board-response': message => parseBulletinBoardResponse(message.html, message.baseUrl),
        'parse-bulletin-detail-response': message => parseBulletinDetailResponse(message.html),
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
