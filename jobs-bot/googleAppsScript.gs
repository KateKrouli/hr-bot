const SHEET_ID = "1p0oYa-bzPXpk-wEixBNnIIGzCKrzWAALhlhX_nzDyo4";
const VACANCIES_RANGE = "Vacancies!A2:G";
const RESPONSES_RANGE = "Responses!A:J";
const RECOMMENDATIONS_RANGE = "Recommendations!A:E";

function doGet(e) {
  try {
    const action = e.parameter?.action;
    if (action === "getVacancies") {
      const sheetId = e.parameter?.sheetId;
      return jsonSuccess(getVacancies(sheetId));
    }
    return jsonError("Unknown action: " + (action || "no action provided"));
  } catch (err) {
    return jsonError("Internal error: " + err.message);
  }
}

function doPost(e) {
  try {
    const body = JSON.parse(e.postData.contents || "{}");
    const action = body.action;
    if (action === "saveResponse") {
      return jsonSuccess(saveResponse(body));
    }
    if (action === "saveRecommendation") {
      return jsonSuccess(saveRecommendation(body));
    }
    return jsonError("Unknown action: " + (action || "no action provided"));
  } catch (err) {
    return jsonError("Internal error: " + err.message);
  }
}

function getVacancies(sheetId) {
  const spreadsheetId = sheetId || SHEET_ID;
  const sheet = SpreadsheetApp.openById(spreadsheetId).getSheetByName("Vacancies");
  if (!sheet) return [];
  const rows = sheet.getRange(VACANCIES_RANGE).getValues();
  return rows
    .filter((row) => row.some((cell) => cell !== ""))
    .map(([id, title, city, description, photo, publishDate, telegraLink]) => ({
      id: String(id || ""),
      title: String(title || ""),
      city: String(city || ""),
      description: String(description || ""),
      photo: String(photo || ""),
      publishDate: String(publishDate || ""),
      telegraLink: String(telegraLink || ""),
    }));
}

function saveResponse(payload) {
  const spreadsheetId = payload.sheetId || SHEET_ID;
  const sheet = SpreadsheetApp.openById(spreadsheetId).getSheetByName("Responses");
  if (!sheet) throw new Error("Лист Responses не найден");
  sheet.appendRow([
    payload.createdAt || "",
    payload.vacancyTitle || "",
    payload.username || "",
    payload.name || "",
    payload.fullName || "",
    payload.birthDate || "",
    payload.contacts || "",
    payload.english || "",
    payload.nightShift || "",
    payload.cvLink || "",
  ]);
  return { savedTo: spreadsheetId };
}

function saveRecommendation(payload) {
  const spreadsheetId = payload.sheetId || SHEET_ID;
  const sheet = SpreadsheetApp.openById(spreadsheetId).getSheetByName("Recommendations");
  if (!sheet) throw new Error("Лист Recommendations не найден");
  sheet.appendRow([
    Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "yyyy-MM-dd HH:mm"),
    payload.vacancyTitle || "",
    payload.username || "",
    payload.name || "",
    payload.recommendedUsername || "",
  ]);
  return { savedTo: spreadsheetId };
}

function jsonError(message) {
  return ContentService
    .createTextOutput(JSON.stringify({ success: false, error: message }))
    .setMimeType(ContentService.MimeType.JSON);
}

function jsonSuccess(data) {
  return ContentService
    .createTextOutput(JSON.stringify({ success: true, data }))
    .setMimeType(ContentService.MimeType.JSON);
}
