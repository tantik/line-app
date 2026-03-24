const LIFF_ID = "2009586903-hyNXZaW7";
const WEBHOOK_URL = "https://script.google.com/macros/s/AKfycbw1yzmTeDnWAc6P2w4Vs9Hs0QG47jK-Ja8PLDwGV9GnC6PPzlqzBf-1sIusvceUttU/exec";

let userId = "";

async function init() {
  try {
    await liff.init({ liffId: LIFF_ID });

    if (liff.isLoggedIn()) {
      const profile = await liff.getProfile();
      userId = profile.userId;
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

function finishBooking() {
  showScreen("form");
}

function clearForm() {
  document.getElementById("name").value = "";
  document.getElementById("phone").value = "";

  document.getElementById("service").value = "";
  document.getElementById("date").value = "";
  document.getElementById("time").value = "";

  document.querySelectorAll(".service-card").forEach((el) => {
    el.classList.remove("active-service");
  });

  document.getElementById("confirmService").textContent = "-";
  document.getElementById("confirmDate").textContent = "-";
  document.getElementById("confirmTime").textContent = "-";
}

function submitForm() {
  const name = document.getElementById("name").value.trim();
  const phone = document.getElementById("phone").value.trim();
  const service = document.getElementById("service").value;
  const date = document.getElementById("date").value;
  const time = document.getElementById("time").value;

  if (!service || !date || !time) {
    alert("先に予約内容を選択してください");
    goBooking();
    return;
  }

  if (!name || !phone) {
    alert("名前と電話番号を入力してください");
    return;
  }

  fetch(WEBHOOK_URL, {
    method: "POST",
    headers: {
      "Content-Type": "text/plain;charset=utf-8"
    },
    body: JSON.stringify({
      name,
      phone,
      service,
      date,
      time,
      userId
    })
  })
    .then(() => {
      clearForm();
      goWelcome();
    })
    .catch((err) => {
      console.log("Submit error:", err);
      alert("送信エラー");
    });
}