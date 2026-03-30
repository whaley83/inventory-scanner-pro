import { useState, useEffect } from 'react';
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
    let spreadsheetId = localStorage.getItem('inv_spreadsheet_id');
    if (!spreadsheetId) {
      spreadsheetId = defaultSpreadsheetId;
      localStorage.setItem('inv_spreadsheet_id', defaultSpreadsheetId);
    }

    try {
      setIsSyncing(true);
      const res = await fetch(`/api/sheets/products?spreadsheetId=${spreadsheetId}`);
      if (res.ok) {
        const data = await res.json();
        if (data.products && data.products.length > 0) {
          setProducts(data.products);
        }
      }
    } catch (error) {
      console.error('Failed to sync products from Google Sheets', error);
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

  // Fetch products from Google Sheets if connected
  useEffect(() => {
    fetchProducts();
  }, []);

  const addProduct = (product: Product) => setProducts(prev => [...prev, product]);
  const addAlias = (alias: BarcodeAlias) => setAliases(prev => [...prev, alias]);
  
  const addRecord = async (record: StocktakeRecord) => {
    // Add locally first for optimistic UI
    setRecords(prev => [record, ...prev]);

    // Try to save to Google Sheets
    let spreadsheetId = localStorage.getItem('inv_spreadsheet_id');
    if (!spreadsheetId) {
      spreadsheetId = defaultSpreadsheetId;
      localStorage.setItem('inv_spreadsheet_id', defaultSpreadsheetId);
    }
    
    if (spreadsheetId) {
      try {
        await fetch('/api/sheets/records', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ spreadsheetId, record })
        });
      } catch (error) {
        console.error('Failed to save record to Google Sheets', error);
      }
    }
  };

  const updateRecordStatus = (id: string, status: StocktakeRecord['status']) => {
    setRecords(prev => prev.map(r => r.id === id ? { ...r, status } : r));
  };

  const deleteRecord = (id: string) => {
    setRecords(prev => prev.filter(r => r.id !== id));
  };

  return {
    products,
    aliases,
    records,
    isSyncing,
    sync: fetchProducts,
    addProduct,
    addAlias,
    addRecord,
    updateRecordStatus,
    deleteRecord,
  };
}
