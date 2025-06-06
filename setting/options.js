//Copyright (c) 2024 SAYU
//This software is released under the MIT License, see LICENSE.

const saveSettings = () => {
    const username = document.getElementById("username").value;
    const password = document.getElementById("password").value;
    const autoLogin = document.getElementById("auto-login").checked;
    const showTime = document.getElementById("show-time").checked;
    const autoAttend = document.getElementById("auto-attend").checked;
    const attendC = document.getElementById("class-term").value;
    const attendM = document.getElementById("meet-id").value;
    const attendD = document.getElementById("day-select").value;
    const attendT = document.getElementById("class-period").value;
    const attendA = document.getElementById("attend-button").checked;
    const autoMeet = document.getElementById("auto-meet").checked;
    const searchSubject = document.getElementById("search-subject").checked;
    const darkMode = document.getElementById("dark-mode").checked;
    const homework = document.getElementById("home-work").checked;
    const hacktest = document.getElementById("hack-test").checked;
    const logoutblock = document.getElementById("logout-block").checked;

    chrome.storage.sync.set({ 
        username, 
        password, 
        autoLogin, 
        showTime, 
        autoAttend,
        attendC,
        attendM,
        attendD,
        attendT,
        attendA,
        autoMeet, 
        searchSubject, 
        darkMode,
        homework,
        hacktest,
        logoutblock,
    }, () => {
        document.dispatchEvent(new Event("settings-changed"));
    });
};

document.addEventListener("DOMContentLoaded", () => {
    chrome.storage.sync.get([
        "username",
        "password",
        "autoLogin",
        "showTime", 
        "autoAttend",
        "attendC",
        "attendM",
        "attendD",
        "attendT",
        "attendA", 
        "autoMeet", 
        "searchSubject", 
        "darkMode",
        "homework",
        "hacktest",
        "logoutblock",
    ], (result) => {
        document.getElementById("username").value = result.username || "";
        document.getElementById("password").value = result.password || "";
        document.getElementById("auto-login").checked = result.autoLogin || false;
        document.getElementById("show-time").checked = result.showTime || false;
        document.getElementById("auto-attend").checked = result.autoAttend || false;
        document.getElementById("class-term").checked = result.attendC || "";
        document.getElementById("meet-id").checked = result.attendM || "";
        document.getElementById("day-select").checked = result.attendD || "";
        document.getElementById("class-period").checked = result.attendT || "";
        document.getElementById("attend-button").checked = result.attendA || false;;
        document.getElementById("auto-meet").checked = result.autoMeet || false;
        document.getElementById("search-subject").checked = result.searchSubject || false;
        document.getElementById("dark-mode").checked = result.darkMode || false;
        document.getElementById("home-work").checked = result.homework || false;
        document.getElementById("hack-test").checked = result.hacktest || false;
        document.getElementById("logout-block").checked = result.logoutblock || false;

        document.dispatchEvent(new Event("settings-loaded"));
    });

    document.getElementById("username").addEventListener("input", saveSettings);
    document.getElementById("password").addEventListener("input", saveSettings);
    document.getElementById("auto-login").addEventListener("change", saveSettings);
    document.getElementById("show-time").addEventListener("change", saveSettings);
    document.getElementById("auto-attend").addEventListener("change", saveSettings);
    document.getElementById("class-term").addEventListener("change", saveSettings);
    document.getElementById("meet-id").addEventListener("input", saveSettings);
    document.getElementById("day-select").addEventListener("change", saveSettings);
    document.getElementById("class-period").addEventListener("change", saveSettings);
    document.getElementById("attend-button").addEventListener("change", saveSettings);
    document.getElementById("auto-meet").addEventListener("change", saveSettings);
    document.getElementById("search-subject").addEventListener("change", saveSettings);
    document.getElementById("dark-mode").addEventListener("change", saveSettings);
    document.getElementById("home-work").addEventListener("change", saveSettings);
    document.getElementById("hack-test").addEventListener("change", saveSettings);
    document.getElementById("logout-block").addEventListener("change", saveSettings);
});