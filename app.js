const LIFF_ID = "2009520436-mnlGZ5e";

async function init() {
  await liff.init({ liffId: LIFF_ID });

  if (!liff.isLoggedIn()) {
    liff.login();
  }

  const profile = await liff.getProfile();
  console.log("User:", profile);
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