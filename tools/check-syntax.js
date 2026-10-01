// Copyright (c) 2024-2026 SAYU
// This software is released under the MIT License, see LICENSE.

/**
 * @file 自作のJavaScriptをNodeのパーサーで一括検査する開発用ツール。
 * 外部ライブラリとブラウザ操作の一時ファイルは検査対象から除外する。
 */

import { execFileSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import path from 'node:path';

const PROJECT_ROOT = process.cwd();
const IGNORED_DIRECTORIES = new Set(['.git', '.playwright-cli', 'node_modules', 'vendor']);

/**
 * 外部ライブラリと一時ディレクトリを除き、JavaScriptファイルを再帰的に列挙する。
 * @param {string} directory - 再帰検索を開始するディレクトリ。
 * @returns {string[]} 検査対象のJavaScriptファイルの絶対パス。
 */
function collectJavaScriptFiles(directory) {
    return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
        if (entry.isDirectory() && IGNORED_DIRECTORIES.has(entry.name)) return [];
        const absolutePath = path.join(directory, entry.name);
        if (entry.isDirectory()) return collectJavaScriptFiles(absolutePath);
        return entry.isFile() && entry.name.endsWith('.js') ? [absolutePath] : [];
    });
}

for (const filePath of collectJavaScriptFiles(PROJECT_ROOT)) {
    execFileSync(process.execPath, ['--check', filePath], { stdio: 'inherit' });
}

console.log('[KLPF] JavaScript syntax check passed.');
