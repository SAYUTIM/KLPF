// Copyright (c) 2025 SAYU
// This software is released under the MIT License, see LICENSE.

document.addEventListener('DOMContentLoaded', () => {
  const setupButton = document.getElementById('setup-button');
  setupButton.addEventListener('click', () => {
    const userConfirmation = window.confirm(
      'これからの自動環境構築には1分から3分程度かかることがあります。\n\n' +
      '処理中に、Googleの認証や権限の許可を求める画面が2回表示されますので、すべて許可してください。\n\n' +
      '設定を正常に完了するために、このタブを閉じたり、他のタブへ移動したりしないようお願いいたします。\n\n' +
      '準備はよろしいですか？'
    );
    chrome.storage.local.set({ gassetup_start: 1 });
    chrome.storage.local.get({ gasWebhook : 1 });
    chrome.runtime.sendMessage({
        type: 'inject',
        data: "gassetup"
    });
    if (userConfirmation) {
      chrome.tabs.create({ url: 'https://script.google.com/home/projects/create' });
    }
  });

  const copyButton = document.getElementById('copy-code-btn');
    if (copyButton) {
        copyButton.addEventListener('click', function() {
            const codeElement = document.getElementById('code-to-copy');
            const codeToCopy = codeElement.textContent || codeElement.innerText;
            const button = this;

            navigator.clipboard.writeText(codeToCopy).then(function() {
                button.textContent = 'コピー完了！';
                button.classList.add('copied');
                setTimeout(function() {
                    button.textContent = 'コピー';
                    button.classList.remove('copied');
                }, 2000);
            }, function(err) {
                console.error('クリップボードへのコピーに失敗しました: ', err);
                alert('コピーに失敗しました。手動でコピーしてください。');
            });
        });
    }

});
