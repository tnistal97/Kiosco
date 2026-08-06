export default function StockAlert({ stock }: { stock: number }) {
  if (stock === 0) {
    return <span className="bg-red-700 text-white px-2 rounded">Sin Stock</span>
  }
  if (stock < 10) {
    return <span className="bg-yellow-500 text-black px-2 rounded">Stock Bajo</span>
  }
  return <span className="bg-green-600 text-white px-2 rounded">{stock}</span>
}
