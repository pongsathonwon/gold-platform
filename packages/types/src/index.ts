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

// --- wholesale-buy ---

// One item per transaction. `kind` splits the happy path from the failure branches:
// every 'bad' transition requires a note — the status log is the audit trail and "why" is
// the only thing it cannot reconstruct. 'terminal' says the transaction can never move again.
export const WHOLE_BUY_STATUSES = [
  { value: 'CREATED', label: 'สร้างรายการ', kind: 'happy', terminal: false },
  { value: 'CONFIRMED', label: 'ยืนยันแล้ว', kind: 'happy', terminal: false },
  { value: 'PAID', label: 'ชำระเงินแล้ว', kind: 'happy', terminal: false },
  { value: 'RECEIVED', label: 'รับของแล้ว', kind: 'happy', terminal: false },
  { value: 'CHECKED', label: 'ตรวจรับแล้ว', kind: 'happy', terminal: true },
  { value: 'PAYMENT_FAILED', label: 'ชำระเงินไม่สำเร็จ', kind: 'bad', terminal: false },
  { value: 'DISPUTED', label: 'รอตรวจสอบ', kind: 'bad', terminal: false },
  { value: 'CANCELLED', label: 'ยกเลิก', kind: 'bad', terminal: true },
  { value: 'REJECTED', label: 'ผู้ขายปฏิเสธ', kind: 'bad', terminal: true },
  { value: 'RETURNED', label: 'ตีกลับผู้ขาย', kind: 'bad', terminal: true },
] as const

export const wholeBuyStatusSchema = z.enum(
  WHOLE_BUY_STATUSES.map((s) => s.value) as [string, ...string[]]
)

export type WholeBuyStatusValue = (typeof WHOLE_BUY_STATUSES)[number]['value']

export const wholeBuyStatusLabel = (value: string) =>
  WHOLE_BUY_STATUSES.find((s) => s.value === value)?.label ?? value

// Statuses whose transition must carry a note explaining the failure.
export const WHOLE_BUY_NOTE_REQUIRED: readonly string[] = WHOLE_BUY_STATUSES
  .filter((s) => s.kind === 'bad')
  .map((s) => s.value)

// The state machine, shared so the UI offers exactly the moves the API will accept.
// The server re-validates every transition — this drives which buttons are shown, nothing more.
export const WHOLE_BUY_TRANSITIONS: Record<WholeBuyStatusValue, WholeBuyStatusValue[]> = {
  // before the supplier commits: we can cancel, they can decline
  CREATED: ['CONFIRMED', 'CANCELLED', 'REJECTED'],
  CONFIRMED: ['PAID', 'PAYMENT_FAILED', 'REJECTED'],
  // a bounced transfer is retryable — fix it and pay again, or give up
  PAYMENT_FAILED: ['PAID', 'CANCELLED', 'REJECTED'],
  PAID: ['RECEIVED'],
  // goods in hand: accept, hold pending resolution, or send back
  RECEIVED: ['CHECKED', 'DISPUTED', 'RETURNED'],
  DISPUTED: ['CHECKED', 'RETURNED'],
  // terminal — corrections after CHECKED go through the inventory gain/loss adjustment forms
  CHECKED: [],
  CANCELLED: [],
  REJECTED: [],
  RETURNED: [],
}

// The transition that moves gold into inventory: stock enters when it has been verified,
// not when it arrived.
export const WHOLE_BUY_INVENTORY_STATUS = 'CHECKED' satisfies WholeBuyStatusValue

// 99.9% gold is quoted off the 96.5% price by the purity ratio. The operator enters the
// 96.5% price and calculates the 99.9% price themselves — this helper only pre-fills the
// field, it is never used to overwrite what they typed.
export const PURITY_RATIO_999_TO_965 = 99.9 / 96.5

export const derivePricePerGb999 = (pricePerGb965: number) =>
  Math.round(pricePerGb965 * PURITY_RATIO_999_TO_965 * 100) / 100

export const createWholeBuySchema = z.object({
  supplierId: z.string().uuid(),
  purityId: z.string().min(1),
  // omitted for 99.9% — those pools are keyed by origin, and the server forces the 'NA' sentinel
  brandId: z.string().optional(),
  productTypeId: z.string().min(1),
  // in the unit product_type_purities defines for this pairing (kg or gold baht)
  weight: z.number().int().positive(),
  // both quotes are recorded on every transaction regardless of the item's purity;
  // the one matching the item's purity is what totalAmount is computed from
  pricePerGb965: z.number().positive(),
  pricePerGb999: z.number().positive(),
  notes: z.string().optional(),
})

export type CreateWholeBuyReq = z.infer<typeof createWholeBuySchema>

// Edits are only accepted while the transaction is still CREATED and inside its edit window.
export const updateWholeBuySchema = createWholeBuySchema.partial()

export type UpdateWholeBuyReq = z.infer<typeof updateWholeBuySchema>

export const advanceWholeBuyStatusSchema = z.object({
  toStatus: wholeBuyStatusSchema,
  note: z.string().optional(),
  // only meaningful on a transition into CHECKED (e.g. resolving a DISPUTED shipment):
  // what physically arrived, in the same unit as the ordered weight
  actualWeight: z.number().positive().optional(),
})

export type AdvanceWholeBuyStatusReq = z.infer<typeof advanceWholeBuyStatusSchema>

// Combined receive + check — one operator action today, split into two transitions later
// without touching the status log, which records both entries either way.
export const receiveCheckWholeBuySchema = z.object({
  // what physically arrived, in the same unit as the ordered weight; omit when it matches
  actualWeight: z.number().positive().optional(),
  note: z.string().optional(),
})

export type ReceiveCheckWholeBuyReq = z.infer<typeof receiveCheckWholeBuySchema>
