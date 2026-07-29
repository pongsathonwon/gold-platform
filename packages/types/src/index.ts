import { z } from "zod";
// mock
// User schemas — shared between API validation and web form validation
export const createUserSchema = z.object({
  name: z.string().min(1, "Name is required"),
  email: z.string().email("Invalid email address"),
});

export const updateUserSchema = createUserSchema.partial();

export type CreateUserInput = z.infer<typeof createUserSchema>;
export type UpdateUserInput = z.infer<typeof updateUserSchema>;

// Auth schemas
export const registerSchema = z.object({
  name: z.string().min(1, "Name is required"),
  username: z.string().min(1, "Username is required"),
  password: z.string().min(8, "Password must be at least 8 characters"),
});

export const loginSchema = z.object({
  username: z.string().min(1, "Username is required"),
  password: z.string().min(1, "Password is required"),
});

export type RegisterInput = z.infer<typeof registerSchema>;
export type LoginInput = z.infer<typeof loginSchema>;

export const publicUserSchema = z.object({
  id: z.number(),
  name: z.string().min(1),
  username: z.string().min(1),
})

export const LoginResponseSchema = z.object({
  user: publicUserSchema,
  token: z.string().jwt()
})

export type PublicUser = z.infer<typeof publicUserSchema>

export type AuthResponse = z.infer<typeof LoginResponseSchema>

//inventory

// Combined transaction-type list used as the "remark" dropdown on the gain/loss forms.
// The selected value becomes the movement's referenceType. Each type migrates to its own
// dedicated module later; until then all movements are recorded through gain/loss.
// `direction` says which of those two forms may offer the option: 'gain' | 'loss' | 'both'.
// PRODUCT_SWITCH is neither — it's set internally by the dedicated product-switch flow and
// is never user-selectable — so it carries no direction and is excluded from both dropdowns.
export const TRANSACTION_TYPES = [
  { value: 'WHOLESALE_BUY', label: 'ซื้อส่ง', direction: 'gain' },
  { value: 'WHOLESALE_SELL', label: 'ขายส่ง', direction: 'loss' },
  { value: 'RETAIL_BUY', label: 'ซื้อปลีก', direction: 'gain' },
  { value: 'RETAIL_SELL', label: 'ขายปลีก', direction: 'loss' },
  { value: 'RECEIVED', label: 'รับเข้า', direction: 'gain' },
  { value: 'SMELTING', label: 'หลอม', direction: 'gain' },
  { value: 'CONVERT_OUT', label: 'แปรสภาพออก', direction: 'loss' },
  { value: 'PRODUCT_SWITCH', label: 'สลับสินค้า', direction: 'none' },
  { value: 'STOCK_COUNT', label: 'ตรวจนับสต๊อก', direction: 'both' },
  { value: 'DAMAGE', label: 'ชำรุด', direction: 'loss' },
  { value: 'LOST', label: 'สูญหาย', direction: 'loss' },
  { value: 'MANUAL_CORRECTION', label: 'แก้ไขด้วยตนเอง', direction: 'both' },
] as const

export const transactionTypeSchema = z.enum(
  TRANSACTION_TYPES.map((t) => t.value) as [string, ...string[]]
)

export type TransactionType = (typeof TRANSACTION_TYPES)[number]['value']

// Reference-type options offered on the stock-gain form (direction 'gain' or 'both').
export const GAIN_TRANSACTION_TYPES = TRANSACTION_TYPES.filter(
  (t) => t.direction === 'gain' || t.direction === 'both'
)

// Reference-type options offered on the stock-loss form (direction 'loss' or 'both').
export const LOSS_TRANSACTION_TYPES = TRANSACTION_TYPES.filter(
  (t) => t.direction === 'loss' || t.direction === 'both'
)

export const stockGainSchema = z.object({
  purityId: z.string(),
  brandId: z.string().optional(),
  origin: z.enum(['domestic', 'foreign']),
  productTypeId: z.string(),
  weight: z.number().int().positive(),
  pricePerGb: z.number().positive(),
  referenceType: transactionTypeSchema,
  notes: z.string().optional(),
})

export type StockGainReq = z.infer<typeof stockGainSchema>

export const stockLossSchema = z.object({
  purityId: z.string(),
  brandId: z.string().optional(),
  origin: z.enum(['domestic', 'foreign']),
  productTypeId: z.string(),
  weight: z.number().int().positive(),
  referenceType: transactionTypeSchema,
  notes: z.string().optional(),
})

export type StockLossReq = z.infer<typeof stockLossSchema>

export const productSwitchSchema = z.object({
  purityId: z.string(),
  productTypeId: z.string(),
  fromBrandId: z.string(),
  weight: z.number().int().positive(),
  notes: z.string().optional(),
})

export type ProductSwitchReq = z.infer<typeof productSwitchSchema>
