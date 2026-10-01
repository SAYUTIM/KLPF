// Copyright (c) 2024-2026 SAYU
// This software is released under the MIT License, see LICENSE.

/**
 * @file 設定のインポート/エクスポートを管理するモジュール
 * @module modules/backup
 * Chromeのsync/localストレージとJSONファイルを使い、設定のエクスポートと確認付きインポートを行う。
 * 形式検証はbackup-formatへ委譲し、復元後にスクリプト登録と設定画面を更新する。
 */

import { loadAndApplySettings } from './settings.js';
import { createExportPayload, validateImportPayload } from './backup-format.js';

const elements = {
    exportButton: null,
    importButton: null,
    importFileInput: null,
    confirmModal: null,
    confirmButton: null,
    cancelButton: null,
};

let confirmResolver = null;

/**
 * 設定バックアップの操作に使うDOM要素を取得して保持する。
 * @returns {void} 戻り値はない。
 */
function cacheDOMElements() {
    elements.exportButton = document.getElementById('export-settings-button');
    elements.importButton = document.getElementById('import-settings-button');
    elements.importFileInput = document.getElementById('import-settings-file');
    elements.confirmModal = document.getElementById('backup-confirm-modal');
    elements.confirmButton = document.getElementById('backup-confirm-button');
    elements.cancelButton = document.getElementById('backup-cancel-button');
}

/**
 * 操作結果を表示するカスタムイベントを送る。
 * @param {string} text - 表示または照合する文字列。
 * @param {string} [color="lightgreen"] - 操作結果に使用する表示色。
 * @param {number} [duration=3000] - 表示または待機の時間（ミリ秒）。
 * @returns {void} 戻り値はない。
 */
function dispatchStatusMessage(text, color = 'lightgreen', duration = 3000) {
    document.dispatchEvent(new CustomEvent('settings-saved', {
        detail: { text, color, duration },
    }));
}

/**
 * エラー表示用のカスタムイベントを送る。
 * @param {string|object} message - 表示する案内文、または受信した機能メッセージ。
 * @returns {void} 戻り値はない。
 */
function dispatchErrorMessage(message) {
    document.dispatchEvent(new CustomEvent('settings-error', { detail: message }));
}

/**
 * 数字を2桁の表示文字列へそろえる。
 * @param {*} value - 検証・変換する入力値。
 * @returns {string} 表示または識別に使う文字列。
 */
function padNumber(value) {
    return value.toString().padStart(2, '0');
}

/**
 * 現在時刻を含むバックアップファイル名を作る。
 * @returns {string} 時刻を含むJSONバックアップのファイル名。
 */
function buildExportFileName() {
    const now = new Date();
    const date = `${now.getFullYear()}${padNumber(now.getMonth() + 1)}${padNumber(now.getDate())}`;
    const time = `${padNumber(now.getHours())}${padNumber(now.getMinutes())}${padNumber(now.getSeconds())}`;
    return `klpf-settings-${date}-${time}.json`;
}

/**
 * syncとlocalの設定値を読み取り、バックアップ形式へまとめる。
 * @returns {Promise<object>} syncとlocalの値を含むバックアップデータ。
 */
async function buildExportPayload() {
    const [syncData, localData] = await Promise.all([
        chrome.storage.sync.get(null),
        chrome.storage.local.get(null),
    ]);

    return createExportPayload(syncData, localData);
}

/**
 * バックアップをJSONファイルとしてダウンロードする。
 * @param {object} payload - 解析・保存・復元へ渡すデータ。
 * @returns {void} 戻り値はない。
 */
function downloadExportFile(payload) {
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = buildExportFileName();
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);
    URL.revokeObjectURL(url);
}

/**
 * 設定を置き換える前の確認画面を開き、利用者の選択を待つ。
 * @returns {Promise<boolean>} 設定の置き換えを承認した場合はtrue。
 */
function showConfirmModal() {
    if (!elements.confirmModal) {
        return Promise.resolve(false);
    }

    elements.confirmModal.classList.add('visible');
    return new Promise((resolve) => {
        confirmResolver = resolve;
    });
}

