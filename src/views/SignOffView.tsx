import React, { useState } from 'react';
import { StocktakeRecord, Product } from '../types';
import { Check, X, FileSpreadsheet, Trash2, AlertTriangle } from 'lucide-react';

interface Props {
  records: StocktakeRecord[];
  products: Product[];
  updateRecordStatus: (id: string, status: StocktakeRecord['status']) => void;
  deleteRecord: (id: string) => void;
}

export function SignOffView({ records, products, updateRecordStatus, deleteRecord }: Props) {
  const [filter, setFilter] = useState<'ALL' | 'VARIANCE' | 'PENDING'>('VARIANCE');
  const [recordToDelete, setRecordToDelete] = useState<string | null>(null);

  const filteredRecords = records.filter(r => {
    if (filter === 'VARIANCE') return r.variance !== 0;
    if (filter === 'PENDING') return r.status === 'Pending';
    return true;
  });

  const getProductName = (sku: string) => {
    return products.find(p => p.sku === sku)?.name || 'Unknown Product';
  };

  const formatDate = (isoString: string) => {
    const d = new Date(isoString);
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) + ' ' + d.toLocaleDateString();
  };

  const confirmDelete = () => {
    if (recordToDelete) {
      deleteRecord(recordToDelete);
      setRecordToDelete(null);
    }
  };

  return (
    <div className="flex flex-col h-full max-w-5xl mx-auto w-full p-4 relative">
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
        
        <div className="flex bg-gray-100 p-1 rounded-lg self-start">
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

      <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden flex-1 flex flex-col">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-200 text-sm text-gray-600">
                <th className="p-4 font-medium">Product</th>
                <th className="p-4 font-medium">Variant</th>
                <th className="p-4 font-medium">Quantity</th>
                <th className="p-4 font-medium">Physical</th>
                <th className="p-4 font-medium">Variance</th>
                <th className="p-4 font-medium">Time / User</th>
                <th className="p-4 font-medium text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {filteredRecords.map(record => (
                <tr key={record.id} className="hover:bg-gray-50 transition-colors">
                  <td className="p-4">
                    <div className="font-medium text-gray-900">{getProductName(record.sku)}</div>
                    <div className="text-xs text-gray-500 font-mono mt-1">{record.sku}</div>
                  </td>
                  <td className="p-4 text-gray-600">
                    {record.variantName ? (
                      <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-gray-100 text-gray-800">
                        {record.variantName}
                      </span>
                    ) : (
                      <span className="text-gray-400 text-xs">-</span>
                    )}
                  </td>
                  <td className="p-4 text-gray-600">{record.quantity}</td>
                  <td className="p-4 font-semibold">{record.physicalQty}</td>
                  <td className="p-4">
                    <div className="flex flex-col gap-1">
                      <span className={`inline-flex items-center w-fit px-2.5 py-0.5 rounded-full text-xs font-medium ${
                        record.variance === 0 ? 'bg-gray-100 text-gray-800' :
                        record.variance > 0 ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'
                      }`}>
                        {record.variance > 0 ? '+' : ''}{record.variance}
                      </span>
                      {record.variancePercent !== undefined && record.variance !== 0 && (
                        <span className={`text-xs font-medium ${
                          record.variancePercent > 0 ? 'text-green-600' : 'text-red-600'
                        }`}>
                          {record.variancePercent > 0 ? '+' : ''}{record.variancePercent}%
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="p-4 text-sm text-gray-500">
                    <div>{formatDate(record.timestamp)}</div>
                    <div className="text-xs">{record.user}</div>
                  </td>
                  <td className="p-4 text-right">
                    <div className="flex justify-end items-center space-x-2">
                      {record.status === 'Pending' ? (
                        <>
                          <button
                            onClick={() => updateRecordStatus(record.id, 'Approved')}
                            className="p-2 text-green-600 hover:bg-green-50 rounded-lg transition-colors border border-green-200"
                            title="Approve"
                          >
                            <Check size={18} />
                          </button>
                          <button
                            onClick={() => updateRecordStatus(record.id, 'Rejected')}
                            className="p-2 text-red-600 hover:bg-red-50 rounded-lg transition-colors border border-red-200"
                            title="Reject"
                          >
                            <X size={18} />
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
                        className="p-2 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors border border-transparent hover:border-red-200 ml-2"
                        title="Delete"
                      >
                        <Trash2 size={18} />
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
    </div>
  );
}
