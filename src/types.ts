export interface Product {
  name: string;
  category: string;
  description: string;
  variantName: string;
  sku: string;
  barcode: string;
  barcode1: string;
  barcode2: string;
  barcode3: string;
  quantity: number;
}

export interface BarcodeAlias {
  barcode: string;
  sku: string;
}

export type AccessLevel = 'Scan Only' | 'Sign-Off Access' | 'Admin';

export interface User {
  email: string;
  accessLevel: AccessLevel;
}

export interface StocktakeRecord {
  id: string;
  sku: string;
  category?: string;
  productName?: string;
  variant?: string;
  description?: string;
  barcode?: string;
  barcodeScanned: string;
  quantity: number;
  originalQuantity: number;
  physicalQty: number;
  physicalCount: number;
  unitType: 'Piece' | 'Box';
  variance: number;
  variancePercent?: number;
  variancePercentage?: number;
  timestamp: string;
  user: string; // Scanner email
  auditor?: string; // Sign-off user email
  status: 'Pending' | 'Approved' | 'Declined';
  mode?: 'Stocktake' | 'Receiving';
  isNewProduct?: boolean;
  sheetName?: string;
  storeLocation?: string;
}
