//Copyright (c) 2024 SAYU
//This software is released under the MIT License, see LICENSE.

(function() {

  const INTERVAL_TIME_MS = 90 * 60 * 1000;
  let keepAliveIntervalId = null;

  if (window.self !== window.top) return;
  
  function sendKeepAliveRequest() {
    
    let sid = window.location.href.match(/SID=([a-zA-Z0-9]+)/);
    if (sid && sid[1]) sid = sid[1];
    else {
      if (keepAliveIntervalId) {
        clearInterval(keepAliveIntervalId);
        keepAliveIntervalId = null;
      }
      return;
    }

    const timestamp = new Date().toLocaleString('ja-JP');

    fetch(`/lms/cmmnAjax/keepSession;SID=${sid}`, {
      method: 'POST',
      headers: {
          'X-Requested-With': 'XMLHttpRequest'
      }
    })
    .then(response => {
      if (response.ok && response.status === 200) {
        return response.text();
      }
      throw new Error(`サーバーエラー (ステータス: ${response.status})`);
    })
    .then(text => {
      if (text.trim() === 'true') {
        console.log(`[${timestamp}] セッション維持成功。サーバーからの応答: [${text}]`);
      } else {
        console.warn(`[${timestamp}] セッション維持応答が予期せぬ値でした。応答: [${text}]`);
      }
    })
    .catch(error => {
      console.error(`[${timestamp}] セッション維持リクエスト中にエラーが発生しました:`, error);
    });
  }

  function DialogObserver() {
    const observer = new MutationObserver((mutationsList) => {
      for (const mutation of mutationsList) {
        if (mutation.type === 'childList' && mutation.addedNodes.length > 0) {
          const continueButton = document.querySelector('#sessionExpirationAlertDialog .continueButton');
          if (continueButton) continueButton.click();
        }
      }
    });

    observer.observe(document.body, {
      childList: true, 
      subtree: true
    });
  }

  keepAliveIntervalId = setInterval(sendKeepAliveRequest, INTERVAL_TIME_MS);
  DialogObserver();

})();