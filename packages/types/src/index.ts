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
  { value: 'DELIVERY_FAILED', label: 'ผู้ขายไม่ส่งของ', kind: 'bad', terminal: false },
  { value: 'DISPUTED', label: 'รอตรวจสอบ', kind: 'bad', terminal: false },
  { value: 'CANCELLED', label: 'ยกเลิก', kind: 'bad', terminal: true },
  { value: 'REJECTED', label: 'ผู้ขายปฏิเสธ', kind: 'bad', terminal: true },
  { value: 'RETURNED', label: 'ตีกลับผู้ขาย', kind: 'bad', terminal: true },
  { value: 'WRITTEN_OFF', label: 'ตัดหนี้สูญ', kind: 'bad', terminal: true },
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
  // our money is gone and the goods have not turned up: they still might, or we give up on them
  PAID: ['RECEIVED', 'DELIVERY_FAILED'],
  // the mirror of the sell side's PAYMENT_FAILED — the counterparty took the valuable thing and
  // has not handed over its other half. Chase it, or write the loss off; there is no CANCELLED
  // here because our money already moved
  DELIVERY_FAILED: ['RECEIVED', 'WRITTEN_OFF'],
  // goods in hand: accept, hold pending resolution, or send back
  RECEIVED: ['CHECKED', 'DISPUTED', 'RETURNED'],
  DISPUTED: ['CHECKED', 'RETURNED'],
  // terminal — corrections after CHECKED go through the inventory gain/loss adjustment forms
  CHECKED: [],
  CANCELLED: [],
  REJECTED: [],
  RETURNED: [],
  WRITTEN_OFF: [],
}

// The transition that moves gold into inventory: stock enters when it has been verified,
// not when it arrived.
export const WHOLE_BUY_INVENTORY_STATUS = 'CHECKED' satisfies WholeBuyStatusValue

// The operator enters exactly one price: the 96.5% quote per gold baht. The 99.9% quote is
// pure arithmetic off it, so the server derives and stores it rather than accepting it —
// two independently-entered prices could disagree, a derived one cannot.
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
  // the only price the operator enters. The 99.9% quote is derived from it server-side;
  // both end up stored, and the item's purity decides which one drives the amount.
  pricePerGb965: z.number().positive(),
  notes: z.string().optional(),
})

export type CreateWholeBuyReq = z.infer<typeof createWholeBuySchema>

// Edits are only accepted while the transaction is still CREATED and inside its edit window.
export const updateWholeBuySchema = createWholeBuySchema.partial()

export type UpdateWholeBuyReq = z.infer<typeof updateWholeBuySchema>

export const advanceWholeBuyStatusSchema = z.object({
  toStatus: wholeBuyStatusSchema,
  note: z.string().optional(),
  // only read on a transition into CHECKED: what physically arrived, in the same unit as the
  // ordered weight. It must match the order exactly — a mismatch diverts to DISPUTED.
  actualWeight: z.number().positive().optional(),
})

export type AdvanceWholeBuyStatusReq = z.infer<typeof advanceWholeBuyStatusSchema>

// Combined receive + check — one operator action today, split into two transitions later
// without touching the status log, which records both entries either way.
export const receiveCheckWholeBuySchema = z.object({
  // what physically arrived, in the same unit as the ordered weight; omit when it matches.
  // Anything other than the ordered weight sends the transaction to DISPUTED instead of CHECKED.
  actualWeight: z.number().positive().optional(),
  note: z.string().optional(),
})

export type ReceiveCheckWholeBuyReq = z.infer<typeof receiveCheckWholeBuySchema>

// --- wholesale-sell ---

// The mirror of wholesale-buy: the company sells gold TO a supplier. Same two-table status-log
// shape, same 'happy' / 'bad' split, same note-on-failure rule, same two-step goods handling
// collapsed behind one endpoint.
//
// Buy pairs RECEIVED (goods here) with CHECKED (verified) and increments on the *second*.
// Sell pairs PACKED (pulled from the vault) with SHIPPED (gone) and decrements on the *first*.
// Both count the pessimistic edge of the transit window: gold coming toward us is not ours until
// verified, gold going out stops being ours the moment it leaves the vault. Neither domain ever
// reports stock it does not physically hold.
export const WHOLE_SELL_STATUSES = [
  { value: 'CREATED', label: 'สร้างรายการ', kind: 'happy', terminal: false },
  { value: 'CONFIRMED', label: 'ยืนยันแล้ว', kind: 'happy', terminal: false },
  { value: 'PACKED', label: 'เบิกทองแพ็คแล้ว', kind: 'happy', terminal: false },
  { value: 'SHIPPED', label: 'ส่งออกแล้ว', kind: 'happy', terminal: false },
  { value: 'PAID', label: 'รับเงินแล้ว', kind: 'happy', terminal: true },
  { value: 'DISPUTED', label: 'รอตรวจสอบ', kind: 'bad', terminal: false },
  { value: 'PAYMENT_FAILED', label: 'รับเงินไม่สำเร็จ', kind: 'bad', terminal: false },
  { value: 'CANCELLED', label: 'ยกเลิก', kind: 'bad', terminal: true },
  { value: 'REJECTED', label: 'ผู้ซื้อปฏิเสธ', kind: 'bad', terminal: true },
  { value: 'RETURNED', label: 'ตีกลับคืนสต๊อก', kind: 'bad', terminal: true },
  { value: 'WRITTEN_OFF', label: 'ตัดหนี้สูญ', kind: 'bad', terminal: true },
] as const

