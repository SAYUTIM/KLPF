// Copyright (c) 2024-2026 SAYU
// This software is released under the MIT License, see LICENSE.

/**
 * @file 課題一覧の取得、表示、GAS連携を行うモジュール
 */

let activeHomeworkUpdate = null;
let hasHomeworkUserInteracted = false;
let homeworkNavigationInProgress = false;
let homeworkNavigationRevision = 0;

const HOMEWORK_NAVIGATION_REQUEST_EVENT = 'klpf-homework-navigation-request';
const HOMEWORK_NAVIGATION_READY_EVENT = 'klpf-home-attendance-navigation-ready';
const HOMEWORK_NAVIGATION_FLAG = 'klpfHomeworkNavigation';
const ATTENDANCE_READY_FLAG = 'klpfHomeAttendanceReady';
const HOMEWORK_NAVIGATION_TIMEOUT_MS = 15000;
const HOMEWORK_ROWS_TIMEOUT_MS = 30000;
const HOMEWORK_CACHE_STORAGE_KEY = 'homework';
const HOMEWORK_FORM_SELECTOR = 'form#homehomlInfo[name="homeHomlActionForm"]';
const HOMEWORK_DEADLINE_CLASS = 'klpf-homework-deadline';
const HOMEWORK_URGENT_DEADLINE_CLASS = 'klpf-homework-deadline-urgent';
const HOMEWORK_URGENT_THRESHOLD_DAYS = 7;
const MILLISECONDS_PER_DAY = 1000 * 60 * 60 * 24;

/**
 * 課題データを表現する型定義
 * @typedef {object} HomeworkItem
 * @property {string} deadline - 提出期限
 * @property {string} homeworkName - 課題名
 * @property {string} lessonName - 授業名
 * @property {string | null} kyozaiId - 教材ID
 * @property {string | null} kyozaiSyCd - 教材種別コード
 */


/**
 * 指定された課題に遷移するためのフォームを動的に作成し、サブミットする。
 * @param {string} sid - セッションID。
 * @param {string} kyozaiId - 教材ID。
 * @param {string} kyozaiSyCd - 教材種別コード。
 */
function submitKyozaiForm(sid, kyozaiId, kyozaiSyCd) {
    const form = document.createElement('form');
    form.method = 'post';
    form.action = `/lms/klmsKlil/kyozaiTitleLink;SID=${sid}`;
    form.style.display = 'none';

    const createInput = (name, value) => {
        const input = document.createElement('input');
        input.type = 'hidden';
        input.name = name;
        input.value = value;
        return input;
    };

    form.appendChild(createInput('kyozaiId', kyozaiId));
    form.appendChild(createInput('kyozaiSyCdHidden', kyozaiSyCd));

    document.body.appendChild(form);
    try {
        form.submit();
    } catch (error) {
        console.error("[KLPF] 課題フォームのサブミットに失敗しました。", error);
    } finally {
        document.body.removeChild(form);
    }
}

/**
 * ホーム出席確認の通信が落ち着くまで課題への遷移を待機する。
 * @returns {Promise<void>} 出席確認の通信が終了するまで待つPromise。
 */
function waitForHomeAttendanceIdle() {
    document.documentElement.dataset[HOMEWORK_NAVIGATION_FLAG] = 'true';

    if (document.documentElement.dataset[ATTENDANCE_READY_FLAG] !== 'true') {
        return Promise.resolve();
    }

    return new Promise((resolve, reject) => {
        const requestId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
        let timeoutId = null;

        const cleanup = () => {
            document.removeEventListener(HOMEWORK_NAVIGATION_READY_EVENT, handleReady);
            if (timeoutId) clearTimeout(timeoutId);
        };

        const handleReady = (event) => {
            if (event.detail?.requestId !== requestId) return;
            cleanup();
            if (event.detail.error) {
                reject(new Error(event.detail.error));
                return;
            }
            resolve();
        };

        document.addEventListener(HOMEWORK_NAVIGATION_READY_EVENT, handleReady);
        timeoutId = setTimeout(() => {
            cleanup();
            reject(new Error('ホーム出席表示の停止待機がタイムアウトしました。'));
        }, HOMEWORK_NAVIGATION_TIMEOUT_MS);

        document.dispatchEvent(new CustomEvent(HOMEWORK_NAVIGATION_REQUEST_EVENT, {
            detail: { requestId },
        }));
    });
}

