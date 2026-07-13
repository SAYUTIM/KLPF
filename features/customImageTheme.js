// Copyright (c) 2024-2026 SAYU
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
    const ALL_DISABLED_KEY = 'klpfInlineAllFeaturesDisabled';
    const ACTIVE_ATTRIBUTE = 'data-klpf-custom-image-theme-active';
    const BACKGROUND_ATTRIBUTE = 'data-klpf-custom-image-theme-background';
    const BACKGROUND_PROPERTY = '--klpf-custom-image-theme-background';
    const WRAP_TOP_PROPERTY = '--klpf-custom-image-theme-wrap-top';
    const BACKGROUND_SIZE_PROPERTY = '--klpf-custom-image-theme-size';
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
    let isAllFeaturesDisabled = false;

    function normalizePercentage(value, fallback, maximum = 100) {
        const number = Number(value);
        return Number.isFinite(number) ? Math.max(0, Math.min(maximum, Math.round(number))) : fallback;
    }

    function normalizePosition(value, fallback = DEFAULT_POSITION) {
        const number = Number(value);
        return Number.isFinite(number)
            ? Math.max(0, Math.min(100, Math.round(number * 10) / 10))
            : fallback;
    }

    function normalizeStoredTheme(value) {
        if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
        const dataUrl = typeof value.dataUrl === 'string' ? value.dataUrl : '';
        if (!/^data:image\/(?:jpeg|png|webp);base64,/i.test(dataUrl)) return null;
        return {
            dataUrl,
            fileName: typeof value.fileName === 'string' ? value.fileName.slice(0, 160) : '',
            updatedAt: typeof value.updatedAt === 'string' ? value.updatedAt : '',
            positionX: normalizePosition(value.positionX),
            positionY: normalizePosition(value.positionY),
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
        const visibleHeight = Math.max(1, window.innerHeight - Math.max(0, areaRect.top));
        if (currentImageDimensions?.width && currentImageDimensions?.height && window.innerWidth && visibleHeight) {
            const coverScale = Math.max(
                window.innerWidth / currentImageDimensions.width,
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
                min-height: 100vh !important;
                background-color: transparent !important;
                background-image: url("${theme.dataUrl}") !important;
                background-position: ${theme.positionX}% ${theme.positionY}% !important;
                background-repeat: no-repeat !important;
                background-size: var(${BACKGROUND_SIZE_PROPERTY}, cover) !important;
                background-attachment: fixed !important;
            }
            html[${ACTIVE_ATTRIBUTE}] .lms-contents-wrap {
                min-height: calc(100vh - var(${WRAP_TOP_PROPERTY}, 0px)) !important;
                background-color: transparent !important;
                background-image: none !important;
            }
            html[${ACTIVE_ATTRIBUTE}] .lms-wrap {
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

    async function syncThemeAvailability(disabled) {
        isAllFeaturesDisabled = disabled === true;
        if (isAllFeaturesDisabled) {
            closePanel();
            currentTheme = null;
            removeAppliedTheme();
            return;
        }

        applyTheme(await loadStoredTheme());
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
                padding: 22px;
                background: rgba(7, 29, 38, .58);
                backdrop-filter: blur(7px);
                font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "Noto Sans JP", sans-serif;
            }
            .panel {
                display: grid;
                grid-template-rows: auto minmax(0, 1fr) auto;
                width: min(1040px, 100%);
                max-height: min(820px, calc(100vh - 44px));
                overflow: hidden;
                border: 1px solid rgba(150, 198, 212, .42);
                border-radius: 20px;
                color: #153743;
                background: #f7fafb;
                box-shadow: 0 30px 90px rgba(3, 31, 42, .36);
            }
            .header {
                display: flex;
                align-items: center;
                justify-content: space-between;
                gap: 20px;
                padding: 18px 22px;
                border-bottom: 1px solid #dce8ec;
                background: rgba(255, 255, 255, .92);
            }
            .eyebrow { margin: 0 0 3px; color: #168fb6; font-size: 10px; font-weight: 800; letter-spacing: .15em; }
            h2 { margin: 0; font-size: 20px; line-height: 1.35; }
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
            .close:hover { border-color: #b9d5de; color: #245a6c; background: #eef7f9; }
            .body { min-height: 0; overflow: auto; padding: 20px 22px; }
            .description { margin: 0 0 15px; color: #647b84; font-size: 13px; line-height: 1.65; }
            .editor {
                display: grid;
                grid-template-columns: minmax(0, 1fr) 280px;
                gap: 20px;
                align-items: start;
            }
            .canvas-column { min-width: 0; }
            .preview-shell {
                overflow: hidden;
                border: 1px solid #bcd1d8;
                border-radius: 15px;
                background: #102d38;
                box-shadow: 0 12px 28px rgba(12, 52, 66, .16);
            }
            .preview-bar {
                display: flex;
                align-items: center;
                gap: 9px;
                height: 35px;
                padding: 0 12px;
                color: #c8dde4;
                background: #173944;
                font-size: 10px;
                font-weight: 700;
                letter-spacing: .02em;
            }
            .window-dots { display: flex; gap: 5px; margin-right: 3px; }
            .window-dots i { width: 7px; height: 7px; border-radius: 50%; background: #6f929d; }
            .window-dots i:first-child { background: #ec7c78; }
            .window-dots i:nth-child(2) { background: #e3bd68; }
            .window-dots i:last-child { background: #65bd91; }
            .preview-title { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
            .preview-ratio { margin-left: auto; color: #8eb1bd; font-variant-numeric: tabular-nums; white-space: nowrap; }
            .preview {
                position: relative;
                display: grid;
                place-items: center;
                width: 100%;
                aspect-ratio: 16 / 9;
                overflow: hidden;
                background-color: #edf4f6;
                background-image:
                    linear-gradient(45deg, rgba(137, 164, 173, .11) 25%, transparent 25%),
                    linear-gradient(-45deg, rgba(137, 164, 173, .11) 25%, transparent 25%),
                    linear-gradient(45deg, transparent 75%, rgba(137, 164, 173, .11) 75%),
                    linear-gradient(-45deg, transparent 75%, rgba(137, 164, 173, .11) 75%);
                background-position: 0 0, 0 8px, 8px -8px, -8px 0;
                background-size: 16px 16px;
                cursor: grab;
                touch-action: none;
                outline: none;
            }
            .preview.is-dragging { cursor: grabbing; }
            .preview:focus-visible { box-shadow: inset 0 0 0 3px rgba(50, 181, 218, .72); }
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
            .preview-empty {
                position: relative;
                z-index: 4;
                display: grid;
                justify-items: center;
                gap: 8px;
                padding: 20px;
                color: #55717b;
                text-align: center;
            }
            .preview-empty[hidden] { display: none; }
            .empty-icon {
                display: grid;
                place-items: center;
                width: 48px;
                height: 48px;
                border: 1px solid #bfd6dd;
                border-radius: 14px;
                color: #168fb6;
                background: rgba(255, 255, 255, .82);
                font-size: 25px;
                font-weight: 400;
                box-shadow: 0 8px 22px rgba(27, 86, 104, .1);
            }
            .empty-title { font-size: 14px; font-weight: 800; }
            .empty-subtitle { color: #7c9199; font-size: 11px; font-weight: 600; }
            .ratio-guide {
                position: absolute;
                z-index: 2;
                border: 1px solid rgba(255, 255, 255, .58);
                border-radius: 5px;
                box-shadow: 0 0 0 1px rgba(10, 49, 63, .13);
                pointer-events: none;
            }
            .ratio-guide[hidden] { display: none; }
            .ratio-guide span {
                position: absolute;
                top: 6px;
                right: 6px;
                padding: 2px 5px;
                border-radius: 4px;
                color: #fff;
                background: rgba(10, 43, 55, .56);
                font-size: 9px;
                font-weight: 800;
            }
            .site-preview {
                position: absolute;
                inset: 0;
                z-index: 1;
                display: grid;
                grid-template: 12% 1fr / 20% 1fr;
                pointer-events: none;
            }
            .site-preview[hidden] { display: none; }
            .site-preview-header {
                grid-column: 1 / -1;
                border-bottom: 1px solid rgba(93, 122, 132, .28);
                background: rgba(255, 255, 255, var(--preview-content-alpha, .72));
            }
            .site-preview-menu {
                border-right: 1px solid rgba(93, 122, 132, .28);
                background: rgba(255, 255, 255, var(--preview-content-alpha, .72));
            }
            .site-preview-main {
                display: grid;
                grid-template-rows: 32% 1fr;
                gap: 5%;
                align-self: stretch;
                margin: 4%;
            }
            .site-preview-news,
            .site-preview-course {
                border: 1px solid rgba(91, 128, 140, .25);
                border-radius: 5px;
                background: rgba(255, 255, 255, var(--preview-content-alpha, .72));
            }
            .site-preview-news::before {
                content: '';
                display: block;
                width: 44%;
                height: 12%;
                margin: 7% 6%;
                border-radius: 999px;
                background: rgba(34, 108, 132, .32);
            }
            .site-preview-courses { display: grid; grid-template-columns: repeat(3, 1fr); gap: 4%; }
            .site-preview-course { min-width: 0; }
            .site-preview-course::before,
            .site-preview-course::after {
                content: '';
                display: block;
                height: 7%;
                margin: 16% 12% 0;
                border-radius: 999px;
                background: rgba(41, 91, 108, .29);
            }
            .site-preview-course::after { width: 58%; margin-top: 10%; opacity: .7; }
            .preview-instruction {
                position: absolute;
                z-index: 4;
                top: 10px;
                left: 10px;
                padding: 5px 8px;
                border: 1px solid rgba(255, 255, 255, .2);
                border-radius: 7px;
                color: #fff;
                background: rgba(9, 38, 49, .68);
                backdrop-filter: blur(5px);
                font-size: 10px;
                font-weight: 700;
                pointer-events: none;
            }
            .preview-toolbar {
                position: absolute;
                z-index: 5;
                left: 50%;
                bottom: 11px;
                display: flex;
                align-items: center;
                gap: 3px;
                min-height: 35px;
                padding: 4px;
                border: 1px solid rgba(255, 255, 255, .22);
                border-radius: 10px;
                color: #fff;
                background: rgba(8, 35, 45, .78);
                box-shadow: 0 7px 20px rgba(4, 27, 35, .2);
                backdrop-filter: blur(7px);
                transform: translateX(-50%);
            }
            .preview-toolbar[hidden] { display: none; }
            .tool-button {
                display: grid;
                place-items: center;
                min-width: 28px;
                height: 27px;
                padding: 0 7px;
                border: 0;
                border-radius: 7px;
                color: #fff;
                background: transparent;
                font: inherit;
                font-size: 15px;
                font-weight: 800;
                cursor: pointer;
            }
            .tool-button:hover { background: rgba(255, 255, 255, .14); }
            .tool-button.reset-view { min-width: auto; padding: 0 9px; font-size: 10px; }
            .tool-value { min-width: 43px; color: #d7edf3; font-size: 10px; font-weight: 800; text-align: center; font-variant-numeric: tabular-nums; }
            .tool-divider { width: 1px; height: 17px; margin: 0 2px; background: rgba(255, 255, 255, .2); }
            .inspector {
                min-width: 0;
                padding-left: 20px;
                border-left: 1px solid #dce7ea;
            }
            .inspector-section + .inspector-section {
                margin-top: 20px;
                padding-top: 19px;
                border-top: 1px solid #e0eaed;
            }
            .section-label { display: block; margin: 0 0 9px; color: #365762; font-size: 12px; font-weight: 800; }
            .file-row { display: grid; gap: 9px; }
            .file-button {
                display: inline-flex;
                align-items: center;
                justify-content: center;
                width: 100%;
                min-height: 40px;
                padding: 0 14px;
                border: 1px solid #91c5d5;
                border-radius: 9px;
                color: #117d9f;
                background: #edf9fc;
                font-size: 12px;
                font-weight: 800;
                cursor: pointer;
            }
            .file-button:hover { border-color: #55abc4; background: #e3f5fa; }
            .file-name { min-width: 0; overflow: hidden; color: #6d828a; font-size: 11px; text-overflow: ellipsis; white-space: nowrap; }
            input[type="file"] { position: absolute; width: 1px; height: 1px; overflow: hidden; opacity: 0; pointer-events: none; }
            .hint { margin: 7px 0 0; color: #87989e; font-size: 10px; line-height: 1.55; }
            .controls { display: grid; gap: 18px; }
            .control-heading { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-bottom: 8px; }
            .control-heading label { color: #45616b; font-size: 11px; font-weight: 800; }
            .control-value { color: #168fb6; font-size: 11px; font-weight: 800; font-variant-numeric: tabular-nums; }
            input[type="range"] {
                width: 100%;
                height: 5px;
                margin: 4px 0;
                border-radius: 999px;
                accent-color: #168fb6;
                cursor: pointer;
            }
            input[type="range"]:disabled { cursor: not-allowed; opacity: .38; }
            .status { min-height: 20px; margin: 14px 0 0; color: #147b57; font-size: 11px; font-weight: 700; line-height: 1.5; }
            .status.is-error { color: #bd3f4b; }
            .actions {
                display: flex;
                align-items: center;
                gap: 9px;
                padding: 14px 22px 17px;
                border-top: 1px solid #dce8ec;
                background: rgba(255, 255, 255, .94);
            }
            button { font-family: inherit; }
            .action {
                min-height: 39px;
                padding: 0 16px;
                border: 0;
                border-radius: 9px;
                font-size: 12px;
                font-weight: 800;
                cursor: pointer;
            }
            .reset { margin-right: auto; border: 1px solid #e2c5c9; color: #a23b46; background: #fff8f8; }
            .secondary { border: 1px solid #d5e2e6; color: #57717a; background: #f7fafb; }
            .primary { min-width: 108px; color: #fff; background: #168fb6; box-shadow: 0 7px 17px rgba(22, 143, 182, .2); }
            .primary:hover { background: #117e9f; }
            button:disabled { cursor: not-allowed; opacity: .42; box-shadow: none; }
            button:focus-visible, .file-button:focus-within { outline: 3px solid rgba(22, 143, 182, .25); outline-offset: 2px; }
            @media (max-width: 820px) {
                .panel { width: min(680px, 100%); }
                .editor { grid-template-columns: 1fr; }
                .inspector { padding: 18px 0 0; border-top: 1px solid #dce7ea; border-left: 0; }
                .inspector-section + .inspector-section { margin-top: 16px; padding-top: 15px; }
            }
            @media (max-width: 600px) {
                .overlay { align-items: end; padding: 8px; }
                .panel { max-height: calc(100vh - 16px); border-radius: 17px 17px 12px 12px; }
                .header { padding: 15px 16px; }
                .body { padding: 15px 16px; }
                .description { display: none; }
                .actions { flex-wrap: wrap; padding: 13px 16px 16px; }
                .reset { width: 100%; margin: 0; }
                .secondary, .primary { flex: 1; }
                .preview-instruction { display: none; }
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
                        <p class="description">画像の見える位置と、コンテンツの透け具合を調整できます。</p>
                        <div class="editor">
                            <div class="canvas-column">
                                <div class="preview-shell">
                                    <div class="preview-bar" aria-hidden="true">
                                        <span class="window-dots"><i></i><i></i><i></i></span>
                                        <span class="preview-title">Ku-LMS プレビュー</span>
                                        <span class="preview-ratio" data-preview-ratio></span>
                                    </div>
                                    <div class="preview" data-preview tabindex="0" role="application" aria-label="背景画像。ドラッグまたは矢印キーで位置を調整し、ホイールまたはプラスとマイナスキーで拡大縮小できます">
                                        <img class="preview-image" data-preview-image alt="">
                                        <div class="site-preview" aria-hidden="true">
                                            <span class="site-preview-header"></span>
                                            <span class="site-preview-menu"></span>
                                            <span class="site-preview-main">
                                                <span class="site-preview-news"></span>
                                                <span class="site-preview-courses">
                                                    <i class="site-preview-course"></i>
                                                    <i class="site-preview-course"></i>
                                                    <i class="site-preview-course"></i>
                                                </span>
                                            </span>
                                        </div>
                                        <div class="ratio-guide" data-ratio-guide><span>16:9</span></div>
                                        <span class="preview-instruction" data-preview-instruction>ドラッグで移動 · ホイールで拡大</span>
                                        <label class="preview-empty" data-preview-empty for="klpf-custom-theme-file">
                                            <span class="empty-icon" aria-hidden="true">＋</span>
                                            <span class="empty-title">背景画像を選択</span>
                                            <span class="empty-subtitle">JPEG・PNG・WebP</span>
                                        </label>
                                        <div class="preview-toolbar" data-preview-toolbar>
                                            <button type="button" class="tool-button" data-zoom-out aria-label="縮小">−</button>
                                            <output class="tool-value" data-toolbar-zoom>100%</output>
                                            <button type="button" class="tool-button" data-zoom-in aria-label="拡大">＋</button>
                                            <span class="tool-divider" aria-hidden="true"></span>
                                            <button type="button" class="tool-button reset-view" data-reset-view>表示をリセット</button>
                                        </div>
                                    </div>
                                </div>
                            </div>
                            <aside class="inspector">
                                <section class="inspector-section">
                                    <span class="section-label">背景画像</span>
                                    <div class="file-row">
                                        <label class="file-button" for="klpf-custom-theme-file" data-file-button-label>画像を選択</label>
                                        <input id="klpf-custom-theme-file" type="file" accept="image/jpeg,image/png,image/webp" data-file-input>
                                        <span class="file-name" data-file-name></span>
                                    </div>
                                    <p class="hint">20MBまで。保存時に背景向けのサイズへ最適化します。</p>
                                </section>
                                <section class="inspector-section controls">
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
                                </section>
                                <p class="status" data-status aria-live="polite"></p>
                            </aside>
                        </div>
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
        const backgroundArea = document.querySelector('.lms-contents-main') || contents;
        const rect = backgroundArea.getBoundingClientRect();
        const width = Math.max(1, Math.round(window.innerWidth));
        const height = Math.max(1, Math.round(window.innerHeight - Math.max(0, rect.top)));
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
        const previewToolbar = shadowRoot.querySelector('[data-preview-toolbar]');
        const ratioGuide = shadowRoot.querySelector('[data-ratio-guide]');
        const fileButtonLabel = shadowRoot.querySelector('[data-file-button-label]');
        const transparency = shadowRoot.querySelector('[data-transparency]');
        const transparencyOutput = shadowRoot.querySelector('[data-transparency-output]');
        const zoom = shadowRoot.querySelector('[data-zoom]');
        const zoomOutput = shadowRoot.querySelector('[data-zoom-output]');
        const toolbarZoom = shadowRoot.querySelector('[data-toolbar-zoom]');
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
        previewToolbar.hidden = !draftDataUrl;
        ratioGuide.hidden = !draftDataUrl;
        fileButtonLabel.textContent = draftDataUrl ? '画像を変更' : '画像を選択';
        transparency.disabled = !draftDataUrl;
        zoom.disabled = !draftDataUrl;
        transparency.value = String(draftTransparency);
        transparencyOutput.value = `${draftTransparency}%`;
        transparencyOutput.textContent = `${draftTransparency}%`;
        zoom.value = String(draftZoom);
        zoomOutput.value = `${draftZoom}%`;
        zoomOutput.textContent = `${draftZoom}%`;
        toolbarZoom.value = `${draftZoom}%`;
        toolbarZoom.textContent = `${draftZoom}%`;
        previewRatio.textContent = `${dimensions.width} × ${dimensions.height}`;

        fileName.textContent = draftFileName || '画像が選択されていません';
        fileName.title = draftFileName;
        applyButton.disabled = !draftDataUrl || !draftIsDirty;
        resetButton.disabled = !currentTheme;
        requestAnimationFrame(updateRatioGuide);
    }

    function renderPreviewTransform() {
        if (!shadowRoot) return;
        const previewImage = shadowRoot.querySelector('[data-preview-image]');
        const zoom = shadowRoot.querySelector('[data-zoom]');
        const zoomOutput = shadowRoot.querySelector('[data-zoom-output]');
        const toolbarZoom = shadowRoot.querySelector('[data-toolbar-zoom]');
        const applyButton = shadowRoot.querySelector('[data-apply]');
        if (!previewImage || !zoom || !zoomOutput || !toolbarZoom || !applyButton) return;

        previewImage.style.objectPosition = `${draftPositionX}% ${draftPositionY}%`;
        previewImage.style.transform = `scale(${draftZoom / 100})`;
        zoom.value = String(draftZoom);
        zoomOutput.value = `${draftZoom}%`;
        zoomOutput.textContent = `${draftZoom}%`;
        toolbarZoom.value = `${draftZoom}%`;
        toolbarZoom.textContent = `${draftZoom}%`;
        applyButton.disabled = !draftDataUrl || !draftIsDirty;
    }

    function updateDraftPositionFromDrag(event, dragStart) {
        if (!draftDataUrl || !dragStart) return;
        const preview = shadowRoot?.querySelector('[data-preview]');
        if (!preview) return;
        const rect = preview.getBoundingClientRect();
        const sensitivity = 100 / (draftZoom / 100);
        draftPositionX = normalizePosition(dragStart.positionX - ((event.clientX - dragStart.clientX) / rect.width) * sensitivity);
        draftPositionY = normalizePosition(dragStart.positionY - ((event.clientY - dragStart.clientY) / rect.height) * sensitivity);
        draftIsDirty = true;
        renderPreviewTransform();
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
        const zoomOutButton = shadowRoot.querySelector('[data-zoom-out]');
        const zoomInButton = shadowRoot.querySelector('[data-zoom-in]');
        const resetViewButton = shadowRoot.querySelector('[data-reset-view]');
        const transparency = shadowRoot.querySelector('[data-transparency]');
        const zoom = shadowRoot.querySelector('[data-zoom]');
        let dragStart = null;

        const setZoom = (value) => {
            if (!draftDataUrl) return;
            draftZoom = Math.max(100, Math.min(250, Math.round(Number(value) || DEFAULT_ZOOM)));
            draftIsDirty = true;
            renderPreviewTransform();
        };

        const resetView = () => {
            if (!draftDataUrl) return;
            draftPositionX = DEFAULT_POSITION;
            draftPositionY = DEFAULT_POSITION;
            draftZoom = DEFAULT_ZOOM;
            draftIsDirty = true;
            renderPreviewTransform();
        };

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
            if (!draftDataUrl || event.button !== 0 || event.target.closest('button, label, input')) return;
            preview.focus({ preventScroll: true });
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
        preview.addEventListener('dblclick', (event) => {
            if (event.target.closest('button, label, input')) return;
            resetView();
        });
        preview.addEventListener('keydown', (event) => {
            if (!draftDataUrl) return;
            const positionStep = event.shiftKey ? 5 : 1;
            const positionChanges = {
                ArrowLeft: [-positionStep, 0],
                ArrowRight: [positionStep, 0],
                ArrowUp: [0, -positionStep],
                ArrowDown: [0, positionStep],
            };
            if (positionChanges[event.key]) {
                event.preventDefault();
                draftPositionX = normalizePosition(draftPositionX + positionChanges[event.key][0]);
                draftPositionY = normalizePosition(draftPositionY + positionChanges[event.key][1]);
                draftIsDirty = true;
                renderPreviewTransform();
                return;
            }
            if (event.key === '+' || event.key === '=') {
                event.preventDefault();
                setZoom(draftZoom + 5);
            } else if (event.key === '-') {
                event.preventDefault();
                setZoom(draftZoom - 5);
            } else if (event.key === '0') {
                event.preventDefault();
                resetView();
            }
        });
        zoomOutButton.addEventListener('click', () => setZoom(draftZoom - 5));
        zoomInButton.addEventListener('click', () => setZoom(draftZoom + 5));
        resetViewButton.addEventListener('click', resetView);
        transparency.addEventListener('input', () => {
            draftTransparency = normalizePercentage(transparency.value, DEFAULT_TRANSPARENCY, 80);
            draftIsDirty = true;
            renderDraft();
        });
        zoom.addEventListener('input', () => {
            setZoom(zoom.value);
        });
        preview.addEventListener('wheel', (event) => {
            if (!draftDataUrl) return;
            event.preventDefault();
            const direction = event.deltaY < 0 ? 1 : -1;
            setZoom(draftZoom + direction * 5);
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
        const disabledState = await chrome.storage.local.get(ALL_DISABLED_KEY);
        if (disabledState[ALL_DISABLED_KEY]) {
            await syncThemeAvailability(true);
            return;
        }
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
        if (areaName !== 'local') return;
        if (changes[ALL_DISABLED_KEY]) {
            syncThemeAvailability(changes[ALL_DISABLED_KEY].newValue === true).catch((error) => {
                console.warn('[KLPF] カスタム画像テーマの停止状態を反映できませんでした。', error);
            });
            return;
        }
        if (changes[STORAGE_KEY] && !isAllFeaturesDisabled) {
            applyTheme(changes[STORAGE_KEY].newValue);
        }
    });

    window.addEventListener('resize', () => {
        scheduleGeometryUpdate();
        if (rootElement?.isConnected) renderDraft();
    }, { passive: true });
    window.addEventListener('scroll', scheduleGeometryUpdate, { passive: true });

    Promise.all([
        loadStoredTheme(),
        chrome.storage.local.get(ALL_DISABLED_KEY),
    ]).then(([theme, disabledState]) => {
        isAllFeaturesDisabled = disabledState[ALL_DISABLED_KEY] === true;
        if (isAllFeaturesDisabled) removeAppliedTheme();
        else applyTheme(theme);
    }).catch((error) => {
        console.warn('[KLPF] カスタム画像テーマを読み込めませんでした。', error);
    });

    globalThis[INSTANCE_KEY] = {
        refresh() {
            chrome.storage.local.get(ALL_DISABLED_KEY).then((disabledState) => {
                return syncThemeAvailability(disabledState[ALL_DISABLED_KEY] === true);
            }).catch((error) => {
                console.warn('[KLPF] カスタム画像テーマを再適用できませんでした。', error);
            });
        },
    };
})();
