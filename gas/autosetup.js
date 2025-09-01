// Copyright (c) 2025 SAYU
// This software is released under the MIT License, see LICENSE.

let isAutomationCancelled = false;

function showOverlay() {
    const existingOverlay = document.getElementById('automation-overlay');
    if (existingOverlay) existingOverlay.remove();

    const styleId = 'rainbow-border-style-revised';
    if (!document.getElementById(styleId)) {
        const style = document.createElement('style');
        style.id = styleId;
        style.textContent = `
            @property --a {
              syntax: '<angle>';
              inherits: false;
              initial-value: 0deg;
            }

            @keyframes rainbow-rotate {
                to {
                    --a: 360deg;
                }
            }

            #rainbow-border-wrapper {
                background: conic-gradient(
                    from var(--a), 
                    #ff0000, #ffaf00, #ffff00, #00ff00, 
                    #00ffff, #0000ff, #8b00ff, #ff0000
                );
                animation: rainbow-rotate 4s linear infinite;
                padding: 1px;
                border-radius: 12px;
                box-shadow: 0 5px 20px rgba(0,0,0,0.2);
            }

            #content-box {
                background: white; 
                color: #333;
                padding: 25px 40px;
                border-radius: 11px;
                text-align: center;
            }

            .stylish-button {
                background: linear-gradient(45deg, #3a86ff, #8338ec);
                border: none;
                color: white;
                padding: 10px 25px;
                font-size: 16px;
                font-weight: bold;
                cursor: pointer;
                border-radius: 8px;
                transition: transform 0.2s ease, box-shadow 0.2s ease;
                box-shadow: 0 2px 5px rgba(0,0,0,0.2);
                margin-top: 20px;
            }

            .stylish-button:hover {
                transform: translateY(-2px);
                box-shadow: 0 4px 10px rgba(0,0,0,0.3);
            }

            .stylish-button:active {
                transform: translateY(0);
                box-shadow: 0 2px 5px rgba(0,0,0,0.2);
            }
        `;
        document.head.appendChild(style);
    }

    const overlay = document.createElement('div');
    overlay.id = 'automation-overlay';
    overlay.style.position = 'fixed';
    overlay.style.top = '0';
    overlay.style.left = '0';
    overlay.style.width = '100vw';
    overlay.style.height = '100vh';
    overlay.style.backgroundColor = 'rgba(255, 255, 255, 0.42)';
    overlay.style.zIndex = '99999';
    overlay.style.display = 'flex';
    overlay.style.justifyContent = 'center';
    overlay.style.alignItems = 'flex-end';
    overlay.style.paddingBottom = '8vh';
    overlay.style.boxSizing = 'border-box';
    overlay.style.fontFamily = '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif';

    const rainbowWrapper = document.createElement('div');
    rainbowWrapper.id = 'rainbow-border-wrapper';

    const contentBox = document.createElement('div');
    contentBox.id = 'content-box';
    
    const message = document.createElement('p');
    message.textContent = '自動処理を実行中です... このタブを閉じたり、ページを再読み込みしないでください。';
    message.style.margin = '0';
    message.style.fontSize = '18px';
    message.style.color = '#333';

    const cancelButton = document.createElement('button');
    cancelButton.textContent = '中止';
    cancelButton.className = 'stylish-button';
    
    cancelButton.onclick = () => {
        isAutomationCancelled = true;
        hideOverlay();
        alert('自動操作を中止しました。');
    };

    contentBox.appendChild(message);
    contentBox.appendChild(cancelButton);
    rainbowWrapper.appendChild(contentBox);
    overlay.appendChild(rainbowWrapper);
    
    document.body.appendChild(overlay);
}



function hideOverlay() {
    const overlay = document.getElementById('automation-overlay');
    if (overlay) overlay.remove();
}