/**
 * 課題への遷移に必要な一覧画面のフォーム状態を復元する。
 * @param {string} sid - KU-LMSの画面遷移に使うセッションID。
 * @returns {Promise<void>} 処理の完了を待つPromise。
 */
async function restoreHomeworkListContext(sid) {
    const response = await fetch(`/lms/klmsKlil/;SID=${sid}`, {
        method: 'GET',
        credentials: 'include',
        cache: 'no-store',
        redirect: 'follow',
    });

    if (!response.ok) {
        throw new Error(`課題一覧コンテキストの復元に失敗しました: HTTP ${response.status}`);
    }

    await response.text();
}

/**
 * 出席確認との競合を調整してから対象課題へ遷移する。
 * @param {string} sid - KU-LMSの画面遷移に使うセッションID。
 * @param {string} kyozaiId - 対象教材のID。
 * @param {string} kyozaiSyCd - 対象教材の種別コード。
 * @param {object} item - 処理する掲示情報または課題要素。
 * @returns {Promise<void>} 処理の完了を待つPromise。
 */
async function navigateToHomework(sid, kyozaiId, kyozaiSyCd, item) {
    if (homeworkNavigationInProgress) return;

    homeworkNavigationInProgress = true;
    const revision = ++homeworkNavigationRevision;
    item.setAttribute('aria-busy', 'true');
    item.style.cursor = 'wait';

    try {
        await waitForHomeAttendanceIdle();
        if (revision !== homeworkNavigationRevision) return;
        abortActiveHomeworkUpdate();
        await restoreHomeworkListContext(sid);
        if (revision !== homeworkNavigationRevision) return;
        submitKyozaiForm(sid, kyozaiId, kyozaiSyCd);
    } catch (error) {
        if (revision !== homeworkNavigationRevision) return;
        resetHomeworkNavigation();
        console.error('[KLPF] 課題ページへの遷移準備に失敗しました。', error);
    }
}

/**
 * 課題への遷移待ちを無効にし、再クリックできる表示へ戻す。
 * @returns {void} 遷移フラグと待機表示の解除。
 */
function resetHomeworkNavigation() {
    homeworkNavigationRevision += 1;
    homeworkNavigationInProgress = false;
    delete document.documentElement.dataset[HOMEWORK_NAVIGATION_FLAG];
    document.querySelectorAll(`.${HOMEWORK_ITEM_CLASS}[aria-busy="true"]`).forEach(item => {
        item.removeAttribute('aria-busy');
        item.style.cursor = 'pointer';
    });
}

/**
 * 課題一覧の取得状態とタイマーを片付ける。
 * @param {object} updateState - 課題取得中の監視とタイマーを持つ状態。
 * @returns {void} 戻り値はない。
 */
function cleanupHomeworkUpdate(updateState) {
    if (!updateState) return;

    if (updateState.timeoutId) clearTimeout(updateState.timeoutId);
    if (updateState.abortIntervalId) clearInterval(updateState.abortIntervalId);
    if (updateState.observer) updateState.observer.disconnect();
    if (updateState.iframe?.isConnected) updateState.iframe.remove();

    if (activeHomeworkUpdate === updateState) {
        activeHomeworkUpdate = null;
    }
}

/**
 * 実行中の課題一覧更新を中断する。
 * @returns {void} 戻り値はない。
 */
function abortActiveHomeworkUpdate() {
    hasHomeworkUserInteracted = true;

    if (!activeHomeworkUpdate) return;

    const error = new DOMException('Homework update aborted.', 'AbortError');
    const { reject } = activeHomeworkUpdate;
    cleanupHomeworkUpdate(activeHomeworkUpdate);
    reject?.(error);
}

