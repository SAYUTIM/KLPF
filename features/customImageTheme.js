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
    const WRAP_TOP_PROPERTY = '--klpf-custom-image-theme-wrap-top';
    const BACKGROUND_SIZE_PROPERTY = '--klpf-custom-image-theme-size';
    const BACKGROUND_TOP_PROPERTY = '--klpf-custom-image-theme-top';
    const BACKGROUND_LEFT_PROPERTY = '--klpf-custom-image-theme-left';
    const BACKGROUND_RIGHT_PROPERTY = '--klpf-custom-image-theme-right';
    const DEFAULT_POSITION = 50;
    const DEFAULT_TRANSPARENCY = 28;
    const DEFAULT_ZOOM = 100;
    const MAX_INPUT_BYTES = 20 * 1024 * 1024;
    const MAX_DATA_URL_LENGTH = 4_500_000;
    const ALLOWED_IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);

    let rootElement = null;
    let shadowRoot = null;
    let currentTheme = null;
    let draftDataUrl = null;
    let draftFileName = '';
    let draftPositionX = DEFAULT_POSITION;
    let draftPositionY = DEFAULT_POSITION;
    let draftTransparency = DEFAULT_TRANSPARENCY;
    let draftZoom = DEFAULT_ZOOM;
    let draftImageWidth = 0;
    let draftImageHeight = 0;
    let draftIsDirty = false;
    let mutationObserver = null;
    let contentsObserver = null;
    let geometryObserver = null;
    let refreshFrame = null;
    let geometryFrame = null;
    let recalculateTimer = null;
    let lastFocusedElement = null;
    let currentImageDimensions = null;

    function normalizePercentage(value, fallback, maximum = 100) {
        const number = Number(value);
        return Number.isFinite(number) ? Math.max(0, Math.min(maximum, Math.round(number))) : fallback;
    }

    function normalizeStoredTheme(value) {
        if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
        const dataUrl = typeof value.dataUrl === 'string' ? value.dataUrl : '';
        if (!/^data:image\/(?:jpeg|png|webp);base64,/i.test(dataUrl)) return null;
        return {
            dataUrl,
            fileName: typeof value.fileName === 'string' ? value.fileName.slice(0, 160) : '',
            updatedAt: typeof value.updatedAt === 'string' ? value.updatedAt : '',
            positionX: normalizePercentage(value.positionX, DEFAULT_POSITION),
            positionY: normalizePercentage(value.positionY, DEFAULT_POSITION),
            contentTransparency: normalizePercentage(value.contentTransparency, DEFAULT_TRANSPARENCY, 80),
            zoom: Math.max(100, Math.min(250, Math.round(Number(value.zoom) || DEFAULT_ZOOM))),
            imageWidth: Math.max(0, Math.round(Number(value.imageWidth) || 0)),
            imageHeight: Math.max(0, Math.round(Number(value.imageHeight) || 0)),
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
            const configuredAlpha = 1 - ((currentTheme?.contentTransparency ?? DEFAULT_TRANSPARENCY) / 100);
            element.style.setProperty(BACKGROUND_PROPERTY, `rgba(${red}, ${green}, ${blue}, ${Math.min(alpha, configuredAlpha)})`);
            element.setAttribute(BACKGROUND_ATTRIBUTE, '');
        }
    }

    function updateThemeGeometry() {
        const contents = document.querySelector('.lms-contents-wrap');
        if (!contents) return false;
        const top = Math.max(0, contents.getBoundingClientRect().top);
        document.documentElement.style.setProperty(WRAP_TOP_PROPERTY, `${top}px`);
        const backgroundArea = document.querySelector('.lms-contents-main') || contents;
        const areaRect = backgroundArea.getBoundingClientRect();
        const visibleTop = Math.max(0, areaRect.top);
        const visibleHeight = Math.max(1, window.innerHeight - visibleTop);
        document.documentElement.style.setProperty(BACKGROUND_TOP_PROPERTY, `${visibleTop}px`);
        document.documentElement.style.setProperty(BACKGROUND_LEFT_PROPERTY, `${Math.max(0, areaRect.left)}px`);
        document.documentElement.style.setProperty(BACKGROUND_RIGHT_PROPERTY, `${Math.max(0, window.innerWidth - areaRect.right)}px`);
        if (currentImageDimensions?.width && currentImageDimensions?.height && areaRect.width && visibleHeight) {
            const coverScale = Math.max(
                areaRect.width / currentImageDimensions.width,
                visibleHeight / currentImageDimensions.height,
            ) * ((currentTheme?.zoom || DEFAULT_ZOOM) / 100);
            document.documentElement.style.setProperty(
                BACKGROUND_SIZE_PROPERTY,
                `${Math.ceil(currentImageDimensions.width * coverScale)}px ${Math.ceil(currentImageDimensions.height * coverScale)}px`,
            );
        }
        return true;
    }

    function scheduleGeometryUpdate() {
        if (!currentTheme || geometryFrame !== null) return;
        geometryFrame = requestAnimationFrame(() => {
            geometryFrame = null;
            updateThemeGeometry();
        });
    }

    function loadCurrentImageDimensions(theme) {
        if (theme.imageWidth && theme.imageHeight) {
            currentImageDimensions = { width: theme.imageWidth, height: theme.imageHeight };
            return;
        }
        currentImageDimensions = null;
        const expectedDataUrl = theme.dataUrl;
        const image = new Image();
        image.addEventListener('load', () => {
            if (currentTheme?.dataUrl !== expectedDataUrl) return;
            currentImageDimensions = { width: image.naturalWidth, height: image.naturalHeight };
            updateThemeGeometry();
        }, { once: true });
        image.src = theme.dataUrl;
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
        if (typeof ResizeObserver === 'function') {
            geometryObserver = new ResizeObserver(updateThemeGeometry);
            geometryObserver.observe(document.querySelector('.lms-contents-main') || contents);
        }
    }

    function activateThemeContents({ recalculate = false } = {}) {
        if (!updateThemeGeometry()) return false;
        refreshElementTransparency({ recalculate });
        startMutationObserver();
        return true;
    }

    function waitForThemeContents() {
        if (activateThemeContents({ recalculate: true }) || contentsObserver) return;
        contentsObserver = new MutationObserver(() => {
            if (!currentTheme || !activateThemeContents({ recalculate: true })) return;
            contentsObserver.disconnect();
            contentsObserver = null;
        });
        contentsObserver.observe(document.documentElement, { childList: true, subtree: true });
    }

    function stopMutationObserver() {
        mutationObserver?.disconnect();
        mutationObserver = null;
        contentsObserver?.disconnect();
        contentsObserver = null;
        geometryObserver?.disconnect();
        geometryObserver = null;
        if (refreshFrame !== null) cancelAnimationFrame(refreshFrame);
        refreshFrame = null;
        if (geometryFrame !== null) cancelAnimationFrame(geometryFrame);
        geometryFrame = null;
        if (recalculateTimer !== null) clearTimeout(recalculateTimer);
        recalculateTimer = null;
    }

    function ensureThemeStyle(theme) {
        let style = document.getElementById(STYLE_ID);
        if (!style) {
            style = document.createElement('style');
            style.id = STYLE_ID;
            (document.head || document.documentElement).appendChild(style);
        }
        style.textContent = `
            html[${ACTIVE_ATTRIBUTE}] .lms-contents-main {
                position: relative !important;
                min-height: 100vh !important;
                isolation: isolate !important;
                background-color: transparent !important;
            }
            html[${ACTIVE_ATTRIBUTE}] .lms-contents-main::before {
                content: "" !important;
                position: fixed !important;
                top: var(${BACKGROUND_TOP_PROPERTY}, 0px) !important;
                right: var(${BACKGROUND_RIGHT_PROPERTY}, 0px) !important;
                bottom: 0 !important;
                left: var(${BACKGROUND_LEFT_PROPERTY}, 0px) !important;
                z-index: -1 !important;
                background-image: url("${theme.dataUrl}") !important;
                background-position: ${theme.positionX}% ${theme.positionY}% !important;
                background-repeat: no-repeat !important;
                background-size: var(${BACKGROUND_SIZE_PROPERTY}, cover) !important;
                pointer-events: none !important;
            }
            html[${ACTIVE_ATTRIBUTE}] .lms-contents-wrap {
                min-height: calc(100vh - var(${WRAP_TOP_PROPERTY}, 0px)) !important;
                background-color: transparent !important;
                background-image: none !important;
            }
            html[${ACTIVE_ATTRIBUTE}] .lms-wrap,
            html[${ACTIVE_ATTRIBUTE}] .lms-contents-main,
            html[${ACTIVE_ATTRIBUTE}] .lms-contents-main-menu {
                background-color: transparent !important;
                background-image: none !important;
            }
            html[${ACTIVE_ATTRIBUTE}] .lms-contents-wrap [${BACKGROUND_ATTRIBUTE}] {
                background-color: var(${BACKGROUND_PROPERTY}) !important;
            }
        `;
    }

    function removeAppliedTheme() {
        stopMutationObserver();
        document.documentElement.removeAttribute(ACTIVE_ATTRIBUTE);
        document.documentElement.style.removeProperty(WRAP_TOP_PROPERTY);
        document.documentElement.style.removeProperty(BACKGROUND_SIZE_PROPERTY);
        document.documentElement.style.removeProperty(BACKGROUND_TOP_PROPERTY);
        document.documentElement.style.removeProperty(BACKGROUND_LEFT_PROPERTY);
        document.documentElement.style.removeProperty(BACKGROUND_RIGHT_PROPERTY);
        currentImageDimensions = null;
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
        loadCurrentImageDimensions(normalized);
        ensureThemeStyle(normalized);
        document.documentElement.setAttribute(ACTIVE_ATTRIBUTE, '');
        waitForThemeContents();

        if (recalculateTimer !== null) clearTimeout(recalculateTimer);
        recalculateTimer = setTimeout(() => {
            recalculateTimer = null;
            if (currentTheme) activateThemeContents({ recalculate: true });
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
                background-position: center;
                background-repeat: no-repeat;
                background-size: cover;
                cursor: grab;
                touch-action: none;
            }
            .preview.is-dragging { cursor: grabbing; }
            .preview-image {
                position: absolute;
                inset: 0;
                width: 100%;
                height: 100%;
                object-fit: cover;
                object-position: center;
                pointer-events: none;
                transform: scale(1);
                transform-origin: center;
                user-select: none;
            }
            .preview-empty { position: relative; z-index: 4; color: #70868e; font-size: 13px; font-weight: 700; }
            .ratio-guide {
                position: absolute;
                z-index: 2;
                border: 1px dashed rgba(255, 255, 255, .9);
                border-radius: 8px;
                box-shadow: 0 0 0 1px rgba(13, 67, 84, .24);
                pointer-events: none;
            }
            .ratio-guide span {
                position: absolute;
                top: 7px;
                right: 8px;
                padding: 3px 6px;
                border-radius: 5px;
                color: #fff;
                background: rgba(10, 53, 68, .68);
                font-size: 10px;
                font-weight: 800;
            }
            .site-preview {
                position: absolute;
                inset: 0;
                z-index: 1;
                display: grid;
                grid-template: 13% 1fr / 18% 1fr;
                pointer-events: none;
            }
            .site-preview-header {
                grid-column: 1 / -1;
                border-bottom: 1px solid rgba(93, 122, 132, .28);
                background: rgba(255, 255, 255, var(--preview-content-alpha, .72));
            }
            .site-preview-menu {
                border-right: 1px solid rgba(93, 122, 132, .28);
                background: rgba(255, 255, 255, var(--preview-content-alpha, .72));
            }
            .site-preview-content {
                align-self: start;
                height: 68%;
                margin: 4%;
                border: 1px solid rgba(121, 143, 151, .3);
                border-radius: 5px;
                background: rgba(255, 255, 255, var(--preview-content-alpha, .72));
            }
            .site-preview-content::before,
            .site-preview-content::after {
                content: '';
                display: block;
                height: 12%;
                margin: 8% 7% 0;
                border-radius: 999px;
                background: rgba(43, 91, 107, .28);
            }
            .site-preview-content::after {
                width: 62%;
                margin-top: 5%;
            }
            .preview-ratio {
                position: absolute;
                z-index: 3;
                bottom: 9px;
                left: 10px;
                padding: 4px 7px;
                border-radius: 6px;
                color: #fff;
                background: rgba(10, 53, 68, .72);
                font-size: 10px;
                font-weight: 800;
                pointer-events: none;
            }
            .preview-instruction {
                position: absolute;
                z-index: 3;
                right: 10px;
                bottom: 9px;
                padding: 4px 7px;
                border-radius: 6px;
                color: #fff;
                background: rgba(10, 53, 68, .72);
                font-size: 10px;
                font-weight: 800;
                pointer-events: none;
            }
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
            .controls { display: grid; gap: 14px; margin-top: 18px; }
            .control-heading { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-bottom: 7px; }
            .control-heading label { color: #45616b; font-size: 12px; font-weight: 800; }
            .control-value { color: #168fb6; font-size: 12px; font-weight: 800; }
            .center-button {
                min-height: 29px;
                padding: 0 10px;
                border: 1px solid #d5e2e6;
                border-radius: 8px;
                color: #57717a;
                background: #f7fafb;
                font-size: 11px;
                font-weight: 800;
                cursor: pointer;
            }
            input[type="range"] { width: 100%; accent-color: #168fb6; cursor: pointer; }
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
                        <div class="preview" data-preview role="application" aria-label="背景画像。ドラッグで位置を調整し、ホイールで拡大縮小できます">
                            <img class="preview-image" data-preview-image alt="">
                            <div class="site-preview" aria-hidden="true">
                                <span class="site-preview-header"></span>
                                <span class="site-preview-menu"></span>
                                <span class="site-preview-content"></span>
                            </div>
                            <div class="ratio-guide" data-ratio-guide><span>16:9 ガイド</span></div>
                            <span class="preview-ratio" data-preview-ratio></span>
                            <span class="preview-instruction" data-preview-instruction>ドラッグで移動 · ホイールで拡大縮小</span>
                            <span class="preview-empty" data-preview-empty>背景画像は設定されていません</span>
                        </div>
                        <div class="file-row">
                            <label class="file-button">
                                画像を選択
                                <input type="file" accept="image/jpeg,image/png,image/webp" data-file-input>
                            </label>
                            <span class="file-name" data-file-name></span>
                        </div>
                        <p class="hint">JPEG・PNG・WebP、20MBまで。保存時に背景向けのサイズへ最適化します。</p>
                        <div class="controls">
                            <div>
                                <div class="control-heading">
                                    <label>画像の位置</label>
                                    <button type="button" class="center-button" data-center-position>中央に戻す</button>
                                </div>
                            </div>
                            <div>
                                <div class="control-heading">
                                    <label for="klpf-custom-theme-zoom">拡大率</label>
                                    <output class="control-value" data-zoom-output>100%</output>
                                </div>
                                <input id="klpf-custom-theme-zoom" type="range" min="100" max="250" step="5" data-zoom>
                            </div>
                            <div>
                                <div class="control-heading">
                                    <label for="klpf-custom-theme-transparency">要素の透過度</label>
                                    <output class="control-value" data-transparency-output>28%</output>
                                </div>
                                <input id="klpf-custom-theme-transparency" type="range" min="0" max="80" step="1" data-transparency>
                            </div>
                        </div>
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

    function getPreviewDimensions() {
        const contents = document.querySelector('.lms-contents-wrap');
        if (!contents) return { width: 16, height: 9, ratio: 16 / 9 };
        const rect = contents.getBoundingClientRect();
        const width = Math.max(1, Math.round(rect.width));
        const height = Math.max(1, Math.round(Math.max(rect.height, window.innerHeight - Math.max(0, rect.top))));
        return { width, height, ratio: Math.max(.8, Math.min(2.5, width / height)) };
    }

    function updateRatioGuide() {
        const preview = shadowRoot?.querySelector('[data-preview]');
        const guide = shadowRoot?.querySelector('[data-ratio-guide]');
        if (!preview || !guide) return;
        const rect = preview.getBoundingClientRect();
        if (!rect.width || !rect.height) return;
        const maximumWidth = rect.width * .9;
        const maximumHeight = rect.height * .9;
        const guideWidth = Math.min(maximumWidth, maximumHeight * (16 / 9));
        const guideHeight = guideWidth / (16 / 9);
        guide.style.width = `${guideWidth}px`;
        guide.style.height = `${guideHeight}px`;
    }

    function renderDraft() {
        if (!shadowRoot) return;
        const preview = shadowRoot.querySelector('[data-preview]');
        const fileName = shadowRoot.querySelector('[data-file-name]');
        const applyButton = shadowRoot.querySelector('[data-apply]');
        const resetButton = shadowRoot.querySelector('[data-reset]');
        const empty = shadowRoot.querySelector('[data-preview-empty]');
        const previewImage = shadowRoot.querySelector('[data-preview-image]');
        const sitePreview = shadowRoot.querySelector('.site-preview');
        const previewInstruction = shadowRoot.querySelector('[data-preview-instruction]');
        const transparency = shadowRoot.querySelector('[data-transparency]');
        const transparencyOutput = shadowRoot.querySelector('[data-transparency-output]');
        const zoom = shadowRoot.querySelector('[data-zoom]');
        const zoomOutput = shadowRoot.querySelector('[data-zoom-output]');
        const previewRatio = shadowRoot.querySelector('[data-preview-ratio]');
        const dimensions = getPreviewDimensions();

        preview.style.aspectRatio = String(dimensions.ratio);
        preview.style.setProperty('--preview-content-alpha', String(1 - (draftTransparency / 100)));
        preview.classList.toggle('has-image', !!draftDataUrl);
        if (draftDataUrl) {
            if (previewImage.src !== draftDataUrl) previewImage.src = draftDataUrl;
            previewImage.style.objectPosition = `${draftPositionX}% ${draftPositionY}%`;
            previewImage.style.transform = `scale(${draftZoom / 100})`;
        } else {
            previewImage.removeAttribute('src');
        }
        empty.hidden = !!draftDataUrl;
        previewImage.hidden = !draftDataUrl;
        sitePreview.hidden = !draftDataUrl;
        previewInstruction.hidden = !draftDataUrl;
        transparency.value = String(draftTransparency);
        transparencyOutput.value = `${draftTransparency}%`;
        transparencyOutput.textContent = `${draftTransparency}%`;
        zoom.value = String(draftZoom);
        zoomOutput.value = `${draftZoom}%`;
        zoomOutput.textContent = `${draftZoom}%`;
        previewRatio.textContent = `表示領域 ${dimensions.width} × ${dimensions.height}`;

        fileName.textContent = draftFileName || '画像が選択されていません';
        fileName.title = draftFileName;
        applyButton.disabled = !draftDataUrl || !draftIsDirty;
        resetButton.disabled = !currentTheme;
        requestAnimationFrame(updateRatioGuide);
    }

    function updateDraftPositionFromDrag(event, dragStart) {
        if (!draftDataUrl || !dragStart) return;
        const preview = shadowRoot?.querySelector('[data-preview]');
        if (!preview) return;
        const rect = preview.getBoundingClientRect();
        const sensitivity = 100 / (draftZoom / 100);
        draftPositionX = normalizePercentage(dragStart.positionX - ((event.clientX - dragStart.clientX) / rect.width) * sensitivity, DEFAULT_POSITION);
        draftPositionY = normalizePercentage(dragStart.positionY - ((event.clientY - dragStart.clientY) / rect.height) * sensitivity, DEFAULT_POSITION);
        draftIsDirty = true;
        renderDraft();
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
                if (dataUrl.length <= MAX_DATA_URL_LENGTH) return { dataUrl, width, height };
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
            const optimized = await optimizeImage(file);
            draftDataUrl = optimized.dataUrl;
            draftImageWidth = optimized.width;
            draftImageHeight = optimized.height;
            draftFileName = file.name.slice(0, 160);
            draftPositionX = DEFAULT_POSITION;
            draftPositionY = DEFAULT_POSITION;
            draftZoom = DEFAULT_ZOOM;
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
        const preview = shadowRoot.querySelector('[data-preview]');
        const centerButton = shadowRoot.querySelector('[data-center-position]');
        const transparency = shadowRoot.querySelector('[data-transparency]');
        const zoom = shadowRoot.querySelector('[data-zoom]');
        let dragStart = null;

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
        preview.addEventListener('pointerdown', (event) => {
            if (!draftDataUrl) return;
            preview.classList.add('is-dragging');
            preview.setPointerCapture(event.pointerId);
            dragStart = {
                clientX: event.clientX,
                clientY: event.clientY,
                positionX: draftPositionX,
                positionY: draftPositionY,
            };
        });
        preview.addEventListener('pointermove', (event) => {
            if (preview.hasPointerCapture(event.pointerId)) updateDraftPositionFromDrag(event, dragStart);
        });
        const finishPositionDrag = (event) => {
            if (preview.hasPointerCapture(event.pointerId)) preview.releasePointerCapture(event.pointerId);
            preview.classList.remove('is-dragging');
            dragStart = null;
        };
        preview.addEventListener('pointerup', finishPositionDrag);
        preview.addEventListener('pointercancel', finishPositionDrag);
        centerButton.addEventListener('click', () => {
            if (!draftDataUrl) return;
            draftPositionX = DEFAULT_POSITION;
            draftPositionY = DEFAULT_POSITION;
            draftIsDirty = true;
            renderDraft();
        });
        transparency.addEventListener('input', () => {
            draftTransparency = normalizePercentage(transparency.value, DEFAULT_TRANSPARENCY, 80);
            draftIsDirty = true;
            renderDraft();
        });
        zoom.addEventListener('input', () => {
            draftZoom = Math.max(100, Math.min(250, Math.round(Number(zoom.value) || DEFAULT_ZOOM)));
            draftIsDirty = true;
            renderDraft();
        });
        preview.addEventListener('wheel', (event) => {
            if (!draftDataUrl) return;
            event.preventDefault();
            const direction = event.deltaY < 0 ? 1 : -1;
            draftZoom = Math.max(100, Math.min(250, draftZoom + direction * 5));
            draftIsDirty = true;
            renderDraft();
        }, { passive: false });
        applyButton.addEventListener('click', async () => {
            if (!draftDataUrl) return;
            applyButton.disabled = true;
            setStatus('画像を保存しています…');
            const theme = {
                dataUrl: draftDataUrl,
                fileName: draftFileName,
                updatedAt: new Date().toISOString(),
                positionX: draftPositionX,
                positionY: draftPositionY,
                contentTransparency: draftTransparency,
                zoom: draftZoom,
                imageWidth: draftImageWidth,
                imageHeight: draftImageHeight,
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
                draftPositionX = DEFAULT_POSITION;
                draftPositionY = DEFAULT_POSITION;
                draftTransparency = DEFAULT_TRANSPARENCY;
                draftZoom = DEFAULT_ZOOM;
                draftImageWidth = 0;
                draftImageHeight = 0;
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
        draftPositionX = currentTheme?.positionX ?? DEFAULT_POSITION;
        draftPositionY = currentTheme?.positionY ?? DEFAULT_POSITION;
        draftTransparency = currentTheme?.contentTransparency ?? DEFAULT_TRANSPARENCY;
        draftZoom = currentTheme?.zoom ?? DEFAULT_ZOOM;
        draftImageWidth = currentTheme?.imageWidth || 0;
        draftImageHeight = currentTheme?.imageHeight || 0;
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

    window.addEventListener('resize', () => {
        scheduleGeometryUpdate();
        if (rootElement?.isConnected) renderDraft();
    }, { passive: true });
    window.addEventListener('scroll', scheduleGeometryUpdate, { passive: true });

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
