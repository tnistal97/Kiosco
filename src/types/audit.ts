// src/types/audit.ts
export interface AuditLog {
  id: number
  user: { id: number; name: string }
  tableName: 'BranchStock' | 'Sale' | 'Product'
  actionType: 'create' | 'update' | 'delete'
  changes: {
    before: Record<string, any> | null
    after: Record<string, any> | null
  }
  timestamp: string
}
