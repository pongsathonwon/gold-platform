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
const lotSchema = z.object({
  id: z.string(),
  sourceType: z.string(),
  sourceId: z.string(),
  purityId: z.string(),
  brandId: z.string(),
  productTypeId: z.string(),
  barSizeId: z.string(),
  weightGb: z.number(),
  weightGm: z.number(),
  conversionFactor: z.string(),
  totalCost: z.number(),
  createdBy: z.string(),
  createdAt: z.coerce.date(),
})

export const adjustLotSchema = lotSchema.omit({
  id: true, // system generate
  sourceType: true, // set to ADJUSTMENT
  sourceId: true, // system generate
  createdAt: true // db generate
}).and(z.object({
  reason: z.string(),
}))

export type AdjustLotReq = z.infer<typeof adjustLotSchema>

export const voidLotSchema = lotSchema.pick({
  id: true,
  createdBy: true
}).and(z.object({
  reason: z.string(),
}))

export type VoidLotReq = z.infer<typeof voidLotSchema>