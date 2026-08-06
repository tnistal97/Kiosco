import {
  ArrowLeftIcon,
  ArrowRightIcon,
} from '@heroicons/react/24/outline'
import clsx from 'clsx'
import React, { Dispatch, SetStateAction } from 'react'

interface Props {
  currentPage: number
  totalPages: number
  // Para usar «p => p + 1», cambiamos el tipo:
  setCurrentPage: Dispatch<SetStateAction<number>>
}

export default function ProductsPagination({
  currentPage,
  totalPages,
  setCurrentPage,
}: Props) {
  return (
    <div className="flex justify-between items-center mt-6">
      <button
        onClick={() => setCurrentPage(1)}
        disabled={currentPage === 1}
        className={clsx(
          'flex items-center gap-1 px-4 py-2 rounded-md font-medium transition',
          currentPage === 1
            ? 'bg-gray-700 text-gray-500 cursor-not-allowed'
            : 'bg-blue-600 text-white hover:bg-blue-700'
        )}
      >
        <ArrowLeftIcon className="w-4 h-4" />
        Primera
      </button>
      <button
        onClick={() => setCurrentPage((p) => Math.max(p - 1, 1))}
        disabled={currentPage === 1}
        className={clsx(
          'flex items-center gap-1 px-4 py-2 rounded-md font-medium transition',
          currentPage === 1
            ? 'bg-gray-700 text-gray-500 cursor-not-allowed'
            : 'bg-blue-600 text-white hover:bg-blue-700'
        )}
      >
        Anterior
      </button>
      <span className="text-sm text-gray-300">
        Página {currentPage} de {totalPages}
      </span>
      <button
        onClick={() => setCurrentPage((p) => Math.min(p + 1, totalPages))}
        disabled={currentPage === totalPages}
        className={clsx(
          'flex items-center gap-1 px-4 py-2 rounded-md font-medium transition',
          currentPage === totalPages
            ? 'bg-gray-700 text-gray-500 cursor-not-allowed'
            : 'bg-blue-600 text-white hover:bg-blue-700'
        )}
      >
        Siguiente
        <ArrowRightIcon className="w-4 h-4" />
      </button>
      <button
        onClick={() => setCurrentPage(totalPages)}
        disabled={currentPage === totalPages}
        className={clsx(
          'flex items-center gap-1 px-4 py-2 rounded-md font-medium transition',
          currentPage === totalPages
            ? 'bg-gray-700 text-gray-500 cursor-not-allowed'
            : 'bg-blue-600 text-white hover:bg-blue-700'
        )}
      >
        Última
      </button>
    </div>
  )
}
