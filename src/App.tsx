/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from 'react';
import { ScanLine, PackageSearch, ClipboardCheck, Settings, Lock } from 'lucide-react';
import { useInventory } from './hooks/useInventory';
import { StocktakeView } from './views/StocktakeView';
import { ProductsView } from './views/ProductsView';
import { SignOffView } from './views/SignOffView';
import { SettingsView } from './views/SettingsView';

type Tab = 'SCAN' | 'PRODUCTS' | 'SIGNOFF' | 'SETTINGS';

const ADMIN_EMAIL = 'william@gvssgroup.com';

export default function App() {
  const [activeTab, setActiveTab] = useState<Tab>('SCAN');
  const [userEmail, setUserEmail] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const inventory = useInventory();

  useEffect(() => {
    fetch('/api/auth/user')
      .then(res => res.json())
      .then(data => {
        setUserEmail(data.email || null);
        setIsLoading(false);
      })
      .catch(err => {
        console.error('Failed to fetch user info', err);
        setIsLoading(false);
      });

    const handleMessage = (event: MessageEvent) => {
      if (event.data?.type === 'OAUTH_AUTH_SUCCESS') {
        window.location.reload();
      }
    };
    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, []);

  const isAdmin = userEmail === ADMIN_EMAIL;

  if (isLoading) {
    return (
      <div className="h-screen flex items-center justify-center bg-gray-50">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-screen bg-gray-50 font-sans">
      {/* Header */}
      <header className="bg-white border-b border-gray-200 px-4 py-3 flex items-center justify-between sticky top-0 z-10">
        <div className="flex items-center space-x-2 text-blue-600">
          <ScanLine size={24} />
          <h1 className="text-xl font-bold text-gray-900 tracking-tight">Inventory<span className="text-blue-600">Pro</span></h1>
        </div>
        {userEmail && (
          <div className="flex items-center gap-2">
            <span className="text-[10px] bg-gray-100 px-2 py-1 rounded-full text-gray-500 font-medium truncate max-w-[120px]">
              {userEmail}
            </span>
          </div>
        )}
      </header>

      {/* Main Content Area */}
      <main className="flex-1 overflow-hidden relative">
        {activeTab === 'SCAN' && (
          <StocktakeView 
            products={inventory.products} 
            aliases={inventory.aliases} 
            addProduct={inventory.addProduct}
            addAlias={inventory.addAlias}
            addRecord={inventory.addRecord}
          />
        )}
        {activeTab === 'PRODUCTS' && (
          <ProductsView 
            products={inventory.products} 
            aliases={inventory.aliases} 
            onSync={inventory.sync}
            isSyncing={inventory.isSyncing}
          />
        )}
        {activeTab === 'SIGNOFF' && (
          <SignOffView 
            records={inventory.records} 
            products={inventory.products}
            updateRecordStatus={inventory.updateRecordStatus}
            deleteRecord={inventory.deleteRecord}
          />
        )}
        {activeTab === 'SETTINGS' && (
          isAdmin ? (
            <SettingsView />
          ) : (
            <div className="h-full flex flex-col items-center justify-center p-8 text-center">
              <Lock size={48} className="text-gray-300 mb-4" />
              <h2 className="text-xl font-bold text-gray-800 mb-2">Admin Access Required</h2>
              <p className="text-gray-500 max-w-xs mb-6">Only administrators can change spreadsheet configuration or OAuth settings.</p>
              {!userEmail ? (
                <button 
                  onClick={() => {
                    // Trigger login from SettingsView logic
                    fetch('/api/auth/url')
                      .then(res => res.json())
                      .then(data => {
                        if (data.url) {
                          const win = window.open(data.url, 'oauth_popup', 'width=600,height=700');
                          if (!win) alert('Please allow popups');
                        }
                      });
                  }}
                  className="bg-blue-600 text-white px-6 py-2 rounded-xl font-bold"
                >
                  Login with Google
                </button>
              ) : (
                <p className="text-sm text-red-500 font-medium">
                  Logged in as {userEmail}. <br/>
                  This account does not have admin privileges.
                </p>
              )}
            </div>
          )
        )}
      </main>

      {/* Bottom Navigation */}
      <nav className="bg-white border-t border-gray-200 pb-safe z-20">
        <div className="flex justify-around">
          <button
            onClick={() => setActiveTab('SCAN')}
            className={`flex flex-col items-center py-3 px-4 flex-1 transition-colors ${
              activeTab === 'SCAN' ? 'text-blue-600' : 'text-gray-500 hover:text-gray-900'
            }`}
          >
            <ScanLine size={24} className="mb-1" />
            <span className="text-xs font-medium">Scan</span>
          </button>
          <button
            onClick={() => setActiveTab('PRODUCTS')}
            className={`flex flex-col items-center py-3 px-4 flex-1 transition-colors ${
              activeTab === 'PRODUCTS' ? 'text-blue-600' : 'text-gray-500 hover:text-gray-900'
            }`}
          >
            <PackageSearch size={24} className="mb-1" />
            <span className="text-xs font-medium">Products</span>
          </button>
          
          {/* Admin Only Tabs */}
          <button
            onClick={() => setActiveTab('SIGNOFF')}
            className={`flex flex-col items-center py-3 px-4 flex-1 transition-colors ${
              activeTab === 'SIGNOFF' ? 'text-blue-600' : 'text-gray-500 hover:text-gray-900'
            }`}
          >
            <div className="relative">
              <ClipboardCheck size={24} className="mb-1" />
              {inventory.records.filter(r => r.status === 'Pending' && r.variance !== 0).length > 0 && (
                <span className="absolute -top-1 -right-2 w-3 h-3 bg-red-500 rounded-full border-2 border-white"></span>
              )}
            </div>
            <span className="text-xs font-medium">Sign-Off</span>
          </button>
          
          <button
            onClick={() => setActiveTab('SETTINGS')}
            className={`flex flex-col items-center py-3 px-4 flex-1 transition-colors ${
              activeTab === 'SETTINGS' ? 'text-blue-600' : 'text-gray-500 hover:text-gray-900'
            }`}
          >
            <div className="relative">
              <Settings size={24} className="mb-1" />
              {!isAdmin && <Lock size={12} className="absolute -top-1 -right-2 text-gray-400" />}
            </div>
            <span className="text-xs font-medium">Settings</span>
          </button>
        </div>
      </nav>
    </div>
  );
}
