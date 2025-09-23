// Copyright (c) 2025 SAYU
// This software is released under the MIT License, see LICENSE.

import { showUpdateNotification } from './ui.js';

/**
 * バージョン文字列（例: "v4.1.3" or "4.1.3"）を数値（例: 413）に変換します。
 * @param {string} versionString - バージョン文字列。
 * @returns {number} バージョンを表す数値。
 */
function parseVersion(versionString) {
    if (!versionString) return 0;
    // 数字以外の文字をすべて削除
    const numericString = versionString.replace(/\D/g, '');
    return parseInt(numericString, 10) || 0;
}

/**
 * manifest.json から現在の拡張機能のバージョンを取得します。
 * @returns {Promise<string>} 現在のバージョン。
 */
async function getCurrentVersion() {
    try {
        const manifestUrl = chrome.runtime.getURL('manifest.json');
        const response = await fetch(manifestUrl);
        if (!response.ok) throw new Error('manifest.json の取得に失敗しました');
        const manifest = await response.json();
        return manifest.version;
    } catch (error) {
        console.error("現在のバージョンを取得できませんでした:", error);
        return '0.0.0'; // エラー時は最小バージョンを返す
    }
}

/**
 * ローカルバージョンと最新のGitHubリリースを比較して、新しいアップデートを確認します。
 */
export async function checkForUpdates() {
    try {
        // GitHubから最新のリリース情報を取得
        const response = await fetch('https://api.github.com/repos/SAYUTIM/KLPF/releases/latest');
        if (!response.ok) throw new Error('最新のリリース情報の取得に失敗しました');
        const latestRelease = await response.json();
        const latestVersionString = latestRelease.tag_name; // 例: "v4.1.3"

        // 現在インストールされているバージョンを取得
        const currentVersionString = await getCurrentVersion(); // 例: "4.1.3"

        // バージョンを数値に変換して比較
        const latestVersion = parseVersion(latestVersionString);
        const currentVersion = parseVersion(currentVersionString);

        //console.log(`現在のバージョン: ${currentVersionString} (${currentVersion}), 最新バージョン: ${latestVersionString} (${latestVersion})`);

        // 最新バージョンの方が大きい場合、通知を表示
        if (latestVersion > currentVersion) {
            showUpdateNotification(latestVersionString);
        }

    } catch (error) {
        console.error("アップデートの確認に失敗しました:", error);
    }
}