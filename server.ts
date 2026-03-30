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
  const requireAuth = (req: express.Request, res: express.Response, next: express.NextFunction) => {
    const tokensCookie = req.cookies.google_tokens;
    if (!tokensCookie) {
      return res.status(401).json({ error: 'Not authenticated' });
    }
    try {
      (req as any).tokens = JSON.parse(tokensCookie);
      next();
    } catch (e) {
      res.status(401).json({ error: 'Invalid tokens' });
    }
  };

  app.get('/api/sheets/products', requireAuth, async (req, res) => {
    const { spreadsheetId } = req.query;
    if (!spreadsheetId) return res.status(400).json({ error: 'Spreadsheet ID required' });

    try {
      const oauth2Client = getOAuthClient();
      oauth2Client.setCredentials((req as any).tokens);
      const sheets = google.sheets({ version: 'v4', auth: oauth2Client });

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

      res.json({ products });
    } catch (error) {
      console.error('Sheets API Error:', error);
      res.status(500).json({ error: 'Failed to fetch products from Google Sheets' });
    }
  });

  app.post('/api/sheets/records', requireAuth, async (req, res) => {
    const { spreadsheetId, record } = req.body;
    if (!spreadsheetId || !record) return res.status(400).json({ error: 'Missing parameters' });

    try {
      const oauth2Client = getOAuthClient();
      oauth2Client.setCredentials((req as any).tokens);
      const sheets = google.sheets({ version: 'v4', auth: oauth2Client });

      // Create a sheet name based on the date of the scan (YYYY-MM-DD)
      const scanDate = new Date(record.timestamp);
      // Format as YYYY-MM-DD using local time or UTC. Let's use the local date string format.
      const sheetName = `${scanDate.getFullYear()}-${String(scanDate.getMonth() + 1).padStart(2, '0')}-${String(scanDate.getDate()).padStart(2, '0')}`;

      // Check if the date-specific sheet exists
      const spreadsheet = await sheets.spreadsheets.get({ spreadsheetId });
      const sheetExists = spreadsheet.data.sheets?.some(s => s.properties?.title === sheetName);

      if (!sheetExists) {
        // Create the new date sheet
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

        // Add headers to the new sheet
        await sheets.spreadsheets.values.append({
          spreadsheetId,
          range: `'${sheetName}'!A1:L1`,
          valueInputOption: 'USER_ENTERED',
          requestBody: {
            values: [
              ['ID', 'SKU', 'Variant', 'BarcodeScanned', 'Quantity', 'PhysicalQty', 'Unit Type', 'Variance', 'Variance %', 'Timestamp', 'User', 'Status']
            ]
          }
        });
      }

      await sheets.spreadsheets.values.append({
        spreadsheetId,
        range: `'${sheetName}'!A:L`,
        valueInputOption: 'USER_ENTERED',
        requestBody: {
          values: [
            [
              record.id,
              record.sku,
              record.variantName || '',
              record.barcodeScanned,
              record.quantity,
              record.physicalQty,
              record.unitType === 'Piece' ? 'pcs' : 'case',
              record.variance,
              record.variancePercent !== undefined ? `${record.variancePercent}%` : '',
              record.timestamp,
              record.user,
              record.status
            ]
          ]
        }
      });

      res.json({ success: true });
    } catch (error) {
      console.error('Sheets API Error:', error);
      res.status(500).json({ error: 'Failed to save record to Google Sheets' });
    }
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
