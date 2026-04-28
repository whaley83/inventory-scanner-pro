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

  app.use(express.json({ limit: '10mb' }));
  app.use(express.urlencoded({ limit: '10mb', extended: true }));
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
      console.log(`Fetching permissions from Apps Script: ${targetUrl}`);
      
      const response = await fetch(targetUrl, {
        redirect: 'follow'
      } as any);
      const contentType = response.headers.get('content-type');
      let text = '';
      try {
        text = await response.text();
      } catch (readError) {
        console.error('Error reading Apps Script response body:', readError);
      }
      
      console.log(`Apps Script response status: ${response.status}`);
      console.log(`Apps Script response content-type: ${contentType}`);

      if (!response.ok) {
        console.error(`Apps Script error response (${response.status}): ${text.substring(0, 1000)}`);
        return res.status(response.status).json({ 
          error: `Apps Script responded with ${response.status}`,
          details: text.substring(0, 500)
        });
      }

      try {
        const data = JSON.parse(text);
        if (data.stores) {
          console.log('Stores received from Apps Script:', Array.isArray(data.stores) ? data.stores.length : 'not an array');
        }
        res.json(data);
      } catch (parseError) {
        console.error('Failed to parse Apps Script response as JSON:', parseError);
        console.error('Raw response text (first 500 chars):', text.substring(0, 500));
        
        // If it's HTML, it's likely a login page or error page from Google
        if (text.trim().startsWith('<!DOCTYPE') || text.trim().startsWith('<html')) {
          console.error('Apps Script returned HTML instead of JSON. Ensure "Who has access" is set to "Anyone".');
          return res.status(500).json({ 
            error: 'Apps Script returned HTML. Ensure "Who has access" is set to "Anyone" and script is deployed.',
            isHtml: true,
            htmlSnippet: text.substring(0, 200)
          });
        }
        
        res.status(500).json({ error: 'Apps Script returned invalid JSON', details: text.substring(0, 200) });
      }
    } catch (error) {
      logError('Failed to fetch permissions from Apps Script', error);
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
          'https://www.googleapis.com/auth/drive.file',
          'https://www.googleapis.com/auth/drive.readonly',
          'https://www.googleapis.com/auth/userinfo.profile',
          'https://www.googleapis.com/auth/userinfo.email'
        ],
        prompt: 'consent'
      });
      res.json({ url });
    } catch (error) {
      logError('Failed to generate auth URL', error);
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
      logError('OAuth callback error', error);
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
  const extractSpreadsheetId = (idOrUrl: string): string => {
    if (!idOrUrl) return '';
    const match = idOrUrl.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
    return match ? match[1] : idOrUrl;
  };

  const fetchProductsInternal = async (spreadsheetId: string, authClient: any) => {
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
        range: `'${targetSheetName}'!A2:J`,
      });

      const rows = response.data.values || [];
      return rows.map(row => ({
        category: row[0] || '',
        name: row[1] || '',
        variantName: row[2] || '',
        sku: row[4] || '',
        barcode: row[5] || '',
      }));
    } catch (error) {
      console.error('Internal Fetch Products Error:', error);
      return [];
    }
  };

  const getAuthClient = (req: express.Request) => {
    const tokensCookie = req.cookies.google_tokens;
    if (tokensCookie && tokensCookie !== 'undefined' && tokensCookie !== 'null') {
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
    const apiKey = process.env.SHEETS_API_KEY || process.env.VITE_SHEETS_API_KEY;
    if (apiKey && 
        apiKey.trim() !== '' && 
        apiKey !== 'undefined' && 
        apiKey !== 'null' && 
        !apiKey.includes('TODO_') && 
        !apiKey.includes('YOUR_')) {
      return apiKey.trim();
    }

    return null;
  };

  const logError = (prefix: string, error: any) => {
    // Handle simple string errors
    if (typeof error === 'string') {
      const isHtml = error.includes('<!DOCTYPE') || error.includes('<html');
      console.error(`[${prefix}] String Error:`, error.substring(0, 1000));
      if (isHtml) {
        console.error('Hint: Apps Script returned HTML. This usually means the script is NOT published as "Anyone" or requires Google login.');
      }
      return;
    }

    // Handle Google API Response Errors
    if (error && error.response && error.response.data) {
      const gError = error.response.data.error || error.response.data;
      console.error(`[${prefix}] API Error Structure:`, JSON.stringify(gError, null, 2));

      const code = gError.code;
      const status = gError.status;
      const message = gError.message || '';

      // Check for ErrorInfo details
      const errorInfo = gError.details?.find((d: any) => d['@type']?.includes('ErrorInfo'));

      // If it's a known configuration error, log a concise warning instead of full blob
      if (errorInfo?.reason === 'API_KEY_INVALID' || code === 403 || code === 401 || code === 400) {
        console.warn(`[${prefix}] Configuration Issue: ${errorInfo?.reason || status || code} - ${message}`);
        return;
      }

      console.error(`[${prefix}] API Error Structure:`, JSON.stringify(gError, null, 2));

      // Friendly explanations for common status codes
      if (code === 403 || status === 'PERMISSION_DENIED') {
        console.error(`[${prefix}] ACCESS DENIED: Ensure you have granted permissions and the sheet belongs to the correct account.`);
      } else if (code === 401 || status === 'UNAUTHENTICATED') {
        console.error(`[${prefix}] SESSION EXPIRED: Please log out and log in again to refresh your Google token.`);
      } else if (code === 404 || status === 'NOT_FOUND') {
        console.error(`[${prefix}] NOT FOUND: The spreadsheet ID or sheet name might be incorrect.`);
      } else if (code === 400 || status === 'INVALID_ARGUMENT') {
        console.error(`[${prefix}] INVALID REQUEST: Potential range error or malformed Spreadsheet ID.`);
      } else if (code === 429) {
        console.error(`[${prefix}] RATE LIMIT: You are sending requests too fast. Please wait a moment.`);
      } else if (message) {
        console.error(`[${prefix}] Message: ${message}`);
      }
    } else if (error instanceof Error) {
      console.error(`[${prefix}] JS Error:`, error.message);
      if (error.stack) console.error(error.stack);
    } else {
      try {
        console.error(`[${prefix}] Unknown Object:`, JSON.stringify(error, null, 2));
      } catch (e) {
        console.error(`[${prefix}] Unknown Non-String:`, error);
      }
    }
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
      logError('Failed to post to Apps Script', error);
      res.status(500).json({ error: 'Failed to post to Apps Script' });
    }
  });

  app.get('/api/sheets/products', async (req, res) => {
    let { spreadsheetId } = req.query;
    if (!spreadsheetId || spreadsheetId === 'undefined' || spreadsheetId === 'null') {
      return res.json({ products: [] });
    }
    
    spreadsheetId = extractSpreadsheetId(spreadsheetId as string);

    const authClient = getAuthClient(req);
    
    // If no auth client, return empty instead of trying public fallback (which might error)
    if (!authClient) {
      return res.json({ products: [] });
    }

    try {
      const sheets = google.sheets({ version: 'v4', auth: authClient as any });

      const spreadsheet = await sheets.spreadsheets.get({
        spreadsheetId: spreadsheetId as string,
      });

      const sheetNames = spreadsheet.data.sheets?.map(s => s.properties?.title) || [];
      const targetSheetName = sheetNames.includes('Products') ? 'Products' : sheetNames[0];

      if (!targetSheetName) {
        return res.json({ products: [] });
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
    } catch (error: any) {
      // Gracefully return empty if spreadsheet is not accessible, rate limited, or ID is malformed
      const status = error?.response?.status;
      if (status === 400 || status === 403 || status === 429 || status === 404) {
        return res.json({ products: [] });
      }
      logError('Sheets API Error', error);
      return res.json({ products: [] });
    }
  });

  app.get('/api/sheets/records', async (req, res) => {
    let { spreadsheetId } = req.query;
    if (!spreadsheetId || spreadsheetId === 'undefined' || spreadsheetId === 'null') {
      return res.json({ records: [] });
    }

    spreadsheetId = extractSpreadsheetId(spreadsheetId as string);

    const authClient = getAuthClient(req);
    if (!authClient) return res.json({ records: [] });

    try {
      const sheets = google.sheets({ version: 'v4', auth: authClient as any });
      
      let spreadsheet;
      try {
        spreadsheet = await sheets.spreadsheets.get({
          spreadsheetId: spreadsheetId as string,
        });
      } catch (e: any) {
        const status = e.response?.status;
        if (status === 400 || status === 401 || status === 403 || status === 404 || status === 429) {
          return res.json({ records: [] });
        }
        throw e;
      }

      const sheetNames = spreadsheet.data.sheets?.map(s => s.properties?.title || '') || [];
      const scanSheets = sheetNames.filter(s => 
        (s.startsWith('Scan-') || s.startsWith('Receiving-') || s.startsWith('New-')) && 
        s !== 'Permissions'
      );
      
      if (scanSheets.length === 0) {
        return res.json({ records: [] });
      }

      const allRecords: any[] = [];

      for (const sheetName of scanSheets) {
        try {
          const response = await sheets.spreadsheets.values.get({
            spreadsheetId: spreadsheetId as string,
            range: `'${sheetName}'!A1:Q`, // Fetch including headers to detect structure
          });

          const allRows = response.data.values || [];
          if (allRows.length === 0) continue;

          const headers = allRows[0];
          const isNewStructure = headers[0] === 'Record ID';
          const rows = allRows.slice(1);

          const sheetRecords = rows
            .filter(row => row[1] || row[2]) // Ensure some product info exists
            .map((row, index) => {
              const isReceiving = sheetName.startsWith('Receiving-');
              
              // Mapping indices based on structure
              const idx = {
                id: isNewStructure ? 0 : -1,
                category: isNewStructure ? 1 : 0,
                productName: isNewStructure ? 2 : 1,
                variant: isNewStructure ? 3 : 2,
                description: isNewStructure ? 4 : 3,
                sku: isNewStructure ? 5 : 4,
                barcode: isNewStructure ? 7 : 7,
                origQty: isNewStructure ? 8 : 8,
                physQty: isNewStructure ? 9 : 9,
                unit: isNewStructure ? 10 : 10,
                variance: isNewStructure ? 11 : 11,
                vPercent: isNewStructure ? 12 : 12,
                timestamp: isNewStructure ? 13 : 13,
                user: isNewStructure ? 14 : 14,
                status: isNewStructure ? 15 : 15,
                auditor: isNewStructure ? 16 : 16
              };

              return {
                id: idx.id !== -1 && row[idx.id] ? row[idx.id] : `${sheetName}-${index}`, 
                category: row[idx.category] || '',
                productName: row[idx.productName] || '',
                variant: row[idx.variant] || '',
                description: row[idx.description] || '',
                sku: row[idx.sku] || '',
                barcode: row[idx.barcode] || '',
                originalQuantity: parseFloat(row[idx.origQty]) || 0,
                expectedQty: parseFloat(row[idx.origQty]) || 0,
                physicalQty: parseFloat(row[idx.physQty]) || 0,
                physicalCount: parseFloat(row[idx.physQty]) || 0,
                unitType: row[idx.unit] || 'Piece',
                variance: parseFloat(row[idx.variance]) || 0,
                variancePercentage: parseFloat(row[idx.vPercent]) || 0,
                timestamp: row[idx.timestamp] || new Date().toISOString(),
                user: row[idx.user] || 'Unknown',
                status: row[idx.status] || 'Pending',
                auditor: row[idx.auditor] || '',
                mode: isReceiving ? 'Receiving' : 'Stocktake',
                isNewProduct: sheetName.startsWith('New-'),
                sheetName: sheetName,
              };
            });
          
          allRecords.push(...sheetRecords);
        } catch (err) {
          logError(`Error fetching from sheet ${sheetName}`, err);
        }
      }

      // Sort by timestamp descending
      allRecords.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

      res.json({ records: allRecords });
    } catch (error) {
      logError('Fetch Records Error', error);
      res.json({ records: [] });
    }
  });

  app.post('/api/sheets/records', async (req, res) => {
    let { spreadsheetId, record } = req.body;
    if (!spreadsheetId || !record) return res.status(400).json({ error: 'Missing parameters' });

    spreadsheetId = extractSpreadsheetId(spreadsheetId as string);

    // Try to use Apps Script Web App if configured
    const scriptsUrl = process.env.VITE_SCRIPTS_URL || process.env.SCRIPTS_URL;
    if (scriptsUrl) {
      try {
        const payload = {
          id: record.id,
          spreadsheetId,
          category: record.category || '',
          productName: record.productName || '',
          variant: record.variant || '',
          description: record.description || '',
          sku: record.sku || '',
          barcode: record.barcode || '',
          originalQuantity: record.mode === 'Receiving' ? (record.expectedQty || 0) : (record.originalQuantity || 0),
          expectedQty: record.expectedQty || 0,
          physicalQty: record.physicalCount || 0,
          quantity: record.physicalCount || 0, // Backward compatibility for script
          physicalCount: record.physicalCount || 0,
          unitType: record.unitType || 'Piece',
          variance: parseFloat(String(record.variance || 0)),
          variancePercentage: record.variancePercentage !== undefined ? parseFloat(String(record.variancePercentage)) : (record.variancePercent !== undefined ? parseFloat(String(record.variancePercent)) / 100 : 0),
          timestamp: record.timestamp,
          user: record.user,
          userEmail: record.userEmail || record.user, // Ensure userEmail is sent as requested
          auditor: record.auditor || '',
          status: record.status,
          mode: record.mode, // Send mode to script
          isNewProduct: record.isNewProduct || false,
          sheetName: record.sheetName, // Send sheetName to script
          update: record.update, // Send update flag to script
          storeLocation: record.storeLocation || ''
        };

        const response = await fetch(scriptsUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          redirect: 'follow', // Use standard fetch property
          body: JSON.stringify(payload)
        } as any);

        const responseText = await response.text();
        
        if (response.ok) {
          try {
            const result = JSON.parse(responseText);
            return res.json(result);
          } catch (e) {
            // If it's valid OK but not JSON, it might be a redirect page or something else
            if (responseText.includes('<!DOCTYPE')) {
              console.error('Apps Script returned HTML instead of JSON. Check your deployment permissions.');
              return res.status(500).json({ 
                error: 'Apps Script returned HTML. Ensure "Who has access" is set to "Anyone".',
                details: responseText.substring(0, 200) 
              });
            }
            return res.json({ success: true, message: responseText });
          }
        }
        
        logError('Apps Script Error', responseText);
        return res.status(response.status).json({ 
          error: 'Apps Script returned error status', 
          details: responseText.substring(0, 500) 
        });
      } catch (error) {
        logError('Failed to send to Apps Script', error);
        return res.status(500).json({ error: 'Server failed to reach Apps Script' });
      }
    }

    res.status(401).json({ error: 'No authentication configured for writing. Please log in or set up SCRIPTS_URL.' });
  });

  app.delete('/api/sheets/records', async (req, res) => {
    const { spreadsheetId, id, sheetName } = req.body;
    if (!spreadsheetId || !id || !sheetName) {
      return res.status(400).json({ error: 'Missing required parameters' });
    }

    const authClient = getAuthClient(req);
    if (authClient && typeof authClient !== 'string') {
      try {
        const sheets = google.sheets({ version: 'v4', auth: authClient as any });
        
        // Find the row index
        const response = await sheets.spreadsheets.values.get({
          spreadsheetId,
          range: `'${sheetName}'!A:A`,
        });
        const rows = response.data.values || [];
        const rowIndex = rows.findIndex(row => row[0] === id);

        if (rowIndex !== -1) {
          // Delete the row using batchUpdate
          const spreadsheet = await sheets.spreadsheets.get({ spreadsheetId });
          const sheet = spreadsheet.data.sheets?.find(s => s.properties?.title === sheetName);
          const sheetId = sheet?.properties?.sheetId;

          if (sheetId !== undefined) {
            await sheets.spreadsheets.batchUpdate({
              spreadsheetId,
              requestBody: {
                requests: [{
                  deleteDimension: {
                    range: {
                      sheetId,
                      dimension: 'ROWS',
                      startIndex: rowIndex,
                      endIndex: rowIndex + 1
                    }
                  }
                }]
              }
            });
            return res.json({ success: true });
          }
        }
        return res.status(404).json({ error: 'Record not found' });
      } catch (error) {
        logError('Sheets API Error (Delete)', error);
        return res.status(500).json({ error: 'Failed to delete record' });
      }
    }
    res.status(401).json({ error: 'Unauthorized' });
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
