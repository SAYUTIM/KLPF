// Copyright (c) 2024-2026 SAYU
// This software is released under the MIT License, see LICENSE.

/**
 * @file 自動ログイン機能を提供するモジュール
 * Chromeのlocalストレージに保存された認証情報と共通TOTP生成関数を使い、各認証ページの入力を補助する。
 * 秘密鍵の取り込み確認と、Ku-Port取得ジョブへ自動ログインできない状態の通知も担当する。
 */


/**
 * 保存されたユーザーIDとパスワード、TOTP秘密鍵を取得する。
 * @returns {Promise<{username?: string, password?: string, totpSecret?: string}>}
 */
async function getCredentials() {
    try {
        return await chrome.storage.local.get(["username", "password", "totpSecret"]);
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
 * Ku-portの入口・再ログイン画面から統合認証へ進む。
 */
function findKuportLoginButton() {
    return safeQuerySelectorAll('button').find(button => {
        const label = (button.textContent || '').replace(/\s+/g, ' ').trim();
        return label === 'ログイン' || label.includes('再ログインはこちら');
    }) || null;
}

/**
 * Ku-Portの取得ジョブへ自動ログインできない状態を通知する。
 * @returns {void} 戻り値はない。
 */
function notifyKuportAutoLoginUnavailable() {
    void chrome.runtime.sendMessage({ type: 'kuport-auto-login-unavailable' }).catch(() => {});
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
        console.debug("[KLPF] ユーザー名入力フォームが見つかりませんでした。");
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
        console.debug("[KLPF] パスワード入力フォームが見つかりませんでした。");
    }
}

// タイムアウトページからログインページへ復帰 (timeout.cgi)
/**
 * 認証のタイムアウト画面からログイン画面へ戻る。
 * @returns {void} 戻り値はない。
 */
function sso_timeoutpage() {
    location.pathname = "/user/";
}

// エラーページからログインページへ復帰
// 2025/9/1 エラーページの存在を確認できず。もしかしたら削除されてるかも
/**
 * KU-LMSのエラー画面から入口へ戻る。
 * @returns {void} 戻り値はない。
 */
function lms_errorpage() {
    location.pathname = "/lms/lginLgir/";
}

/**
 * 統合認証のTOTP入力ページ（otplogin.cgi）を処理する。
 * @param {string} totpSecret - Base32エンコードされたTOTP秘密鍵
 */
async function handleTotpPage(totpSecret) {
    
    if (!totpSecret) return;

    const otpInput = safeQuerySelector(
        "input#password_input.onetime_input, input[autocomplete='one-time-code']"
    );
    if (!otpInput) {
        console.debug("[KLPF] OTP入力フィールドが見つかりませんでした。");
        return;
    }

    const code = await generateTOTP(totpSecret);
    if (!code) {
        console.error("[KLPF] TOTPコードの生成に失敗しました。秘密鍵を確認してください。");
        return;
    }

    // 非同期のコード生成中にOFFへ切り替わった場合も、送信直前の許可で止める。
    if (!await canSubmitAutomatically('otp')) return;
    otpInput.value = code;
    otpInput.dispatchEvent(new Event('input', { bubbles: true }));
    otpInput.dispatchEvent(new Event('change', { bubbles: true }));

    // MFA記憶チェックボックスが存在すればチェックする
    const rememberCheckbox = safeQuerySelector("input#remember[name='remember']");
    if (rememberCheckbox && !rememberCheckbox.checked) {
        rememberCheckbox.click();
    }

    const form = safeQuerySelector("form#login");
    if (form) {
        form.submit();
    } else {
        console.debug("[KLPF] OTPフォームが見つかりませんでした。");
    }
}

const TOTP_SETUP_PATH = '/user/index.php';
const TOTP_IMPORT_HOST_ID = 'klpf-totp-import';

/**
 * 現在のページがTOTP設定画面か判定する。
 * @returns {boolean} 条件を満たす場合はtrue。
 */
function isTotpSetupPage() {
    const url = new URL(window.location.href);
    return url.origin === new URL(KU_SSO).origin
        && url.pathname === TOTP_SETUP_PATH
        && url.searchParams.get('app') === 'qrsecret'
        && url.searchParams.get('st') === 'ga';
}

/**
 * TOTP設定画面のQR生成情報から秘密鍵を読み取る。
 * @returns {string|null} 読み取ったTOTP秘密鍵。見つからなければnull。
 */
function readTotpSecretFromSetupPage() {
    if (!safeQuerySelector('#qrImg canvas')) return null;

    for (const script of safeQuerySelectorAll('script:not([src])')) {
        const match = (script.textContent || '').match(/otpauth:\/\/totp\/[^"'\s<]+/i);
        if (!match) continue;

        try {
            const totpUrl = new URL(match[0]);
            const secret = (totpUrl.searchParams.get('secret') || '')
                .replace(/[\s=-]+/g, '')
                .toUpperCase();
            if (totpUrl.protocol === 'otpauth:'
                && totpUrl.hostname === 'totp'
                && /^[A-Z2-7]{16,}$/.test(secret)) {
                return secret;
            }
        } catch (_error) {
            // QR生成データでないスクリプトは無視する。
        }
    }

    return null;
}

/**
 * 読み取ったTOTP秘密鍵を保存するための確認パネルを作る。
 * @param {string} secret - 設定画面で読み取ったBase32のTOTP秘密鍵。
 * @param {boolean} alreadyConfigured - TOTP秘密鍵がすでに設定されているかどうか。
 * @returns {void} 戻り値はない。
 */
function createTotpImportPanel(secret, alreadyConfigured) {
    if (document.getElementById(TOTP_IMPORT_HOST_ID)) return;

    const host = document.createElement('div');
    host.id = TOTP_IMPORT_HOST_ID;
    const shadow = host.attachShadow({ mode: 'closed' });
    shadow.innerHTML = `
        <style>
            :host { all: initial; }
            .panel {
                position: fixed;
                right: 22px;
                bottom: 22px;
                z-index: 2147483647;
                box-sizing: border-box;
                width: min(370px, calc(100vw - 28px));
                overflow: hidden;
                border: 1px solid rgba(18, 117, 153, .22);
                border-radius: 18px;
                color: #173642;
                background: rgba(255, 255, 255, .97);
                box-shadow: 0 18px 55px rgba(7, 49, 67, .22);
                font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "Noto Sans JP", sans-serif;
            }
            .accent { height: 4px; background: linear-gradient(90deg, #16a7cf, #55d0e5); }
            .body { padding: 21px 22px 19px; }
            .eyebrow { margin: 0 0 7px; color: #168eb5; font-size: 11px; font-weight: 800; letter-spacing: .12em; }
            h2 { margin: 0; color: #123744; font-size: 18px; line-height: 1.45; }
            p { margin: 10px 0 0; color: #58717a; font-size: 13px; line-height: 1.75; }
            .actions { display: flex; gap: 9px; margin-top: 17px; }
            button, a {
                box-sizing: border-box;
                min-height: 39px;
                border-radius: 10px;
                font: inherit;
                font-size: 13px;
                font-weight: 750;
                text-decoration: none;
                cursor: pointer;
            }
            button { flex: 1; border: 0; color: #fff; background: #149fc5; }
            button:hover { background: #0d8caf; }
            button.secondary { border: 1px solid #d7e4e9; color: #607780; background: #f7fafb; }
            a { display: grid; place-items: center; margin-top: 9px; color: #168eb5; }
            .success { color: #147b57; }
            @media (max-width: 520px) { .panel { right: 14px; bottom: 14px; } }
        </style>
        <section class="panel" role="dialog" aria-labelledby="klpf-totp-title">
            <div class="accent"></div>
            <div class="body">
                <p class="eyebrow">KLPF · AUTO LOGIN</p>
                <h2 id="klpf-totp-title">${alreadyConfigured ? 'KLPFの秘密鍵を更新しますか？' : 'このQRコードから秘密鍵を設定しますか？'}</h2>
                <p data-message hidden></p>
                <div class="actions">
                    <button type="button" data-save>${alreadyConfigured ? '更新する' : '設定する'}</button>
                    <button type="button" class="secondary" data-close>今はしない</button>
                </div>
                <a href="https://sayutim.github.io/KLPF/totp/" target="_blank" rel="noopener noreferrer">設定方法を確認</a>
            </div>
        </section>
    `;

    shadow.querySelector('[data-close]').addEventListener('click', () => host.remove());
    shadow.querySelector('[data-save]').addEventListener('click', async () => {
        const saveButton = shadow.querySelector('[data-save]');
        const message = shadow.querySelector('[data-message]');
        const closeButton = shadow.querySelector('[data-close]');
        const title = shadow.querySelector('#klpf-totp-title');
        saveButton.disabled = true;
        try {
            await chrome.storage.local.set({ totpSecret: secret });
            title.textContent = 'KLPFに設定しました。';
            message.hidden = true;
            saveButton.remove();
            closeButton.textContent = '閉じる';
            closeButton.classList.remove('secondary');
        } catch (_error) {
            message.textContent = '保存できませんでした。拡張機能を再読み込みして、もう一度お試しください。';
            message.hidden = false;
            saveButton.disabled = false;
        }
    });

    document.documentElement.appendChild(host);
}

/**
 * TOTP設定画面を確認し、秘密鍵の取り込みパネルを初期化する。
 * @returns {Promise<void>} 処理の完了を待つPromise。
 */
async function initializeTotpSecretImport() {
    const qrCanvas = await waitForElement('#qrImg canvas', document, 10000);
    if (!qrCanvas) return;

    const secret = readTotpSecretFromSetupPage();
    if (!secret) return;

    const generatedCode = await generateTOTP(secret);
    if (!generatedCode) return;

    const { totpSecret = '' } = await chrome.storage.local.get('totpSecret');
    const normalizedStoredSecret = totpSecret.replace(/[\s=-]+/g, '').toUpperCase();
    if (normalizedStoredSecret === secret) return;

    createTotpImportPanel(secret, Boolean(normalizedStoredSecret));
}

/**
 * 認証段階ごとの自動送信許可をWorkerに要求する。
 * @param {string} stage - 入口・ID・パスワード・OTPなどの認証段階。
 * @returns {Promise<boolean>} 設定と送信回数制限を満たす場合だけtrue。
 */
async function canSubmitAutomatically(stage) {
    try {
        const result = await chrome.runtime.sendMessage({ type: 'claim-auto-login-attempt', stage });
        if (result?.ready === true) return true;
        console.info('[KLPF] 自動ログインを停止しました。', result?.reason || '設定を確認してください。');
    } catch { /* 許可を確認できない場合も送信しない。 */ }
    notifyKuportAutoLoginUnavailable();
    return false;
}

/**
 * メイン処理
 */
async function main() {
    const settings = await chrome.storage.sync.get('autoLogin');
    const local = await chrome.storage.local.get('klpfInlineAllFeaturesDisabled');
    if (settings.autoLogin === false || local.klpfInlineAllFeaturesDisabled === true) return;
    if (isTotpSetupPage()) {
        await initializeTotpSecretImport();
        return;
    }

    const { href } = window.location;
    if (href.startsWith(KUPORT_URL)) {
        const loginButton = findKuportLoginButton();
        if (!loginButton) {
            if (document.querySelector('form[id="menuForm"]')) {
                void chrome.runtime.sendMessage({ type: 'auto-login-success' }).catch(() => {});
            }
            return;
        }

        const { username, password } = await getCredentials();
        if (!username || !password) {
            notifyKuportAutoLoginUnavailable();
            return;
        }
        if (await canSubmitAutomatically('kuport-entry')) loginButton.click();
        return;
    }

    if (href.startsWith(LMS_HOME_URL) && document.querySelector('.lms-card, .lms-news-block')) {
        void chrome.runtime.sendMessage({ type: 'auto-login-success' }).catch(() => {});
        return;
    }
    const { username, password, totpSecret } = await getCredentials();

    if (!username || !password) {
        console.log("[KLPF] ユーザー名またはパスワードが未設定のため、自動ログインをスキップします。");
        notifyKuportAutoLoginUnavailable();
        return;
    }

    if (href.startsWith(LMS_LOGIN_URL)) {
        if (await canSubmitAutomatically('lms-entry')) handleLmsStartPage();
    } else if (href.startsWith(SSO_PRELOGIN_URL)) {
        if (await canSubmitAutomatically('username')) handlePreLogin(username);
    } else if (href.startsWith(SSO_LOGIN_URL)) {
        if (await canSubmitAutomatically('password')) handleLogin(password);
    } else if (href.startsWith(SSO_OTP_URL)) {
        if (!totpSecret) {
            notifyKuportAutoLoginUnavailable();
            return;
        }
        await handleTotpPage(totpSecret);
    } else if (href.startsWith(SSO_TIMEOUT_URL)) {
        if (await canSubmitAutomatically('sso-timeout')) sso_timeoutpage();
    } else if (href.startsWith(LMS_ERROR_URL)) {
        if (await canSubmitAutomatically('lms-error')) lms_errorpage();
    }
}

// DOMの準備ができたらメイン処理を実行
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => void main().catch(() => {}), { once: true });
else void main().catch(() => {});
