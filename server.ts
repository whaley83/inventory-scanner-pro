import express from 'express';
import { createServer as createViteServer } from 'vite';
import { google } from 'googleapis';
import cookieParser from 'cookie-parser';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config();

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json());
  app.use(cookieParser());

  // Request logger
  app.use((req, res, next) => {
    console.log(`${new Date().toISOString()} - ${req.method} ${req.url}`);
    next();
  });

  // OAuth setup
  const getRedirectUri = () => {
    const baseUrl = (process.env.APP_URL || 'http://localhost:3000').replace(/\/$/, '');
    return `${baseUrl}/auth/callback`;
  };

  const getOAuthClient = () => {
    return new google.auth.OAuth2({
      clientId: process.env.GOOGLE_CLIENT_ID || '',
      clientSecret: process.env.GOOGLE_CLIENT_SECRET || '',
      redirectUri: getRedirectUri()
    });
  };

  // API Routes
  app.get('/api/health', (req, res) => {
    res.json({ status: 'ok' });
  });

  app.get('/api/auth/permissions', async (req, res) => {
    const { email } = req.query;
    console.log(`Checking permissions for email: ${email || 'ALL'}`);
    
    const scriptsUrl = process.env.VITE_SCRIPTS_URL || process.env.SCRIPTS_URL;
    if (!scriptsUrl) {
      console.error('SCRIPTS_URL not configured in environment');
      return res.status(500).json({ error: 'Scripts URL not configured' });
    }

    try {
      const targetUrl = email 
        ? `${scriptsUrl}?email=${encodeURIComponent(email as string)}`
        : scriptsUrl;
      console.log(`Fetching from Apps Script: ${targetUrl}`);
      
      const response = await fetch(targetUrl);
      const contentType = response.headers.get('content-type');
      const text = await response.text();
      
      console.log(`Apps Script response status: ${response.status}`);
      console.log(`Apps Script response content-type: ${contentType}`);

      if (!response.ok) {
        console.error(`Apps Script error response: ${text}`);
        return res.status(response.status).json({ error: `Apps Script responded with ${response.status}` });
      }

      try {
        const data = JSON.parse(text);
        res.json(data);
      } catch (parseError) {
        console.error('Failed to parse Apps Script response as JSON:', parseError);
        console.error('Raw response text:', text.substring(0, 500) + (text.length > 500 ? '...' : ''));
        
        // If it's HTML, it's likely a login page or error page from Google
        if (text.trim().startsWith('<!DOCTYPE') || text.trim().startsWith('<html')) {
          return res.status(500).json({ 
            error: 'Apps Script returned an HTML page instead of JSON. This usually means the script is not published as "Anyone" or requires a Google login.',
            isHtml: true
          });
        }
        
        res.status(500).json({ error: 'Apps Script returned invalid JSON' });
      }
    } catch (error) {
      console.error('Failed to fetch permissions from Apps Script:', error);
      res.status(500).json({ error: 'Failed to fetch permissions' });
    }
  });

  app.get('/api/auth/url', (req, res) => {
    try {
      if (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET) {
        return res.status(500).json({ 
          error: 'Missing Google OAuth credentials. Please set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in your environment variables.' 
        });
      }

      const oauth2Client = getOAuthClient();
      const url = oauth2Client.generateAuthUrl({
        access_type: 'offline',
        redirect_uri: getRedirectUri(),
        scope: [
          'https://www.googleapis.com/auth/spreadsheets',
          'https://www.googleapis.com/auth/userinfo.profile',
          'https://www.googleapis.com/auth/userinfo.email'
        ],
        prompt: 'consent'
      });
      res.json({ url });
    } catch (error) {
      console.error('Failed to generate auth URL:', error);
      res.status(500).json({ error: 'Failed to generate auth URL' });
    }
  });

  app.get(['/auth/callback', '/auth/callback/'], async (req, res) => {
    const { code } = req.query;
    if (!code) {
      return res.status(400).send('Missing authorization code');
    }

    try {
      const oauth2Client = getOAuthClient();
      const { tokens } = await oauth2Client.getToken(code as string);
      oauth2Client.setCredentials(tokens);

      // Fetch user info to get email
      const oauth2 = google.oauth2({ version: 'v2', auth: oauth2Client });
      const userInfo = await oauth2.userinfo.get();
      const email = userInfo.data.email;
      
      // Store tokens and email in cookie
      res.cookie('google_tokens', JSON.stringify({ ...tokens, email }), {
        secure: true,
        sameSite: 'none',
        httpOnly: true,
        maxAge: 30 * 24 * 60 * 60 * 1000 // 30 days
      });

      res.send(`
        <html>
          <body>
            <script>
              if (window.opener) {
                window.opener.postMessage({ type: 'OAUTH_AUTH_SUCCESS' }, '*');
                window.close();
              } else {
                window.location.href = '/';
              }
            </script>
            <p>Authentication successful. This window should close automatically.</p>
          </body>
        </html>
      `);
    } catch (error) {
      console.error('OAuth callback error:', error);
      res.status(500).send('Authentication failed');
    }
  });

  app.get('/api/auth/status', (req, res) => {
    const tokensCookie = req.cookies.google_tokens;
    res.json({ authenticated: !!tokensCookie });
  });

  app.get('/api/auth/user', (req, res) => {
    const tokensCookie = req.cookies.google_tokens;
    if (!tokensCookie) return res.json({ user: null });
    try {
      const data = JSON.parse(tokensCookie);
      res.json({ email: data.email });
    } catch (e) {
      res.json({ user: null });
    }
  });

  app.post('/api/auth/logout', (req, res) => {
    res.clearCookie('google_tokens', { secure: true, sameSite: 'none', httpOnly: true });
    res.json({ success: true });
  });

  // Middleware to check auth
  const getAuthClient = (req: express.Request) => {
    const tokensCookie = req.cookies.google_tokens;
    if (tokensCookie) {
      try {
        const tokens = JSON.parse(tokensCookie);
        const oauth2Client = getOAuthClient();
        oauth2Client.setCredentials(tokens);
        return oauth2Client;
      } catch (e) {
        console.error('Error parsing tokens cookie', e);
      }
    }

    // Fallback to API Key (only supports read)
    if (process.env.SHEETS_API_KEY) {
      return process.env.SHEETS_API_KEY;
    }

    return null;
  };

  app.post('/api/scripts/post', async (req, res) => {
    const scriptsUrl = process.env.VITE_SCRIPTS_URL || process.env.SCRIPTS_URL;
    if (!scriptsUrl) {
      return res.status(500).json({ error: 'Scripts URL not configured' });
    }

    try {
      const response = await fetch(scriptsUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(req.body)
      });
      if (!response.ok) {
        throw new Error(`Apps Script responded with ${response.status}`);
      }
      const data = await response.json();
      res.json(data);
    } catch (error) {
      console.error('Failed to post to Apps Script:', error);
      res.status(500).json({ error: 'Failed to post to Apps Script' });
    }
  });

  app.get('/api/sheets/products', async (req, res) => {
    const { spreadsheetId } = req.query;
    if (!spreadsheetId) return res.status(400).json({ error: 'Spreadsheet ID required' });

    const authClient = getAuthClient(req);
    
    // If we have an auth client (OAuth or API Key), use the official API
    if (authClient) {
      try {
        const sheets = google.sheets({ version: 'v4', auth: authClient as any });

        const spreadsheet = await sheets.spreadsheets.get({
          spreadsheetId: spreadsheetId as string,
        });

        const sheetNames = spreadsheet.data.sheets?.map(s => s.properties?.title) || [];
        const targetSheetName = sheetNames.includes('Products') ? 'Products' : sheetNames[0];

        if (!targetSheetName) {
          throw new Error('No sheets found in the document');
        }

        const response = await sheets.spreadsheets.values.get({
          spreadsheetId: spreadsheetId as string,
          range: `'${targetSheetName}'!A2:J`, // Adjust based on columns
        });

        const rows = response.data.values || [];
        const products = rows.map(row => ({
          category: row[0] || '',
          name: row[1] || '',
          variantName: row[2] || '',
          description: row[3] || '',
          sku: row[4] || '',
          barcode: row[5] || '',
          barcode1: row[6] || '',
          barcode2: row[7] || '',
          barcode3: row[8] || '',
          quantity: parseInt(row[9], 10) || 0,
        }));

        return res.json({ products });
      } catch (error) {
        console.error('Sheets API Error:', error);
        // Fallback to public fetch if official API fails
      }
    }

    // Fallback: Try to fetch public CSV if no auth or official API failed
    try {
      // We try to fetch the 'Products' sheet or the first sheet as CSV
      // Note: This requires the spreadsheet to be "Published to the web" or "Anyone with the link can view"
      const csvUrl = `https://docs.google.com/spreadsheets/d/${spreadsheetId}/gviz/tq?tqx=out:csv&sheet=Products`;
      const response = await fetch(csvUrl);
      
      if (!response.ok) {
        throw new Error('Failed to fetch public CSV');
      }

      const csvText = await response.text();
      // Simple CSV parser (assuming no complex quoting for now, or use a library if needed)
      // For this app, we'll do a basic split
      const rows = csvText.split('\n').map(line => {
        // Handle basic quoting: "val1","val2"
        return line.split(',').map(cell => cell.replace(/^"(.*)"$/, '$1'));
      });

      // Skip header row
      const products = rows.slice(1).filter(row => row.length >= 6).map(row => ({
        category: row[0] || '',
        name: row[1] || '',
        variantName: row[2] || '',
        description: row[3] || '',
        sku: row[4] || '',
        barcode: row[5] || '',
        barcode1: row[6] || '',
        barcode2: row[7] || '',
        barcode3: row[8] || '',
        quantity: parseInt(row[9], 10) || 0,
      }));

      res.json({ products });
    } catch (error) {
      console.error('Public Sync Error:', error);
      res.status(401).json({ error: 'No authentication configured and public sync failed. Please log in or provide a SHEETS_API_KEY.' });
    }
  });

  app.get('/api/sheets/records', async (req, res) => {
    const { spreadsheetId } = req.query;
    if (!spreadsheetId) return res.status(400).json({ error: 'Spreadsheet ID required' });

    const authClient = getAuthClient(req);
    if (!authClient) return res.status(401).json({ error: 'Authentication required' });

    try {
      const sheets = google.sheets({ version: 'v4', auth: authClient as any });
      const spreadsheet = await sheets.spreadsheets.get({
        spreadsheetId: spreadsheetId as string,
      });

      const sheetNames = spreadsheet.data.sheets?.map(s => s.properties?.title || '') || [];
      const scanSheets = sheetNames.filter(s => 
        (s.startsWith('Scan-') || s.startsWith('Receiving-') || s.startsWith('New-')) && 
        s !== 'Permissions'
      );
      
      if (scanSheets.length === 0) {
        return res.json({ records: [] });
      }

      let allRecords: any[] = [];

      for (const sheetName of scanSheets) {
        try {
          const response = await sheets.spreadsheets.values.get({
            spreadsheetId: spreadsheetId as string,
            range: `'${sheetName}'!A2:R`, // Fetch up to column R (18 columns)
          });

          const rows = response.data.values || [];
          const sheetRecords = rows
            .filter(row => row[1] && row[2]) // Ensure Category and Product Name exist
            .map((row, index) => {
              const isScanSheet = sheetName.startsWith('Scan-');
              const isReceivingOrNew = sheetName.startsWith('Receiving-') || sheetName.startsWith('New-');
              
              let originalQuantity = 0;
              let physicalQty = 0;
              let physicalCount = 0;
              let variance = 0;
              let variancePercentage = 0;
              let timestamp = '';
              let user = 'Unknown';
              let auditor = '';
              let status = 'Pending';
              let mode = sheetName.startsWith('Receiving-') ? 'Receiving' : (sheetName.startsWith('New-') ? 'Receiving' : 'Stocktake');
              let isNewProduct = sheetName.startsWith('New-');

              if (isScanSheet) {
                // For 'Scan-' sheets:
                // Quantity (Original): Index 6 (Col G)
                // Physical Count: Index 7 (Col H)
                // Variance: Index 9 (Col J)
                // Scanner: Index 11 (Col L)
                originalQuantity = parseFloat(row[6]) || 0;
                physicalQty = parseFloat(row[7]) || 0;
                physicalCount = parseFloat(row[7]) || 0;
                variance = parseFloat(row[9]) || 0;
                variancePercentage = parseFloat(row[8]) || 0; // Assuming 8 is percentage if 9 is variance
                timestamp = row[10] || new Date().toISOString(); // Assuming 10 is timestamp if 11 is scanner
                user = row[11] || 'Unknown';
                auditor = row[12] || '';
                status = row[13] || 'Pending';
                mode = row[14] || 'Stocktake';
                isNewProduct = row[15] === 'TRUE' || row[15] === 'true';
              } else if (isReceivingOrNew) {
                // For 'Receiving-' and 'New-' sheets:
                // Physical Count (Received): Index 6 (Col G)
                // Scanner: Index 8 (Col I)
                originalQuantity = 0;
                physicalQty = parseFloat(row[6]) || 0;
                physicalCount = parseFloat(row[6]) || 0;
                variance = 0;
                variancePercentage = 0;
                timestamp = row[7] || new Date().toISOString(); // Assuming 7 is timestamp if 8 is scanner
                user = row[8] || 'Unknown';
                auditor = row[9] || '';
                status = row[10] || 'Pending';
                mode = row[11] || 'Receiving';
                isNewProduct = row[12] === 'TRUE' || row[12] === 'true' || sheetName.startsWith('New-');
              } else {
                // Fallback
                originalQuantity = parseFloat(row[6]) || 0;
                physicalQty = parseFloat(row[7]) || 0;
                physicalCount = parseFloat(row[8]) || 0;
                variance = parseFloat(row[10]) || 0;
                timestamp = row[12] || new Date().toISOString();
                user = row[13] || 'Unknown';
                auditor = row[14] || '';
                status = row[15] || 'Pending';
              }

              return {
                id: row[0] || `${sheetName}-row-${index}`,
                category: row[1] || '',
                productName: row[2] || '',
                sku: row[3] || '',
                variant: row[4] || '',
                barcodeScanned: row[5] || '',
                originalQuantity,
                physicalQty,
                physicalCount,
                variance,
                variancePercentage,
                timestamp,
                user,
                auditor,
                status,
                mode,
                isNewProduct,
                sheetName: sheetName,
              };
            });
          
          allRecords = [...allRecords, ...sheetRecords];
        } catch (err) {
          console.error(`Error fetching from sheet ${sheetName}:`, err);
          // Continue to next sheet
        }
      }

      // Sort by timestamp descending
      allRecords.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

      res.json({ records: allRecords });
    } catch (error) {
      console.error('Fetch Records Error:', error);
      res.status(500).json({ error: 'Failed to fetch records from Google Sheets' });
    }
  });

  app.post('/api/sheets/records', async (req, res) => {
    const { spreadsheetId, record } = req.body;
    if (!spreadsheetId || !record) return res.status(400).json({ error: 'Missing parameters' });

    // Try to use Apps Script Web App if configured
    const scriptsUrl = process.env.VITE_SCRIPTS_URL || process.env.SCRIPTS_URL;
    if (scriptsUrl) {
      try {
        const payload = {
          spreadsheetId,
          category: record.category,
          productName: record.productName,
          variant: record.variant,
          description: record.description,
          sku: record.sku,
          barcode: record.barcode,
          originalQuantity: record.originalQuantity,
          physicalCount: record.physicalCount,
          unitType: record.unitType,
          variance: record.variance,
          variancePercentage: record.variancePercentage,
          timestamp: record.timestamp,
          user: record.user,
          userEmail: record.userEmail || record.user, // Ensure userEmail is sent as requested
          auditor: record.auditor,
          status: record.status,
          sheetName: record.sheetName, // Send sheetName to script
          update: record.update // Send update flag to script
        };

        const response = await fetch(scriptsUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });
        if (response.ok) {
          return res.json({ success: true });
        }
        console.error('Apps Script Error:', await response.text());
      } catch (error) {
        console.error('Failed to send to Apps Script:', error);
      }
    }

    // Fallback to OAuth if logged in
    const authClient = getAuthClient(req);
    if (authClient && typeof authClient !== 'string') {
      try {
        const sheets = google.sheets({ version: 'v4', auth: authClient as any });

        // Use the sheetName provided by the record, or calculate it
        const sheetName = record.sheetName || (() => {
          const scanDate = new Date(record.timestamp);
          const dateStr = `${scanDate.getFullYear()}-${String(scanDate.getMonth() + 1).padStart(2, '0')}-${String(scanDate.getDate()).padStart(2, '0')}`;
          let prefix = 'Scan-';
          if (record.isNewProduct) prefix = 'New-';
          else if (record.mode === 'Receiving') prefix = 'Receiving-';
          return `${prefix}${dateStr}`;
        })();

        // Check if the date-specific sheet exists
        const spreadsheet = await sheets.spreadsheets.get({ spreadsheetId });
        const sheetExists = spreadsheet.data.sheets?.some(s => s.properties?.title === sheetName);

        if (!sheetExists) {
          await sheets.spreadsheets.batchUpdate({
            spreadsheetId,
            requestBody: {
              requests: [{
                addSheet: {
                  properties: { title: sheetName }
                }
              }]
            }
          });

          await sheets.spreadsheets.values.append({
            spreadsheetId,
            range: `'${sheetName}'!A1:R1`,
            valueInputOption: 'USER_ENTERED',
            requestBody: {
              values: [
                ['ID', 'Category', 'Product Name', 'SKU', 'Variant', 'BarcodeScanned', 'Quantity', 'PhysicalQty', 'Physical Count', 'Unit Type', 'Variance', 'Variance %', 'Timestamp', 'User', 'Auditor', 'Status', 'Mode', 'Is New Product']
              ]
            }
          });
        }

        // If update flag is set, find the row by SKU or Barcode and update it
        if (record.update) {
          const response = await sheets.spreadsheets.values.get({
            spreadsheetId,
            range: `'${sheetName}'!A:R`,
          });
          const rows = response.data.values || [];
          
          // Find row by Product Name (column C, index 2), SKU (column D, index 3) or Barcode (column F, index 5)
          // Skip header row (index 0)
          const rowIndex = rows.findIndex((row, i) => 
            i > 0 && (row[2] === record.productName || row[3] === record.sku || row[5] === record.barcodeScanned)
          );

          if (rowIndex !== -1) {
            // Update existing row (rowIndex + 1 because Sheets is 1-indexed)
            const isScanSheet = sheetName.startsWith('Scan-');
            const isReceivingOrNew = sheetName.startsWith('Receiving-') || sheetName.startsWith('New-');
            
            let rowValues: any[] = [];
            if (isScanSheet) {
              rowValues = [
                record.id,
                record.category || '',
                record.productName || '',
                record.sku,
                record.variant || record.variantName || '',
                record.barcodeScanned,
                record.originalQuantity, // 6
                record.physicalQty || record.physicalCount, // 7
                record.variancePercentage, // 8
                record.variance, // 9
                record.timestamp, // 10
                record.userEmail || record.user, // 11
                record.auditor || '', // 12
                record.status, // 13
                record.mode || 'Stocktake', // 14
                record.isNewProduct ? 'TRUE' : 'FALSE' // 15
              ];
            } else if (isReceivingOrNew) {
              rowValues = [
                record.id,
                record.category || '',
                record.productName || '',
                record.sku,
                record.variant || record.variantName || '',
                record.barcodeScanned,
                record.physicalQty || record.physicalCount, // 6
                record.timestamp, // 7
                record.userEmail || record.user, // 8
                record.auditor || '', // 9
                record.status, // 10
                record.mode || 'Receiving', // 11
                record.isNewProduct ? 'TRUE' : 'FALSE' // 12
              ];
            } else {
              rowValues = [
                record.id,
                record.category || '',
                record.productName || '',
                record.sku,
                record.variant || record.variantName || '',
                record.barcodeScanned,
                record.originalQuantity,
                record.physicalQty || record.physicalCount,
                record.physicalCount,
                record.unitType === 'Piece' ? 'pcs' : 'case',
                record.variance,
                record.variancePercentage,
                record.timestamp,
                record.userEmail || record.user,
                record.auditor || '',
                record.status,
                record.mode || 'Stocktake',
                record.isNewProduct ? 'TRUE' : 'FALSE'
              ];
            }

            await sheets.spreadsheets.values.update({
              spreadsheetId,
              range: `'${sheetName}'!A${rowIndex + 1}:R${rowIndex + 1}`,
              valueInputOption: 'USER_ENTERED',
              requestBody: {
                values: [rowValues]
              }
            });
            return res.json({ success: true, updated: true });
          }
        }

        // Default: Append as new row
        const isScanSheet = sheetName.startsWith('Scan-');
        const isReceivingOrNew = sheetName.startsWith('Receiving-') || sheetName.startsWith('New-');
        
        let rowValues: any[] = [];
        if (isScanSheet) {
          rowValues = [
            record.id,
            record.category || '',
            record.productName || '',
            record.sku,
            record.variant || record.variantName || '',
            record.barcodeScanned,
            record.originalQuantity, // 6
            record.physicalQty || record.physicalCount, // 7
            record.variancePercentage, // 8
            record.variance, // 9
            record.timestamp, // 10
            record.userEmail || record.user, // 11
            record.auditor || '', // 12
            record.status, // 13
            record.mode || 'Stocktake', // 14
            record.isNewProduct ? 'TRUE' : 'FALSE' // 15
          ];
        } else if (isReceivingOrNew) {
          rowValues = [
            record.id,
            record.category || '',
            record.productName || '',
            record.sku,
            record.variant || record.variantName || '',
            record.barcodeScanned,
            record.physicalQty || record.physicalCount, // 6
            record.timestamp, // 7
            record.userEmail || record.user, // 8
            record.auditor || '', // 9
            record.status, // 10
            record.mode || 'Receiving', // 11
            record.isNewProduct ? 'TRUE' : 'FALSE' // 12
          ];
        } else {
          rowValues = [
            record.id,
            record.category || '',
            record.productName || '',
            record.sku,
            record.variant || record.variantName || '',
            record.barcodeScanned,
            record.originalQuantity,
            record.physicalQty || record.physicalCount,
            record.physicalCount,
            record.unitType === 'Piece' ? 'pcs' : 'case',
            record.variance,
            record.variancePercentage,
            record.timestamp,
            record.userEmail || record.user,
            record.auditor || '',
            record.status,
            record.mode || 'Stocktake',
            record.isNewProduct ? 'TRUE' : 'FALSE'
          ];
        }

        await sheets.spreadsheets.values.append({
          spreadsheetId,
          range: `'${sheetName}'!A:R`,
          valueInputOption: 'USER_ENTERED',
          requestBody: {
            values: [rowValues]
          }
        });

        return res.json({ success: true });
      } catch (error) {
        console.error('Sheets API Error:', error);
        return res.status(500).json({ error: 'Failed to save record to Google Sheets' });
      }
    }

    res.status(401).json({ error: 'No authentication configured for writing. Please log in or set up SCRIPTS_URL.' });
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
