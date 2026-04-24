import React, { useState } from 'react';
import { StocktakeRecord, Product } from '../types';
import { Check, X, FileSpreadsheet, Trash2, AlertTriangle, RefreshCw, MapPin } from 'lucide-react';
import { toast } from 'sonner';

interface Props {
  records: StocktakeRecord[];
  products: Product[];
  updateRecordStatus: (id: string, status: StocktakeRecord['status'], auditor?: string) => void;
  deleteRecord: (id: string) => void;
  onSyncAll?: () => Promise<boolean>;
  onSyncProducts?: () => void;
  isSyncing?: boolean;
  userEmail: string | null;
}

export function SignOffView({ records, products, updateRecordStatus, deleteRecord, onSyncAll, onSyncProducts, isSyncing, userEmail }: Props) {
  const [filter, setFilter] = useState<'ALL' | 'VARIANCE' | 'PENDING'>('PENDING');
  const [recordToDelete, setRecordToDelete] = useState<string | null>(null);

  const filteredRecords = records.filter(r => {
    if (filter === 'VARIANCE') return r.variance !== 0;
    if (filter === 'PENDING') return r.status === 'Pending';
    return true;
  });

  const getProductName = (sku: string) => {
    const product = products.find(p => p.sku === sku);
    return product?.name || 'Unknown Product';
  };

  const getProductVariant = (sku: string) => {
    return products.find(p => p.sku === sku)?.variantName || '';
  };

  const formatDate = (isoString: string) => {
    if (!isoString) return 'Just Now';
    const d = new Date(isoString);
    if (isNaN(d.getTime())) return 'Just Now';
    return d.toLocaleString();
  };

  const confirmDelete = () => {
    if (recordToDelete) {
      deleteRecord(recordToDelete);
      setRecordToDelete(null);
    }
  };

  return (
    <div className="flex flex-col min-h-[600px] mx-auto w-full p-4 relative pb-32">
      {/* Delete Confirmation Modal */}
      {recordToDelete && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-xl max-w-sm w-full p-6 animate-in fade-in zoom-in duration-200">
            <div className="flex items-center justify-center w-12 h-12 rounded-full bg-red-100 mb-4 mx-auto">
              <AlertTriangle className="h-6 w-6 text-red-600" />
            </div>
            <h3 className="text-lg font-bold text-center text-gray-900 mb-2">Delete Record</h3>
            <p className="text-sm text-center text-gray-500 mb-6">
              Are you sure you want to delete this stocktake record? This action cannot be undone.
            </p>
            <div className="flex space-x-3">
              <button
                onClick={() => setRecordToDelete(null)}
                className="flex-1 px-4 py-2 bg-gray-100 text-gray-700 rounded-lg font-medium hover:bg-gray-200 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={confirmDelete}
                className="flex-1 px-4 py-2 bg-red-600 text-white rounded-lg font-medium hover:bg-red-700 transition-colors"
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="flex flex-col sm:flex-row sm:items-center justify-between mb-6 gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-800">GM Sign-Off</h1>
          <p className="text-gray-500 text-sm">Review and approve stocktake variances</p>
        </div>
        
        <div className="flex items-center gap-2">
          {onSyncProducts && (
            <button
              onClick={onSyncProducts}
              disabled={isSyncing}
              className="p-2 text-blue-600 hover:bg-blue-50 rounded-lg transition-colors border border-blue-100 flex items-center gap-2 text-sm font-medium"
              title="Refresh Data"
            >
              <RefreshCw size={18} className={isSyncing ? 'animate-spin' : ''} />
              <span className="hidden sm:inline">Refresh Data</span>
            </button>
          )}
          
          <div className="flex bg-gray-100 p-1 rounded-lg">
            <button
              onClick={() => setFilter('VARIANCE')}
              className={`px-4 py-2 text-sm font-medium rounded-md transition-colors ${filter === 'VARIANCE' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}
            >
              Has Variance
            </button>
            <button
              onClick={() => setFilter('PENDING')}
              className={`px-4 py-2 text-sm font-medium rounded-md transition-colors ${filter === 'PENDING' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}
            >
              Pending
            </button>
            <button
              onClick={() => setFilter('ALL')}
              className={`px-4 py-2 text-sm font-medium rounded-md transition-colors ${filter === 'ALL' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}
            >
              All Scans
            </button>
          </div>
        </div>
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-gray-200 flex-1 flex flex-col">
        <div className="overflow-x-auto overflow-y-auto">
          <table className="w-full text-left border-collapse min-w-[1000px]">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-200 text-sm text-gray-600">
                <th className="p-4 font-medium whitespace-nowrap">Category</th>
                <th className="p-4 font-medium whitespace-nowrap">Store</th>
                <th className="p-4 font-medium whitespace-nowrap">Product</th>
                <th className="p-4 font-medium whitespace-nowrap">Orig / Expected Qty</th>
                <th className="p-4 font-medium whitespace-nowrap">Physical / Received</th>
                <th className="p-4 font-medium whitespace-nowrap">Variance</th>
                <th className="p-4 font-medium whitespace-nowrap">Time / User</th>
                <th className="p-4 font-medium text-right whitespace-nowrap">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {filteredRecords.map((record, index) => (
                <tr key={`${record.id}-${index}`} className="hover:bg-gray-50 transition-colors">
                  <td className="p-4 whitespace-nowrap">
                    <span className="px-2 py-1 text-[10px] font-medium bg-gray-100 text-gray-600 rounded uppercase tracking-wider">
                      {record.category || 'Uncategorized'}
                    </span>
                  </td>
                  <td className="p-4 whitespace-nowrap">
                    <div className="flex items-center gap-1 text-xs font-medium text-gray-700">
                      <MapPin size={12} className="text-gray-400" />
                      {record.storeLocation || '-'}
                    </div>
                  </td>
                  <td className="p-4 whitespace-nowrap">
                    <div className="flex items-center gap-2">
                      <div className="font-medium text-gray-900">
                        {record.productName || getProductName(record.sku)}
                      </div>
                      {record.isNewProduct && (
                        <span className="bg-amber-100 text-amber-700 text-[10px] px-1.5 py-0.5 rounded font-bold uppercase tracking-wider">NEW</span>
                      )}
                      {record.mode === 'Receiving' ? (
                        <span className="bg-green-100 text-green-700 text-[10px] px-1.5 py-0.5 rounded font-bold uppercase tracking-wider">RCV</span>
                      ) : (
                        <span className="bg-blue-100 text-blue-700 text-[10px] px-1.5 py-0.5 rounded font-bold uppercase tracking-wider">STake</span>
                      )}
                    </div>
                  </td>
                  <td className="p-4 whitespace-nowrap text-gray-600">
                    {record.mode === 'Receiving' ? (
                      record.expectedQuantity || record.originalQuantity || 0
                    ) : (
                      record.originalQuantity
                    )}
                  </td>
                  <td className="p-4 whitespace-nowrap font-semibold">{record.physicalQty}</td>
                  <td className="p-4 whitespace-nowrap">
                    <div className="flex flex-col gap-1">
                      {record.mode !== 'Receiving' ? (
                        <span className={`inline-flex items-center w-fit px-2.5 py-0.5 rounded-full text-xs font-medium ${
                          record.variance === 0 ? 'bg-gray-100 text-gray-800' :
                          record.variance > 0 ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'
                        }`}>
                          {record.variance > 0 ? '+' : ''}{record.variance}
                        </span>
                      ) : null}
                      
                      {((record.variancePercentage !== undefined) || (record.variance !== 0)) && (
                        <span className={`text-xs font-medium ${
                          (record.variancePercentage || 0) >= 0 ? 'text-green-600' : 'text-red-600'
                        }`}>
                          {(record.variancePercentage || 0) >= 0 ? '+' : ''}
                          {((record.variancePercentage !== undefined ? record.variancePercentage : (record.variancePercent || 0) / 100) * 100).toFixed(0)}%
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="p-4 whitespace-nowrap text-sm text-gray-500">
                    <div>{formatDate(record.timestamp)}</div>
                    <div className="text-xs flex items-center gap-1 mt-1">
                      <span className="text-gray-400 font-medium uppercase text-[9px]">Scanner:</span>
                      <span className="truncate max-w-[120px]">{record.user || userEmail || 'Unknown User'}</span>
                    </div>
                  </td>
                  <td className="p-4 text-right whitespace-nowrap">
                    <div className="flex justify-end items-center space-x-2">
                      {record.status === 'Pending' ? (
                        <>
                          <button
                            onClick={() => updateRecordStatus(record.id, 'Approved', userEmail || undefined)}
                            className="p-2 text-green-600 hover:bg-green-50 rounded-lg transition-colors border border-green-200 min-w-[44px] flex items-center justify-center"
                            title="Approve"
                          >
                            <Check size={36} />
                          </button>
                          <button
                            onClick={() => updateRecordStatus(record.id, 'Declined', userEmail || undefined)}
                            className="p-2 text-red-600 hover:bg-red-50 rounded-lg transition-colors border border-red-200 min-w-[44px] flex items-center justify-center"
                            title="Decline"
                          >
                            <X size={36} />
                          </button>
                        </>
                      ) : (
                        <span className={`inline-flex items-center px-2.5 py-1 rounded-md text-xs font-medium ${
                          record.status === 'Approved' ? 'bg-green-50 text-green-700 border border-green-200' : 'bg-red-50 text-red-700 border border-red-200'
                        }`}>
                          {record.status}
                        </span>
                      )}
                      <button
                        onClick={() => setRecordToDelete(record.id)}
                        className="p-2 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors border border-transparent hover:border-red-200 ml-2 min-w-[44px] flex items-center justify-center"
                        title="Delete"
                      >
                        <Trash2 size={36} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          
          {filteredRecords.length === 0 && (
            <div className="text-center py-16 text-gray-500">
              <FileSpreadsheet size={48} className="mx-auto mb-4 text-gray-300" />
              <p>No records found for the current filter.</p>
            </div>
          )}
        </div>
      </div>

      {records.some(r => r.status === 'Pending') && (
        <div className="mt-6">
          <button
            onClick={async () => {
              if (onSyncAll) {
                const success = await onSyncAll();
                if (success) {
                  toast.success('Record Updated in Google Sheets');
                } else {
                  toast.error('Failed to update records in Google Sheets');
                }
              }
            }}
            disabled={isSyncing}
            className="w-full py-4 bg-blue-600 hover:bg-blue-700 text-white rounded-2xl font-bold text-lg flex items-center justify-center gap-3 shadow-lg shadow-blue-100 transition-all active:scale-95 disabled:opacity-50"
          >
            <RefreshCw size={24} className={isSyncing ? 'animate-spin' : ''} />
            <span>{isSyncing ? 'Syncing to Google Sheets...' : 'Sync to Google Sheet'}</span>
          </button>
        </div>
      )}
    </div>
  );
}