/**
 * 課題行がDOMへ描画されるまで監視し、期限まで待つ。
 * @param {Document} doc - 課題行を検索する文書。
 * @param {number} [timeout=30000] - 待機を打ち切るまでの時間（ミリ秒）。
 * @returns {Promise<Element|null>} 見つかった課題行。タイムアウト時はnull、中断時は拒否される。
 */
function waitForHomeworkRows(doc, timeout = 30000) {
    return new Promise((resolve, reject) => {
        const existingRow = safeQuerySelector("tbody tr", doc);
        if (existingRow) {
            resolve(existingRow);
            return;
        }

        const updateState = activeHomeworkUpdate || {};
        const finish = (result, error = null) => {
            cleanupHomeworkUpdate(updateState);
            if (error) {
                reject(error);
                return;
            }
            resolve(result);
        };

        updateState.reject = reject;
        updateState.timeoutId = setTimeout(() => {
            console.debug("[KLPF] 要素の待機がタイムアウトしました: tbody tr");
            finish(null);
        }, timeout);

        updateState.abortIntervalId = setInterval(() => {
            if (hasHomeworkUserInteracted) {
                finish(null, new DOMException('Homework update aborted.', 'AbortError'));
            }
        }, 50);

        updateState.observer = new MutationObserver(() => {
            const row = safeQuerySelector("tbody tr", doc);
            if (row) {
                finish(row);
            }
        });

        updateState.observer.observe(doc, {
            childList: true,
            subtree: true,
        });
    });
}

/**
 * 期限文字列が現在時刻から7日以内か判定する。
 * @param {string} deadlineText - KU-LMSに表示される期限文字列。
 * @param {Date} now - 判定基準となる現在時刻。
 * @returns {boolean}
 */
function isUrgentHomeworkDeadline(deadlineText, now = new Date()) {
    const normalizedDeadline = deadlineText.replace(/^📅\s*/, '').trim();
    const deadlineDate = new Date(normalizedDeadline.replace(/年|月/g, "/").replace("日", ""));
    if (!Number.isFinite(deadlineDate.getTime())) return false;

    const remainingDays = (deadlineDate - now) / MILLISECONDS_PER_DAY;
    return remainingDays >= 0 && remainingDays <= HOMEWORK_URGENT_THRESHOLD_DAYS;
}

/**
 * 期限に応じて課題の表示クラスと案内を設定する。
 * @param {HTMLElement} deadlineElement - 期限の表示状態を反映する要素。
 * @param {string} deadlineText - 課題の期限文字列。
 * @returns {void} 戻り値はない。
 */
function applyHomeworkDeadlineState(deadlineElement, deadlineText) {
    const isUrgent = isUrgentHomeworkDeadline(deadlineText);
    deadlineElement.classList.add(HOMEWORK_DEADLINE_CLASS);
    deadlineElement.classList.toggle(HOMEWORK_URGENT_DEADLINE_CLASS, isUrgent);
    deadlineElement.style.color = isUrgent ? 'red' : '#666';
    deadlineElement.style.fontSize = '0.8em';
}

/**
 * 課題コンテナにクリックイベントリスナーを設定する。
 * @param {string} containerId - イベントリスナーを設定するコンテナのID。
 * @param {string} sid - セッションID。
 */
function setupHomeworkClickListener(containerId, sid) {
    const container = document.getElementById(containerId);
    if (!container) return;

    // キャッシュ表示時にも現在時刻を基準に期限の警告状態を更新する。
    container.querySelectorAll(`.${HOMEWORK_ITEM_CLASS}`).forEach((item) => {
        const deadlineElement = item.firstElementChild;
        if (!(deadlineElement instanceof HTMLElement)) return;
        applyHomeworkDeadlineState(deadlineElement, deadlineElement.textContent || '');
    });

    container.addEventListener('pointerdown', (event) => {
        const item = event.target.closest(`.${HOMEWORK_ITEM_CLASS}`);
        if (!item) return;
        document.documentElement.dataset[HOMEWORK_NAVIGATION_FLAG] = 'true';
    }, true);

    container.addEventListener('click', (event) => {
        const item = event.target.closest(`.${HOMEWORK_ITEM_CLASS}`);
        if (!item) return;

        const { kyozaiId, kyozaiSyCd } = item.dataset;
        if (kyozaiId && kyozaiSyCd) {
            void navigateToHomework(sid, kyozaiId, kyozaiSyCd, item);
        }
    });
}

