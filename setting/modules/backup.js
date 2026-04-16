// Copyright (c) 2024-2025 SAYU
// This software is released under the MIT License, see LICENSE.

/**
 * @file 設定のインポート/エクスポートを管理するモジュール
 * @module modules/backup
 */

import { loadAndApplySettings } from './settings.js';

const EXPORT_APP_NAME = 'KLPF';
const EXPORT_SCHEMA_VERSION = 1;

const elements = {
    exportButton: null,
    importButton: null,
    importFileInput: null,
    confirmModal: null,
    confirmButton: null,
    cancelButton: null,
};

let confirmResolver = null;

function cacheDOMElements() {
    elements.exportButton = document.getElementById('export-settings-button');
    elements.importButton = document.getElementById('import-settings-button');
    elements.importFileInput = document.getElementById('import-settings-file');
    elements.confirmModal = document.getElementById('backup-confirm-modal');
    elements.confirmButton = document.getElementById('backup-confirm-button');
    elements.cancelButton = document.getElementById('backup-cancel-button');
}

function dispatchStatusMessage(text, color = 'lightgreen', duration = 3000) {
    document.dispatchEvent(new CustomEvent('settings-saved', {
        detail: { text, color, duration },
    }));
}

function dispatchErrorMessage(message) {
    document.dispatchEvent(new CustomEvent('settings-error', { detail: message }));
}

function isPlainObject(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function padNumber(value) {
    return value.toString().padStart(2, '0');
}

function buildExportFileName() {
    const now = new Date();
    const date = `${now.getFullYear()}${padNumber(now.getMonth() + 1)}${padNumber(now.getDate())}`;
    const time = `${padNumber(now.getHours())}${padNumber(now.getMinutes())}${padNumber(now.getSeconds())}`;
    return `klpf-settings-${date}-${time}.json`;
}

async function buildExportPayload() {
    const [syncData, localData] = await Promise.all([
        chrome.storage.sync.get(null),
        chrome.storage.local.get(null),
    ]);

    return {
        app: EXPORT_APP_NAME,
        schemaVersion: EXPORT_SCHEMA_VERSION,
        exportedAt: new Date().toISOString(),
        sync: syncData,
        local: localData,
    };
}

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

function showConfirmModal() {
    if (!elements.confirmModal) {
        return Promise.resolve(false);
    }

    elements.confirmModal.classList.add('visible');
    return new Promise((resolve) => {
        confirmResolver = resolve;
    });
}

function resolveConfirmModal(result) {
    if (elements.confirmModal) {
        elements.confirmModal.classList.remove('visible');
    }

    if (confirmResolver) {
        confirmResolver(result);
        confirmResolver = null;
    }
}

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

function validateImportPayload(payload) {
    if (!isPlainObject(payload)) {
        throw new Error('JSONの形式が不正です。');
    }

    if (payload.app !== EXPORT_APP_NAME) {
        throw new Error('KLPF用のバックアップファイルではありません。');
    }

    if (payload.schemaVersion !== EXPORT_SCHEMA_VERSION) {
        throw new Error('対応していないバックアップ形式です。');
    }

    if (!isPlainObject(payload.sync) || !isPlainObject(payload.local)) {
        throw new Error('バックアップファイルに必要なデータが不足しています。');
    }
}

async function replaceStorageArea(area, data) {
    await area.clear();
    if (Object.keys(data).length > 0) {
        await area.set(data);
    }
}

async function importPayload(payload) {
    validateImportPayload(payload);

    await Promise.all([
        replaceStorageArea(chrome.storage.sync, payload.sync),
        replaceStorageArea(chrome.storage.local, payload.local),
    ]);

    await loadAndApplySettings();
}

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

export function initializeBackupControls() {
    cacheDOMElements();
    addEventListeners();
}