async function waitForElement(selector, timeout = 10000) {
    return new Promise((resolve, reject) => {
        const intervalTime = 500;
        let attempts = 0;
        const maxAttempts = timeout / intervalTime;
        const interval = setInterval(() => {
            if (isAutomationCancelled) return reject(new Error('Cancelled by user'));
            const element = document.querySelector(selector);
            if (element && !element.disabled) {
                clearInterval(interval);
                resolve(element);
            } else if (++attempts > maxAttempts) {
                clearInterval(interval);
                reject(new Error(`要素が見つからないか、有効になりませんでした: ${selector}`));
            }
        }, intervalTime);
    });
}

function simulateClick(element) {
    const mouseEventInit = { bubbles: true, cancelable: true, view: window };
    element.dispatchEvent(new MouseEvent('mousedown', mouseEventInit));
    element.dispatchEvent(new MouseEvent('mouseup', mouseEventInit));
    element.dispatchEvent(new MouseEvent('click', mouseEventInit));
}

async function renameProject(newName) {
    if (isAutomationCancelled) throw new Error('Cancelled by user');
    const projectTitleElement = await waitForElement('[aria-label="名前を変更"]');
    simulateClick(projectTitleElement);
    
    const dialogInput = await waitForElement('div[role="dialog"] input[type="text"]');
    dialogInput.value = newName;
    dialogInput.dispatchEvent(new Event('input', { bubbles: true }));
    
    await new Promise(resolve => setTimeout(resolve, 500)); 
    
    const confirmButton = await waitForElement('div[role="dialog"] button[data-mdc-dialog-action="ok"]');
    if (confirmButton && !confirmButton.disabled) simulateClick(confirmButton);
}

function pasteCodeIntoEditor(codeToPaste) {
  const editorTextarea = document.querySelector('textarea.inputarea');
  if (editorTextarea) {
    editorTextarea.focus();
    editorTextarea.value = codeToPaste;
    editorTextarea.dispatchEvent(new Event('input', { bubbles: true }));
  }
}

async function deployWebApp() {
    const delay = 1500;
    
    if (isAutomationCancelled) throw new Error('Cancelled by user');
    const deployButton = await waitForElement('div[data-tt="このプロジェクトをデプロイ"] div[role="button"]');
    simulateClick(deployButton);
    await new Promise(resolve => setTimeout(resolve, delay));
    
    if (isAutomationCancelled) throw new Error('Cancelled by user');
    const newDeploymentButton = await waitForElement('span[aria-label="新しいデプロイ"]');
    simulateClick(newDeploymentButton);
    
    if (isAutomationCancelled) throw new Error('Cancelled by user');
    const enableTypesButton = await waitForElement('div[role="button"][aria-label="デプロイタイプを有効にする"]', 15000);
    await new Promise(resolve => setTimeout(resolve, delay));
    
    if (isAutomationCancelled) throw new Error('Cancelled by user');
    simulateClick(enableTypesButton);
    await new Promise(resolve => setTimeout(resolve, delay));
    
    if (isAutomationCancelled) throw new Error('Cancelled by user');
    const webAppButton = await waitForElement('span[aria-label="ウェブアプリ"]');
    simulateClick(webAppButton);
    await new Promise(resolve => setTimeout(resolve, delay));
    
    if (isAutomationCancelled) throw new Error('Cancelled by user');
    const finalDeployButton = await waitForButtonByText('デプロイ');
    simulateClick(finalDeployButton);
    
    if (isAutomationCancelled) throw new Error('Cancelled by user');
    await waitForButtonByText('アクセスを承認', 20000);
    
    hideOverlay();
    alert('1分以内に「アクセスを承認」をクリックして承認してください。');
    if (isAutomationCancelled) throw new Error('Cancelled by user');

    const urlLinkElement = await waitForElement('a[href^="https://script.google.com/a/macros/"]', 60000);
    
    const webAppUrl = urlLinkElement.href;
    console.log('ウェブアプリのURLを取得しました:', webAppUrl);
    chrome.storage.sync.set({ gaswebhookurl : `${webAppUrl}` });

    if (isAutomationCancelled) throw new Error('Cancelled by user');
    showOverlay();
    const doneButton = await waitForButtonByText('完了');
    simulateClick(doneButton);
}

