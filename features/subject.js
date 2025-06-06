//Copyright (c) 2024 SAYU
//This software is released under the MIT License, see LICENSE.

const courseCards = document.querySelectorAll('.lms-card');

function determineNowQ() {
    const today = new Date();
    const month = today.getMonth() + 1;

    if ((month === 4 || month === 5)) {
        return 1;
    } else if ((month === 6 || month === 7)) {
        return 2;
    } else if ((month >= 8 && month <= 10)) {
        return 3;
    } else if (month >=11 || month <= 3) {
        return 4;
    } else {
        return 0;
    }
}

function isTermMatch(term, nowQ) {
    const validTerms = {
        1: ["Q1", "前期", "通年"],
        2: ["Q2", "前期", "通年"],
        3: ["Q3", "後期", "通年"],
        4: ["Q4", "後期", "通年"]
    };
    return validTerms[nowQ].includes(term.trim());
}

function filterCourseCards(nowQ) {
    
    courseCards.forEach(card => {
        const termElements = card.querySelectorAll('.term');
        let shouldKeep = false;

        termElements.forEach(termElement => {
            if (isTermMatch(termElement.textContent, nowQ)) {
                shouldKeep = true;
            }
        });

        if (!shouldKeep) {
            card.remove();
        }
    });
}

function removeStyle() {
    courseCards.forEach(card => {
        if (card.style.clear === 'both') {
            card.style.clear = '';
        }
    });
}

const nowQ = determineNowQ();
if (nowQ > 0) {
    filterCourseCards(nowQ);
    removeStyle();
}