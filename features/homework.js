// Copyright (c) 2024-2025 SAYU
// This software is released under the MIT License, see LICENSE.

/**
 * @file 課題一覧の取得、表示、GAS連携を行うモジュール
 */

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
 * 課題コンテナにクリックイベントリスナーを設定する。
 * @param {string} containerId - イベントリスナーを設定するコンテナのID。
 * @param {string} sid - セッションID。
 */
function setupHomeworkClickListener(containerId, sid) {
    const container = document.getElementById(containerId);
    if (!container) return;

    container.addEventListener('click', (event) => {
        const item = event.target.closest(`.${HOMEWORK_ITEM_CLASS}`);
        if (!item) return;

        const { kyozaiId, kyozaiSyCd } = item.dataset;
        if (kyozaiId && kyozaiSyCd) {
            submitKyozaiForm(sid, kyozaiId, kyozaiSyCd);
        }
    });
}

/**
 * 課題データをGoogle Apps Scriptに送信する。
 * @param {HomeworkItem[]} homeworkData - 送信する課題データの配列。
 */
function sendHomeworkToGAS(homeworkData) {
    if (homeworkData.length === 0) return;
    
    chrome.storage.sync.get(["gaswebhookurl"], function(result) {
        const gas_webhook = result.gaswebhookurl;

        if (!gas_webhook || !gas_webhook.match(/^https:\/\/script\.google\.com\/a\/macros\/g\.kogakuin\.jp\/s\//)) {
            console.log("GASのWebhook URLが正しくないため、処理を中断しました。");
            return;
        }

    });

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

    Object.assign(container.style, { border: "1px solid #ccc", padding: "10px", marginTop: "10px", backgroundColor: "#f9f9f9", fontFamily: "sans-serif" });

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
        const deadlineDate = new Date(item.deadline.replace(/年|月/g, "/").replace("日", ""));
        const diff = (deadlineDate - new Date()) / (1000 * 60 * 60 * 24);
        deadlineDiv.style.cssText = (diff >= 0 && diff <= 7) ? "color: red; font-size: 0.8em;" : "color: #666; font-size: 0.8em;";
        deadlineDiv.textContent = `📅 ${item.deadline}`;

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
    notice.style.margin = "10px 0 10px 12px";
    document.querySelector('form#homehomlInfo[name="homeHomlActionForm"]')?.insertAdjacentElement("afterend", notice);

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
    };
}

/**
 * メイン処理
 */
async function main() {
    // 実行コンテキストを判定するため、フォームとヘッダーを取得
    const form = safeQuerySelector('form#homehomlInfo[name="homeHomlActionForm"]');
    const header = safeQuerySelector('header.lms-header#lms-header');

    // 画面に課題一覧を表示するかどうかのフラグ (フォームがある場合のみ表示)
    const shouldDisplay = !!form;

    // フォームもヘッダーも存在しない場合、または既に課題コンテナが表示されている場合は処理を終了
    if ((!shouldDisplay && !header) || document.getElementById(HOMEWORK_CONTAINER_ID)) {
        return;
    }

    const sid = getSid();
    if (!sid) {
        console.error("[KLPF] 課題一覧の表示に必要なSIDが取得できませんでした。");
        return;
    }

    // --- UI表示が有効な場合のみ、キャッシュされた課題をまず表示 ---
    if (shouldDisplay) {
        try {
            const { homework: cachedHtml } = await chrome.storage.local.get("homework");
            if (cachedHtml && typeof cachedHtml === 'string') {
                const tempDiv = document.createElement('div');
                tempDiv.innerHTML = cachedHtml;
                const cachedContainer = tempDiv.firstElementChild;
                if (cachedContainer) {
                    cachedContainer.id = HOMEWORK_CONTAINER_ID;
                    form.insertAdjacentElement("afterend", cachedContainer);
                    setupHomeworkClickListener(HOMEWORK_CONTAINER_ID, sid);
                }
            }
        } catch (error) {
            console.error("[KLPF] キャッシュされた課題の読み込みに失敗しました。", error);
        }
    }

    // --- ここから共通のバックグラウンド更新処理 ---

    // ローディング表示はUI表示時のみ。それ以外は空の関数を設定。
    const stopLoading = shouldDisplay ? manageLoadingIndicator(true) : () => {};

    try {
        // iframeを非表示で作成し、課題一覧ページを読み込む
        const iframe = document.createElement("iframe");
        iframe.src = `/lms/klmsKlil/;SID=${sid}`;
        iframe.id = HOMEWORK_RAW_DATA_IFRAME_ID;
        iframe.style.display = "none";
        document.body.appendChild(iframe);

        await new Promise((resolve, reject) => {
            iframe.onload = resolve;
            iframe.onerror = (err) => reject(new Error("iframeの読み込みに失敗しました。"));
        });

        const iframeDoc = iframe.contentDocument;
        if (!iframeDoc) throw new Error("iframeのコンテンツが取得できませんでした。");

        // iframe内で課題データが描画されるのを待つ
        const waiting_tbody = await waitForElement("tbody tr", iframeDoc, 30000); // 30秒のタイムアウト
        if (!waiting_tbody) throw new Error("課題データの待機がタイムアウトしました。");

        // データの解析とHTMLコンテナの生成
        const homeworkData = parseHomeworkData(iframeDoc);
        const newHomeworkContainer = renderHomework(homeworkData);

        // --- UI表示が有効な場合のみ、画面を更新 ---
        if (shouldDisplay) {
            const oldContainer = document.getElementById(HOMEWORK_CONTAINER_ID);
            if (oldContainer) oldContainer.remove();
            form.insertAdjacentElement("afterend", newHomeworkContainer);
            setupHomeworkClickListener(HOMEWORK_CONTAINER_ID, sid);
        }

        // --- 共通の通知処理 ---

        // 新しい課題データをキャッシュに保存
        await chrome.storage.local.set({ homework: newHomeworkContainer.outerHTML });

        // GASに送信
        const { gasWebhook } = await chrome.storage.sync.get(["gasWebhook"]);
        if (gasWebhook) {
            sendHomeworkToGAS(homeworkData);
        }

    } catch (error) {
        console.error("[KLPF] 課題一覧の更新に失敗しました。", error);
    } finally {
        // ローディング表示の停止とiframeのクリーンアップ
        stopLoading();
        const iframe = document.getElementById(HOMEWORK_RAW_DATA_IFRAME_ID);
        if (iframe) iframe.remove();
    }
}

main();