async function waitForButtonByText(text, timeout = 10000) {
    return new Promise((resolve, reject) => {
        const intervalTime = 500;
        let attempts = 0;
        const maxAttempts = timeout / intervalTime;
        const interval = setInterval(() => {
            if (isAutomationCancelled) return reject(new Error('Cancelled by user'));
            const targetButton = Array.from(document.querySelectorAll('button')).find(b => b.textContent.trim() === text && b.offsetParent !== null && !b.disabled);
            if (targetButton) {
                clearInterval(interval);
                resolve(targetButton);
            } else if (++attempts > maxAttempts) {
                clearInterval(interval);
                reject(new Error(`「${text}」ボタンが見つかりませんでした。`));
            }
        }, intervalTime);
    });
}

async function runAutomation() {

    try {

        await renameProject('KLPF課題リマインダー');
        
        if (isAutomationCancelled) throw new Error('Cancelled by user');
        await new Promise(resolve => setTimeout(resolve, 3000));
        
        const myCode =`
  try {
    const userEmail = Session.getActiveUser().getEmail();
    const subject = \`【課題通知】セットアップ完了のお知らせ\`;
    const body = \`
      <div style="font-family: sans-serif; text-align: left; max-width: 600px; margin: auto;">
        <p><strong>自動環境構築セットアップが完了しました</strong></p>
        <p>今後、登録された課題の締切が近づくと、このメールアドレスに通知が届きます。</p>
        <p>このスクリプトは10分ごとに自動で実行され、リマインダーをチェックします。</p>
        <p>締切期限の18時間前、6時間前、1時間前の計3回メールが送信されます。</p>
        <p style="text-align: center; margin-top: 24px; margin-bottom: 24px;">
        <a href="https://study.ns.kogakuin.ac.jp" style="display: inline-block; background-color: #5B9DFF; color: #ffffff; padding: 12px 48px; text-decoration: none; border-radius: 8px; font-weight: bold;">Ku-LMSを開く</a>
        </p>
        <hr>
        <p style="color: #888; font-size: 0.8em;">このメールは拡張機能KLPFによって自動送信されました。</p>
      </div>
    \`;
    GmailApp.sendEmail(userEmail, subject, "", { htmlBody: body });
    console.log(\`セットアップ完了のメールを \${userEmail} に送信しました。\`);
  } catch (error) {
    console.error("テストメールの送信に失敗しました:", error);
    return;
  }

  clearAllTriggers();

  ScriptApp.newTrigger('checkDeadlinesAndSendReminders')
      .timeBased()
      .everyMinutes(10)
      .create();
  
  console.log('10分ごとに実行するトリガーをセットしました。');
  console.log('セットアップは正常に終了しました。このタブを閉じてKu-LMSで課題リストアップの更新を行ってください。');
}

// Copyright (c) 2025 SAYU
// This software is released under the MIT License, see LICENSE.

const PROPERTIES_KEY = 'HOMEWORKS_DATA'; 

function doPost(e) {
  try {
    const incomingHomeworks = JSON.parse(e.postData.contents);
    const userProperties = PropertiesService.getUserProperties();
    
    const currentDataJSON = userProperties.getProperty(PROPERTIES_KEY);
    const homeworks = currentDataJSON ? JSON.parse(currentDataJSON) : [];

    const updatedHomeworks = updateHomeworkList(homeworks, incomingHomeworks);

    userProperties.setProperty(PROPERTIES_KEY, JSON.stringify(updatedHomeworks.homeworks));

    const message = \`\${updatedHomeworks.addedCount}件の新しい課題を登録し、\${updatedHomeworks.removedCount}件の提出済み課題を削除しました。 (締切日なしの課題は\${updatedHomeworks.ignoredCount}件スキップしました)\`;

    return ContentService.createTextOutput(JSON.stringify({
      status: 'success',
      message: message
    })).setMimeType(ContentService.MimeType.JSON);

  } catch (error) {
    console.error(error);
    return ContentService.createTextOutput(JSON.stringify({
      status: 'error',
      message: error.toString()
    })).setMimeType(ContentService.MimeType.JSON);
  }
}

function updateHomeworkList(currentList, incomingList) {
    const validIncomingList = incomingList.filter(h => h.deadline && h.deadline.trim() !== '‐');
    const ignoredCount = incomingList.length - validIncomingList.length;

    const incomingKeys = new Set(validIncomingList.map(h => \`\${h.lessonName}|\${h.homeworkName}|\${h.deadline}\`));
    let addedCount = 0;
    let removedCount = 0;

    const keptHomeworks = currentList.filter(h => {
        const key = \`\${h.lessonName}|\${h.homeworkName}|\${h.deadline}\`;
        const shouldKeep = incomingKeys.has(key);
        if (!shouldKeep) {
            removedCount++;
        }
        return shouldKeep;
    });

    const keptKeys = new Set(keptHomeworks.map(h => \`\${h.lessonName}|\${h.homeworkName}|\${h.deadline}\`));

    validIncomingList.forEach(h => {
        const key = \`\${h.lessonName}|\${h.homeworkName}|\${h.deadline}\`;
        if (!keptKeys.has(key)) {
            keptHomeworks.push({
                lessonName: h.lessonName,
                homeworkName: h.homeworkName,
                deadline: h.deadline,
                reminders: { h18: false, h6: false, h1: false } 
            });
            addedCount++;
        }
    });

    return { homeworks: keptHomeworks, addedCount, removedCount, ignoredCount };
}

function checkDeadlinesAndSendReminders() {
  const userProperties = PropertiesService.getUserProperties();
  const homeworksJSON = userProperties.getProperty(PROPERTIES_KEY);
  if (!homeworksJSON) return;

  let homeworks = JSON.parse(homeworksJSON);
  const now = new Date();
  
  const remindersToSend = {
    h18: [],
    h6: [],
    h1: []
  };
  let dataWasUpdated = false;

  homeworks.forEach(hw => {
    const deadlineStr = hw.deadline.replace(/\\s\\(.\\)/, '');
    const deadline = new Date(deadlineStr.replace(/年|月/g, "/").replace("日", ""));
    
    const reminderChecks = [
      { hours: 18, flag: 'h18', text: "18時間" },
      { hours: 6,  flag: 'h6',  text: "6時間" },
      { hours: 1,  flag: 'h1',  text: "1時間" }
    ];

    for (const check of reminderChecks) {
      const reminderTime = new Date(deadline.getTime() - (check.hours * 60 * 60 * 1000));
      if (now >= reminderTime && !hw.reminders[check.flag]) {
        remindersToSend[check.flag].push(hw);
        hw.reminders[check.flag] = true;
        dataWasUpdated = true;
      }
    }
  });

  const userEmail = Session.getActiveUser().getEmail();

  if (remindersToSend.h18.length > 0) {
    sendGroupedReminderEmail(userEmail, remindersToSend.h18, "18時間", homeworks);
  }
  if (remindersToSend.h6.length > 0) {
    sendGroupedReminderEmail(userEmail, remindersToSend.h6, "6時間", homeworks);
  }
  if (remindersToSend.h1.length > 0) {
    sendGroupedReminderEmail(userEmail, remindersToSend.h1, "1時間", homeworks);
  }

  if (dataWasUpdated) {
    userProperties.setProperty(PROPERTIES_KEY, JSON.stringify(homeworks));
  }
}

function sendGroupedReminderEmail(userEmail, groupedHomeworks, remainingTimeText, allHomeworks) {
  const subject = \`【課題通知】締切まで約\${remainingTimeText}の課題が\${groupedHomeworks.length}件あります\`;
  
  let mainHomeworksHtml = "";
  groupedHomeworks.forEach(hw => {
    mainHomeworksHtml += \`
      <div style="border: 1px solid #ddd; padding: 16px; margin-bottom: 16px; border-radius: 8px; background-color: #f9f9f9;">
        <p><strong>締切日:</strong> \${hw.deadline}</p>
        <p><strong>授業名:</strong> \${hw.lessonName}</p>
        <p><strong>課題名:</strong> \${hw.homeworkName}</p>
      </div>
    \`;
  });

  const otherHomeworksHtml = createOtherHomeworksHtml(groupedHomeworks, allHomeworks);

  const body = \`
    <div style="font-family: sans-serif; text-align: left; max-width: 600px; margin: auto;">
      <p style="font-size: 1.1em; color: #D32F2F;"><strong>以下の\${groupedHomeworks.length}件の課題が、\${remainingTimeText}以内に締め切りになります！</strong></p>
      <p>Ku-LMSを開いて確認してください。</p>
      \${mainHomeworksHtml}
      <p>提出しているにもかかわらずこのメールが受信された場合は、課題リストが正しく更新されていない可能性があります。Ku-LMSホーム画面で課題リストアップの更新を完了させてください。</p>
      <p style="text-align: center; margin-top: 24px; margin-bottom: 24px;">
        <a href="https://study.ns.kogakuin.ac.jp" style="display: inline-block; background-color: #5B9DFF; color: #ffffff; padding: 12px 48px; text-decoration: none; border-radius: 8px; font-weight: bold;">Ku-LMSを開く</a>
      </p>
      \${otherHomeworksHtml}
      <hr>
      <p style="color: #888; font-size: 0.8em;">このメールは拡張機能KLPFによって自動送信されました。</p>
    </div>
  \`;
  
  GmailApp.sendEmail(userEmail, subject, "", { htmlBody: body });
}

function createOtherHomeworksHtml(mainHomeworks, allHomeworks) {
    const mainKeys = new Set(mainHomeworks.map(h => \`\${h.lessonName}|\${h.homeworkName}|\${h.deadline}\`));

    const otherHomeworksList = allHomeworks.filter(h => {
        const key = \`\${h.lessonName}|\${h.homeworkName}|\${h.deadline}\`;
        if (mainKeys.has(key)) {
            return false;
        }
        const deadlineStr = h.deadline.replace(/\\s\\(.\\)/, '');
        const deadline = new Date(deadlineStr.replace(/年|月/g, "/").replace("日", ""));
        return deadline > new Date();
    });

    otherHomeworksList.sort((a, b) => {
        const dateA_str = a.deadline.replace(/\\s\\(.\\)/, '');
        const dateB_str = b.deadline.replace(/\\s\\(.\\)/, '');
        const dateA = new Date(dateA_str.replace(/年|月/g, "/").replace("日", ""));
        const dateB = new Date(dateB_str.replace(/年|月/g, "/").replace("日", ""));
        return dateA - dateB;
    });

    if (otherHomeworksList.length === 0) return "";

    let html = '<h3 style="margin-top: 24px; border-bottom: 1px solid #ccc; padding-bottom: 8px;">その他に締切が近い課題</h3><ul style="padding-left: 20px; list-style-type: none;">';
    otherHomeworksList.forEach(item => {
        html += \`<li style="margin-bottom: 12px;"><strong>\${item.lessonName}</strong><br>　→\${item.homeworkName}<br><span style="font-size: 0.9em; color: #555;">(締切: \${item.deadline})</span></li>\`;
    });
    html += '</ul>';
    return html;
}

function showScheduledHomework() {
  const homeworksJSON = PropertiesService.getUserProperties().getProperty(PROPERTIES_KEY);
  if (!homeworksJSON || homeworksJSON === '[]') {
    console.log('現在登録されている課題リマインダーはありません。');
    return;
  }
  
  const homeworks = JSON.parse(homeworksJSON);
  console.log(\`--- 現在登録されている課題リマインダー (\${homeworks.length}件) ---\`);
  homeworks.forEach((hw, index) => {
    console.log(\`[\${index + 1}]\`);
    console.log(\`  締切日: \${hw.deadline}\`);
    console.log(\`  授業名: \${hw.lessonName}\`);
    console.log(\`  課題名: \${hw.homeworkName}\`);
    console.log(\`  通知状況: 18時間前:\${hw.reminders.h18}, 6時間前:\${hw.reminders.h6}, 1時間前:\${hw.reminders.h1}\`);
    console.log('--------------------');
  });
}

function clearAllTriggers() {
    const allTriggers = ScriptApp.getProjectTriggers();
    for (const trigger of allTriggers) {
        if (trigger.getHandlerFunction() === 'checkDeadlinesAndSendReminders') {
            ScriptApp.deleteTrigger(trigger);
        }
    }
}

function clearAllDataAndTriggers() {
  clearAllTriggers();
  console.log('定期実行トリガーを削除しました。');
  PropertiesService.getUserProperties().deleteProperty(PROPERTIES_KEY);
  console.log('すべての課題データを削除しました。');
  console.log('リセットが完了しました。');
`;

        pasteCodeIntoEditor(myCode);
        
        if (isAutomationCancelled) throw new Error('Cancelled by user');
        await new Promise(resolve => setTimeout(resolve, 3000));
        await deployWebApp();
        
        if (isAutomationCancelled) throw new Error('Cancelled by user');
        console.log('デプロイプロセスが完了しました。メイン画面に戻るのを待ちます...');
        await new Promise(resolve => setTimeout(resolve, 2000));

        if (isAutomationCancelled) throw new Error('Cancelled by user');
        console.log('「実行」ボタンを探しています...');
        await new Promise(resolve => setTimeout(resolve, 1000)); 
        console.log('「実行」ボタンをクリックします。');
        const buttons = document.querySelectorAll('button[aria-label="選択した関数を実行"]');
        if (buttons.length > 0) buttons.forEach((button) => {button.click() });

        await new Promise(resolve => setTimeout(resolve, 1000)); 

        hideOverlay();
        alert('1分以内に「権限を確認」をクリックして権限を与えてください。');

        chrome.storage.local.set({ gassetup_start: 0 });
        chrome.storage.local.set({ gasWebhook : 1 });
        
    } catch (error) {
        chrome.storage.local.set({ gassetup_start: 0 });
        if (!error.message.includes('Cancelled by user')) {
            console.error('自動化処理が失敗しました:', error);
            alert('自動化処理中にエラーが発生しました。');
        }
        disGasScript();
    } finally {
        hideOverlay();
        chrome.storage.local.set({ gassetup_start: 0 });
        disGasScript();
    }
}

