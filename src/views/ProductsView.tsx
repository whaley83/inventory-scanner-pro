import React, { useState } from 'react';
import { Product, BarcodeAlias } from '../types';
import { Search, Package, RefreshCw } from 'lucide-react';

interface Props {
  products: Product[];
  aliases: BarcodeAlias[];
  onSync?: () => void;
  isSyncing?: boolean;
  onStartAction?: (product: Product, mode: 'Stocktake' | 'Receiving') => void;
}

export function ProductsView({ products, aliases, onSync, isSyncing, onStartAction }: Props) {
  const [search, setSearch] = useState('');
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null);

  const filteredProducts = products.filter(p => 
    p.name.toLowerCase().includes(search.toLowerCase()) || 
    p.sku.toLowerCase().includes(search.toLowerCase()) ||
    p.barcode.includes(search) ||
    p.barcode1.includes(search) ||
    p.barcode2.includes(search) ||
    p.barcode3.includes(search)
  );

  const handleRowClick = (product: Product) => {
    if (onStartAction) {
      setSelectedProduct(product);
    }
  };

  const handleModeSelect = (mode: 'Stocktake' | 'Receiving') => {
    if (selectedProduct && onStartAction) {
      onStartAction(selectedProduct, mode);
      setSelectedProduct(null);
    }
  };

  return (
    <div className="flex flex-col h-full mx-auto w-full p-4 relative">
      <div className="mb-6 max-w-4xl mx-auto w-full">
        <div className="flex justify-between items-center mb-4">
          <h1 className="text-2xl font-bold text-gray-800">Product List Information</h1>
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
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {filteredProducts.map((product, index) => (
                <tr 
                  key={`${product.sku}-${product.barcode}-${index}`} 
                  className="hover:bg-gray-50 transition-colors cursor-pointer"
                  onClick={() => handleRowClick(product)}
                >
                  <td className="p-3 text-gray-600">{product.category}</td>
                  <td className="p-3 font-medium text-gray-900">{product.name}</td>
                  <td className="p-3 text-gray-600">{product.variantName}</td>
                  <td className="p-3 text-gray-500 truncate max-w-[250px]" title={product.description}>{product.description}</td>
                  <td className="p-3 font-mono text-xs text-gray-600">{product.sku}</td>
                  <td className="p-3 font-mono text-xs text-blue-600">{product.barcode}</td>
                  <td className="p-3 font-mono text-xs text-gray-500">{product.barcode1}</td>
                  <td className="p-3 font-mono text-xs text-gray-500">{product.barcode2}</td>
                  <td className="p-3 font-mono text-xs text-gray-500">{product.barcode3}</td>
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

      {/* Mode Selection Modal */}
      {selectedProduct && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="bg-white rounded-2xl shadow-2xl max-w-sm w-full p-6 animate-in zoom-in duration-200">
            <h3 className="text-xl font-bold text-gray-900 mb-2">Start Recording for:</h3>
            <p className="text-gray-600 mb-6">
              <span className="font-semibold text-blue-600">{selectedProduct.name}</span>
              <br />
              <span className="text-sm">{selectedProduct.variantName}</span>
            </p>
            
            <div className="grid grid-cols-2 gap-4">
              <button
                onClick={() => handleModeSelect('Stocktake')}
                className="flex flex-col items-center justify-center p-4 bg-blue-50 text-blue-700 rounded-xl hover:bg-blue-100 transition-colors font-bold border border-blue-100"
              >
                Stock Take
              </button>
              <button
                onClick={() => handleModeSelect('Receiving')}
                className="flex flex-col items-center justify-center p-4 bg-green-50 text-green-700 rounded-xl hover:bg-green-100 transition-colors font-bold border border-green-100"
              >
                Receiving
              </button>
            </div>
            
            <button
              onClick={() => setSelectedProduct(null)}
              className="w-full mt-6 py-3 text-gray-500 font-medium hover:text-gray-700 transition-colors"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
