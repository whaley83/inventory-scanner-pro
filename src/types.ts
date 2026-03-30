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

export interface StocktakeRecord {
  id: string;
  sku: string;
  variantName?: string;
  barcodeScanned: string;
  quantity: number;
  physicalQty: number;
  unitType: 'Piece' | 'Box';
  variance: number;
  variancePercent?: number;
  timestamp: string;
  user: string;
  status: 'Pending' | 'Approved' | 'Rejected';
}
