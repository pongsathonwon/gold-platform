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
  email: z.string().email("Invalid email address"),
  password: z.string().min(8, "Password must be at least 8 characters"),
});

export const loginSchema = z.object({
  email: z.string().email("Invalid email address"),
  password: z.string().min(1, "Password is required"),
});

export type RegisterInput = z.infer<typeof registerSchema>;
export type LoginInput = z.infer<typeof loginSchema>;

export const publicUserSchema = z.object({
  id: z.number(),
  name: z.string().min(1),
  email: z.string().email(),
})

export const LoginResponseSchema = z.object({
  user: publicUserSchema,
  token: z.string().jwt()
})

export type PublicUser = z.infer<typeof publicUserSchema>

export type AuthResponse = z.infer<typeof LoginResponseSchema>

//inventory

// stock gain — creates a new lot from a manual adjustment
export const stockGainSchema = z.object({
  purityId: z.string(),
  brandId: z.string(),
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

// stock loss — FIFO drains existing lots; no totalCost (derived from lot cost basis)
export const stockLossSchema = z.object({
  purityId: z.string(),
  brandId: z.string(),
  productTypeId: z.string(),
  weightGb: z.number().positive(),
  weightGm: z.number().positive(),
  reason: z.enum(['stock_count_loss', 'damage', 'lost', 'correction']),
  notes: z.string().optional(),
  auditedBy: z.string(),
})

export type StockLossReq = z.infer<typeof stockLossSchema>