function disGasScript(){
  chrome.runtime.sendMessage({
    type: 'inject',
    data: 'gassetupstop'
  });
}

let urlCheckInterval = null;
let editorLoadCheckInterval = null;

function checkEditorLoadedAndRunAutomation() {
  const editorCodeLinesElement = document.querySelector('.view-lines.monaco-mouse-cursor-text');

  if (editorCodeLinesElement) {
    console.log("エディタ要素が見つかりました。読み込み完了と判断し、自動化を実行します。");
    clearInterval(editorLoadCheckInterval);
    editorLoadCheckInterval = null;
    runAutomation();
  } else {
    console.log("エディタの読み込みを待機中 ('.view-lines.monaco-mouse-cursor-text' を検索中)...");
  }
}

function checkUrlAndStartNextStage() {
  const currentUrl = window.location.href;
  const targetUrlPrefix = 'https://script.google.com/home/projects/';

  if (currentUrl.startsWith(targetUrlPrefix)) {
    console.log(`目的のURLに到達しました: ${currentUrl}`);
    clearInterval(urlCheckInterval);
    urlCheckInterval = null;
    if (!editorLoadCheckInterval) {
      editorLoadCheckInterval = setInterval(checkEditorLoadedAndRunAutomation, 1000);
    }
  }
}

chrome.storage.local.get("gassetup_start", (result) => { if (!result.gassetup_start) return });

if (!urlCheckInterval) {
  isAutomationCancelled = false;
  showOverlay();
  urlCheckInterval = setInterval(checkUrlAndStartNextStage, 1000);
}