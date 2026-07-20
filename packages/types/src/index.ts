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
export const TRANSACTION_TYPES = [
  { value: 'WHOLESALE_BUY', label: 'ซื้อส่ง' },
  { value: 'WHOLESALE_SELL', label: 'ขายส่ง' },
  { value: 'RETAIL_BUY', label: 'ซื้อปลีก' },
  { value: 'RETAIL_SELL', label: 'ขายปลีก' },
  { value: 'RECEIVED', label: 'รับเข้า' },
  { value: 'SMELTING', label: 'หลอม' },
  { value: 'CONVERT_OUT', label: 'แปรสภาพออก' },
  { value: 'PRODUCT_SWITCH', label: 'สลับสินค้า' },
  { value: 'STOCK_COUNT', label: 'ตรวจนับสต๊อก' },
  { value: 'DAMAGE', label: 'ชำรุด' },
  { value: 'LOST', label: 'สูญหาย' },
  { value: 'MANUAL_CORRECTION', label: 'แก้ไขด้วยตนเอง' },
] as const

export const transactionTypeSchema = z.enum(
  TRANSACTION_TYPES.map((t) => t.value) as [string, ...string[]]
)

export type TransactionType = (typeof TRANSACTION_TYPES)[number]['value']

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
