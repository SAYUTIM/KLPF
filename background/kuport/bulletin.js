// Copyright (c) 2024-2026 SAYU
// MIT License; see LICENSE.

/**
 * @file Ku-Port掲示板の一覧と本文をJSFフォームへの直接通信で取得する。
 * 共通のフォーム・ヘッダー・非表示HTML解析を使い、進捗通知と継続可否の判定は呼び出し元から受け取る。
 */

import { createFormBody } from '../modules/kuport-form.js';
import { assertKuportUrl } from '../modules/url-utils.js';
import { isKuportUrl, mergeFormFields, createPartialFormBody, createKuportHeaders, parseKuportDocument } from '../modules/kuport-runtime.js';

const KUPORT_ENTRY_URL = 'https://ku-port.sc.kogakuin.ac.jp/';
const KUPORT_BULLETIN_URL = `${KUPORT_ENTRY_URL}uprx/up/bs/bsd007/Bsd00701.xhtml`;
export const BULLETIN_MAX_ITEMS = 5;
const BULLETIN_TAB_AREA_ID = 'funcForm:tabArea';

/**
 * 呼び出し元の進捗・取消処理を組み込み、掲示板の直接通信関数を作る。
 * @param {object} options - この処理に必要な設定と依存処理。
 * @param {Function} options.reportPhase - 要求IDに対応する進捗段階を通知する処理。
 * @param {Function} options.ensureActive - 取得を続行できるか確認し、中断時に例外を投げる処理。
 * @param {Function} options.throwIfAborted - 中断シグナルを検査する処理。
 * @returns {object} セッション確認と掲示板取得を行う関数群。
 */