export const wholeSellStatusSchema = z.enum(
  WHOLE_SELL_STATUSES.map((s) => s.value) as [string, ...string[]]
)

export type WholeSellStatusValue = (typeof WHOLE_SELL_STATUSES)[number]['value']

export const wholeSellStatusLabel = (value: string) =>
  WHOLE_SELL_STATUSES.find((s) => s.value === value)?.label ?? value

// Statuses whose transition must carry a note explaining the failure.
export const WHOLE_SELL_NOTE_REQUIRED: readonly string[] = WHOLE_SELL_STATUSES
  .filter((s) => s.kind === 'bad')
  .map((s) => s.value)

// The state machine, shared so the UI offers exactly the moves the API will accept.
// The server re-validates every transition — this drives which buttons are shown, nothing more.
export const WHOLE_SELL_TRANSITIONS: Record<WholeSellStatusValue, WholeSellStatusValue[]> = {
  // before the buyer commits: we can cancel, they can decline
  CREATED: ['CONFIRMED', 'CANCELLED', 'REJECTED'],
  // no CANCELLED, exactly as on the buy side: once we have committed to the counterparty, only
  // they can kill it. A packed weight that does not match the deal is a 422 and a re-pack, not
  // a status — the operator fixes it on the spot and the deal stays here.
  CONFIRMED: ['PACKED', 'REJECTED'],
  // the gold is out of the vault and out of the books. If the deal dies now the gold comes back
  // and the decrement is reversed — that is what RETURNED means on this side.
  PACKED: ['SHIPPED', 'RETURNED'],
  // in the buyer's hands: they pay, they contest the weight, their transfer bounces, or the
  // shipment comes home
  SHIPPED: ['PAID', 'DISPUTED', 'PAYMENT_FAILED', 'RETURNED'],
  // contested at the buyer's scale: settle on a price and get paid, or take it back
  DISPUTED: ['PAID', 'RETURNED'],
  // the buyer's transfer bounced or came up short: chase it, or write the receivable off.
  // No RETURNED — by this point they have kept the gold, which is what makes it a bad debt.
  PAYMENT_FAILED: ['PAID', 'WRITTEN_OFF'],
  // terminal — corrections after PAID go through the inventory gain/loss adjustment forms
  PAID: [],
  CANCELLED: [],
  REJECTED: [],
  RETURNED: [],
  WRITTEN_OFF: [],
}

// The transition that moves gold out of inventory: stock leaves the books when it leaves the
// vault to be packed, not when it ships and not when the money lands. Anything that kills the
// deal after this point has to put the gold back — see WHOLE_SELL_REVERSAL_STATUS.
export const WHOLE_SELL_INVENTORY_STATUS = 'PACKED' satisfies WholeSellStatusValue

// The transition that puts the gold back. Reachable from PACKED, SHIPPED and DISPUTED — every
// state after the decrement in which the gold can still physically come home.
export const WHOLE_SELL_REVERSAL_STATUS = 'RETURNED' satisfies WholeSellStatusValue

// Same one-price rule as wholesale-buy: the operator enters the 96.5% quote per gold baht and
// the server derives the 99.9% one with `derivePricePerGb999()`.
export const createWholeSellSchema = z.object({
  supplierId: z.string().uuid(),
  purityId: z.string().min(1),
  // omitted for 99.9% — those pools are keyed by origin, and the server forces the 'NA' sentinel
  brandId: z.string().optional(),
  productTypeId: z.string().min(1),
  // in the unit product_type_purities defines for this pairing (kg or gold baht)
  weight: z.number().int().positive(),
  // the only price the operator enters. The 99.9% quote is derived from it server-side;
  // both end up stored, and the item's purity decides which one drives the amount.
  pricePerGb965: z.number().positive(),
  notes: z.string().optional(),
})

export type CreateWholeSellReq = z.infer<typeof createWholeSellSchema>

// Edits are only accepted while the transaction is still CREATED — confirmation is the lock.
export const updateWholeSellSchema = createWholeSellSchema.partial()

export type UpdateWholeSellReq = z.infer<typeof updateWholeSellSchema>

export const advanceWholeSellStatusSchema = z.object({
  toStatus: wholeSellStatusSchema,
  note: z.string().optional(),
  // only read on a transition into PACKED: what actually came out of the vault, in the same unit
  // as the agreed weight. It must equal the agreed weight — anything else is rejected 422 and
  // nothing is decremented, because the fix is to re-pack, not to record a wrong deal.
  actualWeight: z.number().positive().optional(),
})

export type AdvanceWholeSellStatusReq = z.infer<typeof advanceWholeSellStatusSchema>

// Combined pack + ship — one operator action today, the mirror of the buy side's receive-check.
// Both transitions are still written to the status log, so splitting them later needs no
// migration and loses no history.
export const packShipWholeSellSchema = z.object({
  // what came out of the vault, in the same unit as the agreed weight; omit when it matches.
  actualWeight: z.number().positive().optional(),
  note: z.string().optional(),
})

export type PackShipWholeSellReq = z.infer<typeof packShipWholeSellSchema>
