import { useState, useEffect } from 'react';
import { toast } from 'sonner';
import { Product, BarcodeAlias, StocktakeRecord } from '../types';

const INITIAL_PRODUCTS: Product[] = [
  { 
    name: 'Blue T-Shirt', 
    category: 'Apparel', 
    description: 'Basic cotton t-shirt',
    variantName: 'Small',
    sku: 'TSH-BLU-S', 
    barcode: '123456',
    barcode1: '123457',
    barcode2: '',
    barcode3: '',
    quantity: 50 
  },
];

const INITIAL_ALIASES: BarcodeAlias[] = [
  { barcode: '123456', sku: 'TSH-BLU-S' },
  { barcode: '123457', sku: 'TSH-BLU-S' },
];

export function useInventory() {
  const defaultSpreadsheetId = '1bbVxr0BqFlDra2OPSd4o8J8kamWpKi-leG2Ax6wCdPs';
  
  const [products, setProducts] = useState<Product[]>(() => {
    const saved = localStorage.getItem('inv_products');
    return saved ? JSON.parse(saved) : INITIAL_PRODUCTS;
  });

  const [aliases, setAliases] = useState<BarcodeAlias[]>(() => {
    const saved = localStorage.getItem('inv_aliases');
    return saved ? JSON.parse(saved) : INITIAL_ALIASES;
  });

  const [records, setRecords] = useState<StocktakeRecord[]>(() => {
    const saved = localStorage.getItem('inv_records');
    return saved ? JSON.parse(saved) : [];
  });

  const [isSyncing, setIsSyncing] = useState(false);

  const fetchProducts = async () => {
    let spreadsheetId = import.meta.env.VITE_GOOGLE_SHEET_ID;
    if (!spreadsheetId || spreadsheetId === 'undefined' || spreadsheetId === 'null') {
      spreadsheetId = defaultSpreadsheetId;
    }
    
    const apiKey = import.meta.env.VITE_SHEETS_API_KEY;
    
    if (!spreadsheetId || !apiKey || apiKey === 'undefined' || apiKey === 'null') {
      console.warn('Missing VITE_GOOGLE_SHEET_ID or VITE_SHEETS_API_KEY');
      return;
    }

    try {
      setIsSyncing(true);
      // Use the official Google Sheets API directly from client if possible, 
      // or keep using the server proxy but pass the VITE_ variables.
      // The prompt says "Use VITE_SCRIPTS_URL, VITE_SHEETS_API_KEY, and VITE_GOOGLE_SHEET_ID for all data calls."
      // Let's use the server proxy but ensure it's configured.
      const res = await fetch(`/api/sheets/products?spreadsheetId=${spreadsheetId}`);
      if (res.ok) {
        const data = await res.json();
        if (data.products && data.products.length > 0) {
          setProducts(data.products);
        }
      } else {
        const errorData = await res.json();
        toast.error(`Products Sync Failed: ${errorData.error || 'Unknown error'}`);
      }
    } catch (error) {
      console.error('Failed to sync products from Google Sheets', error);
    } finally {
      setIsSyncing(false);
    }
  };

  const fetchRecords = async () => {
    let spreadsheetId = import.meta.env.VITE_GOOGLE_SHEET_ID;
    if (!spreadsheetId || spreadsheetId === 'undefined' || spreadsheetId === 'null') {
      spreadsheetId = defaultSpreadsheetId;
    }
    
    if (!spreadsheetId) return;

    try {
      setIsSyncing(true);
      const res = await fetch(`/api/sheets/records?spreadsheetId=${spreadsheetId}`);
      if (res.ok) {
        const data = await res.json();
        if (data.records) {
      // Map to match StocktakeRecord interface if necessary
      const mappedRecords: StocktakeRecord[] = data.records.map((r: any) => {
        // If variancePercentage is a decimal (e.g. 1.0 for 100%), multiply by 100
        let vPercent = r.variancePercentage || 0;
        if (Math.abs(vPercent) <= 2 && vPercent !== 0) {
          vPercent = vPercent * 100;
        }
        
        return {
          ...r,
          quantity: r.originalQuantity, // Ensure field name matches
          originalQuantity: r.originalQuantity,
          expectedQuantity: r.expectedQuantity || r.originalQuantity, // Fallback to originalQuantity if not set
          physicalQty: r.physicalQty || r.physicalCount, // Ensure field name matches
          variancePercent: Math.round(vPercent)
        };
      });
          setRecords(mappedRecords);
        }
      } else {
        const errorData = await res.json();
        toast.error(`Records Fetch Failed: ${errorData.error || 'Unknown error'}`);
      }
    } catch (error) {
      console.error('Failed to fetch records from Google Sheets', error);
    } finally {
      setIsSyncing(false);
    }
  };

  useEffect(() => {
    localStorage.setItem('inv_products', JSON.stringify(products));
  }, [products]);

  useEffect(() => {
    localStorage.setItem('inv_aliases', JSON.stringify(aliases));
  }, [aliases]);

  useEffect(() => {
    localStorage.setItem('inv_records', JSON.stringify(records));
  }, [records]);

  // Fetch products and records from Google Sheets if connected
  useEffect(() => {
    fetchProducts();
    fetchRecords();
  }, []);

  const addProduct = (product: Product) => setProducts(prev => [...prev, product]);
  const addAlias = (alias: BarcodeAlias) => setAliases(prev => [...prev, alias]);
  
  const addRecord = (record: StocktakeRecord) => {
    // Add locally only - we will sync manually later
    setRecords(prev => [record, ...prev]);
  };

  const syncAllRecords = async (auditorEmail: string) => {
    const recordsToSync = records.filter(r => r.status !== 'Pending');
    if (recordsToSync.length === 0) {
      toast.info('No approved or declined records to sync.');
      return true;
    }
    
    setIsSyncing(true);
    const spreadsheetId = import.meta.env.VITE_GOOGLE_SHEET_ID;
    const syncedIds: string[] = [];
    
    try {
      // Send each record to the server one by one
      for (const record of recordsToSync) {
        // Use the sheetName from the record if it exists, otherwise calculate it
        const sheetName = record.sheetName || (() => {
          const scanDate = new Date(record.timestamp);
          const dateStr = `${scanDate.getFullYear()}-${String(scanDate.getMonth() + 1).padStart(2, '0')}-${String(scanDate.getDate()).padStart(2, '0')}`;
          
          let prefix = 'Scan-';
          if (record.isNewProduct) {
            prefix = 'New-';
          } else if (record.mode === 'Receiving') {
            prefix = 'Receiving-';
          }
          
          return `${prefix}${dateStr}`;
        })();

        const res = await fetch('/api/sheets/records', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ 
            spreadsheetId, 
            record: { 
              id: record.id,
              category: record.category || '',
              productName: record.productName || '',
              sku: record.sku || '',
              variant: record.variant || '',
              description: record.description || '',
              barcode: record.barcode || '',
              barcodeScanned: record.barcodeScanned || '',
              originalQuantity: record.originalQuantity || 0,
              expectedQuantity: record.expectedQuantity || 0,
              physicalQty: record.physicalQty || 0,
              physicalCount: record.physicalCount || 0,
              unitType: record.unitType || 'Piece',
              variance: record.variance || 0,
              variancePercentage: record.variancePercentage || 0,
              timestamp: record.timestamp,
              user: record.user, // Scanner email
              userEmail: record.user, // Ensure original scanner email is sent as userEmail
              auditor: record.auditor || auditorEmail, // Logged in user is the auditor
              status: record.status,
              mode: record.mode,
              isNewProduct: record.isNewProduct,
              storeLocation: record.storeLocation || '',
              sheetName, 
              update: true 
            } 
          })
        });
        
        if (res.ok) {
          syncedIds.push(record.id);
        } else {
          throw new Error('Failed to sync one or more records');
        }
      }
      
      // Remove successfully synced items from the local list
      setRecords(prev => prev.filter(r => !syncedIds.includes(r.id)));
      return true;
    } catch (error) {
      console.error('Failed to sync records to Google Sheets', error);
      // Even on error, remove the ones that DID succeed
      if (syncedIds.length > 0) {
        setRecords(prev => prev.filter(r => !syncedIds.includes(r.id)));
      }
      return false;
    } finally {
      setIsSyncing(false);
    }
  };

  const saveRecordToScript = async (record: StocktakeRecord) => {
    try {
      const res = await fetch('/api/scripts/post', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...record,
          category: record.category || '',
          productName: record.productName || '',
          variant: record.variant || '',
          storeLocation: record.storeLocation || '',
          userEmail: record.user // Explicitly include userEmail as requested
        })
      });
      if (res.ok) {
        toast.success('Data Synced to Cloud');
        return true;
      }
      return false;
    } catch (error) {
      console.error('Failed to sync record to script', error);
      return false;
    }
  };

  const updateRecordStatus = async (id: string, status: StocktakeRecord['status'], auditor?: string) => {
    setRecords(prev => prev.map(r => r.id === id ? { ...r, status, auditor: auditor || r.auditor } : r));
    
    // If the record is already in Google Sheets, update it immediately
    const record = records.find(r => r.id === id);
    if (record && record.sheetName) {
      const spreadsheetId = import.meta.env.VITE_GOOGLE_SHEET_ID;
      try {
        await fetch('/api/sheets/records', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            spreadsheetId,
            record: {
              ...record,
              status,
              auditor: auditor || record.auditor,
              update: true
            }
          })
        });
        toast.success(`Record ${status}`);
      } catch (error) {
        console.error('Failed to update record status on server', error);
        toast.error('Failed to update record in Google Sheets');
      }
    }
  };

  const deleteRecord = async (id: string) => {
    const record = records.find(r => r.id === id);
    setRecords(prev => prev.filter(r => r.id !== id));
    
    // If the record is already in Google Sheets, delete it there too
    if (record && record.sheetName) {
      const spreadsheetId = import.meta.env.VITE_GOOGLE_SHEET_ID;
      try {
        const res = await fetch('/api/sheets/records', {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            spreadsheetId,
            id,
            sheetName: record.sheetName
          })
        });
        if (res.ok) {
          toast.success('Record deleted from Google Sheets');
        } else {
          toast.error('Failed to delete record from Google Sheets');
        }
      } catch (error) {
        console.error('Failed to delete record from server', error);
        toast.error('Error deleting record from Google Sheets');
      }
    }
  };

  return {
    products,
    aliases,
    records,
    isSyncing,
    sync: async () => {
      // Force Refresh: Clear local cache
      localStorage.removeItem('inv_products');
      localStorage.removeItem('inv_aliases');
      localStorage.removeItem('inv_records');
      
      await fetchProducts();
      await fetchRecords();
    },
    syncAllRecords,
    saveRecordToScript,
    addProduct,
    addAlias,
    addRecord,
    updateRecordStatus,
    deleteRecord,
  };
}
