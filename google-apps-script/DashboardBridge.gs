/** Read-only, signed feed for the existing BCM dashboard. Never publishes the workbook. */
function doGet(e) {
  var props = PropertiesService.getScriptProperties();
  var secret = props.getProperty('BCM_DASHBOARD_SECRET');
  var p = (e && e.parameter) || {};
  var timestamp = String(p.timestamp || '');
  var signature = String(p.signature || '');
  var reply = function(value) {
    return ContentService.createTextOutput(JSON.stringify(value)).setMimeType(ContentService.MimeType.JSON);
  };
  if (!secret || !/^\d{13}$/.test(timestamp) || Math.abs(Date.now() - Number(timestamp)) > 300000) {
    return reply({error: 'Unauthorized'});
  }
  var expected = Utilities.computeHmacSha256Signature(timestamp, secret).map(function(b) {
    return ('0' + ((b + 256) % 256).toString(16)).slice(-2);
  }).join('');
  var diff = expected.length ^ signature.length;
  for (var j = 0; j < expected.length; j++) diff |= expected.charCodeAt(j) ^ (signature.charCodeAt(j) || 0);
  if (diff) return reply({error: 'Unauthorized'});
  try {
    var book = SpreadsheetApp.openById(props.getProperty('BCM_DASHBOARD_SPREADSHEET_ID'));
    var sheet = book.getSheetByName('BCM Sales Form');
    if (!sheet || sheet.getRange(1, 1).getDisplayValue() !== 'Date') throw new Error('Source unavailable');
    // Only the columns consumed by the current parser. Customer identity, contact,
    // address, notes and submission IDs never leave Google Sheets.
    var columns = [0,1,2,3,8,9,10,11,12,15,31,32,33,34,36,37,38,39,41,46,47,48,49,50,58,61];
    var labels = ['Date','Rep','Location','Interaction Type'];
    var headers = Array(62).fill('');
    labels.forEach(function(label, i) { headers[i] = label; });
    var rows = sheet.getRange(1, 1, Math.max(1, sheet.getLastRow()), 62).getDisplayValues();
    var output = [headers];
    rows.slice(1).forEach(function(row) {
      if (!row[0] || !row[1]) return;
      var record = Array(62).fill('');
      columns.forEach(function(index) { record[index] = row[index]; });
      // This free-text column is only used to classify accessories: export categories.
      record[47] = ['pillow','protector','sheet'].filter(function(word) {
        return String(row[47]).toLowerCase().indexOf(word) !== -1;
      }).join(' ');
      output.push(record);
    });
    var csv = output.map(function(row) {
      return row.map(function(value) { return '"' + String(value).replace(/"/g, '""') + '"'; }).join(',');
    }).join('\r\n');
    return reply({schemaVersion: 1, csv: csv, updatedAt: new Date().toISOString()});
  } catch (error) {
    // Do not return sheet data or internal error details to callers.
    return reply({error: 'Source unavailable'});
  }
}