/**
 * 課題データを設定済みのWebhookへ送信する。
 * @param {HomeworkItem[]} homeworkData - 送信する課題データの配列。
 */
function sendHomeworkToWebhook(homeworkData) {
    if (homeworkData.length === 0) return;

    // 日付でソートしてから送信
    const sortedData = [...homeworkData].sort((a, b) => {
        const dateA = new Date(a.deadline.replace(/年|月/g, "/").replace("日", ""));
        const dateB = new Date(b.deadline.replace(/年|月/g, "/").replace("日", ""));
        return dateA - dateB;
    });

    chrome.runtime.sendMessage({ type: 'send-homework', data: sortedData });
}

/**
 * 課題データを解析し、構造化された配列として返す。
 * @param {Document} doc - 解析対象のドキュメント (iframe.contentDocument)。
 * @returns {HomeworkItem[]}
 */
function parseHomeworkData(doc) {
    const rows = safeQuerySelectorAll("tbody > tr:not(.thead)", doc);
    const homeworkData = [];

    for (const tr of rows) {
        const deadline = tr.children[0]?.textContent.trim() || "";
        const homeworkNameCell = tr.children[2];
        const homeworkLink = homeworkNameCell?.querySelector("a");
        const homeworkName = homeworkLink?.textContent.trim() || homeworkNameCell?.textContent.trim() || "";
        const lessonName = tr.children[4]?.textContent.trim() || "";

        if (!lessonName.includes("学習支援センター") && deadline && homeworkName && lessonName) {
            const onclickAttr = homeworkLink?.getAttribute("onclick");
            let kyozaiId = null;
            let kyozaiSyCd = null;

            if (onclickAttr) {
                const match = onclickAttr.match(/kyozaiTitleLink\s*\(\s*'([^']*)'\s*,\s*'([^']*)'\s*\)/);
                if (match) {
                    [, kyozaiId, kyozaiSyCd] = match;
                }
            }

            homeworkData.push({ deadline, homeworkName, lessonName, kyozaiId, kyozaiSyCd });
        }
    }
    return homeworkData;
}

/**
 * 課題データを元にHTML要素を生成する。
 * @param {HomeworkItem[]} homeworkData - 描画する課題データの配列。
 * @returns {HTMLDivElement}
 */
function renderHomework(homeworkData) {
    const container = document.createElement('div');
    container.id = HOMEWORK_CONTAINER_ID;

    applyHomeworkContainerStyles(container);

    if (homeworkData.length === 0) {
        container.textContent = "提出期限が設定されている課題はありませんでした。";
        return container;
    }

    for (const item of homeworkData) {
        const itemDiv = document.createElement('div');
        itemDiv.className = HOMEWORK_ITEM_CLASS;
        itemDiv.style.borderBottom = "1px solid #ddd";
        itemDiv.style.padding = "8px 0";

        if (item.kyozaiId && item.kyozaiSyCd) {
            itemDiv.dataset.kyozaiId = item.kyozaiId;
            itemDiv.dataset.kyozaiSyCd = item.kyozaiSyCd;
            itemDiv.style.cursor = "pointer";
        }

        const deadlineDiv = document.createElement('div');
        deadlineDiv.textContent = `📅 ${item.deadline}`;
        applyHomeworkDeadlineState(deadlineDiv, item.deadline);

        const lessonDiv = document.createElement('div');
        lessonDiv.style.fontWeight = "bold";
        lessonDiv.style.margin = "4px 0";
        lessonDiv.textContent = item.lessonName;

        const nameDiv = document.createElement('div');
        nameDiv.textContent = `📝 ${item.homeworkName}`;

        itemDiv.append(deadlineDiv, lessonDiv, nameDiv);
        container.appendChild(itemDiv);
    }
    return container;
}

