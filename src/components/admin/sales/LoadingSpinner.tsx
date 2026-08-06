// src/app/admin/sales/LoadingSpinner.tsx
'use client'

import React from 'react'

export default function LoadingSpinner() {
  return (
    <div className="flex items-center justify-center py-16">
      <div className="w-12 h-12 border-4 border-blue-500 border-dashed rounded-full animate-spin" />
    </div>
  )
}
