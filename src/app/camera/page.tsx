import BarcodeScanner from '@/components/BarcodeScanner'

export default function CameraPage() {
  return (
    <div className="p-6 space-y-4">
      <h1 className="text-2xl font-bold">Escanear Código de Barras</h1>
      <BarcodeScanner />
    </div>
  )
}
