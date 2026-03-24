const LIFF_ID = "2009586903-hyNXZaW7";

async function init() {
  try {
    await liff.init({ liffId: LIFF_ID });

    if (liff.isLoggedIn()) {
      const profile = await liff.getProfile();
      console.log("User:", profile);
    }
  } catch (e) {
    console.log("LIFF error:", e);
  }
}

init();

function showScreen(id) {
  document.querySelectorAll(".screen").forEach((el) => {
    el.classList.remove("active");
  });
  document.getElementById(id).classList.add("active");
}

function goWelcome() {
  showScreen("welcome");
}

function goBooking() {
  showScreen("booking");
}

function goForm() {
  showScreen("form");
}

function selectService(service, button) {
  document.getElementById("service").value = service;

  document.querySelectorAll(".service-card").forEach((el) => {
    el.classList.remove("active-service");
  });

  button.classList.add("active-service");
}



function finishBooking() {
  alert("予約が確定しました！");
  goWelcome();
}


function submitForm() {
  const name = document.getElementById("name").value.trim();
  const phone = document.getElementById("phone").value.trim();

  const service = document.getElementById("service").value;
  const date = document.getElementById("date").value;
  const time = document.getElementById("time").value;

  if (!name || !phone) {
    alert("名前と電話番号を入力してください");
    return;
  }

  fetch("https://script.google.com/macros/s/AKfycbxFir4mJn21gJyWvh_OOb9I_glIF_K7hOvwDdbbyrHph1vWGYG98n_NaiX8E6wVrQcq/exec", {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      name,
      phone,
      service,
      date,
      time
    }),
    mode: "no-cors"
  })
  .then(() => {
    alert("送信完了！");
    goWelcome();
  })
  .catch((err) => {
    console.log(err);
    alert("送信エラー");
  });
}

function goConfirm() {
  const service = document.getElementById("service").value;
  const date = document.getElementById("date").value;
  const time = document.getElementById("time").value;

  if (!service || !date || !time) {
    alert("サービス・日付・時間を選択してください");
    return;
  }

  document.getElementById("confirmService").textContent = service;
  document.getElementById("confirmDate").textContent = date;
  document.getElementById("confirmTime").textContent = time;

  showScreen("confirm");
}