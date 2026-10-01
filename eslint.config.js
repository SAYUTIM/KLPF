// Copyright (c) 2024-2026 SAYU
// This software is released under the MIT License, see LICENSE.

/**
 * @file KLPFのfirst-party JavaScriptに対する静的検査設定。
 * 注入順で共有されるclassic scriptのグローバルは既存仕様のため、未定義変数検査は
 * Service Workerで有効にする。
 * ファイル単位の未使用判定だけで共有グローバルを削除しない。
 */

import globals from 'globals';

const generatedOrThirdParty = [
    '.playwright-cli/**',
    'node_modules/**',
    'vendor/**',
];

const correctnessRules = {
    'constructor-super': 'error',
    'for-direction': 'error',
    'getter-return': 'error',
    'no-async-promise-executor': 'error',
    'no-class-assign': 'error',
    'no-compare-neg-zero': 'error',
    'no-const-assign': 'error',
    'no-control-regex': 'error',
    'no-debugger': 'error',
    'no-dupe-args': 'error',
    'no-dupe-class-members': 'error',
    'no-dupe-else-if': 'error',
    'no-dupe-keys': 'error',
    'no-duplicate-case': 'error',
    'no-ex-assign': 'error',
    'no-fallthrough': 'error',
    'no-func-assign': 'error',
    'no-import-assign': 'error',
    'no-loss-of-precision': 'error',
    'no-obj-calls': 'error',
    'no-promise-executor-return': 'error',
    'no-self-assign': 'error',
    'no-setter-return': 'error',
    'no-sparse-arrays': 'error',
    'no-this-before-super': 'error',
    'no-unexpected-multiline': 'error',
    'no-unreachable': 'error',
    'no-unreachable-loop': 'error',
    'no-unsafe-finally': 'error',
    'no-unsafe-negation': 'error',
    'no-unsafe-optional-chaining': 'error',
    'no-unused-labels': 'error',
    'no-useless-backreference': 'error',
    'no-useless-catch': 'error',
    'no-with': 'error',
    'require-yield': 'error',
    'use-isnan': 'error',
    'valid-typeof': 'error',
};

export default [
    { ignores: generatedOrThirdParty },
    {
        files: ['**/*.js'],
        languageOptions: {
            ecmaVersion: 'latest',
            sourceType: 'module',
            globals: {
                ...globals.browser,
                chrome: 'readonly',
            },
        },
        rules: correctnessRules,
    },
    {
        files: ['background.js', 'background/**/*.js'],
        rules: {
            'no-undef': 'error',
            'no-unused-vars': ['error', { args: 'none', caughtErrors: 'none' }],
        },
    },
    {
        files: ['gas/**/*.js'],
        languageOptions: {
            globals: {
                ...globals.browser,
                Browser: 'readonly',
                ContentService: 'readonly',
                GmailApp: 'readonly',
                ScriptApp: 'readonly',
                SpreadsheetApp: 'readonly',
            },
        },
    },
];
