const SHEET_ID = "1p0oYa-bzPXpk-wEixBNnIIGzCKrzWAALhlhX_nzDyo4";
const VACANCIES_RANGE = "Vacancies!A2:G"; // ID | Title | City | Description | Photo | PublishDate | TelegraLink
const RESPONSES_RANGE = "Responses!A:J";
const RECOMMENDATIONS_RANGE = "Recommendations!A:E";

function doGet(e) {
  try {
    const action = e.parameter && e.parameter.action;
    if (action === "getVacancies") {
      return ContentService
        .createTextOutput(JSON.stringify(getVacancies()))
        .setMimeType(ContentService.MimeType.JSON);
    }

    return jsonError("Unknown action");
  } catch (err) {
    console.error(err);
    return jsonError("Internal error: " + (err.message || "Runtime exception"));
  }
}

function doPost(e) {
  try {
    let payload;
    try {
      payload = JSON.parse(e.postData && e.postData.contents ? e.postData.contents : "{}");
    } catch (err) {
      return jsonError("Invalid JSON payload");
    }

    const action = payload.action || (e.parameter && e.parameter.action);
    if (action === "saveResponse") {
      return jsonSuccess(saveResponse(payload));
    }
    if (action === "saveRecommendation") {
      return jsonSuccess(saveRecommendation(payload));
    }

    return jsonError("Unknown action");
  } catch (err) {
    console.error(err);
    return jsonError("Internal error: " + (err.message || "Runtime exception"));
  }
}

function getVacancies() {
  const sheet = SpreadsheetApp.openById(SHEET_ID).getSheetByName("Vacancies");
  if (!sheet) return [];
  const rows = sheet.getRange(VACANCIES_RANGE).getValues();
  return rows.filter(row => row.some(cell => cell !== "")).map(([id, title, city, description, photo, publishDate, telegraLink]) => ({
    id: String(id || ""),
    title: title || "",
    city: city || "",
    description: description || "",
    photo: photo || "",
    publishDate: publishDate || "",
    telegraLink: telegraLink || "",
  }));
}

function saveResponse(payload) {
  const sheet = SpreadsheetApp.openById(SHEET_ID).getSheetByName("Responses");
  if (!sheet) throw new Error("Лист Responses не найден");

  sheet.appendRow([
    payload.vacancyTitle || "",   // A
    payload.username || "",       // B
    payload.name || "",           // C
    payload.fullName || "",       // D
    payload.birthDate || "",      // E
    payload.contacts || "",       // F
    payload.english || "",        // G
    payload.nightShift || "",     // H
    payload.cvLink || "",         // I

    payload.createdAt || Utilities.formatDate(
      new Date(),
      Session.getScriptTimeZone(),
      "yyyy-MM-dd HH:mm"
    )                             // J
  ]);

  return { success: true };
}

function saveRecommendation(payload) {
  const sheet = SpreadsheetApp.openById(SHEET_ID).getSheetByName("Recommendations");
  if (!sheet) throw new Error("Лист Recommendations не найден");
  sheet.appendRow([
    payload.vacancyTitle || "",
    payload.username || "",
    payload.name || "",
    payload.recommendedUsername || "",
    Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "yyyy-MM-dd HH:mm"),
  ]);
  return { success: true };
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
