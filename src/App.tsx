import React, { useState } from 'react';
import { ScanLine, PackageSearch, ClipboardCheck, Settings, Lock, LogOut } from 'lucide-react';
import { Toaster, toast } from 'sonner';
import { useInventory } from './hooks/useInventory';
import { StocktakeView } from './views/StocktakeView';
import { ProductsView } from './views/ProductsView';
import { SignOffView } from './views/SignOffView';
import { SettingsView } from './views/SettingsView';
import { User, AccessLevel } from './types';

type Tab = 'SCAN' | 'PRODUCTS' | 'SIGNOFF' | 'SETTINGS';

export default function App() {
  const [activeTab, setActiveTab] = useState<Tab>('SCAN');
  const [user, setUser] = useState<User | null>(() => {
    const saved = localStorage.getItem('inv_user');
    return saved ? JSON.parse(saved) : null;
  });
  const [loginEmail, setLoginEmail] = useState('');
  const [isLoggingIn, setIsLoggingIn] = useState(false);
  const [loginError, setLoginError] = useState<string | null>(null);
  
  const inventory = useInventory();

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!loginEmail.trim()) return;

    setIsLoggingIn(true);
    setLoginError(null);

    const scriptsUrl = import.meta.env.VITE_SCRIPTS_URL;
    if (!scriptsUrl) {
      setLoginError('Access Denied: Email not authorized.');
      setIsLoggingIn(false);
      return;
    }

    const normalizedLoginEmail = loginEmail.trim().toLowerCase();

    // Hardcoded Admin Bypass for testing
    if (normalizedLoginEmail === 'william@gvssgroup.com') {
      const adminUser: User = {
        email: 'william@gvssgroup.com',
        accessLevel: 'Admin'
      };
      setUser(adminUser);
      localStorage.setItem('inv_user', JSON.stringify(adminUser));
      setActiveTab('SCAN');
      setIsLoggingIn(false);
      return;
    }

    try {
      // Fetch permissions from server-side proxy
      // We fetch all permissions to perform a case-insensitive search locally
      const res = await fetch(`/api/auth/permissions`);
      if (res.ok) {
        try {
          const data = await res.json();
          
          let foundUser = null;
          
          // Handle { users: [], stores: [] } or just an array
          const usersList = Array.isArray(data) ? data : (data.users || []);
          
          if (Array.isArray(usersList)) {
            foundUser = usersList.find((u: any) => {
              const email = typeof u === 'string' ? u : u?.email;
              return email && typeof email === 'string' && email.trim().toLowerCase() === normalizedLoginEmail;
            });
            
            if (foundUser && typeof foundUser === 'string') {
              foundUser = { email: foundUser, accessLevel: 'Scan Only' };
            }
          }

          if (foundUser && foundUser.accessLevel) {
            const rawAccessLevel = String(foundUser.accessLevel).trim().toLowerCase();
            let mappedAccessLevel: AccessLevel | null = null;

            if (rawAccessLevel === 'admin') {
              mappedAccessLevel = 'Admin';
            } else if (rawAccessLevel.includes('scan')) {
              mappedAccessLevel = 'Scan Only';
            } else if (rawAccessLevel.includes('sign') || rawAccessLevel.includes('off')) {
              mappedAccessLevel = 'Sign-Off Access';
            }

            if (mappedAccessLevel) {
              const newUser: User = {
                email: foundUser.email || loginEmail,
                accessLevel: mappedAccessLevel
              };
              setUser(newUser);
              localStorage.setItem('inv_user', JSON.stringify(newUser));
              
              // Set initial tab based on access level
              if (newUser.accessLevel === 'Scan Only') {
                setActiveTab('SCAN');
              } else if (newUser.accessLevel === 'Sign-Off Access') {
                setActiveTab('SIGNOFF');
              } else {
                setActiveTab('SCAN');
              }
            } else {
              setLoginError('Access Denied: Email not authorized.');
            }
          } else {
            setLoginError('Access Denied: Email not authorized.');
          }
        } catch (parseError) {
          console.error('Failed to parse server response as JSON:', parseError);
          setLoginError('Access Denied: Email not authorized.');
        }
      } else {
        setLoginError('Access Denied: Email not authorized.');
      }
    } catch (error) {
      console.error('Login error:', error);
      setLoginError('Access Denied: Email not authorized.');
    } finally {
      setIsLoggingIn(false);
    }
  };

  const handleLogout = () => {
    setUser(null);
    localStorage.removeItem('inv_user');
    localStorage.removeItem('inv_stocktake_completed');
  };

  if (!user) {
    return (
      <div className="h-screen flex items-center justify-center bg-gray-50 p-4">
        <div className="bg-white p-8 rounded-2xl shadow-xl max-w-md w-full border border-gray-100">
          <div className="flex flex-col items-center mb-8">
            <div className="bg-blue-600 p-4 rounded-2xl text-white mb-4 shadow-lg shadow-blue-200">
              <ScanLine size={40} />
            </div>
            <h1 className="text-3xl font-bold text-gray-900 tracking-tight">Inventory<span className="text-blue-600">Pro</span></h1>
            <p className="text-gray-500 mt-2">Enter your email to access the system</p>
          </div>

          <form onSubmit={handleLogin} className="space-y-6">
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-2">Email Address</label>
              <input
                type="email"
                required
                value={loginEmail}
                onChange={(e) => setLoginEmail(e.target.value)}
                placeholder="staff@example.com"
                className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl focus:border-blue-500 focus:ring-2 focus:ring-blue-200 transition-all outline-none"
              />
            </div>

            {loginError && (
              <div className="p-3 bg-red-50 text-red-600 text-sm rounded-lg font-medium border border-red-100">
                {loginError}
              </div>
            )}

            <button
              type="submit"
              disabled={isLoggingIn}
              className="w-full py-4 bg-blue-600 hover:bg-blue-700 text-white rounded-xl font-bold text-lg shadow-lg shadow-blue-100 transition-all active:scale-[0.98] disabled:opacity-70"
            >
              {isLoggingIn ? 'Checking access...' : 'Access System'}
            </button>
          </form>
        </div>
      </div>
    );
  }

  const accessLevel = user.accessLevel;
  const canScan = accessLevel === 'Scan Only' || accessLevel === 'Admin' || accessLevel === 'Sign-Off Access';
  const canSignOff = accessLevel === 'Sign-Off Access' || accessLevel === 'Admin';
  const canSettings = accessLevel === 'Admin';

  return (
    <div className="flex flex-col h-screen bg-gray-50 font-sans">
      <Toaster position="top-center" richColors />
      {/* Header */}
      <header className="bg-white border-b border-gray-200 px-4 py-3 flex items-center justify-between sticky top-0 z-10">
        <div className="flex items-center space-x-2 text-blue-600">
          <ScanLine size={24} />
          <h1 className="text-xl font-bold text-gray-900 tracking-tight">Inventory<span className="text-blue-600">Pro</span></h1>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex flex-col items-end">
            <span className="text-[10px] bg-blue-50 px-2 py-0.5 rounded-full text-blue-600 font-bold uppercase tracking-wider">
              {accessLevel}
            </span>
            <span className="text-[11px] text-gray-500 font-medium truncate max-w-[150px]">
              {user.email}
            </span>
          </div>
          <button 
            onClick={handleLogout}
            className="p-2 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
            title="Logout"
          >
            <LogOut size={20} />
          </button>
        </div>
      </header>

      {/* Main Content Area */}
      <main className="flex-1 overflow-hidden relative">
        {activeTab === 'SCAN' && canScan && (
          <StocktakeView 
            products={inventory.products} 
            aliases={inventory.aliases} 
            addProduct={inventory.addProduct}
            addAlias={inventory.addAlias}
            addRecord={inventory.addRecord}
            saveRecordToScript={inventory.saveRecordToScript}
            isSyncing={inventory.isSyncing}
            userEmail={user.email}
            accessLevel={accessLevel}
          />
        )}
        {activeTab === 'PRODUCTS' && (
          <ProductsView 
            products={inventory.products} 
            aliases={inventory.aliases} 
          />
        )}
        {activeTab === 'SIGNOFF' && canSignOff && (
          <SignOffView 
            records={inventory.records} 
            products={inventory.products}
            updateRecordStatus={inventory.updateRecordStatus}
            deleteRecord={inventory.deleteRecord}
            onSyncAll={() => inventory.syncAllRecords(user.email)}
            onSyncProducts={inventory.sync}
            isSyncing={inventory.isSyncing}
            userEmail={user.email}
          />
        )}
        {activeTab === 'SETTINGS' && canSettings && (
          <SettingsView />
        )}
        
        {/* Fallback for unauthorized tabs */}
        {((activeTab === 'SIGNOFF' && !canSignOff) || (activeTab === 'SETTINGS' && !canSettings)) && (
          <div className="h-full flex flex-col items-center justify-center p-8 text-center">
            <Lock size={48} className="text-gray-300 mb-4" />
            <h2 className="text-xl font-bold text-gray-800 mb-2">Access Restricted</h2>
            <p className="text-gray-500 max-w-xs">Your current access level ({accessLevel}) does not allow viewing this section.</p>
          </div>
        )}
      </main>

      {/* Bottom Navigation */}
      <nav className="bg-white border-t border-gray-200 pb-safe z-20">
        <div className="flex justify-around">
          {canScan && (
            <button
              onClick={() => setActiveTab('SCAN')}
              className={`flex flex-col items-center py-3 px-4 flex-1 transition-colors ${
                activeTab === 'SCAN' ? 'text-blue-600' : 'text-gray-500 hover:text-gray-900'
              }`}
            >
              <ScanLine size={24} className="mb-1" />
              <span className="text-xs font-medium">Scan</span>
            </button>
          )}
          
          <button
            onClick={() => setActiveTab('PRODUCTS')}
            className={`flex flex-col items-center py-3 px-4 flex-1 transition-colors ${
              activeTab === 'PRODUCTS' ? 'text-blue-600' : 'text-gray-500 hover:text-gray-900'
            }`}
          >
            <PackageSearch size={24} className="mb-1" />
            <span className="text-xs font-medium">Products</span>
          </button>
          
          {canSignOff && (
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
          )}
          
          {canSettings && (
            <button
              onClick={() => setActiveTab('SETTINGS')}
              className={`flex flex-col items-center py-3 px-4 flex-1 transition-colors ${
                activeTab === 'SETTINGS' ? 'text-blue-600' : 'text-gray-500 hover:text-gray-900'
              }`}
            >
              <Settings size={24} className="mb-1" />
              <span className="text-xs font-medium">Settings</span>
            </button>
          )}
        </div>
      </nav>
    </div>
  );
}
