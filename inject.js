//Copyright (c) 2024 SAYU
//This software is released under the MIT License, see LICENSE.

chrome.runtime.onMessage.addListener((message) => {
    if (message.action === "openTab") chrome.tabs.create({ url: message.url });
});

chrome.runtime.onInstalled.addListener(() => {

    chrome.contextMenus.create({
        id: "openOptions",
        title: "[KLPF] 設定を開く",
        contexts: ["page"],
    });

    chrome.storage.sync.get(["autoLogin"], (result) => {
        if (result.autoLogin) enableAutoLogin();
        else disableScript("AutoLoginScript");
    });

    chrome.storage.sync.get(["showTime"], (result) => {
        if (result.showTime) enableTimeDisplay();
        else disableScript("TimeDisplayScript");
    });

    chrome.storage.sync.get(["autoAttend"], (result) => {
        if (result.autoAttend) enableAutoAttend();
        else disableScript("AutoAttendScript");
    });

    chrome.storage.sync.get(["autoMeet"], (result) => {
        if (result.autoMeet) enableMeetjoin();
        else disableScript("MeetJoinScript");
    });

    chrome.storage.sync.get(["searchSubject"], (result) => {
        if (result.searchSubject) enableSearchSubject();
        else disableScript("SearchSubject");
    });

    chrome.storage.sync.get(["darkMode"], (result) => {
        if (result.darkMode) enableDarkMode();
        else disableScript("DarkMode");
    });

    chrome.storage.sync.get(["homework"], (result) => {
        if (result.homework) enableHomework();
        else disableScript("Homework");
    });

    chrome.storage.sync.get(["hacktest"], (result) => {
        if (result.hacktest) enableHackTest();
        else disableScript("hacktest");
    });

    chrome.storage.sync.get(["logoutblock"], (result) => {
        if (result.logoutblock) enableLogoutBlock();
        else disableScript("logoutblock");
    });

});

chrome.contextMenus.onClicked.addListener((info, tab) => {
    if (info.menuItemId === "openOptions") {
        chrome.tabs.create({ url: "setting/options.html" });
    }
});

chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "sync") {

        if (changes.autoLogin) {
            if (changes.autoLogin.newValue) enableAutoLogin();
            else disableScript("AutoLoginScript");
        }

        if (changes.showTime) {
            if (changes.showTime.newValue) enableTimeDisplay();
            else disableScript("TimeDisplayScript");
            
        }

        if (changes.autoAttend) {
            if (changes.autoAttend.newValue) enableAutoAttend();
            else disableScript("AutoAttendScript");
        }

        if (changes.autoMeet) {
            if (changes.autoMeet.newValue) enableMeetjoin();
            else disableScript("MeetJoinScript");
        }

        if (changes.searchSubject) {
            if (changes.searchSubject.newValue) enableSearchSubject();
            else disableScript("SearchSubject");
        }

        if (changes.darkMode) {
            if (changes.darkMode.newValue) enableDarkMode();
            else disableScript("DarkMode");
        }

        if (changes.homework) {
            if (changes.homework.newValue) enableHomework();
            else disableScript("Homework");
        }

        if (changes.hacktest) {
            if (changes.hacktest.newValue) enableHackTest();
            else disableScript("hacktest");
        }

        if (changes.logoutblock) {
            if (changes.logoutblock.newValue) enableLogoutBlock();
            else disableScript("logoutblock");
        }
    }
});

const root = "features/";

function disableScript(scriptId) {
    chrome.scripting.getRegisteredContentScripts((scripts) => {
        if (scripts.some(script => script.id === scriptId)) chrome.scripting.unregisterContentScripts({ ids: [scriptId] })
    });
}

function enableAutoLogin() {
    chrome.scripting.registerContentScripts([{
        id: "AutoLoginScript",
        matches: ["https://study.ns.kogakuin.ac.jp/*", "https://auth.kogakuin.ac.jp/*"],
        js: [`${root}AutoLogin.js`],
        runAt: "document_start"
    }]);
}

function enableTimeDisplay() {
    chrome.scripting.registerContentScripts([{
        id: "TimeDisplayScript",
        matches: ["https://study.ns.kogakuin.ac.jp/*"],
        js: [`${root}time.js`],
        runAt: "document_idle"
    }]);
}

function enableAutoAttend() {

    enableMeetjoin();

    chrome.scripting.registerContentScripts([{
        id: "AutoAttendScript",
        matches: ["https://study.ns.kogakuin.ac.jp/*", "https://meet.google.com/*"],
        js: [`${root}attend.js`],
        runAt: "document_idle"
    }]);
}

function enableMeetjoin() {
    chrome.scripting.registerContentScripts([{
        id: "MeetJoinScript",
        matches: ["https://meet.google.com/*"],
        js: [`${root}meet.js`],
        runAt: "document_idle"
    }]);
}

function enableSearchSubject() {
    chrome.scripting.registerContentScripts([{
        id: "SearchSubject",
        matches: ["https://study.ns.kogakuin.ac.jp/*"],
        js: [`${root}subject.js`],
        runAt: "document_start"
    }]);
}

function enableDarkMode() {
    chrome.scripting.registerContentScripts([{
        id: "DarkMode",
        matches: ["https://study.ns.kogakuin.ac.jp/*"],
        js: [`${root}darkmode.js`],
        runAt: "document_start"
    }]);
}

function enableHomework() {
    chrome.scripting.registerContentScripts([{
        id: "Homework",
        matches: ["https://study.ns.kogakuin.ac.jp/lms/homeHoml/*"],
        js: [`${root}homework.js`],
        runAt: "document_end"
    }]);
}

function enableHackTest(){
    chrome.scripting.registerContentScripts([{
        id: "hacktest",
        matches: ["https://study.ns.kogakuin.ac.jp/lms/tstsQuee/*"],
        js: [`${root}hacktest.js`],
        runAt: "document_end"
    }]);
}

function enableLogoutBlock(){
    chrome.scripting.registerContentScripts([{
        id: "logoutblock",
        matches: ["https://study.ns.kogakuin.ac.jp/lms/*"],
        js: [`${root}LMSlogoutblock.js`],
        runAt: "document_end"
    }]);
}
