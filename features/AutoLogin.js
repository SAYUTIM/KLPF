// Copyright (c) 2024-2025 SAYU
// This software is released under the MIT License, see LICENSE.

/**
 * @file 自動ログイン機能を提供するモジュール
 */


/**
 * 保存されたユーザーIDとパスワードを取得する。
 * @returns {Promise<{username?: string, password?: string}>}
 */
async function getCredentials() {
    try {
        return await chrome.storage.local.get(["username", "password"]);
    } catch (error) {
        console.error("[KLPF] ログイン情報の取得に失敗しました。", error);
        return {};
    }
}

/**
 * LMSの初期ログインページを処理する。
 * 統合認証ページへ遷移するために「ログイン」ボタンをクリック
 */
function handleLmsStartPage() {
    const loginButton = safeQuerySelector(`button[name='loginButton']`);
    if (loginButton) {
        loginButton.click();
    } else {
        // もしボタンがなければ、リンクを探すなどの代替処理
        const loginLink = safeQuerySelector('a[href*="login"]'); // "login"を含むリンク
        loginLink?.click();
    }
}

/**
 * 統合認証のユーザー名入力ページ（prelogin.cgi）を処理する。
 * @param {string} username
 */
function handlePreLogin(username) {
    const usernameInput = safeQuerySelector("input[name='username']");
    const form = safeQuerySelector("form#login");

    if (usernameInput && form) {
        usernameInput.value = username;
        form.submit();
    } else {
        console.warn("[KLPF] ユーザー名入力フォームが見つかりませんでした。");
    }
}

/**
 * 統合認証のパスワード入力ページ（login.cgi）を処理する。
 * @param {string} password
 */
function handleLogin(password) {
    const passwordInput = safeQuerySelector("input[name='password']");
    const form = safeQuerySelector("form#login");

    if (passwordInput && form) {
        passwordInput.value = password;
        form.submit();
    } else {
        console.warn("[KLPF] パスワード入力フォームが見つかりませんでした。");
    }
}

// タイムアウトページからログインページへ復帰 (timeout.cgi)
function sso_timeoutpage() {
    location.pathname = "/user/";
}

// エラーページからログインページへ復帰
// 2025/9/1 エラーページの存在を確認できず。もしかしたら削除されてるかも
function lms_errorpage() {
    location.pathname = "/lms/lginLgir/";
}


/**
 * メイン処理
 */
async function main() {
    const { username, password } = await getCredentials();

    if (!username || !password) {
        console.log("[KLPF] ユーザー名またはパスワードが未設定のため、自動ログインをスキップします。");
        return;
    }

    const { href } = window.location;

    if (href.startsWith(LMS_LOGIN_URL)) {
        handleLmsStartPage();
    } else if (href.startsWith(SSO_PRELOGIN_URL)) {
        handlePreLogin(username);
    } else if (href.startsWith(SSO_LOGIN_URL)) {
        handleLogin(password);
    } else if (href.startsWith(SSO_TIMEOUT_URL)) {
        sso_timeoutpage();
    } else if (href.startsWith(LMS_ERROR_URL)) {
        lms_errorpage();
    }
}

// DOMの準備ができたらメイン処理を実行
document.addEventListener("DOMContentLoaded", main);