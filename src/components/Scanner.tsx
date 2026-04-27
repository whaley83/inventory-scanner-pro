import { useEffect, useRef, useState } from 'react';
import { Html5Qrcode } from 'html5-qrcode';
import { X, Camera, AlertCircle, Loader2, Sparkles } from 'lucide-react';
import { toast } from 'sonner';
import { GoogleGenAI } from "@google/genai";

interface ScannerProps {
  onScan: (barcode: string) => void;
  onAIIdentify: (base64: string) => Promise<void>;
  onClose: () => void;
  spreadsheetId?: string;
}

type ScanMode = 'BARCODE' | 'AI';

export function Scanner({ onScan, onAIIdentify, onClose, spreadsheetId }: ScannerProps) {
  const html5QrCodeRef = useRef<Html5Qrcode | null>(null);
  const [mode, setMode] = useState<ScanMode>('BARCODE');
  const [isIdentifying, setIsIdentifying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const isTransitioning = useRef(false);

  useEffect(() => {
    const handleModeChange = async () => {
      if (isTransitioning.current) return;
      isTransitioning.current = true;

      try {
        if (mode === 'BARCODE') {
          stopCameraStream();
          await startBarcodeScanner();
        } else {
          await stopBarcodeScanner();
          await startCameraStream();
        }
      } finally {
        isTransitioning.current = false;
      }
    };

    handleModeChange();

    return () => {
      stopBarcodeScanner();
      stopCameraStream();
    };
  }, [mode]);

  const startBarcodeScanner = async () => {
    try {
      // Ensure any previous instance is cleaned up
      if (html5QrCodeRef.current) {
        try {
          if (html5QrCodeRef.current.isScanning) {
            await html5QrCodeRef.current.stop();
          }
        } catch (e) {
          console.warn("Cleanup error:", e);
        }
        html5QrCodeRef.current = null;
      }

      // Küçük bir gecikme sağlamak için DOM'da olduğundan emin olun
      await new Promise(resolve => setTimeout(resolve, 150));
      
      const html5QrCode = new Html5Qrcode("reader");
      html5QrCodeRef.current = html5QrCode;

      // Try to find the back camera specifically
      let cameraId = { facingMode: "environment" };
      try {
        const cameras = await Html5Qrcode.getCameras();
        if (cameras && cameras.length > 0) {
          const backCamera = cameras.find(cam => 
            cam.label.toLowerCase().includes('back') || 
            cam.label.toLowerCase().includes('rear') || 
            cam.label.toLowerCase().includes('camera 0') ||
            cam.label.toLowerCase().includes('environment')
          );
          if (backCamera) {
            cameraId = { deviceId: backCamera.id } as any;
            console.log("Selected back camera:", backCamera.label);
          }
        }
      } catch (e) {
        console.warn("Camera enumeration failed, falling back to environment mode", e);
      }

      const config = { 
        fps: 30, 
        qrbox: { width: 250, height: 250 },
        aspectRatio: 1.0,
        disableFlip: false,
        rememberLastUsedCamera: true,
        videoConstraints: {
          facingMode: 'environment', // still helpful as secondary signal
          focusMode: 'continuous',
          exposureMode: 'continuous',
          whiteBalanceMode: 'continuous'
        } as any
      };

      await html5QrCode.start(
        cameraId,
        config,
        async (decodedText) => {
          if (isTransitioning.current) return;
          isTransitioning.current = true;
          try {
            await html5QrCode.stop();
            html5QrCodeRef.current = null;
            onScan(decodedText);
          } catch (err) {
            console.error("Error stopping after scan:", err);
            // Still call onScan even if stop fails
            onScan(decodedText);
          } finally {
            isTransitioning.current = false;
          }
        },
        (errorMessage) => {
          // Ignore frequent scan errors
        }
      );
      
      // Apply object-fit contain to ensure full frame is visible
      const videoElement = document.querySelector('#reader video') as HTMLVideoElement;
      if (videoElement) {
        videoElement.style.objectFit = 'cover';
        videoElement.style.width = '100%';
        videoElement.style.height = '100%';
      }
      setError(null);
    } catch (err) {
      console.error("Error starting barcode scanner:", err);
      setError("Could not access camera. Please ensure you have granted permission and are using HTTPS.");
    }
  };

  const stopBarcodeScanner = async () => {
    if (html5QrCodeRef.current) {
      try {
        if (html5QrCodeRef.current.isScanning) {
          await html5QrCodeRef.current.stop();
        }
      } catch (err) {
        console.warn("Error stopping barcode scanner:", err);
      } finally {
        html5QrCodeRef.current = null;
      }
    }
  };

  const startCameraStream = async () => {
    try {
      // Try to find the back camera first
      let constraints: any = {
        video: { 
          facingMode: { ideal: 'environment' },
          width: { ideal: 1920 },
          height: { ideal: 1080 }
        }
      };

      try {
        const cameras = await Html5Qrcode.getCameras();
        if (cameras && cameras.length > 0) {
          const backCamera = cameras.find(cam => 
            cam.label.toLowerCase().includes('back') || 
            cam.label.toLowerCase().includes('rear') || 
            cam.label.toLowerCase().includes('camera 0')
          );
          if (backCamera) {
            constraints = {
              video: {
                deviceId: { exact: backCamera.id },
                width: { ideal: 1920 },
                height: { ideal: 1080 },
                // Important for zoom stability and focus
                focusMode: { ideal: 'continuous' } as any
              }
            };
          }
        }
      } catch (e) {
        console.warn("Camera enumeration failed for AI", e);
      }

      let stream: MediaStream;
      try {
        stream = await navigator.mediaDevices.getUserMedia(constraints);
      } catch (e) {
        console.warn("Failed with specific constraints, trying ideal environment:", e);
        stream = await navigator.mediaDevices.getUserMedia({ 
          video: { facingMode: 'environment' } 
        });
      }

      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
      }
      setError(null);
    } catch (err) {
      console.error("Error accessing camera for AI scanner:", err);
      setError("Could not access camera. Please ensure permissions are granted.");
    }
  };

  const stopCameraStream = () => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
      streamRef.current = null;
    }
  };

  const captureAndIdentify = async () => {
    if (!videoRef.current || !canvasRef.current) return;

    setIsIdentifying(true);
    const video = videoRef.current;
    const canvas = canvasRef.current;
    const context = canvas.getContext('2d');

    if (context) {
      // Resize logic: max 1024px
      const MAX_WIDTH = 1024;
      const MAX_HEIGHT = 1024;
      let width = video.videoWidth;
      let height = video.videoHeight;

      if (width > height) {
        if (width > MAX_WIDTH) {
          height *= MAX_WIDTH / width;
          width = MAX_WIDTH;
        }
      } else {
        if (height > MAX_HEIGHT) {
          width *= MAX_HEIGHT / height;
          height = MAX_HEIGHT;
        }
      }

      canvas.width = width;
      canvas.height = height;
      context.drawImage(video, 0, 0, width, height);

      const imageDataUrl = canvas.toDataURL('image/jpeg', 0.8);
      const base64Data = imageDataUrl.split(',')[1];

      try {
        await onAIIdentify(base64Data);
      } catch (error) {
        console.error("AI Identify Error:", error);
        toast.error("AI could not identify product. Please enter manually.");
      } finally {
        setIsIdentifying(false);
      }
    }
  };

  return (
    <div className="fixed inset-0 z-[100] bg-black/90 flex flex-col items-center justify-center p-4">
      <div className="bg-white rounded-2xl w-full max-w-md overflow-hidden flex flex-col shadow-2xl">
        <div className="p-4 border-b flex justify-between items-center bg-gray-50">
          <h3 className="font-bold text-gray-900">
            {mode === 'BARCODE' ? 'Scan Barcode' : 'Scan Product Details'}
          </h3>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-700 p-2 hover:bg-gray-200 rounded-full transition-colors">
            <X size={24} />
          </button>
        </div>
        
        <div className="flex border-b">
           <button 
             className={`flex-1 py-4 flex items-center justify-center gap-2 font-bold transition-all ${mode === 'BARCODE' ? 'bg-blue-50 text-blue-600 border-b-4 border-blue-600' : 'text-gray-500 hover:bg-gray-50'}`}
             onClick={() => setMode('BARCODE')}
           >
             <Camera size={20} /> Barcode
           </button>
           <button 
             className={`flex-1 py-4 flex items-center justify-center gap-2 font-bold transition-all ${mode === 'AI' ? 'bg-blue-50 text-blue-600 border-b-4 border-blue-600' : 'text-gray-500 hover:bg-gray-50'}`}
             onClick={() => setMode('AI')}
           >
             <Sparkles size={20} /> AI Identify
           </button>
        </div>

        <div className="relative w-full bg-black min-h-[300px] flex items-center justify-center overflow-hidden">
          {error ? (
            <div className="p-8 text-center text-white flex flex-col items-center gap-4">
              <AlertCircle size={48} className="text-red-500" />
              <p className="font-medium">{error}</p>
              <button 
                onClick={() => window.location.reload()}
                className="px-4 py-2 bg-white/20 hover:bg-white/30 rounded-lg transition-colors"
              >
                Reload App
              </button>
            </div>
          ) : (
            <>
              {mode === 'BARCODE' && (
                <div className="relative w-full h-full">
                  <div id="reader" className="w-full h-auto min-h-[300px] flex items-center justify-center"></div>
                  
                  {/* Overlay guide for barcode - Fixed square */}
                  <div className="absolute inset-0 pointer-events-none flex items-center justify-center">
                    <div className="w-[250px] h-[250px] relative">
                      {/* Shading */}
                      <div className="absolute inset-0 shadow-[0_0_0_1000px_rgba(0,0,0,0.4)] rounded-xl border border-white/20"></div>
                      
                      {/* Corners - White larger borders */}
                      <div className="absolute top-0 left-0 w-12 h-12 border-t-4 border-l-4 border-white rounded-tl-xl"></div>
                      <div className="absolute top-0 right-0 w-12 h-12 border-t-4 border-r-4 border-white rounded-tr-xl"></div>
                      <div className="absolute bottom-0 left-0 w-12 h-12 border-b-4 border-l-4 border-white rounded-bl-xl"></div>
                      <div className="absolute bottom-0 right-0 w-12 h-12 border-b-4 border-r-4 border-white rounded-br-xl"></div>
                      
                      {/* Scanning line animation */}
                      <div className="absolute top-0 left-0 right-0 h-[2px] bg-red-500/50 animate-scan shadow-[0_0_8px_rgba(239,68,68,0.5)]"></div>
                    </div>
                  </div>
                </div>
              )}
              
              {mode === 'AI' && (
                <>
                  <video 
                    ref={videoRef} 
                    autoPlay 
                    playsInline 
                    className="w-full h-full object-contain"
                  />
                  <canvas ref={canvasRef} className="hidden" />
                  
                  {isIdentifying && (
                    <div className="absolute inset-0 bg-black/60 flex flex-col items-center justify-center z-10 animate-in fade-in duration-200">
                      <div className="bg-white/10 backdrop-blur-md p-6 rounded-2xl flex flex-col items-center gap-4 border border-white/20">
                        <Loader2 className="animate-spin text-white" size={48} />
                        <div className="text-center">
                          <p className="text-white font-bold text-lg">Scanning with AI...</p>
                          <p className="text-white/60 text-sm">Identifying product details</p>
                        </div>
                      </div>
                    </div>
                  )}

                  <div className="absolute bottom-6 left-0 right-0 flex justify-center">
                    <button
                      onClick={captureAndIdentify}
                      disabled={isIdentifying}
                      className="bg-purple-600 text-white px-8 py-4 rounded-full font-bold shadow-xl flex items-center gap-2 disabled:opacity-50 active:scale-95 transition-transform"
                    >
                      {isIdentifying ? (
                        <>
                          <Loader2 className="animate-spin" size={20} />
                          <span>Processing...</span>
                        </>
                      ) : (
                        <>
                          <Sparkles size={20} />
                          <span>Identify Now</span>
                        </>
                      )}
                    </button>
                  </div>
                  
                  {/* Overlay guide for AI identification - Rectangular 95% width with 5:3 aspect ratio */}
                  <div className="absolute inset-0 pointer-events-none flex items-center justify-center">
                    <div className="w-[95%] aspect-[5/3] relative">
                      {/* Shading */}
                      <div className="absolute inset-0 shadow-[0_0_0_1000px_rgba(0,0,0,0.4)] rounded-xl border border-purple-400/30"></div>
                      
                      {/* Corners - White larger borders (keeping high visibility) */}
                      <div className="absolute top-0 left-0 w-12 h-12 border-t-4 border-l-4 border-white rounded-tl-xl"></div>
                      <div className="absolute top-0 right-0 w-12 h-12 border-t-4 border-r-4 border-white rounded-tr-xl"></div>
                      <div className="absolute bottom-0 left-0 w-12 h-12 border-b-4 border-l-4 border-white rounded-bl-xl"></div>
                      <div className="absolute bottom-0 right-0 w-12 h-12 border-b-4 border-r-4 border-white rounded-br-xl"></div>
                    </div>
                  </div>
                </>
              )}
            </>
          )}
        </div>
        
        <div className="p-4 bg-gray-50 text-center text-xs text-gray-500">
          Tip: Hold the camera steady and ensure good lighting.
        </div>
      </div>
    </div>
  );
}
