// Copyright (c) 2024-2026 SAYU
// This software is released under the MIT License, see LICENSE.

/**
 * @file 出席率・シラバス・掲示板で共用するKu-Port通信の補助処理を提供する。
 * Chrome APIで認証画面の作成・所有画面の終了・外部タブ検出・非表示HTML解析を管理する。
 * 各機能のジョブ、取得順序、キャッシュ、取消判断は呼び出し元が担当する。
 */
import { createFormBody } from './kuport-form.js';

const KUPORT_PARSER_PATH = 'offscreen/kuportParser.html';
let creatingKuportParser = null;
let closingKuportParser = null;
// 3機能で解析用ドキュメントを共有するため、解析要求が残る間は終了させない。
let activeParserRequests = 0;

/**
 * URLのホストがKu-Portか判定する。不正なURLは対象外とする。
 * @param {string|URL} url - 判定または通信の対象URL。
 * @returns {boolean} 条件を満たす場合はtrue。
 */
export function isKuportUrl(url) {
    try {
        return new URL(url).hostname === 'ku-port.sc.kogakuin.ac.jp';
    } catch {
        return false;
    }
}

/**
 * 拡張機能所有のタブを除外し、開いているKu-Portタブを列挙する。
 * @param {number[]} [excludedTabIds] - 外部タブの判定から除外する所有タブID。
 * @returns {Promise<object[]>} 除外対象以外のKu-Portタブ情報。
 */
export async function findOpenKuportTabs(excludedTabIds = []) {
    const excluded = new Set(excludedTabIds);
    const tabs = await chrome.tabs.query({});
    return tabs.filter((tab) => !excluded.has(tab.id)
        && isKuportUrl(tab.url || tab.pendingUrl || ''));
}

/**
 * 新しい応答に含まれる同名フィールドを置き換え、フォーム情報を更新する。
 * @param {Array<Array<string>>} baseFields - 更新前のフォームフィールド。
 * @param {Array<Array<string>>} nextFields - 応答から追加・置換するフォームフィールド。
 * @returns {Array<Array<string>>} 更新されたフォームフィールド。同名の旧値は置換済み。
 */
export function mergeFormFields(baseFields, nextFields) {
    const base = Array.isArray(baseFields) ? baseFields : [];
    const next = Array.isArray(nextFields) ? nextFields : [];
    if (next.length === 0) return base;
    const replacedNames = new Set(next.map(([name]) => String(name)));
    return [
        ...base.filter(([name]) => !replacedNames.has(String(name))),
        ...next,
    ];
}

/**
 * 文字列フィールドにJSFの送信元・実行対象・更新対象を加えたPOST本文を作る。
 * @param {Array<Array<string>>} fields - 名前と文字列値の組を並べた送信フィールド。
 * @param {string} source - JSF要求の送信元コンポーネントID。
 * @param {string} execute - JSFで処理するコンポーネントIDまたはキーワード。
 * @param {string} render - JSFで再描画するコンポーネントIDまたはキーワード。
 * @returns {URLSearchParams} JSFの部分要求情報を含む送信本文。
 */
export function createPartialFormBody(fields, source, execute, render) {
    const body = createFormBody(fields);
    body.set('javax.faces.partial.ajax', 'true');
    body.set('javax.faces.source', source);
    body.set('javax.faces.partial.execute', execute || source);
    body.set('javax.faces.partial.render', render || '@none');
    body.set(source, source);
    return body;
}

/**
 * Ku-PortのフォームPOSTに必要なヘッダーを作る。
 * @param {boolean} [partial=true] - JSFの部分要求用ヘッダーを付けるかどうか。
 * @returns {Object<string, string>} 通常POSTまたはJSF部分POSTのヘッダー。
 */
export function createKuportHeaders(partial = true) {
    const headers = {
        'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
    };
    if (partial) {
        headers['Faces-Request'] = 'partial/ajax';
        headers['X-Requested-With'] = 'XMLHttpRequest';
    }
    return headers;
}

/**
 * 解析用の非表示ドキュメントを用意する。作成・終了中の処理とは重複させない。
 * @returns {Promise<void>} 処理の完了を待つPromise。
 */
export async function ensureKuportParser() {
    // 前のジョブの終了と次のジョブの開始が重なるため、解析用ドキュメントの終了を待つ。
    if (closingKuportParser) await closingKuportParser;
    const documentUrl = chrome.runtime.getURL(KUPORT_PARSER_PATH);
    const contexts = await chrome.runtime.getContexts({
        contextTypes: ['OFFSCREEN_DOCUMENT'],
        documentUrls: [documentUrl],
    });
    if (contexts.length > 0) return;

    if (!creatingKuportParser) {
        creatingKuportParser = chrome.offscreen.createDocument({
            url: KUPORT_PARSER_PATH,
            reasons: ['DOM_PARSER'],
            justification: 'Ku-Portの出席表・シラバス・掲示板HTMLを画面へ表示せず解析するため',
        }).finally(() => {
            creatingKuportParser = null;
        });
    }
    await creatingKuportParser;
}

