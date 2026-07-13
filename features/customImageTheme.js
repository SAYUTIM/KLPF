// Copyright (c) 2024-2025 SAYU
// This software is released under the MIT License, see LICENSE.

(() => {
    'use strict';

    const INSTANCE_KEY = '__klpfCustomImageThemeInstance';
    const existingInstance = globalThis[INSTANCE_KEY];
    if (existingInstance?.refresh) {
        existingInstance.refresh();
        return;
    }

    const OPEN_EVENT = 'klpf-open-custom-image-theme';
    const ROOT_ID = 'klpf-custom-image-theme-root';
    const STYLE_ID = 'klpf-custom-image-theme-style';
    const SCROLL_LOCK_STYLE_ID = 'klpf-custom-image-theme-scroll-lock';
    const STORAGE_KEY = 'klpfCustomImageTheme';
    const ACTIVE_ATTRIBUTE = 'data-klpf-custom-image-theme-active';
    const BACKGROUND_ATTRIBUTE = 'data-klpf-custom-image-theme-background';
    const BACKGROUND_PROPERTY = '--klpf-custom-image-theme-background';
    const MAX_INPUT_BYTES = 20 * 1024 * 1024;
    const MAX_DATA_URL_LENGTH = 4_500_000;
    const ALLOWED_IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);

    let rootElement = null;
    let shadowRoot = null;
    let currentTheme = null;
    let draftDataUrl = null;
    let draftFileName = '';
    let draftIsDirty = false;
    let mutationObserver = null;
    let refreshFrame = null;
    let recalculateTimer = null;
    let lastFocusedElement = null;

    function normalizeStoredTheme(value) {
        if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
        const dataUrl = typeof value.dataUrl === 'string' ? value.dataUrl : '';
        if (!/^data:image\/(?:jpeg|png|webp);base64,/i.test(dataUrl)) return null;
        return {
            dataUrl,
            fileName: typeof value.fileName === 'string' ? value.fileName.slice(0, 160) : '',
            updatedAt: typeof value.updatedAt === 'string' ? value.updatedAt : '',
        };
    }

    function parseBackgroundColor(value) {
        if (typeof value !== 'string') return null;
        const match = value.match(/^rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:\s*[,/]\s*([\d.]+%?))?\s*\)$/i);
        if (!match) return null;

        const channels = match.slice(1, 4).map(channel => Math.max(0, Math.min(255, Math.round(Number(channel)))));
        let alpha = match[4] === undefined ? 1 : Number(match[4]);
        if (match[4]?.includes('%')) alpha /= 100;
        if (!Number.isFinite(alpha) || alpha <= 0.02) return null;
        return [...channels, Math.max(0, Math.min(1, alpha))];
    }

    function clearElementTransparency() {
        document.querySelectorAll(`[${BACKGROUND_ATTRIBUTE}]`).forEach((element) => {
            element.removeAttribute(BACKGROUND_ATTRIBUTE);
            element.style.removeProperty(BACKGROUND_PROPERTY);
        });
    }

    function refreshElementTransparency({ recalculate = false } = {}) {
        const contents = document.querySelector('.lms-contents-wrap');
        if (!contents) return;

        const elements = [...contents.querySelectorAll('*')];
        if (recalculate) {
            for (const element of elements) {
                element.removeAttribute(BACKGROUND_ATTRIBUTE);
                element.style.removeProperty(BACKGROUND_PROPERTY);
            }
        }

        for (const element of elements) {
            if (!(element instanceof HTMLElement) || element.hasAttribute(BACKGROUND_ATTRIBUTE)) continue;
            const color = parseBackgroundColor(getComputedStyle(element).backgroundColor);
            if (!color) continue;
            const [red, green, blue, alpha] = color;
            element.style.setProperty(BACKGROUND_PROPERTY, `rgba(${red}, ${green}, ${blue}, ${Math.min(alpha, 0.72)})`);
            element.setAttribute(BACKGROUND_ATTRIBUTE, '');
        }
    }

    function scheduleTransparencyRefresh() {
        if (!currentTheme || refreshFrame !== null) return;
        refreshFrame = requestAnimationFrame(() => {
            refreshFrame = null;
            refreshElementTransparency();
        });
    }

    function startMutationObserver() {
        if (mutationObserver) return;
        const contents = document.querySelector('.lms-contents-wrap');
        if (!contents) return;
        mutationObserver = new MutationObserver(scheduleTransparencyRefresh);
        mutationObserver.observe(contents, { childList: true, subtree: true });
    }

    function stopMutationObserver() {
        mutationObserver?.disconnect();
        mutationObserver = null;
        if (refreshFrame !== null) cancelAnimationFrame(refreshFrame);
        refreshFrame = null;
        if (recalculateTimer !== null) clearTimeout(recalculateTimer);
        recalculateTimer = null;
    }

    function ensureThemeStyle(dataUrl) {
        let style = document.getElementById(STYLE_ID);
        if (!style) {
            style = document.createElement('style');
            style.id = STYLE_ID;
            (document.head || document.documentElement).appendChild(style);
        }
        style.textContent = `
            html[${ACTIVE_ATTRIBUTE}] .lms-contents-wrap {
                background-image: url("${dataUrl}") !important;
                background-position: center center !important;
                background-repeat: no-repeat !important;
                background-size: cover !important;
                background-attachment: fixed !important;
            }
            html[${ACTIVE_ATTRIBUTE}] .lms-contents-wrap [${BACKGROUND_ATTRIBUTE}] {
                background-color: var(${BACKGROUND_PROPERTY}) !important;
            }
        `;
    }

    function removeAppliedTheme() {
        stopMutationObserver();
        document.documentElement.removeAttribute(ACTIVE_ATTRIBUTE);
        document.getElementById(STYLE_ID)?.remove();
        clearElementTransparency();
    }

    function applyTheme(theme) {
        const normalized = normalizeStoredTheme(theme);
        if (!normalized) {
            currentTheme = null;
            removeAppliedTheme();
            return;
        }

        currentTheme = normalized;
        ensureThemeStyle(normalized.dataUrl);
        document.documentElement.setAttribute(ACTIVE_ATTRIBUTE, '');
        refreshElementTransparency({ recalculate: true });
        startMutationObserver();

        if (recalculateTimer !== null) clearTimeout(recalculateTimer);
        recalculateTimer = setTimeout(() => {
            recalculateTimer = null;
            if (currentTheme) refreshElementTransparency({ recalculate: true });
        }, 500);
    }

    async function loadStoredTheme() {
        const stored = await chrome.storage.local.get(STORAGE_KEY);
        return normalizeStoredTheme(stored[STORAGE_KEY]);
    }

    function ensureScrollLockStyle() {
        if (document.getElementById(SCROLL_LOCK_STYLE_ID)) return;
        const style = document.createElement('style');
        style.id = SCROLL_LOCK_STYLE_ID;
        style.textContent = `
            html.klpf-custom-image-theme-open,
            html.klpf-custom-image-theme-open body {
                overflow: hidden !important;
                overscroll-behavior: none !important;
            }
        `;
        (document.head || document.documentElement).appendChild(style);
    }

    function setScrollLocked(locked) {
        ensureScrollLockStyle();
        document.documentElement.classList.toggle('klpf-custom-image-theme-open', locked);
    }

    function ensureRoot() {
        if (rootElement?.isConnected && shadowRoot) return;
        rootElement = document.getElementById(ROOT_ID);
        if (!rootElement) {
            rootElement = document.createElement('div');
            rootElement.id = ROOT_ID;
            document.documentElement.appendChild(rootElement);
        }
        shadowRoot = rootElement.shadowRoot || rootElement.attachShadow({ mode: 'open' });
    }

    function getPanelStyles() {
        return `
            :host { all: initial; }
            *, *::before, *::after { box-sizing: border-box; }
            .overlay {
                position: fixed;
                inset: 0;
                z-index: 2147483646;
                display: grid;
                place-items: center;
                padding: 24px;
                background: rgba(8, 34, 45, .54);
                backdrop-filter: blur(5px);
                font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "Noto Sans JP", sans-serif;
            }
            .panel {
                width: min(640px, 100%);
                max-height: min(780px, calc(100vh - 48px));
                overflow: auto;
                border: 1px solid rgba(20, 122, 157, .22);
                border-radius: 22px;
                color: #153743;
                background: #fff;
                box-shadow: 0 28px 80px rgba(5, 42, 56, .28);
            }
            .header {
                display: flex;
                align-items: flex-start;
                justify-content: space-between;
                gap: 20px;
                padding: 25px 26px 20px;
                border-bottom: 1px solid #dce8ec;
            }
            .eyebrow { margin: 0 0 5px; color: #168fb6; font-size: 11px; font-weight: 800; letter-spacing: .13em; }
            h2 { margin: 0; font-size: 22px; line-height: 1.4; }
            .close {
                display: grid;
                place-items: center;
                flex: 0 0 36px;
                width: 36px;
                height: 36px;
                border: 1px solid #d8e5e9;
                border-radius: 50%;
                color: #55717b;
                background: #f8fbfc;
                font: inherit;
                font-size: 21px;
                cursor: pointer;
            }
            .body { padding: 24px 26px 8px; }
            .description { margin: 0 0 20px; color: #58717a; font-size: 14px; line-height: 1.75; }
            .preview {
                position: relative;
                display: grid;
                place-items: center;
                width: 100%;
                aspect-ratio: 16 / 9;
                overflow: hidden;
                border: 1px solid #cfdee3;
                border-radius: 16px;
                background: linear-gradient(135deg, #edf6f8, #f8fbfc);
            }
            .preview img { width: 100%; height: 100%; object-fit: cover; }
            .preview-empty { color: #70868e; font-size: 13px; font-weight: 700; }
            .file-row { display: flex; align-items: center; gap: 12px; margin-top: 16px; }
            .file-button {
                display: inline-flex;
                align-items: center;
                justify-content: center;
                min-height: 42px;
                padding: 0 17px;
                border: 1px solid #9fcdd9;
                border-radius: 11px;
                color: #117d9f;
                background: #f0fafc;
                font-size: 13px;
                font-weight: 800;
                cursor: pointer;
            }
            .file-name { min-width: 0; overflow: hidden; color: #607780; font-size: 13px; text-overflow: ellipsis; white-space: nowrap; }
            input[type="file"] { position: absolute; width: 1px; height: 1px; overflow: hidden; opacity: 0; pointer-events: none; }
            .hint { margin: 10px 0 0; color: #82959c; font-size: 12px; }
            .status { min-height: 22px; margin: 14px 0 0; color: #147b57; font-size: 13px; font-weight: 700; }
            .status.is-error { color: #bd3f4b; }
            .actions {
                display: flex;
                align-items: center;
                gap: 10px;
                padding: 18px 26px 24px;
            }
            button { font-family: inherit; }
            .action {
                min-height: 43px;
                padding: 0 18px;
                border: 0;
                border-radius: 11px;
                font-size: 13px;
                font-weight: 800;
                cursor: pointer;
            }
            .reset { margin-right: auto; border: 1px solid #e2c5c9; color: #a23b46; background: #fff8f8; }
            .secondary { border: 1px solid #d5e2e6; color: #57717a; background: #f7fafb; }
            .primary { color: #fff; background: linear-gradient(135deg, #168fb6, #53c7dd); }
            button:disabled { cursor: not-allowed; opacity: .45; }
            button:focus-visible, .file-button:focus-within { outline: 3px solid rgba(22, 143, 182, .25); outline-offset: 2px; }
            @media (max-width: 600px) {
                .overlay { align-items: end; padding: 10px; }
                .panel { max-height: calc(100vh - 20px); border-radius: 20px 20px 14px 14px; }
                .header { padding: 21px 20px 17px; }
                .body { padding: 20px 20px 6px; }
                .actions { flex-wrap: wrap; padding: 16px 20px 20px; }
                .reset { width: 100%; margin: 0; }
                .secondary, .primary { flex: 1; }
            }
            @media (prefers-reduced-motion: reduce) { * { scroll-behavior: auto !important; } }
        `;
    }

    function getPanelMarkup() {
        return `
            <style>${getPanelStyles()}</style>
            <div class="overlay">
                <section class="panel" role="dialog" aria-modal="true" aria-labelledby="klpf-custom-image-theme-title">
                    <header class="header">
                        <div>
                            <p class="eyebrow">KLPF · CUSTOM THEME</p>
                            <h2 id="klpf-custom-image-theme-title">カスタム画像テーマ</h2>
                        </div>
                        <button type="button" class="close" aria-label="閉じる">×</button>
                    </header>
                    <div class="body">
                        <p class="description">選んだ画像をKu-LMSの背景に設定します。コンテンツの背景色は読みやすさを保ちながら半透明になり、画像はこのChromeに保存されます。</p>
                        <div class="preview" data-preview></div>
                        <div class="file-row">
                            <label class="file-button">
                                画像を選択
                                <input type="file" accept="image/jpeg,image/png,image/webp" data-file-input>
                            </label>
                            <span class="file-name" data-file-name></span>
                        </div>
                        <p class="hint">JPEG・PNG・WebP、20MBまで。保存時に背景向けのサイズへ最適化します。</p>
                        <p class="status" data-status aria-live="polite"></p>
                    </div>
                    <footer class="actions">
                        <button type="button" class="action reset" data-reset>画像をリセット</button>
                        <button type="button" class="action secondary" data-close>閉じる</button>
                        <button type="button" class="action primary" data-apply>設定する</button>
                    </footer>
                </section>
            </div>
        `;
    }

    function setStatus(message, { error = false } = {}) {
        const status = shadowRoot?.querySelector('[data-status]');
        if (!status) return;
        status.textContent = message;
        status.classList.toggle('is-error', error);
    }

    function renderDraft() {
        if (!shadowRoot) return;
        const preview = shadowRoot.querySelector('[data-preview]');
        const fileName = shadowRoot.querySelector('[data-file-name]');
        const applyButton = shadowRoot.querySelector('[data-apply]');
        const resetButton = shadowRoot.querySelector('[data-reset]');

        preview.replaceChildren();
        if (draftDataUrl) {
            const image = document.createElement('img');
            image.src = draftDataUrl;
            image.alt = '選択した背景画像のプレビュー';
            preview.appendChild(image);
        } else {
            const empty = document.createElement('span');
            empty.className = 'preview-empty';
            empty.textContent = '背景画像は設定されていません';
            preview.appendChild(empty);
        }

        fileName.textContent = draftFileName || '画像が選択されていません';
        fileName.title = draftFileName;
        applyButton.disabled = !draftDataUrl || !draftIsDirty;
        resetButton.disabled = !currentTheme;
    }

    async function optimizeImage(file) {
        if (!ALLOWED_IMAGE_TYPES.has(file.type)) {
            throw new Error('JPEG・PNG・WebP形式の画像を選択してください。');
        }
        if (file.size > MAX_INPUT_BYTES) {
            throw new Error('画像サイズは20MB以下にしてください。');
        }

        const bitmap = await createImageBitmap(file);
        try {
            const attempts = [
                { maxWidth: 2560, maxHeight: 1440, quality: .88 },
                { maxWidth: 2200, maxHeight: 1320, quality: .76 },
                { maxWidth: 1920, maxHeight: 1080, quality: .64 },
            ];

            for (const attempt of attempts) {
                const scale = Math.min(1, attempt.maxWidth / bitmap.width, attempt.maxHeight / bitmap.height);
                const width = Math.max(1, Math.round(bitmap.width * scale));
                const height = Math.max(1, Math.round(bitmap.height * scale));
                const canvas = document.createElement('canvas');
                canvas.width = width;
                canvas.height = height;
                const context = canvas.getContext('2d', { alpha: false });
                context.drawImage(bitmap, 0, 0, width, height);
                const dataUrl = canvas.toDataURL('image/webp', attempt.quality);
                if (dataUrl.length <= MAX_DATA_URL_LENGTH) return dataUrl;
            }
        } finally {
            bitmap.close();
        }
        throw new Error('画像を保存できる大きさまで圧縮できませんでした。別の画像を選択してください。');
    }

    async function handleFileSelection(file) {
        if (!(file instanceof File)) return;
        setStatus('画像を読み込んでいます…');
        try {
            draftDataUrl = await optimizeImage(file);
            draftFileName = file.name.slice(0, 160);
            draftIsDirty = true;
            renderDraft();
            setStatus('プレビューを確認して「設定する」を押してください。');
        } catch (error) {
            setStatus(error instanceof Error ? error.message : '画像を読み込めませんでした。', { error: true });
        }
    }

    function closePanel() {
        if (!rootElement) return;
        setScrollLocked(false);
        rootElement.remove();
        rootElement = null;
        shadowRoot = null;
        if (lastFocusedElement instanceof HTMLElement && lastFocusedElement.isConnected) lastFocusedElement.focus();
        lastFocusedElement = null;
    }

    function addPanelListeners() {
        const overlay = shadowRoot.querySelector('.overlay');
        const panel = shadowRoot.querySelector('.panel');
        const fileInput = shadowRoot.querySelector('[data-file-input]');
        const applyButton = shadowRoot.querySelector('[data-apply]');
        const resetButton = shadowRoot.querySelector('[data-reset]');

        shadowRoot.querySelector('.close').addEventListener('click', closePanel);
        shadowRoot.querySelector('[data-close]').addEventListener('click', closePanel);
        overlay.addEventListener('click', (event) => {
            if (event.target === overlay) closePanel();
        });
        panel.addEventListener('keydown', (event) => {
            if (event.key === 'Escape') {
                event.preventDefault();
                closePanel();
            }
        });
        fileInput.addEventListener('change', () => handleFileSelection(fileInput.files?.[0]));
        applyButton.addEventListener('click', async () => {
            if (!draftDataUrl) return;
            applyButton.disabled = true;
            setStatus('画像を保存しています…');
            const theme = {
                dataUrl: draftDataUrl,
                fileName: draftFileName,
                updatedAt: new Date().toISOString(),
            };
            try {
                await chrome.storage.local.set({ [STORAGE_KEY]: theme });
                applyTheme(theme);
                closePanel();
            } catch (error) {
                applyButton.disabled = false;
                setStatus('画像を保存できませんでした。別の画像を選択してください。', { error: true });
                console.warn('[KLPF] カスタム画像テーマを保存できませんでした。', error);
            }
        });
        resetButton.addEventListener('click', async () => {
            resetButton.disabled = true;
            try {
                await chrome.storage.local.remove(STORAGE_KEY);
                currentTheme = null;
                draftDataUrl = null;
                draftFileName = '';
                draftIsDirty = false;
                removeAppliedTheme();
                renderDraft();
                setStatus('背景画像をリセットしました。');
            } catch (error) {
                resetButton.disabled = false;
                setStatus('背景画像をリセットできませんでした。', { error: true });
                console.warn('[KLPF] カスタム画像テーマをリセットできませんでした。', error);
            }
        });
    }

    async function openPanel() {
        if (rootElement?.isConnected) {
            shadowRoot?.querySelector('[data-file-input]')?.focus();
            return;
        }

        lastFocusedElement = document.activeElement;
        currentTheme = await loadStoredTheme();
        draftDataUrl = currentTheme?.dataUrl || null;
        draftFileName = currentTheme?.fileName || '';
        draftIsDirty = false;
        ensureRoot();
        shadowRoot.innerHTML = getPanelMarkup();
        renderDraft();
        addPanelListeners();
        setScrollLocked(true);
        shadowRoot.querySelector('.close')?.focus();
    }

    document.addEventListener(OPEN_EVENT, () => {
        openPanel().catch((error) => {
            console.warn('[KLPF] カスタム画像テーマを開けませんでした。', error);
        });
    });

    chrome.storage.onChanged.addListener((changes, areaName) => {
        if (areaName !== 'local' || !changes[STORAGE_KEY]) return;
        applyTheme(changes[STORAGE_KEY].newValue);
    });

    loadStoredTheme().then(applyTheme).catch((error) => {
        console.warn('[KLPF] カスタム画像テーマを読み込めませんでした。', error);
    });

    globalThis[INSTANCE_KEY] = {
        refresh() {
            loadStoredTheme().then(applyTheme).catch((error) => {
                console.warn('[KLPF] カスタム画像テーマを再適用できませんでした。', error);
            });
        },
    };
})();
