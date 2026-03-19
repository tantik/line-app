const LIFF_ID = "2009534336-E6S4sA5p";

async function init() {
  try {
    await liff.init({ liffId: LIFF_ID });

    // ❌ УБИРАЕМ login
    // if (!liff.isLoggedIn()) {
    //   liff.login();
    // }

    if (liff.isLoggedIn()) {
      const profile = await liff.getProfile();
      console.log("User:", profile);
    }

  } catch (e) {
    console.log("LIFF init error:", e);
  }
}

init();

function goBooking() {
  document.querySelector(".active").classList.remove("active");
  document.getElementById("booking").classList.add("active");
}

function goForm() {
  document.querySelector(".active").classList.remove("active");
  document.getElementById("form").classList.add("active");
}

function confirmBooking() {
  alert("予約完了！");
}

function submitForm() {
  alert("送信完了！");
}