/**
 * 確認画面を閉じ、待機中の処理へ選択結果を返す。
 * @param {object|null} result - 取得したデータ。失敗などで結果がない場合はnull。
 * @returns {void} 戻り値はない。
 */
function resolveConfirmModal(result) {
    if (elements.confirmModal) {
        elements.confirmModal.classList.remove('visible');
    }

    if (confirmResolver) {
        confirmResolver(result);
        confirmResolver = null;
    }
}

/**
 * バックアップを組み立ててダウンロードし、操作結果を通知する。
 * @returns {Promise<void>} 処理の完了を待つPromise。
 */
async function handleExport() {
    const isConfirmed = await showConfirmModal();
    if (!isConfirmed) return;

    try {
        const payload = await buildExportPayload();
        downloadExportFile(payload);
        dispatchStatusMessage('設定をエクスポートしました。');
    } catch (error) {
        console.error('[KLPF] 設定のエクスポートに失敗しました。', error);
        dispatchErrorMessage('設定のエクスポートに失敗しました。');
    }
}

/**
 * 指定ストレージ領域の内容をバックアップの値へ置き換える。
 * @param {string} area - 読み書きまたは変更通知のストレージ領域名。
 * @param {object} data - 保存する処理状態または設定データ。
 * @returns {Promise<void>} 処理の完了を待つPromise。
 */
async function replaceStorageArea(area, data) {
    await area.clear();
    if (Object.keys(data).length > 0) {
        await area.set(data);
    }
}

/**
 * 設定の復元後にバックグラウンドへスクリプト登録の更新を依頼する。
 * @returns {Promise<void>} 処理の完了を待つPromise。
 */
async function refreshBackgroundContentScripts() {
    try {
        const response = await chrome.runtime.sendMessage({ type: 'refresh-content-scripts' });
        if (response && response.success === false) {
            throw new Error(response.error || 'backgroundの再初期化に失敗しました。');
        }
    } catch (error) {
        console.warn('[KLPF] backgroundへの設定再反映に失敗しました。', error);
    }
}

/**
 * 検証済みのバックアップを設定ストレージへ復元する。
 * @param {object} payload - 解析・保存・復元へ渡すデータ。
 * @returns {Promise<void>} 処理の完了を待つPromise。
 */
async function importPayload(payload) {
    validateImportPayload(payload);

    await Promise.all([
        replaceStorageArea(chrome.storage.sync, payload.sync),
        replaceStorageArea(chrome.storage.local, payload.local),
    ]);

    await loadAndApplySettings();
    await refreshBackgroundContentScripts();
}

/**
 * 選択されたJSONを検証し、確認後に設定を復元する。
 * @param {Event} event - 操作または通知のイベント。
 * @returns {Promise<void>} 処理の完了を待つPromise。
 */
async function handleImportFileChange(event) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;

    try {
        const text = await file.text();
        const payload = JSON.parse(text);
        await importPayload(payload);
        dispatchStatusMessage('設定をインポートしました。');
    } catch (error) {
        console.error('[KLPF] 設定のインポートに失敗しました。', error);
        const message = error instanceof Error ? error.message : '設定のインポートに失敗しました。';
        dispatchErrorMessage(message);
    }
}

/**
 * バックアップの保存・読み込み・確認画面の操作を登録する。
 * @returns {void} 戻り値はない。
 */
function addEventListeners() {
    elements.exportButton?.addEventListener('click', handleExport);
    elements.importButton?.addEventListener('click', () => elements.importFileInput?.click());
    elements.importFileInput?.addEventListener('change', handleImportFileChange);

    elements.confirmButton?.addEventListener('click', () => resolveConfirmModal(true));
    elements.cancelButton?.addEventListener('click', () => resolveConfirmModal(false));
    elements.confirmModal?.addEventListener('click', (event) => {
        if (event.target === elements.confirmModal) {
            resolveConfirmModal(false);
        }
    });
}

/**
 * バックアップ用DOMと操作イベントを初期化する。
 * @returns {void} 戻り値はない。
 */
export function initializeBackupControls() {
    cacheDOMElements();
    addEventListeners();
}