/**
 * 共通の非表示ドキュメントへ解析を依頼し、結果を返す。解析失敗時は例外を投げる。
 * @param {string} type - 非表示ドキュメントへ依頼する解析種別。
 * @param {object} payload - 指定した解析処理へ渡す応答データ。
 * @param {string} payload.html - 解析対象のHTMLまたはJSF部分応答。
 * @param {string} [payload.baseUrl] - フォームの相対送信先を解決する基準URL。
 * @returns {Promise<object|object[]>} 解析種別に対応するフォーム・記録・表示項目などのデータ。
 * @throws {Error} 非表示ドキュメントの準備、メッセージ送信、HTML解析に失敗した場合。
 */
export async function parseKuportDocument(type, payload) {
    activeParserRequests += 1;
    try {
        await ensureKuportParser();
        const response = await chrome.runtime.sendMessage({
            ...payload,
            target: 'kuport-parser',
            type,
        });
        if (!response?.success) {
            throw new Error(response?.error || 'Ku-portのHTMLを解析できませんでした。');
        }
        return response.data;
    } finally {
        activeParserRequests -= 1;
    }
}

/**
 * 解析要求がない場合に非表示ドキュメントを閉じ、次の作成と競合しないよう終了処理を共有する。
 * @returns {Promise<void>} 終了処理の完了。解析中は終了せずに返る。
 */
export async function closeKuportParser() {
    if (activeParserRequests > 0) return;
    if (closingKuportParser) return closingKuportParser;
    closingKuportParser = Promise.resolve().then(async () => {
        if (creatingKuportParser) await creatingKuportParser;
        if (activeParserRequests > 0) return;
        await chrome.offscreen.closeDocument();
    }).catch(() => {
        // 解析用ドキュメントが存在しないか、Chrome側ですでに閉じられている。
    }).finally(() => { closingKuportParser = null; });
    return closingKuportParser;
}

/**
 * 拡張機能が作成したウィンドウと所有タブだけを閉じる。ユーザーのウィンドウ全体は閉じない。
 * @param {object} job - 要求ID・所有タブ・取得状態を持つジョブ情報。
 * @returns {Promise<void>} 処理の完了を待つPromise。
 */
export async function closeKuportLoginContext(job) {
    if (Number.isInteger(job?.createdWindowId)) {
        try { await chrome.windows.remove(job.createdWindowId); }
        catch { /* すでに閉じられているため、残っている所有タブだけを後続で削除する。 */ }
    }
    const tabIds = new Set(job?.tabIds || []);
    if (Number.isInteger(job?.helperTabId)) tabIds.add(job.helperTabId);
    for (const tabId of tabIds) {
        if (!Number.isInteger(tabId)) continue;
        try { await chrome.tabs.remove(tabId); }
        catch { /* ウィンドウと同時に閉じたか、ユーザーによってすでに削除されている。 */ }
    }
}

/**
 * 認証用の最小化ウィンドウを作る。作成できない場合は非アクティブタブへ切り替える。
 * @returns {Promise<object>} 認証用タブ、所有ウィンドウID、表示方式。
 */
export async function createKuportLoginContext() {
    let popupWindowId = null;
    try {
        const popupWindow = await chrome.windows.create({
            url: 'about:blank',
            type: 'popup',
            state: 'minimized',
            focused: false,
        });
        popupWindowId = popupWindow?.id;
        const tabs = popupWindow?.tabs?.length
            ? popupWindow.tabs
            : Number.isInteger(popupWindow?.id)
                ? await chrome.tabs.query({ windowId: popupWindow.id })
                : [];
        if (tabs[0]?.id !== undefined) {
            return {
                tab: tabs[0],
                createdWindowId: popupWindow.id,
                displayMode: 'minimized-window',
            };
        }
        if (Number.isInteger(popupWindow?.id)) await chrome.windows.remove(popupWindow.id);
    } catch (error) {
        if (Number.isInteger(popupWindowId)) {
            try { await chrome.windows.remove(popupWindowId); }
            catch { /* 作成に失敗したウィンドウがすでに閉じられている場合もある。 */ }
        }
        console.debug('[KLPF] 最小化したKu-portログイン画面を作成できませんでした。', error);
    }

    return {
        tab: await chrome.tabs.create({ active: false }),
        createdWindowId: null,
        displayMode: 'inactive-tab',
    };
}
