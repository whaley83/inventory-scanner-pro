import React, { useState, useEffect } from 'react';
import { Settings, LogIn, LogOut, Save, CheckCircle2, AlertCircle, Database } from 'lucide-react';

export function SettingsView() {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [spreadsheetId, setSpreadsheetId] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState<{ type: 'success' | 'error', text: string } | null>(null);

  useEffect(() => {
    // Check auth status
    fetch('/api/auth/status')
      .then(res => res.json())
      .then(data => setIsAuthenticated(data.authenticated))
      .catch(err => console.error('Failed to fetch auth status', err));

    // Load saved spreadsheet ID or set default
    const defaultId = '1bbVxr0BqFlDra2OPSd4o8J8kamWpKi-leG2Ax6wCdPs';
    const savedId = localStorage.getItem('inv_spreadsheet_id');
    if (savedId) {
      setSpreadsheetId(savedId);
    } else {
      setSpreadsheetId(defaultId);
      localStorage.setItem('inv_spreadsheet_id', defaultId);
    }

    // Listen for OAuth success
    const handleMessage = (event: MessageEvent) => {
      if (event.data?.type === 'OAUTH_AUTH_SUCCESS') {
        setIsAuthenticated(true);
      }
    };
    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, []);

  const handleLogin = async () => {
    try {
      const response = await fetch('/api/auth/url');
      const data = await response.json();
      
      if (!response.ok || data.error) {
        alert(data.error || 'Failed to generate auth URL. Please check your configuration.');
        return;
      }

      const { url } = data;
      
      const authWindow = window.open(
        url,
        'oauth_popup',
        'width=600,height=700'
      );

      if (!authWindow) {
        alert('Please allow popups for this site to connect your Google account.');
      }
    } catch (error) {
      console.error('Login error:', error);
    }
  };

  const handleLogout = async () => {
    try {
      await fetch('/api/auth/logout', { method: 'POST' });
      setIsAuthenticated(false);
    } catch (error) {
      console.error('Logout error:', error);
    }
  };

  const handleSaveSettings = () => {
    setIsSaving(true);
    localStorage.setItem('inv_spreadsheet_id', spreadsheetId);
    
    setTimeout(() => {
      setIsSaving(false);
      setSaveMessage({ type: 'success', text: 'Settings saved successfully' });
      setTimeout(() => setSaveMessage(null), 3000);
    }, 500);
  };

  return (
    <div className="flex flex-col h-full max-w-md mx-auto w-full p-4">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-800 flex items-center gap-2">
          <Settings size={24} className="text-blue-600" />
          Settings & Sync
        </h1>
        <p className="text-gray-500 text-sm mt-1">Connect to Google Sheets for inventory data</p>
      </div>

      <div className="space-y-6">
        {/* Google Auth Section */}
        <div className="bg-white rounded-2xl p-5 shadow-sm border border-gray-100">
          <h2 className="text-lg font-semibold text-gray-800 mb-4 flex items-center gap-2">
            <Database size={20} className="text-gray-500" />
            Google Sheets Connection
          </h2>
          
          <div className="mb-4 p-3 bg-gray-50 border border-gray-200 rounded-lg text-sm">
            <p className="text-gray-600 mb-1 font-medium">Required OAuth Redirect URI:</p>
            <code className="block bg-white p-2 border border-gray-200 rounded text-xs break-all select-all">
              {window.location.origin}/auth/callback
            </code>
            <p className="text-xs text-gray-500 mt-2">Add this exact URL to your Google Cloud Console OAuth settings.</p>
          </div>

          {isAuthenticated ? (
            <div className="space-y-4">
              <div className="flex items-center gap-3 text-green-600 bg-green-50 p-3 rounded-xl border border-green-100">
                <CheckCircle2 size={20} />
                <span className="font-medium text-sm">Connected to Google (Admin)</span>
              </div>
              <button
                onClick={handleLogout}
                className="w-full py-3 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-xl font-medium flex items-center justify-center gap-2 transition-colors"
              >
                <LogOut size={18} />
                <span>Disconnect</span>
              </button>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="flex items-start gap-3 text-blue-600 bg-blue-50 p-3 rounded-xl border border-blue-100 text-sm">
                <Database size={20} className="shrink-0 mt-0.5" />
                <p>Connecting a Google account is optional for admins to manage sheets directly. Staff can sync and save using the Spreadsheet ID below.</p>
              </div>
              <button
                onClick={handleLogin}
                className="w-full py-3 bg-blue-600 hover:bg-blue-700 text-white rounded-xl font-medium flex items-center justify-center gap-2 transition-colors shadow-sm"
              >
                <LogIn size={18} />
                <span>Connect with Google (Admin)</span>
              </button>
            </div>
          )}
        </div>

        {/* Spreadsheet ID Section */}
        <div className="bg-white rounded-2xl p-5 shadow-sm border border-gray-100">
          <h2 className="text-lg font-semibold text-gray-800 mb-4">Spreadsheet Configuration</h2>
          
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Google Spreadsheet ID
              </label>
              <input
                type="text"
                value={spreadsheetId}
                onChange={(e) => setSpreadsheetId(e.target.value)}
                placeholder="e.g. 1BxiMVs0XRYFgwnAKB..."
                className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl focus:border-blue-500 focus:ring-1 focus:ring-blue-500 focus:bg-white transition-colors text-sm font-mono"
              />
              <p className="text-xs text-gray-500 mt-2">
                You can find the ID in the URL of your Google Sheet: <br/>
                <code className="bg-gray-100 px-1 py-0.5 rounded">docs.google.com/spreadsheets/d/<b>[ID]</b>/edit</code>
              </p>
            </div>

            <button
              onClick={handleSaveSettings}
              disabled={isSaving}
              className="w-full py-3 bg-gray-900 hover:bg-gray-800 text-white rounded-xl font-medium flex items-center justify-center gap-2 transition-colors disabled:opacity-70"
            >
              <Save size={18} />
              <span>{isSaving ? 'Saving...' : 'Save Settings'}</span>
            </button>

            {saveMessage && (
              <div className={`flex items-center gap-2 p-3 rounded-xl text-sm ${
                saveMessage.type === 'success' ? 'bg-green-50 text-green-700 border border-green-100' : 'bg-red-50 text-red-700 border border-red-100'
              }`}>
                {saveMessage.type === 'success' ? <CheckCircle2 size={18} /> : <AlertCircle size={18} />}
                {saveMessage.text}
              </div>
            )}
          </div>
        </div>
        
        <div className="bg-blue-50 rounded-2xl p-5 border border-blue-100 text-sm text-blue-800">
          <h3 className="font-semibold mb-2">Background Sync Configuration</h3>
          <p className="mb-2">To enable automatic background syncing without user login, ensure the following environment variables are set:</p>
          <ul className="list-disc pl-5 space-y-1">
            <li><b>SHEETS_API_KEY</b>: For reading products (Spreadsheet must be public).</li>
            <li><b>SCRIPTS_URL</b>: Google Apps Script Web App URL for saving records (Full automation).</li>
          </ul>
          <p className="mt-3 font-semibold">Google Apps Script Code (for SCRIPTS_URL):</p>
          <pre className="bg-gray-900 text-gray-100 p-3 rounded-xl text-[10px] mt-1 overflow-x-auto font-mono">
{`function doPost(e) {
  const data = JSON.parse(e.postData.contents);
  const ss = SpreadsheetApp.openById(data.spreadsheetId);
  const date = new Date(data.timestamp);
  const sheetName = date.getFullYear() + "-" + 
    String(date.getMonth() + 1).padStart(2, "0") + "-" + 
    String(date.getDate()).padStart(2, "0");
  
  let sheet = ss.getSheetByName(sheetName);
  if (!sheet) {
    sheet = ss.insertSheet(sheetName);
    sheet.appendRow(['Category', 'Product Name', 'Variant', 'Description', 'SKU', 'Barcode', 'Original Qty', 'Physical Qty', 'Unit Type', 'Variance', 'Variance %', 'Timestamp', 'User', 'Status']);
  }
  
  sheet.appendRow([
    data.category, data.productName, data.variant || "", data.description || "",
    data.sku, data.barcode, data.originalQuantity, data.quantity, data.unitType === "Piece" ? "pcs" : "case",
    data.variance, data.originalQuantity === 0 ? (data.variance > 0 ? "100%" : "0%") : (Math.round((data.variance / data.originalQuantity) * 1000) / 10) + "%",
    data.timestamp, data.user, data.status
  ]);
  
  return ContentService.createTextOutput("Success").setMimeType(ContentService.MimeType.TEXT);
}`}
          </pre>
          <p className="mt-3 font-semibold">Required Sheet Structure:</p>
          <ul className="list-disc pl-5 space-y-1 mt-1">
            <li><b>Products</b>: Category, Name, VariantName, Description, SKU, Barcode, Barcode1, Barcode2, Barcode3, Quantity</li>
            <li><b>[YYYY-MM-DD]</b>: Category, Product Name, Variant, Description, SKU, Barcode, Original Qty, Physical Qty, Unit Type, Variance, Variance %, Timestamp, User, Status</li>
          </ul>
        </div>
      </div>
    </div>
  );
}
