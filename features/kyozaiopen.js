// Copyright (c) 2024-2025 SAYU
// This software is released under the MIT License, see LICENSE.

/**
 * @file 教材一括開封機能
 * @description
 * LMSの教材一覧ページおよび詳細ページに「一括開封ボタン」を追加します。
 * この機能は、複数の教材（ファイル、外部リンクなど）を一度の操作で開き、
 * 自動的に「参照済み」にすることを目的としています。
 */
(() => {
    'use strict';

    // =========================================================================
    // 機能固有の定数 (Feature-Specific Constants)
    // =========================================================================

    /** @type {Object} - この機能でのみ使用する定数 */
    const FEATURE_CONSTANTS = {
        FEATURE_NAME: 'KLPF',
        SELECTORS: {
            // Page Detection
            SRCL_FORM: '#srcl_form',
            MAIN_FORM: '#main_form',
            DETAIL_TABLE: 'table.lms-float-table',
            BACK_BUTTON: 'input[onclick*="bacKyozai"]',
            // Material Extraction
            MATERIAL_ICON: 'i[title="資料"], i[title="ファイル資料"], i.fj-icon-file-outline',
            MATERIAL_CELL: 'td.kyozaititleCell',
            KYOZAI_LINK: 'a[onclick*="kyozaiTitleLink"]',
            DETAIL_MATERIAL_CELL: 'td[data-label="資料名"]',
            DETAIL_TABLE_ROWS: 'table.lms-float-table tbody tr',
            ONCLICK_LINK: 'a[onclick]',
            // Button Placement
            DETAIL_HEADER_LEFT: '#cs_fullHeadLeft, .lms-srcs-head-adj',
            // Form Inputs
            FORM_FILE_ID: 'input[name="fileId"]',
            FORM_SYOSAI_ID: 'input[name="syosaiId"]',
            FORM_KYOZAI_ID: '#kyozaiId',
            FORM_KYOZAI_SY_CD: '#kyozaiSyCdHidden',
        },
        STORAGE_KEYS: {
            BULK_OPERATION: 'klpf_kyozai_bulk_operation',
            BUTTON_TRIGGERED: 'klpf_kyozai_button_triggered',
            TRIGGER_TIMESTAMP: 'klpf_kyozai_trigger_timestamp',
            SESSION_TRIGGER: 'klpf_kyozai_button_session',
            SESSION_TIMESTAMP: 'klpf_kyozai_session_timestamp',
            COMPLETED_FLAG: 'klpf_kyozai_bulk_completed',
            COMPLETION_DATA: 'klpf_kyozai_completion_data',
        },
        CLASS_NAMES: {
            MAIN_BULK_BUTTON: 'klpf-bulk-open-btn',
            DETAIL_BULK_BUTTON: 'klpf-detail-bulk-open-btn',
        },
        MESSAGES: {
            FETCHING: '教材情報を取得中...', 
            NAVIGATING: '教材詳細ページに移動中...',
            OPENING: '開封中...', 
            PROCESSING: '処理中...',
            UPDATING_STATUS: 'ステータス更新中...', 
            NO_MATERIALS_FOUND: 'この資料には開封できるファイルが見つかりませんでした。',
            FETCH_FAILED: '教材情報の取得に失敗しました。手動で教材詳細ページから開封してください。',
            BULK_OPEN_FAILED: '教材の一括開封中にエラーが発生しました。',
            COMPLETED_ALERT: function(count) {
                return count + '個の資料を開封し、参照済みにしました！\n\nダウンロードファイルはブラウザのダウンロードフォルダをご確認ください。';
            },
            CONFIRM_PROMPT: function(materials, downloadable, externals) {
                var message = materials.length + '個の資料を一括で開封し、参照済みにします。';
                message += '資料一覧:\n' + materials.map(function(m, i) { return (i + 1) + '. ' + m.name; }).join('\n') + '\n\n';
                if (downloadable.length > 0) {
                    message += '※ ' + downloadable.length + '個のファイルが教材詳細ページ経由でダウンロードされます。';
                }
                if (externals.length > 0) {
                    message += '※ ' + externals.length + '個の外部リンクが直接開かれます。';
                }
                message += '処理中は他のページに移動しないでください。';
                message += 'よろしいですか？';
                return message;
            },
            CONFIRM_DIRECT_PROMPT: function(materials) {
                var message = materials.length + '個の資料を直接開封します。';
                message += '資料一覧:\n' + materials.map(function(m, i) { return (i + 1) + '. ' + m.name; }).join('\n') + '\n\n';
                message += 'よろしいですか？';
                return message;
            },
            CONFIRM_DETAIL_PROMPT: function(materials) {
                var message = materials.length + '個の資料を一括で開封し、参照済みにします。';
                message += '資料一覧:\n' + materials.map(function(m, i) { return (i + 1) + '. ' + m.name + ' (' + m.type + ')'; }).join('\n') + '\n\n';
                message += 'よろしいですか？';
                return message;
            },
        },
    };

    /** @type {Object} - ユーザーが変更可能な設定 */
    const CONFIG = {
        OPEN_DELAY: 0, // 各教材を開く間隔 (ms)
        NAVIGATION_DELAY: 10, // ページ遷移前の待機時間 (ms)
        RETURN_DELAY: 100, // 元のページに戻る前の待機時間 (ms)
        DEBOUNCE_DELAY: 300, // DOM変更監視のデバウンス時間 (ms)
        TRIGGER_TIMEOUT: 2 * 60 * 1000, // 2分
        SESSION_TIMEOUT: 1 * 60 * 1000, // 1分
        DEBUG_MODE: false, // デバッグログを有効にするか
    };

    // =========================================================================
    // ユーティリティ (Utilities)
    // =========================================================================

    /**
     * デバッグ用のログを出力する
     * @param {...any} args - ログに出力する内容
     */
    function logDebug() {
        if (CONFIG.DEBUG_MODE) {
            var args = Array.from(arguments);
            console.log.apply(console, ['[' + FEATURE_CONSTANTS.FEATURE_NAME + ' DEBUG]'].concat(args));
        }
    }

    /**
     * 指定時間待機する
     * @param {number} ms - 待機時間 (ミリ秒)
     * @returns {Promise<void>}
     */
    function sleep(ms) {
        return new Promise(function(resolve) { setTimeout(resolve, ms); });
    }

    // =========================================================================
    // 状態管理 (State Management)
    // =========================================================================

    /**
     * 機能の状態を管理するクラス (localStorage/sessionStorage)
     */
    class StateManager {
        constructor() {
            this.processedIds = new Set();
        }

        isProcessed(id) {
            return this.processedIds.has(id);
        }

        markProcessed(id) {
            this.processedIds.add(id);
        }

        setBulkOperation(data) {
            const now = Date.now().toString();
            localStorage.setItem(FEATURE_CONSTANTS.STORAGE_KEYS.BULK_OPERATION, JSON.stringify(data));
            localStorage.setItem(FEATURE_CONSTANTS.STORAGE_KEYS.BUTTON_TRIGGERED, 'true');
            localStorage.setItem(FEATURE_CONSTANTS.STORAGE_KEYS.TRIGGER_TIMESTAMP, now);
            sessionStorage.setItem(FEATURE_CONSTANTS.STORAGE_KEYS.SESSION_TRIGGER, 'true');
            sessionStorage.setItem(FEATURE_CONSTANTS.STORAGE_KEYS.SESSION_TIMESTAMP, now);
        }

        getBulkOperation() {
            const stored = localStorage.getItem(FEATURE_CONSTANTS.STORAGE_KEYS.BULK_OPERATION);
            if (!stored) return null;
            try {
                return JSON.parse(stored);
            } catch (error) {
                console.error('[' + FEATURE_CONSTANTS.FEATURE_NAME + '] 一括操作データのパースに失敗', error);
                this.clearBulkOperation();
                return null;
            }
        }

        isButtonTriggered() {
            const localFlag = localStorage.getItem(FEATURE_CONSTANTS.STORAGE_KEYS.BUTTON_TRIGGERED);
            const localTimestamp = localStorage.getItem(FEATURE_CONSTANTS.STORAGE_KEYS.TRIGGER_TIMESTAMP);
            const sessionFlag = sessionStorage.getItem(FEATURE_CONSTANTS.STORAGE_KEYS.SESSION_TRIGGER);
            const sessionTimestamp = sessionStorage.getItem(FEATURE_CONSTANTS.STORAGE_KEYS.SESSION_TIMESTAMP);

            if (localFlag === 'true' && sessionFlag === 'true' && localTimestamp && sessionTimestamp) {
                const elapsed = Date.now() - parseInt(localTimestamp, 10);
                const sessionElapsed = Date.now() - parseInt(sessionTimestamp, 10);
                return elapsed < CONFIG.TRIGGER_TIMEOUT && sessionElapsed < CONFIG.SESSION_TIMEOUT;
            }
            return false;
        }

        clearBulkOperation() {
            localStorage.removeItem(FEATURE_CONSTANTS.STORAGE_KEYS.BULK_OPERATION);
            localStorage.removeItem(FEATURE_CONSTANTS.STORAGE_KEYS.BUTTON_TRIGGERED);
            localStorage.removeItem(FEATURE_CONSTANTS.STORAGE_KEYS.TRIGGER_TIMESTAMP);
            sessionStorage.removeItem(FEATURE_CONSTANTS.STORAGE_KEYS.SESSION_TRIGGER);
            sessionStorage.removeItem(FEATURE_CONSTANTS.STORAGE_KEYS.SESSION_TIMESTAMP);
        }

        setCompletionData(data) {
            sessionStorage.setItem(FEATURE_CONSTANTS.STORAGE_KEYS.COMPLETED_FLAG, 'true');
            sessionStorage.setItem(FEATURE_CONSTANTS.STORAGE_KEYS.COMPLETION_DATA, JSON.stringify(data));
        }

        getCompletionData() {
            if (sessionStorage.getItem(FEATURE_CONSTANTS.STORAGE_KEYS.COMPLETED_FLAG) !== 'true') {
                return null;
            }
            const data = sessionStorage.getItem(FEATURE_CONSTANTS.STORAGE_KEYS.COMPLETION_DATA);
            sessionStorage.removeItem(FEATURE_CONSTANTS.STORAGE_KEYS.COMPLETED_FLAG);
            sessionStorage.removeItem(FEATURE_CONSTANTS.STORAGE_KEYS.COMPLETION_DATA);
            if (!data) return null;

            try {
                return JSON.parse(data);
            } catch (error) {
                console.error('[' + FEATURE_CONSTANTS.FEATURE_NAME + '] 完了データのパースに失敗', error);
                return null;
            }
        }
    }

    // =========================================================================
    // ページ種別判定 (Page Detector)
    // =========================================================================

    class PageDetector {
        static detect() {
            const hasSrclForm = !!safeQuerySelector(FEATURE_CONSTANTS.SELECTORS.SRCL_FORM);
            const hasDetailTable = !!safeQuerySelector(FEATURE_CONSTANTS.SELECTORS.DETAIL_TABLE);
            const hasBackButton = !!safeQuerySelector(FEATURE_CONSTANTS.SELECTORS.BACK_BUTTON);

            if (hasSrclForm && hasDetailTable && hasBackButton) {
                return 'detail';
            }

            const hasMainForm = !!safeQuerySelector(FEATURE_CONSTANTS.SELECTORS.MAIN_FORM);
            const hasKyozaiLinks = !!safeQuerySelector(FEATURE_CONSTANTS.SELECTORS.KYOZAI_LINK);

            if (hasMainForm && hasKyozaiLinks) {
                return 'main';
            }

            return 'unknown';
        }
    }

    // =========================================================================
    // 教材パーサー (Material Parser)
    // =========================================================================

    class MaterialParser {
        static async fetchAndParseMaterials(kyozaiId, kyozaiSyCd) {
            const sid = getSid();
            if (!sid) {
                throw new Error('セッションIDが取得できませんでした');
            }

            const url = LMS_URL + 'lms/corsColl/linkKyozaiTitle;SID=' + sid;
            const formData = new URLSearchParams({
                kyozaiId: kyozaiId,
                kyozaiSyCdHidden: kyozaiSyCd
            });

            logDebug("fetch送信先:", url, { kyozaiId, kyozaiSyCd });

            const response = await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                body: formData,
                credentials: 'same-origin'
            });

            if (!response.ok) {
                throw new Error('HTTP ' + response.status + ': ' + response.statusText);
            }

            const html = await response.text();
            logDebug("fetch取得HTML:", html);

            return this.parseFromHtml(html);
        }

        static parseFromHtml(html) {
            const doc = new DOMParser().parseFromString(html, 'text/html');
            const materialsMap = new Map();

            safeQuerySelectorAll(FEATURE_CONSTANTS.SELECTORS.ONCLICK_LINK, doc).forEach(link => {
                try {
                    const material = this._extractMaterialFromLink(link);
                    if (material && !materialsMap.has(material.uniqueKey)) {
                        materialsMap.set(material.uniqueKey, material);
                    }
                } catch (error) {
                    console.error('[' + FEATURE_CONSTANTS.FEATURE_NAME + '] 教材リンクの解析エラー', error, link);
                }
            });

            return Array.from(materialsMap.values());
        }

        static extractFromDetailPage() {
            const materialsMap = new Map();
            safeQuerySelectorAll(FEATURE_CONSTANTS.SELECTORS.DETAIL_TABLE_ROWS).forEach(row => {
                try {
                    const material = this._extractMaterialFromTableRow(row);
                    if (material && !materialsMap.has(material.uniqueKey)) {
                        materialsMap.set(material.uniqueKey, material);
                    }
                } catch (error) {
                    console.error('[' + FEATURE_CONSTANTS.FEATURE_NAME + '] テーブル行の解析エラー', error, row);
                }
            });
            return Array.from(materialsMap.values());
        }

        static _extractMaterialFromTableRow(row) {
            const materialCell = safeQuerySelector(FEATURE_CONSTANTS.SELECTORS.DETAIL_MATERIAL_CELL, row);
            if (!materialCell) return null;

            const resourceIcon = safeQuerySelector(FEATURE_CONSTANTS.SELECTORS.MATERIAL_ICON, materialCell);
            if (!resourceIcon) return null;

            const link = safeQuerySelector(FEATURE_CONSTANTS.SELECTORS.ONCLICK_LINK, materialCell);
            if (!link) return null;

            return this._extractMaterialFromLink(link);
        }

        static _extractMaterialFromLink(link) {
            const onclick = link.getAttribute('onclick') || '';
            const name = link.textContent.trim();
            if (!name) return null;

            const downloadMatch = onclick.match(/downloadFile\('([^']+)',\s*'([^']+)'\)/);
            if (downloadMatch) {
                return { name: name, type: 'download', fileId: downloadMatch[1], syosaiId: downloadMatch[2], uniqueKey: 'download_' + downloadMatch[1] };
            }

            const referenceMatch = onclick.match(/openReference\('([^']+)'(?:,\s*(true|false))?\)/);
            if (referenceMatch) {
                return { name: name, type: 'reference', fileId: referenceMatch[1], officeFlg: referenceMatch[2] === 'true', uniqueKey: 'reference_' + referenceMatch[1] };
            }

            const windowMatch = onclick.match(/openWindow\('([^']+)'/);
            if (windowMatch) {
                const rawUrl = windowMatch[1].replace(/&amp;/g, '&');
                let finalUrl = rawUrl;
                try {
                    const urlObj = new URL(rawUrl, window.location.origin);
                    if (urlObj.pathname.includes("/srcsSrcl/downloadUrl") && urlObj.searchParams.has("fileurl")) {
                        finalUrl = decodeURIComponent(urlObj.searchParams.get("fileurl"));
                    }
                } catch (e) {
                    logDebug("URLの解析に失敗:", rawUrl, e);
                }
                finalUrl = finalUrl.endsWith("/") ? finalUrl.slice(0, -1) : finalUrl;
                return { name: name, type: 'external', trackingUrl: finalUrl, uniqueKey: 'external_' + finalUrl };
            }

            return null;
        }
    }

    // =========================================================================
    // ダウンローダー (Downloader)
    // =========================================================================

    class Downloader {
        static processMaterial(material) {
            logDebug("教材処理開始:", material);
            try {
                switch (material.type) {
                    case 'download':
                        return this._downloadFile(material.fileId, material.syosaiId);
                    case 'reference':
                        return this._openReference(material.fileId, material.officeFlg);
                    case 'external':
                        return this._openExternal(material.trackingUrl);
                    default:
                        console.warn('[' + FEATURE_CONSTANTS.FEATURE_NAME + '] 未対応の教材タイプ: ' + material.type, material);
                        return false;
                }
            } catch (error) {
                console.error('[' + FEATURE_CONSTANTS.FEATURE_NAME + '] 教材処理エラー:', error, material);
                return false;
            }
        }

        static _downloadFile(fileId, syosaiId) {
            if (this._submitSrclForm(fileId, syosaiId, false)) {
                logDebug("srcl_formでダウンロード:", fileId);
                return true;
            }
            if (typeof window.downloadFile === 'function') {
                try {
                    window.downloadFile(fileId, syosaiId);
                    logDebug("window.downloadFileでダウンロード:", fileId);
                    return true;
                } catch (e) {
                    console.warn('[' + FEATURE_CONSTANTS.FEATURE_NAME + '] window.downloadFileの実行に失敗', e);
                }
            }
            logDebug("iframeフォールバックでダウンロード:", fileId);
            return this._createIframeFormSubmit(fileId, syosaiId, false);
        }

        static _openReference(fileId, officeFlg) {
            if (this._submitSrclForm(fileId, null, true, officeFlg)) {
                logDebug("srcl_formで参照:", fileId);
                return true;
            }
            if (typeof window.openReference === 'function') {
                try {
                    window.openReference(fileId, officeFlg);
                    logDebug("window.openReferenceで参照:", fileId);
                    return true;
                } catch (e) {
                    console.warn('[' + FEATURE_CONSTANTS.FEATURE_NAME + '] window.openReferenceの実行に失敗', e);
                }
            }
            logDebug("iframeフォールバックで参照:", fileId);
            return this._createIframeFormSubmit(fileId, null, true, officeFlg);
        }

        static _openExternal(url) {
            try {
                const absoluteUrl = url.startsWith('/') ? new URL(LMS_URL).origin + url : url;
                window.open(absoluteUrl, '_blank', 'noopener,noreferrer');
                return true;
            } catch (error) {
                console.error('[' + FEATURE_CONSTANTS.FEATURE_NAME + '] 外部リンクを開けませんでした:', url, error);
                return false;
            }
        }

        static _submitSrclForm(fileId, syosaiId, isReference, officeFlg) {
            const form = safeQuerySelector(FEATURE_CONSTANTS.SELECTORS.SRCL_FORM);
            if (!form) return false;

            const sid = getSid();
            if (!sid) return false;

            try {
                const fileIdInput = safeQuerySelector(FEATURE_CONSTANTS.SELECTORS.FORM_FILE_ID, form);
                if (fileIdInput) fileIdInput.value = fileId;

                if (syosaiId) {
                    const syosaiIdInput = safeQuerySelector(FEATURE_CONSTANTS.SELECTORS.FORM_SYOSAI_ID, form);
                    if (syosaiIdInput) syosaiIdInput.value = syosaiId;
                }

                if (isReference) {
                    form.action = officeFlg ?
                        '/lms/srcsSrcl/downloadOffice;SID=' + sid :
                        '/lms/srcsSrcl/downloadImage;SID=' + sid;
                    form.target = '_blank';
                } else {
                    form.action = '/lms/srcsSrcl/downloadFile;SID=' + sid;
                    form.target = '';
                }
                form.submit();
                if (isReference) form.target = '_self';
                return true;
            } catch (error) {
                console.error('[' + FEATURE_CONSTANTS.FEATURE_NAME + '] srcl_formの操作に失敗', error);
                return false;
            }
        }

        static _createIframeFormSubmit(fileId, syosaiId, isReference, officeFlg) {
            const sid = getSid();
            if (!sid) return false;

            const form = document.createElement('form');
            form.method = 'POST';
            form.style.display = 'none';

            if (isReference) {
                form.action = officeFlg ?
                    '/lms/srcsSrcl/downloadOffice;SID=' + sid :
                    '/lms/srcsSrcl/downloadImage;SID=' + sid;
                form.target = '_blank';
            } else {
                const iframe = document.createElement('iframe');
                iframe.name = 'download_iframe_' + Date.now();
                iframe.style.display = 'none';
                document.body.appendChild(iframe);
                form.target = iframe.name;
                form.action = '/lms/srcsSrcl/downloadFile;SID=' + sid;
                setTimeout(function() { document.body.removeChild(iframe); }, 10000);
            }

            const fileIdInput = document.createElement('input');
            fileIdInput.type = 'hidden';
            fileIdInput.name = 'fileId';
            fileIdInput.value = fileId;
            form.appendChild(fileIdInput);

            if (syosaiId) {
                const syosaiIdInput = document.createElement('input');
                syosaiIdInput.type = 'hidden';
                syosaiIdInput.name = 'syosaiId';
                syosaiIdInput.value = syosaiId;
                form.appendChild(syosaiIdInput);
            }

            document.body.appendChild(form);
            form.submit();
            setTimeout(function() { document.body.removeChild(form); }, 5000);
            return true;
        }
    }

    // =========================================================================
    // アクションハンドラ (Action Handler)
    // =========================================================================

    class ActionHandler {
        static async handleMainPageClick(kyozaiId, kyozaiSyCd, button) {
            const originalText = button.textContent;
            UIManager.updateButtonState(button, FEATURE_CONSTANTS.MESSAGES.FETCHING, true);

            try {
                const materials = await MaterialParser.fetchAndParseMaterials(kyozaiId, kyozaiSyCd);
                if (materials.length === 0) {
                    alert(FEATURE_CONSTANTS.MESSAGES.NO_MATERIALS_FOUND);
                    UIManager.updateButtonState(button, originalText, false);
                    return;
                }

                const downloadable = materials.filter(function(m) { return m.type === 'download' || m.type === 'reference'; });
                const externals = materials.filter(function(m) { return m.type === 'external'; });

                if (downloadable.length > 0) {
                    this._handleNavigationRequired(kyozaiId, kyozaiSyCd, materials, button, originalText);
                } else {
                    this._handleDirectOpening(externals, button, originalText);
                }
            } catch (error) {
                console.error('[' + FEATURE_CONSTANTS.FEATURE_NAME + '] 条件分岐処理でエラー:', error);
                alert(FEATURE_CONSTANTS.MESSAGES.FETCH_FAILED);
                UIManager.updateButtonState(button, originalText, false);
            }
        }

        static async handleDetailPageClick(button) {
            const originalText = button.textContent;
            UIManager.updateButtonState(button, FEATURE_CONSTANTS.MESSAGES.PROCESSING, true);

            try {
                const allMaterials = MaterialParser.extractFromDetailPage();
                if (allMaterials.length === 0) {
                    alert(FEATURE_CONSTANTS.MESSAGES.NO_MATERIALS_FOUND);
                    UIManager.updateButtonState(button, originalText, false);
                    return;
                }

                if (!confirm(FEATURE_CONSTANTS.MESSAGES.CONFIRM_DETAIL_PROMPT(allMaterials))) {
                    UIManager.updateButtonState(button, originalText, false);
                    return;
                }

                const externals = allMaterials.filter(function(m) { return m.type === 'external'; });
                externals.forEach(function(m) { Downloader.processMaterial(m); });

                const downloadable = allMaterials.filter(function(m) { return m.type !== 'external'; });
                if (downloadable.length > 0) {
                    await this._processMaterialsInSequence(downloadable, button);
                }

                await sleep(CONFIG.RETURN_DELAY);
                UIManager.updateButtonState(button, FEATURE_CONSTANTS.MESSAGES.UPDATING_STATUS, true);

                if (typeof window.link === 'function') {
                    window.link();
                }

                alert(FEATURE_CONSTANTS.MESSAGES.COMPLETED_ALERT(allMaterials.length));
                UIManager.updateButtonState(button, originalText, false);

            } catch (error) {
                console.error('[' + FEATURE_CONSTANTS.FEATURE_NAME + '] 詳細ページ一括開封処理でエラー:', error);
                alert(FEATURE_CONSTANTS.MESSAGES.BULK_OPEN_FAILED);
                UIManager.updateButtonState(button, originalText, false);
            }
        }

        static async executeAutoDownload() {
            if (!state.isButtonTriggered()) {
                logDebug("ボタン起因の遷移ではないため自動実行をスキップ");
                state.clearBulkOperation();
                return;
            }

            const bulkData = state.getBulkOperation();
            if (!bulkData || !Array.isArray(bulkData.materials) || bulkData.materials.length === 0) {
                logDebug("一括操作データ不整合のため自動実行をスキップ");
                state.clearBulkOperation();
                return;
            }

            console.info('[' + FEATURE_CONSTANTS.FEATURE_NAME + '] 自動ダウンロード開始（教材数: ' + bulkData.materials.length + '）');

            await this._processMaterialsInSequence(bulkData.materials);

            if (typeof window.link === 'function') {
                try {
                    window.link();
                } catch (e) {
                    console.error('[' + FEATURE_CONSTANTS.FEATURE_NAME + '] 参照状況の更新に失敗', e);
                }
            }

            state.setCompletionData({
                materialCount: bulkData.materials.length,
                buttonSelector: bulkData.buttonSelector,
                originalText: bulkData.originalText
            });

            await sleep(CONFIG.RETURN_DELAY);

            if (typeof window.bacKyozai === 'function') {
                window.bacKyozai();
            } else {
                window.location.href = bulkData.returnUrl;
            }
        }

        static _handleNavigationRequired(kyozaiId, kyozaiSyCd, materials, button, originalText) {
            const downloadable = materials.filter(function(m) { return m.type === 'download' || m.type === 'reference'; });
            const externals = materials.filter(function(m) { return m.type === 'external'; });

            if (!confirm(FEATURE_CONSTANTS.MESSAGES.CONFIRM_PROMPT(materials, downloadable, externals))) {
                UIManager.updateButtonState(button, originalText, false);
                return;
            }

            externals.forEach(function(m) { Downloader.processMaterial(m); });

            state.setBulkOperation({
                materials: downloadable,
                returnUrl: window.location.href,
                originalText: originalText,
                buttonSelector: '.' + FEATURE_CONSTANTS.CLASS_NAMES.MAIN_BULK_BUTTON + '[data-kyozai-key="' + kyozaiId + '_' + kyozaiSyCd + '"]'
            });

            UIManager.updateButtonState(button, FEATURE_CONSTANTS.MESSAGES.NAVIGATING, true);

            setTimeout(() => {
                if (typeof window.kyozaiTitleLink === 'function') {
                    window.kyozaiTitleLink(kyozaiId, kyozaiSyCd);
                } else {
                    this._navigateToDetailPageFallback(kyozaiId, kyozaiSyCd);
                }
            }, CONFIG.NAVIGATION_DELAY);
        }

        static async _handleDirectOpening(materials, button, originalText) {
            if (materials.length === 0) {
                alert(FEATURE_CONSTANTS.MESSAGES.NO_MATERIALS_FOUND);
                UIManager.updateButtonState(button, originalText, false);
                return;
            }

            if (!confirm(FEATURE_CONSTANTS.MESSAGES.CONFIRM_DIRECT_PROMPT(materials))) {
                UIManager.updateButtonState(button, originalText, false);
                return;
            }

            UIManager.updateButtonState(button, FEATURE_CONSTANTS.MESSAGES.OPENING, true);
            await this._processMaterialsInSequence(materials, button);

            alert(FEATURE_CONSTANTS.MESSAGES.COMPLETED_ALERT(materials.length));
            UIManager.updateButtonState(button, originalText, false);
        }

        static async _processMaterialsInSequence(materials, button = null) {
            for (let i = 0; i < materials.length; i++) {
                if (button) {
                    button.textContent = FEATURE_CONSTANTS.MESSAGES.OPENING + ' (' + (i + 1) + '/' + materials.length + ')';
                }
                Downloader.processMaterial(materials[i]);
                await sleep(CONFIG.OPEN_DELAY);
            }
        }

        static _navigateToDetailPageFallback(kyozaiId, kyozaiSyCd) {
            const form = safeQuerySelector(FEATURE_CONSTANTS.SELECTORS.MAIN_FORM);
            const sid = getSid();
            if (!form || !sid) {
                alert("ページの遷移に失敗しました。");
                return;
            }
            const kyozaiIdInput = safeQuerySelector(FEATURE_CONSTANTS.SELECTORS.FORM_KYOZAI_ID, form);
            const kyozaiSyCdInput = safeQuerySelector(FEATURE_CONSTANTS.SELECTORS.FORM_KYOZAI_SY_CD, form);

            if (kyozaiIdInput && kyozaiSyCdInput) {
                kyozaiIdInput.value = kyozaiId;
                kyozaiSyCdInput.value = kyozaiSyCd;
                form.action = '/lms/corsColl/linkKyozaiTitle;SID=' + sid;
                form.submit();
            }
        }
    }

    // =========================================================================
    // UIマネージャー (UI Manager)
    // =========================================================================

    class UIManager {
        static initializeUI() {
            const pageType = PageDetector.detect();
            logDebug("ページ種別:", pageType);

            if (pageType === 'main') {
                this.addBulkOpenButtons();
                this.startObserver();
                this.checkForCompletion();
            } else if (pageType === 'detail') {
                this.addDetailPageButton();
                setTimeout(function() { ActionHandler.executeAutoDownload(); }, CONFIG.NAVIGATION_DELAY);
            }
        }

        static addBulkOpenButtons() {
            safeQuerySelectorAll(FEATURE_CONSTANTS.SELECTORS.MATERIAL_CELL).forEach(cell => {
                try {
                    const link = safeQuerySelector(FEATURE_CONSTANTS.SELECTORS.KYOZAI_LINK, cell);
                    const icon = safeQuerySelector(FEATURE_CONSTANTS.SELECTORS.MATERIAL_ICON, cell);
                    if (!link || !icon) return;

                    const onclick = link.getAttribute('onclick');
                    if (!onclick) return;

                    const match = onclick.match(/kyozaiTitleLink\('([^']+)',\s*'([^']+)'\)/);
                    if (!match) return;

                    const kyozaiId = match[1];
                    const kyozaiSyCd = match[2];
                    const uniqueKey = kyozaiId + '_' + kyozaiSyCd;
                    if (state.isProcessed(uniqueKey)) return;

                    const button = this._createButton('📄 全資料を開く', FEATURE_CONSTANTS.CLASS_NAMES.MAIN_BULK_BUTTON, uniqueKey);
                    button.addEventListener('click', (e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        ActionHandler.handleMainPageClick(kyozaiId, kyozaiSyCd, button);
                    });

                    link.parentNode.insertBefore(button, link.nextSibling);
                    state.markProcessed(uniqueKey);
                } catch (error) {
                    console.error('[' + FEATURE_CONSTANTS.FEATURE_NAME + '] 教材セルの処理中にエラー', error, cell);
                }
            });
        }

        static addDetailPageButton() {
            if (safeQuerySelector('.' + FEATURE_CONSTANTS.CLASS_NAMES.DETAIL_BULK_BUTTON)) return;

            const materials = MaterialParser.extractFromDetailPage();
            if (materials.length === 0) return;

            const headerLeft = safeQuerySelector(FEATURE_CONSTANTS.SELECTORS.DETAIL_HEADER_LEFT);
            if (headerLeft) {
                const button = this._createButton('📄 全資料を一括開封', FEATURE_CONSTANTS.CLASS_NAMES.DETAIL_BULK_BUTTON);
                button.style.padding = '6px 12px';
                button.style.fontSize = '12px';
                button.addEventListener('click', (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    ActionHandler.handleDetailPageClick(button);
                });
                headerLeft.appendChild(button);
                console.info('[' + FEATURE_CONSTANTS.FEATURE_NAME + '] 詳細ページに一括開封ボタンを追加しました');
            }
        }

        static checkForCompletion() {
            const completionData = state.getCompletionData();
            if (completionData) {
                const button = safeQuerySelector(completionData.buttonSelector);
                if (button) {
                    this.updateButtonState(button, completionData.originalText, false);
                }
                setTimeout(function() {
                    alert(FEATURE_CONSTANTS.MESSAGES.COMPLETED_ALERT(completionData.materialCount));
                    state.clearBulkOperation();
                }, 500);
            }
        }

        static startObserver() {
            const observer = new MutationObserver(mutations => {
                const hasRelevantChanges = mutations.some(m =>
                    m.type === 'childList' && Array.from(m.addedNodes).some(node =>
                        node.nodeType === Node.ELEMENT_NODE && (
                            node.matches(FEATURE_CONSTANTS.SELECTORS.MATERIAL_CELL) ||
                            node.querySelector(FEATURE_CONSTANTS.SELECTORS.MATERIAL_CELL)
                        )
                    )
                );
                if (hasRelevantChanges) {
                    this.addBulkOpenButtons();
                }
            });

            observer.observe(document.body, {
                childList: true,
                subtree: true
            });
        }

        static _createButton(text, className, key = null) {
            const button = document.createElement('button');
            button.textContent = text;
            button.className = className;
            if (key) {
                button.setAttribute('data-kyozai-key', key);
            }
            Object.assign(button.style, {
                marginLeft: '8px',
                background: 'linear-gradient(135deg, #4CAF50 0%, #45a049 100%)',
                color: 'white',
                border: 'none',
                padding: '4px 8px',
                borderRadius: '4px',
                cursor: 'pointer',
                fontSize: '11px',
                fontWeight: 'bold',
                boxShadow: '0 2px 4px rgba(0,0,0,0.2)',
                transition: 'all 0.3s ease',
            });
            button.addEventListener('mouseover', () => {
                button.style.transform = 'translateY(-1px)';
                button.style.boxShadow = '0 4px 8px rgba(0,0,0,0.3)';
            });
            button.addEventListener('mouseout', () => {
                button.style.transform = 'translateY(0)';
                button.style.boxShadow = '0 2px 4px rgba(0,0,0,0.2)';
            });
            return button;
        }

        static updateButtonState(button, text, disabled) {
            if (button) {
                button.textContent = text;
                button.disabled = disabled;
            }
        }
    }

    // =========================================================================
    // 初期化 (Initialization)
    // =========================================================================

    const state = new StateManager();

    function initialize() {
        try {
            UIManager.initializeUI();
            console.info('[' + FEATURE_CONSTANTS.FEATURE_NAME + '] 教材一括開封機能が初期化されました');
        } catch (error) {
            console.error('[' + FEATURE_CONSTANTS.FEATURE_NAME + '] 初期化中にエラーが発生しました:', error);
        }
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initialize);
    } else {
        initialize();
    }

})();
