/**
 * Google Apps Script for InventoryPro
 * 
 * Instructions:
 * 1. Open your Google Sheet.
 * 2. Extensions -> Apps Script.
 * 3. Replace all code with this script.
 * 4. Click 'Deploy' -> 'New Deployment'.
 * 5. Select 'Web App'.
 * 6. Execute as: 'Me'.
 * 7. Who has access: 'Anyone'.
 * 8. Copy the Web App URL and set it as VITE_SCRIPTS_URL in your environment.
 */

function doPost(e) {
  try {
    if (!e || !e.postData || !e.postData.contents) {
      return createJsonResponse({ success: false, error: "No post data received" });
    }

    const data = JSON.parse(e.postData.contents);
    const spreadsheetId = data.spreadsheetId;
    if (!spreadsheetId) {
      return createJsonResponse({ success: false, error: "Missing spreadsheetId" });
    }

    const ss = SpreadsheetApp.openById(spreadsheetId);
    
    // Determine the sheet name if not provided
    let sheetName = data.sheetName;
    if (!sheetName) {
      const scanDate = new Date();
      const dateStr = Utilities.formatDate(scanDate, "GMT+8", "yyyy-MM-dd");
      let prefix = 'Scan-';
      if (data.isNewProduct) {
        prefix = 'New-';
      } else if (data.mode === 'Receiving' || data.sheetName?.startsWith('Receiving-')) {
        prefix = 'Receiving-';
      }
      sheetName = prefix + dateStr;
    }
    
    let sheet = ss.getSheetByName(sheetName);
    const isReceiving = sheetName.startsWith('Receiving-');
    
    // Check if sheet exists and what structure it has
    let isNewStructure = true;
    if (sheet) {
      const firstCell = sheet.getRange(1, 1).getValue();
      if (firstCell !== "Record ID" && firstCell !== "") {
        isNewStructure = false;
      }
    } else {
      // If sheet doesn't exist, create it with headers
      sheet = ss.insertSheet(sheetName);
      const headers = [
        "Record ID",        // A (0)
        "Category",         // B (1)
        "Product Name",     // C (2)
        "Variant",          // D (3)
        "Description",      // E (4)
        "SKU",              // F (5)
        "Store Location",   // G (6)
        "Barcode",          // H (7)
        isReceiving ? "Expected Qty" : "Original Qty",      // I (8)
        isReceiving ? "Actual Received Qty" : "Physical Count", // J (9)
        "Unit Type",        // K (10)
        "Variance",         // L (11)
        "Variance %",       // M (12)
        "Timestamp",        // N (13)
        "User",             // O (14)
        "Status",           // P (15)
        "Auditor"           // Q (16)
      ];
      sheet.getRange(1, 1, 1, headers.length).setValues([headers]).setFontWeight("bold").setBackground("#f3f3f3");
      sheet.setFrozenRows(1);
      sheet.getRange("M2:M").setNumberFormat("0%");
    }

    const rowData = isNewStructure ? [
      data.id || "",            // A
      data.category || "",      // B
      data.productName || "",   // C
      data.variant || "",       // D
      data.description || "",   // E
      data.sku || "",           // F
      data.storeLocation || "", // G
      data.barcode || "",       // H
      data.mode === 'Receiving' ? (data.expectedQty || 0) : (data.originalQuantity || 0), // I
      data.physicalCount || 0,  // J
      data.unitType || "Piece",// K
      data.variance || 0,       // L
      data.variancePercentage || 0, // M
      data.timestamp || new Date().toISOString(), // N
      data.userEmail || data.user || "Unknown", // O
      data.status || "Pending", // P
      data.auditor || ""        // Q
    ] : [
      data.category || "",      // A
      data.productName || "",   // B
      data.variant || "",       // C
      data.description || "",   // D
      data.sku || "",           // E
      data.storeLocation || "", // F
      "",                       // G (Reserved)
      data.barcode || "",       // H
      data.mode === 'Receiving' ? (data.expectedQty || 0) : (data.originalQuantity || 0), // I
      data.physicalCount || 0,  // J
      data.unitType || "Piece",// K
      data.variance || 0,       // L
      data.variancePercentage || 0, // M
      data.timestamp || new Date().toISOString(), // N
      data.userEmail || data.user || "Unknown", // O
      data.status || "Pending", // P
      data.auditor || ""        // Q
    ];

    // Check if we should update or append
    if (data.update) {
      const records = sheet.getDataRange().getValues();
      let foundIndex = -1;
      
      const requestId = (data.id || "").toString().trim();
      const requestUser = (data.userEmail || data.user || "").toString().trim().toLowerCase();
      const requestProduct = (data.productName || "").toString().trim().toLowerCase();

      // Column offsets based on structure
      const colId = 0;
      const colUser = 14;
      const colProduct = isNewStructure ? 2 : 1;
      const colStatus = 15;
      const colAuditor = 16;

      for (let i = 1; i < records.length; i++) {
        const rowDataInSheet = records[i];
        
        // Match by ID if isNewStructure
        if (isNewStructure && requestId && rowDataInSheet[colId].toString().trim() === requestId) {
          foundIndex = i + 1;
          break;
        }

        const sheetUser = (rowDataInSheet[colUser] || "").toString().trim().toLowerCase();
        const sheetProduct = (rowDataInSheet[colProduct] || "").toString().trim().toLowerCase();
        const sheetBarcode = (rowDataInSheet[7] || "").toString().trim().toLowerCase();

        const matchesUser = sheetUser === requestUser;
        const matchesProduct = sheetProduct === requestProduct || (data.barcode && sheetBarcode === data.barcode.toString().trim().toLowerCase());
        
        if (matchesUser && matchesProduct) {
          if (rowDataInSheet[colStatus] === "Pending") {
            foundIndex = i + 1;
            break;
          }
          foundIndex = i + 1;
        }
      }

      if (foundIndex !== -1) {
        if (data.status === 'Approved' || data.status === 'Declined') {
          sheet.getRange(foundIndex, colStatus + 1).setValue(data.status); 
          sheet.getRange(foundIndex, colAuditor + 1).setValue(data.auditor || "");
        } else {
          sheet.getRange(foundIndex, 1, 1, rowData.length).setValues([rowData]);
        }
      } else {
        sheet.appendRow(rowData);
      }
    } else {
      sheet.appendRow(rowData);
    }

    return createJsonResponse({ success: true, sheetName: sheetName });
      
  } catch (err) {
    return createJsonResponse({ success: false, error: err.toString() });
  }
}

function createJsonResponse(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

function doGet(e) {
  // Simple check for permissions - list all users and stores
  try {
    const spreadsheetId = e.parameter.spreadsheetId || "YOUR_FALLBACK_ID";
    const ss = SpreadsheetApp.openById(spreadsheetId);
    
    // Get permissions from a sheet named 'Permissions'
    const permSheet = ss.getSheetByName("Permissions");
    let users = [];
    if (permSheet) {
      const data = permSheet.getDataRange().getValues();
      for (let i = 1; i < data.length; i++) {
        users.push({
          email: data[i][0],
          accessLevel: data[i][1] || "Scan Only"
        });
      }
    }

    // Get stores from a sheet named 'Stores'
    const storeSheet = ss.getSheetByName("Stores");
    let stores = [];
    if (storeSheet) {
      const data = storeSheet.getDataRange().getValues();
      for (let i = 1; i < data.length; i++) {
        if (data[i][0]) {
          stores.push(data[i][0]);
        }
      }
    }

    return ContentService.createTextOutput(JSON.stringify({ 
      users: users,
      stores: stores
    }))
      .setMimeType(ContentService.MimeType.JSON);
  } catch (err) {
    return ContentService.createTextOutput(JSON.stringify({ error: err.toString() }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}
