const SHEET_ID = "14mfJUTcpwRD-1LpSH6lCHQHU6jvBU3YPhDF2xen5BVY";

function doGet(e) {
  const action = e.parameter.action;

  if (action === "services") {
    return outputJson(getServices());
  }

  if (action === "staff") {
    return outputJson(getStaff());
  }

  return outputJson({ error: "Unknown action" });
}

function doPost(e) {
  const sheet = SpreadsheetApp.openById(SHEET_ID).getSheetByName("bookings");
  const data = JSON.parse(e.postData.contents);

  sheet.appendRow([
    new Date(),
    data.name || "",
    data.phone || "",
    data.userId || "",
    data.staffId || "",
    data.staffName || "",
    data.serviceId || "",
    data.serviceName || "",
    data.date || "",
    data.time || "",
    "booked"
  ]);

  return outputJson({ status: "ok" });
}

function getServices() {
  const sheet = SpreadsheetApp.openById(SHEET_ID).getSheetByName("services");
  const values = sheet.getDataRange().getValues();

  const rows = values.slice(1);

  return rows
    .filter(row => String(row[5]).toLowerCase() === "yes")
    .map(row => ({
      serviceId: row[0],
      category: row[1],
      name: row[2],
      duration: row[3],
      price: row[4],
      active: row[5]
    }));
}

function getStaff() {
  const sheet = SpreadsheetApp.openById(SHEET_ID).getSheetByName("staff");
  const values = sheet.getDataRange().getValues();

  const rows = values.slice(1);

  return rows
    .filter(row => String(row[7]).toLowerCase() === "yes")
    .map(row => ({
      staffId: row[0],
      name: row[1],
      photoUrl: row[2],
      workDays: row[3],
      startTime: row[4],
      endTime: row[5],
      slotMinutes: row[6],
      active: row[7]
    }));
}

function outputJson(data) {
  return ContentService
    .createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}