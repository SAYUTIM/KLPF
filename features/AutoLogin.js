//Copyright (c) 2024 SAYU
//This software is released under the MIT License, see LICENSE.

async function getID() {
    return new Promise((id) => {
        chrome.storage.sync.get(["username", "password"], (ids) => {
            id(ids);
        });
    });
}

document.addEventListener("DOMContentLoaded", async () => {
    const id = await getID();

    if (!id.username || !id.password) return;

    if (location.href.startsWith("https://study.ns.kogakuin.ac.jp/lms/lginLgir/")) {

        const Integrated_authentication = document.querySelector('a.lms-text-link[onclick="otherClick()"]');
        if (Integrated_authentication) Integrated_authentication.click();

        const login_btn = document.querySelector(`button[name='loginButton']`);
        if (login_btn) login_btn.click();

    }

    else if (location.href.startsWith("https://study.ns.kogakuin.ac.jp/lms/error/")) location.pathname = "/lms/lginLgir/";

    else if (location.href.startsWith("https://auth.kogakuin.ac.jp/idp/profile/SAML2/Redirect/")) {

        const errorElement = document.querySelector("p.form-element.form-error");
        if(!errorElement) {

            const username = document.querySelector(`input[name='j_username']`);
            if (username) username.value = id.username;

            const password = document.querySelector(`input[name='j_password']`);
            if (password) password.value = id.password;

            const login_event = document.querySelector(`button[name='_eventId_proceed']`);
            if (login_event) login_event.click();

        }
    }
});