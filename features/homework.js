//Copyright (c) 2024-2025 SAYU
//This software is released under the MIT License, see LICENSE.

(function () {
  const form = document.querySelector('form#homehomlInfo[name="homeHomlActionForm"]');
  if (!form || document.getElementById("rawdata")) return;

  let sid = window.location.href.match(/SID=([a-zA-Z0-9]+)/);
  if (sid && sid[1]) {
    sid = sid[1];
  } else {
    return;
  }

  function setupHomeworkClickListener(containerElementId) {
    const homeworkContainer = document.getElementById(containerElementId);
    if (!homeworkContainer) return;

    homeworkContainer.addEventListener('click', (event) => {
      const clickedItem = event.target.closest('.homeworkItem');
      if (!clickedItem) return;

      const kyozaiId = clickedItem.dataset.kyozaiId;
      const kyozaiSyCd = clickedItem.dataset.kyozaiSyCd;

      if (kyozaiId && kyozaiSyCd) {
        const dynamicForm = document.createElement('form');
        dynamicForm.method = 'post';
        dynamicForm.action = `/lms/klmsKlil/kyozaiTitleLink;SID=${sid}`;
        dynamicForm.style.display = 'none';

        const kyozaiIdInput = document.createElement('input');
        kyozaiIdInput.type = 'hidden';
        kyozaiIdInput.name = 'kyozaiId';
        kyozaiIdInput.value = kyozaiId;
        dynamicForm.appendChild(kyozaiIdInput);

        const kyozaiSyCdInput = document.createElement('input');
        kyozaiSyCdInput.type = 'hidden';
        kyozaiSyCdInput.name = 'kyozaiSyCdHidden';
        kyozaiSyCdInput.value = kyozaiSyCd;
        dynamicForm.appendChild(kyozaiSyCdInput);

        document.body.appendChild(dynamicForm);
        try {
          dynamicForm.submit();
          if (dynamicForm.parentNode === document.body) {
            document.body.removeChild(dynamicForm);
          }
        } catch (e) {
          console.error("Error:", e);
          if (dynamicForm.parentNode === document.body) {
            document.body.removeChild(dynamicForm);
          }
        }
      }
    });
  }

  const rawdata = document.createElement("iframe");
  rawdata.src = `/lms/klmsKlil/;SID=${sid}`;
  rawdata.id = "rawdata";
  rawdata.style.display = "none";
  document.body.appendChild(rawdata);

  rawdata.addEventListener("load", () => {
    const loadingPhases = ["更新中", "更新中.", "更新中..", "更新中..."];
    let phaseIndex = 0;
    let animationIntervalId;

    let updatingNotice = document.createElement("div");
    updatingNotice.id = "updatingNotice";
    updatingNotice.style.fontWeight = "bold";
    updatingNotice.style.margin = "10px 0";
    updatingNotice.style.marginLeft = "12px";
    updatingNotice.textContent = loadingPhases[0];

    animationIntervalId = setInterval(() => {
      phaseIndex = (phaseIndex + 1) % loadingPhases.length;
      updatingNotice.textContent = loadingPhases[phaseIndex];
    }, 500);

    let preHomework = document.createElement("div");
    preHomework.id = "homework";
    preHomework.style.border = "1px solid #ccc";
    preHomework.style.padding = "10px";
    preHomework.style.marginTop = "10px";
    preHomework.style.backgroundColor = "#f9f9f9";
    preHomework.style.fontFamily = "sans-serif";

    chrome.storage.local.get("homework", (data) => {
      if (data.homework && typeof data.homework === 'string') {
        preHomework.innerHTML = data.homework;
        form.insertAdjacentElement("afterend", updatingNotice);
        updatingNotice.insertAdjacentElement("afterend", preHomework);
        setupHomeworkClickListener("homework");
      } else {
        form.insertAdjacentElement("afterend", updatingNotice);
      }
    });

    const findTbody = () => {
      const contentDoc = rawdata.contentDocument;
      if (!contentDoc) return false;

      const tbody = contentDoc.querySelector("tbody");
      if (tbody) {
        const rows = Array.from(tbody.querySelectorAll("tr")).filter(
          (tr) => !tr.classList.contains("thead")
        );

        const newHomework = document.createElement("div");
        newHomework.id = "homework";
        newHomework.style.border = "1px solid #ccc";
        newHomework.style.padding = "10px";
        newHomework.style.marginTop = "10px";
        newHomework.style.backgroundColor = "#f9f9f9";
        newHomework.style.fontFamily = "sans-serif";

        rows.forEach((tr) => {
          const deadline = tr.children[0]?.textContent.trim() || "";
          const homeworkNameCell = tr.children[2];
          const homeworkLinkElement = homeworkNameCell?.querySelector("a");
          const homeworkName =
            homeworkLinkElement?.textContent.trim() ||
            homeworkNameCell?.textContent.trim() ||
            "";
          const lessonName = tr.children[4]?.textContent.trim() || "";

          if (lessonName.includes("学習支援センター")) return;

          const homeworkItemDiv = document.createElement("div");
          homeworkItemDiv.className = "homeworkItem";
          homeworkItemDiv.style.borderBottom = "1px solid #ddd";
          homeworkItemDiv.style.padding = "8px 0";

          if (homeworkLinkElement) {
            const onclickAttr = homeworkLinkElement.getAttribute("onclick");
            if (onclickAttr) {
              const match = onclickAttr.match(
                /kyozaiTitleLink\s*\(\s*'([^']*)'\s*,\s*'([^']*)'\s*\)/
              );
              if (match && match.length === 3) {
                homeworkItemDiv.dataset.kyozaiId = match[1];
                homeworkItemDiv.dataset.kyozaiSyCd = match[2];
                homeworkItemDiv.style.cursor = "pointer";
              }
            }
          }

          let deadlineStyle = "color: #666; font-size: 0.8em;";
          const deadlineDate = new Date(
            deadline.replace(/年|月/g, "/").replace("日", "")
          );
          const today = new Date();
          const diff = (deadlineDate - today) / (1000 * 60 * 60 * 24);

          if (!isNaN(diff) && diff >= 0 && diff <= 7) {
            deadlineStyle = "color: red; font-size: 0.8em;";
          }

          homeworkItemDiv.innerHTML = `
            <div style="${deadlineStyle}">📅 ${deadline}</div>
            <div style="font-weight: bold; margin: 4px 0;">${lessonName}</div>
            <div>📝 ${homeworkName}</div>
          `;
          newHomework.appendChild(homeworkItemDiv);
        });

        chrome.storage.local.set({ homework: newHomework.innerHTML }, () => {
          clearInterval(animationIntervalId);
          const oldHomeworkEl = document.getElementById("homework");
          if (oldHomeworkEl) {
            oldHomeworkEl.remove();
          }
          if (document.getElementById("updatingNotice")) {
            document.getElementById("updatingNotice").remove();
          }
          if (document.getElementById("rawdata")) {
            document.getElementById("rawdata").remove();
          }
          form.insertAdjacentElement("afterend", newHomework);
          setupHomeworkClickListener("homework");
        });

        return true;
      }
      return false;
    };

    const intervalId = setInterval(() => {
      if (findTbody()) {
        clearInterval(intervalId);
      }
    }, 100);
  });
})();
