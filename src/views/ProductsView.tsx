import React, { useState } from 'react';
import { Product, BarcodeAlias } from '../types';
import { Search, Package, RefreshCw } from 'lucide-react';

interface Props {
  products: Product[];
  aliases: BarcodeAlias[];
  onSync?: () => void;
  isSyncing?: boolean;
}

export function ProductsView({ products, aliases, onSync, isSyncing }: Props) {
  const [search, setSearch] = useState('');

  const filteredProducts = products.filter(p => 
    p.name.toLowerCase().includes(search.toLowerCase()) || 
    p.sku.toLowerCase().includes(search.toLowerCase()) ||
    p.barcode.includes(search) ||
    p.barcode1.includes(search) ||
    p.barcode2.includes(search) ||
    p.barcode3.includes(search)
  );

  return (
    <div className="flex flex-col h-full mx-auto w-full p-4">
      <div className="mb-6 max-w-4xl mx-auto w-full">
        <div className="flex justify-between items-center mb-4">
          <h1 className="text-2xl font-bold text-gray-800">Product List Information</h1>
          {onSync && (
            <button
              onClick={onSync}
              disabled={isSyncing}
              className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50"
            >
              <RefreshCw size={18} className={isSyncing ? 'animate-spin' : ''} />
              <span>{isSyncing ? 'Syncing...' : 'Sync Now'}</span>
            </button>
          )}
        </div>
        <div className="relative">
          <input
            type="text"
            placeholder="Search products, SKUs, or barcodes..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-10 pr-4 py-3 bg-white border border-gray-200 rounded-xl focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
          />
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={20} />
        </div>
      </div>

      <div className="flex-1 overflow-auto pb-20">
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 min-w-max">
          <table className="w-full text-left border-collapse text-sm">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-200 text-gray-600">
                <th className="p-3 font-medium whitespace-nowrap">Category</th>
                <th className="p-3 font-medium whitespace-nowrap">Product Name</th>
                <th className="p-3 font-medium whitespace-nowrap">Variant</th>
                <th className="p-3 font-medium min-w-[200px]">Description</th>
                <th className="p-3 font-medium whitespace-nowrap">SKU</th>
                <th className="p-3 font-medium whitespace-nowrap">Barcode</th>
                <th className="p-3 font-medium whitespace-nowrap">Barcode 1</th>
                <th className="p-3 font-medium whitespace-nowrap">Barcode 2</th>
                <th className="p-3 font-medium whitespace-nowrap">Barcode 3</th>
                <th className="p-3 font-medium whitespace-nowrap text-right">Quantity</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {filteredProducts.map((product, index) => (
                <tr key={`${product.sku}-${product.barcode}-${index}`} className="hover:bg-gray-50 transition-colors">
                  <td className="p-3 text-gray-600">{product.category}</td>
                  <td className="p-3 font-medium text-gray-900">{product.name}</td>
                  <td className="p-3 text-gray-600">{product.variantName}</td>
                  <td className="p-3 text-gray-500 truncate max-w-[250px]" title={product.description}>{product.description}</td>
                  <td className="p-3 font-mono text-xs text-gray-600">{product.sku}</td>
                  <td className="p-3 font-mono text-xs text-blue-600">{product.barcode}</td>
                  <td className="p-3 font-mono text-xs text-gray-500">{product.barcode1}</td>
                  <td className="p-3 font-mono text-xs text-gray-500">{product.barcode2}</td>
                  <td className="p-3 font-mono text-xs text-gray-500">{product.barcode3}</td>
                  <td className="p-3 font-semibold text-right text-gray-900">{product.quantity}</td>
                </tr>
              ))}
            </tbody>
          </table>
          
          {filteredProducts.length === 0 && (
            <div className="text-center py-16 text-gray-500 w-full">
              <Package size={48} className="mx-auto mb-4 text-gray-300" />
              <p>No products found matching "{search}"</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
