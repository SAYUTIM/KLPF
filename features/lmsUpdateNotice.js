// Copyright (c) 2024-2026 SAYU
// This software is released under the MIT License, see LICENSE.

/**
 * @file KU-LMSホームのヘッダーへ、一日一回だけ更新通知を表示する。
 */

(function initializeLmsUpdateNotice() {
    'use strict';

    const NOTICE_ID = 'klpf-home-update-notice';
    const STYLE_ID = 'klpf-home-update-notice-style';
    const HEADER_SELECTOR = '.lms-header-inner';
    const HAMBURGER_SELECTOR = '#hamburger-menu';
    const HEADER_TITLE_SELECTOR = '.lms-header-title';
    const HOME_UPDATE_NOTICE_DISABLED_KEY = 'hideHomeUpdateNotification';
    const MINIMUM_NOTICE_SPACE_PX = 260;
    const RELEASE_URL = 'https://sayutim.github.io/KLPF/#download';
    const NOTICE_DISPLAY_DURATION_MS = 20000;
    const NOTICE_FADE_DURATION_MS = 520;

    function hasEnoughHeaderSpace(header, hamburgerMenu) {
        const headerTitle = header.querySelector(HEADER_TITLE_SELECTOR);
        if (!headerTitle) return false;
        const titleRect = headerTitle.getBoundingClientRect();
        const menuRect = hamburgerMenu.getBoundingClientRect();
        return menuRect.left - titleRect.right >= MINIMUM_NOTICE_SPACE_PX;
    }

    function injectNoticeStyles() {
        if (document.getElementById(STYLE_ID)) return;
        const style = document.createElement('style');
        style.id = STYLE_ID;
        style.textContent = `
            ${HEADER_SELECTOR} {
                position: relative;
            }
            #${NOTICE_ID} {
                align-items: center;
                align-self: center;
                animation: klpf-home-update-enter 520ms cubic-bezier(0.22, 1, 0.36, 1) both;
                background: #fffde8;
                border: 1px solid #eee9c9;
                border-radius: 9px;
                box-shadow: 0 3px 12px rgba(66, 62, 42, 0.08);
                box-sizing: border-box;
                color: #4c483d;
                display: flex;
                flex: 0 1 380px;
                gap: 9px;
                height: 38px;
                left: 50%;
                margin: 0;
                max-width: 380px;
                min-width: 250px;
                overflow: hidden;
                padding: 0 10px;
                position: absolute;
                text-decoration: none;
                transform: translateX(-50%);
                transition: background 160ms ease, border-color 160ms ease, box-shadow 160ms ease;
            }
            #${NOTICE_ID}:hover,
            #${NOTICE_ID}:focus-visible {
                background: #fffbd8;
                border-color: #e5dca7;
                box-shadow: 0 5px 16px rgba(66, 62, 42, 0.11);
                color: #403c32;
                outline: 2px solid transparent;
            }
            #${NOTICE_ID}.is-leaving {
                animation: klpf-home-update-leave ${NOTICE_FADE_DURATION_MS}ms cubic-bezier(0.4, 0, 1, 1) both;
                pointer-events: none;
            }
            #${NOTICE_ID} .klpf-home-update-mark {
                align-items: center;
                background: transparent;
                display: inline-flex;
                flex: 0 0 auto;
                justify-content: center;
            }
            #${NOTICE_ID} .klpf-home-update-mark img {
                display: block;
                height: 27px;
                object-fit: contain;
                width: 27px;
            }
            #${NOTICE_ID} .klpf-home-update-viewport {
                align-self: stretch;
                flex: 1 1 auto;
                min-width: 0;
                overflow: hidden;
                position: relative;
            }
            #${NOTICE_ID} .klpf-home-update-track {
                align-items: center;
                animation: klpf-home-update-marquee 20s cubic-bezier(0.3, 0.05, 0.2, 1) both;
                display: inline-flex;
                font-size: 13px;
                font-weight: 650;
                height: 100%;
                letter-spacing: 0.01em;
                left: 0;
                position: absolute;
                white-space: nowrap;
                will-change: transform, opacity;
            }
            #${NOTICE_ID}:hover .klpf-home-update-track {
                animation-play-state: paused;
            }
            #${NOTICE_ID} .klpf-home-update-progress {
                animation: klpf-home-update-countdown ${NOTICE_DISPLAY_DURATION_MS}ms linear both;
                background: #e5d46f;
                bottom: 0;
                height: 2px;
                left: 0;
                pointer-events: none;
                position: absolute;
                transform-origin: left center;
                width: 100%;
                will-change: transform;
            }
            #${NOTICE_ID}:hover .klpf-home-update-progress {
                animation-play-state: paused;
            }
            #${NOTICE_ID} .klpf-home-update-arrow {
                align-items: center;
                color: #756b38;
                display: inline-flex;
                flex: 0 0 auto;
                font-size: 15px;
                font-weight: 800;
                justify-content: center;
                transition: transform 160ms ease;
                width: 16px;
            }
            #${NOTICE_ID}:hover .klpf-home-update-arrow,
            #${NOTICE_ID}:focus-visible .klpf-home-update-arrow {
                transform: translate(2px, -2px);
            }
            @keyframes klpf-home-update-enter {
                from { opacity: 0; transform: translate(-50%, -7px); }
                to { opacity: 1; transform: translate(-50%, 0); }
            }
            @keyframes klpf-home-update-leave {
                from { opacity: 1; transform: translate(-50%, 0); }
                to { opacity: 0; transform: translate(-50%, -7px); }
            }
            @keyframes klpf-home-update-marquee {
                0% { opacity: 0; transform: translateX(310px); }
                8% { opacity: 1; }
                92% { opacity: 1; }
                100% { opacity: 0; transform: translateX(-105%); }
            }
            @keyframes klpf-home-update-countdown {
                from { transform: scaleX(1); }
                to { transform: scaleX(0); }
            }
            @media (max-width: 900px) {
                #${NOTICE_ID} { display: none; }
            }
            @media (prefers-reduced-motion: reduce) {
                #${NOTICE_ID} .klpf-home-update-track {
                    animation: none;
                    display: block;
                    line-height: 38px;
                    opacity: 1;
                    overflow: hidden;
                    position: static;
                    text-overflow: ellipsis;
                    transform: none;
                    width: 100%;
                }
            }
        `;
        (document.head || document.documentElement).appendChild(style);
    }

    function createUpdateNotice(version) {
        const notice = document.createElement('a');
        notice.id = NOTICE_ID;
        notice.href = RELEASE_URL;
        notice.target = '_blank';
        notice.rel = 'noopener noreferrer';
        notice.setAttribute('aria-label', `KLPF新バージョン ${version} の更新があります。更新内容を見る`);

        const mark = document.createElement('span');
        mark.className = 'klpf-home-update-mark';
        mark.setAttribute('aria-hidden', 'true');
        const icon = document.createElement('img');
        icon.src = chrome.runtime.getURL('icon/icon48.png');
        icon.alt = '';
        mark.appendChild(icon);

        const viewport = document.createElement('span');
        viewport.className = 'klpf-home-update-viewport';
        const track = document.createElement('span');
        track.className = 'klpf-home-update-track';
        const message = document.createElement('span');
        message.textContent = `KLPF新バージョン ${version} の更新があります`;
        track.appendChild(message);
        viewport.appendChild(track);

        const arrow = document.createElement('span');
        arrow.className = 'klpf-home-update-arrow';
        arrow.setAttribute('aria-hidden', 'true');
        arrow.textContent = '↗';
        const progress = document.createElement('span');
        progress.className = 'klpf-home-update-progress';
        progress.setAttribute('aria-hidden', 'true');
        notice.append(mark, viewport, arrow, progress);

        const removeNotice = () => {
            if (!notice.isConnected || notice.classList.contains('is-leaving')) return;
            notice.classList.add('is-leaving');
            window.setTimeout(() => notice.remove(), NOTICE_FADE_DURATION_MS);
        };

        progress.addEventListener('animationend', (event) => {
            if (event.animationName === 'klpf-home-update-countdown') removeNotice();
        }, { once: true });
        return notice;
    }

    async function main() {
        if (document.getElementById(NOTICE_ID)) return;
        const hamburgerMenu = await waitForElement(HAMBURGER_SELECTOR, document, 8000);
        const header = hamburgerMenu?.closest(HEADER_SELECTOR);
        if (!header || !hasEnoughHeaderSpace(header, hamburgerMenu)) return;

        const response = await chrome.runtime.sendMessage({ type: 'claim-home-update-notice' });
        if (response?.status !== 'update-available' || !response.latestVersion) return;

        const latestPreference = await chrome.storage.sync.get(HOME_UPDATE_NOTICE_DISABLED_KEY);
        if (latestPreference[HOME_UPDATE_NOTICE_DISABLED_KEY] === true) return;

        injectNoticeStyles();
        header.insertBefore(createUpdateNotice(response.latestVersion), hamburgerMenu);
    }

    chrome.storage.onChanged.addListener((changes, areaName) => {
        if (areaName !== 'sync' || changes[HOME_UPDATE_NOTICE_DISABLED_KEY]?.newValue !== true) return;
        document.getElementById(NOTICE_ID)?.remove();
    });

    void main().catch((error) => {
        console.debug('[KLPF] KU-LMSヘッダーへ更新通知を表示できませんでした。', error);
    });
})();
