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

export const stockGainSchema = z.object({
  purityId: z.string(),
  brandId: z.string().optional(),
  origin: z.enum(['domestic', 'foreign']),
  productTypeId: z.string(),
  weightGb: z.number().positive(),
  weightGm: z.number().positive(),
  conversionFactor: z.number().positive(),
  totalCost: z.number().positive(),
  reason: z.enum(['stock_count_gain', 'correction']),
  notes: z.string().optional(),
  auditedBy: z.string(),
})

export type StockGainReq = z.infer<typeof stockGainSchema>

export const stockLossSchema = z.object({
  purityId: z.string(),
  brandId: z.string().optional(),
  origin: z.enum(['domestic', 'foreign']),
  productTypeId: z.string(),
  weightGb: z.number().positive(),
  weightGm: z.number().positive(),
  reason: z.enum(['stock_count_loss', 'damage', 'lost', 'correction']),
  notes: z.string().optional(),
  auditedBy: z.string(),
})

export type StockLossReq = z.infer<typeof stockLossSchema>

export const productSwitchSchema = z.object({
  purityId: z.string(),
  productTypeId: z.string(),
  fromBrandId: z.string(),
  weightGb: z.number().positive(),
  weightGm: z.number().positive(),
  notes: z.string().optional(),
  switchedBy: z.string(),
})

export type ProductSwitchReq = z.infer<typeof productSwitchSchema>
