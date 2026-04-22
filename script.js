// ================= STATE =================
let state = {
  service: null,
  staff: null,
  date: null,
  time: null
};

// ================= NAV =================
function goTo(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById(id).classList.add('active');
}

function openAdmin() {
  window.open('/admin.html');
}

// ================= DATA =================
const services = [
  {id:1, name:"カット", price:1500},
  {id:2, name:"カラー", price:3000}
];

const staff = [
  {id:1, name:"Yuki", services:[1]},
  {id:2, name:"Haruka", services:[1,2]}
];

// ================= INIT =================
function renderServices() {
  const el = document.getElementById('services');
  el.innerHTML = '';
  services.forEach(s=>{
    const btn = document.createElement('button');
    btn.innerText = s.name + " ¥" + s.price;
    btn.onclick = ()=>{
      state.service = s;
      renderStaff();
    };
    el.appendChild(btn);
  });
}

function renderStaff() {
  const el = document.getElementById('staff');
  el.innerHTML = '';
  staff
    .filter(st => !state.service || st.services.includes(state.service.id))
    .forEach(st=>{
      const btn = document.createElement('button');
      btn.innerText = st.name;
      btn.onclick = ()=> state.staff = st;
      el.appendChild(btn);
    });
}

// ================= FLOW =================
function nextStep() {
  goTo('datetime');
}

function nextStep2() {
  state.date = document.getElementById('date').value;
  goTo('confirm');
  renderSummary();
}

function renderSummary() {
  document.getElementById('summary').innerText =
    state.service.name + " / " +
    (state.staff ? state.staff.name : "") + " / " +
    state.date;
}

function confirmBooking() {
  // тут потом supabase
  goTo('done');
  document.getElementById('doneSummary').innerText = "予約が作成されました";
}

// ================= LEAD =================
function sendLead() {
  alert("送信");
}

// ================= START =================
renderServices();