export function createBulletinTransport({ reportPhase, ensureActive, throwIfAborted }) {
    /**
     * 入口ページから掲示板の送信フォームを取得し、認証の継続可否を確認する。
     * @param {AbortSignal} signal - 取得の中断を通知するシグナル。
     * @returns {Promise<object|null>} 直接取得に使えるフォーム情報。認証を確認できなければnull。
     */
    async function probeKuportSessionForBulletin(signal) {
        throwIfAborted(signal);
        let response = await fetch(KUPORT_ENTRY_URL, {
            credentials: 'include',
            cache: 'no-store',
            redirect: 'follow',
            signal,
        });
        for (let step = 0; step <= 2; step += 1) {
            throwIfAborted(signal);
            if (!response.ok) return null;
            const responseHtml = await response.text();
            try {
                return await parseKuportDocument('parse-bulletin-home-form', {
                    html: responseHtml,
                    baseUrl: response.url,
                });
            } catch (homeError) {
                if (step === 2 || !isKuportUrl(response.url)) return null;
                try {
                    // ログイン済みセッションがメニュー画面を返す場合は、掲示板画面を
                    // 直接GETして以降のAjax通信だけをService Workerで続ける。
                    await parseKuportDocument('parse-menu-bootstrap', {
                        html: responseHtml,
                        baseUrl: response.url,
                    });
                    const boardResponse = await fetch(KUPORT_BULLETIN_URL, {
                        credentials: 'include',
                        cache: 'no-store',
                        redirect: 'follow',
                        signal,
                    });
                    if (boardResponse.ok) {
                        const board = await parseKuportDocument('parse-bulletin-board-response', {
                            html: await boardResponse.text(),
                            baseUrl: boardResponse.url,
                        });
                        if (board?.allPanelId || board?.items?.length) {
                            return { ...board, boardPage: true };
                        }
                    }
                } catch {
                    // ログイン前の画面、またはメニューからの直接GETが未対応なら通常の遷移を続ける。
                }
                let navigation;
                try {
                    navigation = await parseKuportDocument('parse-auto-navigation-form', {
                        html: responseHtml,
                        baseUrl: response.url,
                    });
                } catch {
                    return null;
                }
                try {
                    const navigationAction = assertKuportUrl(navigation.action);
                    response = await fetch(navigationAction, {
                        method: 'POST',
                        credentials: 'include',
                        cache: 'no-store',
                        redirect: 'follow',
                        headers: createKuportHeaders(false),
                        body: createFormBody(navigation.fields),
                        signal,
                    });
                } catch (error) {
                    if (error?.name === 'AbortError') throw error;
                    return null;
                }
            }
        }
        return null;
    }

    /**
     * 上位の掲示IDへ順番にPOSTし、各掲示の本文とメタデータを取得する。
     * @param {string} requestId - 処理と結果を対応付ける取得要求ID。
     * @param {object} board - 解析済みの掲示一覧と送信フォーム情報。
     * @param {object[]} items - 掲示一覧または表示対象の項目。
     * @param {AbortSignal} signal - 取得の中断を通知するシグナル。
     * @returns {Promise<object[]>} 本文とメタデータを付加した掲示情報。
     */
    async function fetchBulletinDetails(requestId, board, items, signal) {
        const resultItems = [];
        let fields = mergeFormFields(board.baseFields, board.fields);
        let action = assertKuportUrl(board.action);
        for (const item of items.slice(0, BULLETIN_MAX_ITEMS)) {
            throwIfAborted(signal);
            await ensureActive(requestId, signal);
            const detailBody = createPartialFormBody(
                fields,
                item.id,
                item.id,
                '@none',
            );
            const detailResponse = await fetch(action, {
                method: 'POST',
                credentials: 'include',
                headers: createKuportHeaders(true),
                body: detailBody,
                redirect: 'follow',
                signal,
            });
            if (!detailResponse.ok) {
                throw new Error(`Ku-port掲示詳細取得エラー: ${detailResponse.status}`);
            }
            await ensureActive(requestId, signal);
            const detail = await parseKuportDocument('parse-bulletin-detail-response', {
                html: await detailResponse.text(),
            });
            if (detail.viewState) fields = mergeFormFields(fields, [['javax.faces.ViewState', detail.viewState]]);
            resultItems.push({
                ...item,
                title: detail.subject || item.title,
                sender: detail.sender || item.sender || '',
                category: detail.category || item.category || '',
                body: detail.body || detail.text || item.body || '',
                period: detail.period || item.period || '',
            });
        }
        return resultItems;
    }

    /**
     * 引き渡されたフォームから全表示の掲示一覧を取得し、上位5件の詳細をまとめる。
     * @param {string} requestId - 処理と結果を対応付ける取得要求ID。
     * @param {object} bootstrap - 認証後に読み取った送信先とフォームフィールド。
     * @param {AbortSignal} signal - 取得の中断を通知するシグナル。
     * @returns {Promise<object>} 最大5件の掲示と取得時刻を含む結果。
     */
    async function fetchKuportBulletinInBackground(requestId, bootstrap, signal) {
        await reportPhase(requestId, 'opening-bulletin-board');
        await ensureActive(requestId, signal);
        let homeBoard = bootstrap.boardPage ? bootstrap : null;
        let boardBaseUrl = bootstrap.action;
        if (!homeBoard) {
            const fromMenu = bootstrap.menuPage === true;
            if (fromMenu && !bootstrap.bulletinMenuId) {
                throw new Error('Ku-portの掲示板メニューを特定できませんでした。');
            }
            const homeBody = fromMenu ? createFormBody(bootstrap.fields) : createPartialFormBody(
                bootstrap.fields,
                bootstrap.bulletinSource,
                bootstrap.bulletinExecute,
                bootstrap.bulletinRender,
            );
            if (fromMenu) {
                homeBody.set('menuForm:mainMenu', 'menuForm:mainMenu');
                homeBody.set('menuForm:mainMenu_menuid', bootstrap.bulletinMenuId);
            }
            const homeResponse = await fetch(assertKuportUrl(bootstrap.action), {
                method: 'POST',
                credentials: 'include',
                headers: createKuportHeaders(!fromMenu),
                body: homeBody,
                redirect: 'follow',
                signal,
            });
            if (!homeResponse.ok) {
                throw new Error(`Ku-port掲示板への遷移エラー: ${homeResponse.status}`);
            }
            boardBaseUrl = homeResponse.url;
            homeBoard = await parseKuportDocument('parse-bulletin-board-response', {
                html: await homeResponse.text(),
                baseUrl: homeResponse.url,
            });
        }
        const baseFields = mergeFormFields(bootstrap.fields, homeBoard.fields);
        const boardAction = assertKuportUrl(homeBoard.action || boardBaseUrl);
        await reportPhase(requestId, 'loading-all-bulletins');
        await ensureActive(requestId, signal);

        const tabAreaId = homeBoard.tabAreaId || BULLETIN_TAB_AREA_ID;
        const allPanelId = homeBoard.allPanelId;
        if (!allPanelId) {
            throw new Error('Ku-port掲示板の全表示パネルを特定できませんでした。');
        }
        const allBody = createFormBody(baseFields);
        allBody.set('javax.faces.partial.ajax', 'true');
        allBody.set('javax.faces.source', tabAreaId);
        allBody.set('javax.faces.partial.execute', tabAreaId);
        allBody.set('javax.faces.partial.render', tabAreaId);
        allBody.set('javax.faces.behavior.event', 'tabChange');
        allBody.set('javax.faces.partial.event', 'tabChange');
        allBody.set(`${tabAreaId}_newTab`, allPanelId);
        allBody.set(`${tabAreaId}_tabindex`, '1');
        allBody.set(`${tabAreaId}_active`, '0,1,2,3,4,5,6,7,8,9,-1');
        allBody.set(tabAreaId, tabAreaId);
        const allResponse = await fetch(boardAction, {
            method: 'POST',
            credentials: 'include',
            headers: createKuportHeaders(true),
            body: allBody,
            redirect: 'follow',
            signal,
        });
        if (!allResponse.ok) {
            throw new Error(`Ku-port掲示板の全表示取得エラー: ${allResponse.status}`);
        }
        await ensureActive(requestId, signal);
        const allBoard = await parseKuportDocument('parse-bulletin-board-response', {
            html: await allResponse.text(),
            baseUrl: allResponse.url,
        });
        const allFields = mergeFormFields(baseFields, allBoard.fields);
        const items = Array.isArray(allBoard.items) && allBoard.items.length > 0
            ? allBoard.items.slice(0, BULLETIN_MAX_ITEMS)
            : (homeBoard.items || []).slice(0, BULLETIN_MAX_ITEMS);
        if (items.length === 0) throw new Error('Ku-port掲示板に取得できる掲示がありませんでした。');

        await reportPhase(requestId, 'loading-bulletin-details');
        const detailedItems = await fetchBulletinDetails(requestId, {
            action: allBoard.action || boardAction,
            baseFields,
            fields: allFields,
        }, items, signal);
        return {
            items: detailedItems.slice(0, BULLETIN_MAX_ITEMS),
            fetchedAt: Date.now(),
        };
    }

    return { probeSession: probeKuportSessionForBulletin, fetchBulletin: fetchKuportBulletinInBackground };
}
