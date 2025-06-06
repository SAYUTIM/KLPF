//Copyright (c) 2024 SAYU
//This software is released under the MIT License, see LICENSE.

//カメラマイクOFF
const disableCameraMic = () => {

    //接続後もOFFにし続けないようにする
    const outattend = document.querySelector('[aria-label="通話から退出"]');
    if(outattend) return;
    
    const cameraButton = document.querySelector('[aria-label="カメラをオフ"]');
    if (cameraButton) cameraButton.click();
        
    const micButton = document.querySelector('[aria-label="マイクをオフ"]');
    if (micButton) micButton.click();      
};

//参加
const clickJoinButton = () => {
    const joinButton = Array.from(document.querySelectorAll('button'))
        .find(button => button.textContent.includes('今すぐ参加'));

    if (joinButton) joinButton.click();
};

const observer = new MutationObserver(() => {
    disableCameraMic();
    clickJoinButton();
});

//サイトの読み込みが終わった後に実行
observer.observe(document.body, {
    childList: true,
    subtree: true
});