/**
 * 課題一覧コンテナへ必要な表示スタイルを適用する。
 * @param {Element} container - 対象の表や一覧を含む要素。
 * @returns {void} 戻り値はない。
 */
function applyHomeworkContainerStyles(container) {
    Object.assign(container.style, {
        border: "1px solid #ccc",
        padding: "10px",
        marginTop: "0",
        backgroundColor: "#f9f9f9",
        fontFamily: "sans-serif",
    });
}

/**
 * ローディング表示を管理する。
 * @param {boolean} show - 表示するかどうか。
 * @returns {() => void} ローディング表示を停止する関数。
 */
function manageLoadingIndicator(show) {
    const existingNotice = document.getElementById(HOMEWORK_UPDATING_NOTICE_ID);
    if (existingNotice) existingNotice.remove();

    if (!show) return () => {};

    const notice = document.createElement("div");
    notice.id = HOMEWORK_UPDATING_NOTICE_ID;
    notice.style.fontWeight = "bold";
    notice.style.margin = "0 0 10px";

    let homeworkContainer = document.getElementById(HOMEWORK_CONTAINER_ID);
    const createdPlaceholder = !homeworkContainer;
    if (!homeworkContainer) {
        homeworkContainer = document.createElement('div');
        homeworkContainer.id = HOMEWORK_CONTAINER_ID;
        applyHomeworkContainerStyles(homeworkContainer);
        document.querySelector(HOMEWORK_FORM_SELECTOR)
            ?.insertAdjacentElement("afterend", homeworkContainer);
    }
    const firstHomeworkItem = homeworkContainer?.querySelector(`.${HOMEWORK_ITEM_CLASS}`);
    homeworkContainer?.insertBefore(notice, firstHomeworkItem || null);

    const phases = ["更新中", "更新中.", "更新中..", "更新中..."];
    let phaseIndex = 0;
    notice.textContent = phases[0];

    const intervalId = setInterval(() => {
        phaseIndex = (phaseIndex + 1) % phases.length;
        notice.textContent = phases[phaseIndex];
    }, 500);

    return () => {
        clearInterval(intervalId);
        notice.remove();
        if (createdPlaceholder
            && homeworkContainer?.isConnected
            && !homeworkContainer.querySelector(`.${HOMEWORK_ITEM_CLASS}`)
            && homeworkContainer.textContent.trim() === '') {
            homeworkContainer.remove();
        }
    };
}

/**
 * 課題一覧更新の中断が要求されていれば例外を投げる。
 * @returns {void} 戻り値はない。
 */
function throwIfHomeworkUpdateAborted() {
    if (hasHomeworkUserInteracted) {
        throw new DOMException('Homework update aborted.', 'AbortError');
    }
}

/**
 * 取得した課題一覧をホームの表示コンテナへ置き換える。
 * @param {HTMLFormElement} form - 読み取りまたは送信の対象フォーム。
 * @param {string} sid - KU-LMSの画面遷移に使うセッションID。
 * @param {Element} container - 対象の表や一覧を含む要素。
 * @returns {void} 戻り値はない。
 */
function replaceHomeworkContainer(form, sid, container) {
    document.getElementById(HOMEWORK_CONTAINER_ID)?.remove();
    form.insertAdjacentElement('afterend', container);
    setupHomeworkClickListener(HOMEWORK_CONTAINER_ID, sid);
}

/**
 * 保存済みの課題一覧をホームへ復元する。
 * @param {HTMLFormElement} form - 読み取りまたは送信の対象フォーム。
 * @param {string} sid - KU-LMSの画面遷移に使うセッションID。
 * @returns {Promise<void>} 処理の完了を待つPromise。
 */
async function restoreCachedHomework(form, sid) {
    try {
        const result = await chrome.storage.local.get(HOMEWORK_CACHE_STORAGE_KEY);
        const cachedHtml = result[HOMEWORK_CACHE_STORAGE_KEY];
        if (!cachedHtml || typeof cachedHtml !== 'string') return;

        const template = document.createElement('template');
        template.innerHTML = cachedHtml;
        const cachedContainer = template.content.firstElementChild;
        if (!cachedContainer) return;

        cachedContainer.id = HOMEWORK_CONTAINER_ID;
        replaceHomeworkContainer(form, sid, cachedContainer);
    } catch (error) {
        console.error("[KLPF] キャッシュされた課題の読み込みに失敗しました。", error);
    }
}

