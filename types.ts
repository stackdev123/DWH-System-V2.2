export enum ItemStatus {
  CREATED = 'CREATED',
  IN_STOCK = 'IN_STOCK',
  OUTBOUND = 'OUTBOUND',
  EXPIRED = 'EXPIRED',
  CONSUMED = 'CONSUMED',
  PENDING_APPROVAL = 'PENDING_APPROVAL'
}

export interface User {
  username: string;
  role: 'SuperAdmin' | 'Admin' | 'AdminPPIC' | 'User' | 'UserMT' | 'UserGA' | 'UserHRGA' | 'Viewer';
}

export interface Product {
  id: string;
  name: string;
  category: string;
  unit: string;
  uom?: string;
  categoryCode?: string;
  subCategory?: string;
  subCategoryCode?: string;
  code1?: string;
  numberCode?: string;
  code2?: string;
  stockToday?: number;
  safetyStock?: number;
  initialStock?: number;
  isActive?: boolean;
}

export interface InventorySummary {
  code: string;
  itemName: string;
  uom: string;
  category: string;
  initialStock: number;
  stockToday: number;
  safetyStock: number;
}

export interface StockItem {
  id?: number;
  uniqueId: string;
  productId: string;
  productName: string;
  batchCode?: string;
  arrivalDate: string;
  expiryDate: string;
  supplier: string;
  status: ItemStatus;
  createdAt: number;
  quantity: number;
  note?: string;
  isUnlabeled?: boolean;
}

export interface LogEntry {
  id: string;
  type: 'IN' | 'OUT' | 'CREATE' | 'ADJUST';
  stockItemId: string;
  productName: string;
  timestamp: number;
  recipient?: string;
  note?: string;
  quantityChange?: number;
  user?: string;
}

// --- NEW TYPES FOR MT & HRGA ---

export interface SimpleItem {
  id?: number;
  name: string;
  unit: string;
  module: 'MT' | 'GA' | 'HR';
  initialStock?: number;
}

export interface SimpleTransaction {
  id?: string;
  timestamp: number;
  type: 'IN' | 'OUT';
  itemName: string;
  quantity: number;
  unit: string;
  supplier?: string;
  recipient?: string;
  officer: string;
  note?: string;
  module: 'MT' | 'GA' | 'HR';
}

export interface OpnameRequest {
  id: string;
  productId: string;
  productName: string;
  batchCode: string;
  systemQty: number;
  physicalQty: number;
  variance: number;
  note: string;
  isInitialStockAdjustment: boolean;
  referenceDate: string;
  submittedBy: string;
  submittedAt: number;
  status: 'PENDING' | 'APPROVED' | 'REJECTED';
}

export interface LabelData {
  item: {
    name: string;
    code: string;
    batchCode?: string;
    quantity: number;
    unit: string;
  };
  supplier: string;
  arrivalDate: string;
  expiryDate: string;
}