/**
 * 課題一覧ページを取得し、表示に使うデータを読み取る。
 * @param {string} sid - KU-LMSの画面遷移に使うセッションID。
 * @returns {Promise<HomeworkItem[]>} 課題一覧ページから解析した科目・課題・期限情報。
 */
async function fetchHomeworkData(sid) {
    hasHomeworkUserInteracted = false;

    const iframe = document.createElement('iframe');
    iframe.src = `/lms/klmsKlil/;SID=${sid}`;
    iframe.id = HOMEWORK_RAW_DATA_IFRAME_ID;
    iframe.style.display = 'none';

    const updateState = { iframe, reject: null };
    activeHomeworkUpdate = updateState;
    document.body.appendChild(iframe);

    try {
        await new Promise((resolve, reject) => {
            updateState.reject = reject;
            iframe.onload = resolve;
            iframe.onerror = reject;
            updateState.timeoutId = setTimeout(() => {
                reject(new Error('課題一覧ページの読み込みがタイムアウトしました。'));
            }, HOMEWORK_ROWS_TIMEOUT_MS);
        });
    } finally {
        clearTimeout(updateState.timeoutId);
        updateState.timeoutId = null;
        iframe.onload = null;
        iframe.onerror = null;
    }

    throwIfHomeworkUpdateAborted();

    const iframeDocument = iframe.contentDocument;
    if (!iframeDocument) throw new Error("iframeのコンテンツが取得できませんでした。");

    const firstHomeworkRow = await waitForHomeworkRows(iframeDocument, HOMEWORK_ROWS_TIMEOUT_MS);
    if (!firstHomeworkRow) throw new Error("課題データの待機がタイムアウトしました。");

    throwIfHomeworkUpdateAborted();
    return parseHomeworkData(iframeDocument);
}

/**
 * 課題一覧を取得し、ホーム表示とキャッシュを更新する。
 * @param {HTMLFormElement} form - 読み取りまたは送信の対象フォーム。
 * @param {string} sid - KU-LMSの画面遷移に使うセッションID。
 * @returns {Promise<void>} 処理の完了を待つPromise。
 */
async function updateHomeworkList(form, sid) {
    const homeworkData = await fetchHomeworkData(sid);
    const newHomeworkContainer = renderHomework(homeworkData);

    replaceHomeworkContainer(form, sid, newHomeworkContainer);
    await chrome.storage.local.set({
        [HOMEWORK_CACHE_STORAGE_KEY]: newHomeworkContainer.outerHTML,
    });

    const { gasWebhook } = await chrome.storage.sync.get(['gasWebhook']);
    if (gasWebhook === true) sendHomeworkToWebhook(homeworkData);
}

/**
 * メイン処理
 */
async function main() {
    const form = safeQuerySelector(HOMEWORK_FORM_SELECTOR);
    if (!form || document.getElementById(HOMEWORK_CONTAINER_ID)) return;

    const sid = getSid();
    if (!sid) {
        console.error("[KLPF] 課題一覧の表示に必要なSIDが取得できませんでした。");
        return;
    }

    await restoreCachedHomework(form, sid);
    if (hasHomeworkUserInteracted) return;

    const stopLoading = manageLoadingIndicator(true);
    try {
        await updateHomeworkList(form, sid);
    } catch (error) {
        if (error?.name === 'AbortError') {
            return;
        }
        console.error("[KLPF] 課題一覧の更新に失敗しました。", error);
    } finally {
        stopLoading();
        cleanupHomeworkUpdate(activeHomeworkUpdate);
    }
}

window.addEventListener('pagehide', () => {
    resetHomeworkNavigation();
    abortActiveHomeworkUpdate();
});
window.addEventListener('pageshow', event => {
    if (event.persisted) resetHomeworkNavigation();
});

main();
