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

// --- shared across both wholesale domains ---

// Why a shipment went back to the party that sent it. A column rather than free text in the note,
// because supplier reliability is the reason CANCELLED and REJECTED are separate statuses at all,
// and "HUA sent the wrong purity four times this quarter" is only answerable if the cause is a
// field. The note is still required on top of it — the reason says what, the note says the rest.
export const RETURN_REASONS = [
  { value: 'WEIGHT', label: 'น้ำหนักไม่ตรง' },
  { value: 'BRAND', label: 'ยี่ห้อไม่ตรง' },
  { value: 'PURITY', label: 'ความบริสุทธิ์ไม่ตรง' },
  { value: 'DAMAGED', label: 'สินค้าเสียหาย' },
  { value: 'OTHER', label: 'อื่น ๆ' },
] as const

export const returnReasonSchema = z.enum(
  RETURN_REASONS.map((r) => r.value) as [string, ...string[]]
)

export type ReturnReasonValue = (typeof RETURN_REASONS)[number]['value']

export const returnReasonLabel = (value: string) =>
  RETURN_REASONS.find((r) => r.value === value)?.label ?? value

// --- wholesale-buy ---

// One item per transaction. `kind` splits the happy path from the failure branches:
// every 'bad' transition requires a note — the status log is the audit trail and "why" is
// the only thing it cannot reconstruct. 'terminal' says the transaction can never move again.
export const WHOLE_BUY_STATUSES = [
  { value: 'CREATED', label: 'สร้างรายการ', kind: 'happy', terminal: false },
  { value: 'CONFIRMED', label: 'ยืนยันแล้ว', kind: 'happy', terminal: false },
  { value: 'PAID', label: 'ชำระเงินแล้ว', kind: 'happy', terminal: false },
  { value: 'RECEIVED', label: 'รับของแล้ว', kind: 'happy', terminal: false },
  // named for what it does — it is the step that moves gold into inventory. The old name
  // (CHECKED) described the clerical act and said nothing about the stock movement it carries.
  { value: 'STOCKED', label: 'เข้าสต๊อกแล้ว', kind: 'happy', terminal: true },
  { value: 'PAYMENT_FAILED', label: 'ชำระเงินไม่สำเร็จ', kind: 'bad', terminal: false },
  { value: 'DELIVERY_FAILED', label: 'ผู้ขายไม่ส่งของ', kind: 'bad', terminal: false },
  { value: 'DISPUTED', label: 'รอตรวจสอบ', kind: 'bad', terminal: false },
  { value: 'CANCELLED', label: 'ยกเลิก', kind: 'bad', terminal: true },
  { value: 'REJECTED', label: 'ผู้ขายปฏิเสธ', kind: 'bad', terminal: true },
  // no longer terminal: our money left at PAID, so a shipment going back leaves the supplier
  // holding it. The transaction stays open until that cash is accounted for — refunded, replaced
  // by a re-delivery, or given up on.
  { value: 'RETURNED', label: 'ตีกลับผู้ขาย', kind: 'bad', terminal: false },
  { value: 'REFUNDED', label: 'ได้รับเงินคืน', kind: 'bad', terminal: true },
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
  // CANCELLED is reachable here. An earlier rule forced every exit from CONFIRMED through
  // REJECTED, which poisoned the one metric REJECTED exists to feed: it means *the supplier
  // killed it*, and routing our own data-entry mistakes through it makes supplier-reliability
  // reporting meaningless. Nothing has moved at this point, so there is nothing to unwind.
  CONFIRMED: ['PAID', 'PAYMENT_FAILED', 'CANCELLED', 'REJECTED'],
  // a bounced transfer is retryable — fix it and pay again, or give up
  PAYMENT_FAILED: ['PAID', 'CANCELLED', 'REJECTED'],
  // Our money is gone. The goods either arrive and are accepted at the door, arrive wrong and are
  // refused without ever taking custody, or never turn up at all.
  PAID: ['RECEIVED', 'RETURNED', 'DELIVERY_FAILED'],
  // the mirror of the sell side's PAYMENT_FAILED — the counterparty took the valuable thing and
  // has not handed over its other half. Chase it, or write the loss off; there is no CANCELLED
  // here because our money already moved
  DELIVERY_FAILED: ['RECEIVED', 'WRITTEN_OFF'],
  // Custody has transferred, and RECEIVED means it was correct at the door. There is no direct
  // route back to RETURNED: once we have taken the gold in, sending it back goes through
  // DISPUTED, which is where the reason and the contested weight get recorded.
  RECEIVED: ['STOCKED', 'DISPUTED'],
  DISPUTED: ['STOCKED', 'RETURNED'],
  // The gold went back but our cash did not come with it. This is the only place in either domain
  // where money is outstanding with nothing to show for it, so it stays open until it resolves:
  // the supplier refunds, re-delivers the correct item, or never makes us whole.
  RETURNED: ['REFUNDED', 'RECEIVED', 'WRITTEN_OFF'],
  // terminal — corrections after STOCKED go through the inventory gain/loss adjustment forms
  STOCKED: [],
  CANCELLED: [],
  REJECTED: [],
  REFUNDED: [],
  WRITTEN_OFF: [],
}

// The transition that moves gold into inventory: stock enters when it has been accepted,
// not when it arrived.
export const WHOLE_BUY_INVENTORY_STATUS = 'STOCKED' satisfies WholeBuyStatusValue

// The move that refuses a delivery outright, and the one that sends back gold already taken in.
// Both require a `returnReason`.
export const WHOLE_BUY_RETURN_STATUS = 'RETURNED' satisfies WholeBuyStatusValue

/**
 * Statuses that must not be summed into a list's weight or money totals.
 *
 * Deliberately an explicit set rather than a `bad && terminal` test. That shorthand held only
 * while every dead end was also terminal; `RETURNED` now has onward moves, and inferring
 * "counts toward stock" from "can still move" would start counting gold that went back to the
 * supplier. The question is only ever *did the company end up with the gold*.
 */
export const WHOLE_BUY_EXCLUDED_FROM_TOTALS: readonly WholeBuyStatusValue[] =
  ['CANCELLED', 'REJECTED', 'RETURNED', 'REFUNDED', 'WRITTEN_OFF']

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
  // Only read on a move into DISPUTED: what the delivery actually weighed. Accepting takes no
  // weight at all — acceptance means "it matched the document", so the only value the field could
  // legally hold on that path was the number already on the order. A field that permits exactly
  // one value carries no information, and mistyping it wrongly diverted good deliveries.
  actualWeight: z.number().positive().optional(),
  // only read on a move into PAID: what was actually settled, when it differs from totalAmount.
  // Omit when the payment matched. Accounting needs the variance; the state machine does not
  // branch on it, because an accepted difference closes the deal exactly like an exact one.
  settledAmount: z.number().positive().optional(),
  // required on a move into RETURNED
  returnReason: returnReasonSchema.optional(),
})

export type AdvanceWholeBuyStatusReq = z.infer<typeof advanceWholeBuyStatusSchema>

// Receive + stock as one operator action: the person who accepts the delivery is the person who
// puts it away, and BU would staff that role rather than split it. Both status entries are still
// written, so separating the steps later needs no migration.
//
// It takes no weight. The check that matters happens at the door, against the document, before
// custody transfers — a delivery whose weight, brand or purity disagrees is refused via
// PAID → RETURNED and never reaches this endpoint.
export const receiveStockWholeBuySchema = z.object({
  note: z.string().optional(),
})

export type ReceiveStockWholeBuyReq = z.infer<typeof receiveStockWholeBuySchema>

// --- wholesale-sell ---

// The mirror of wholesale-buy: the company sells gold TO a supplier. Same two-table status-log
// shape, same 'happy' / 'bad' split, same note-on-failure rule, same two-step goods handling
// collapsed behind one endpoint.
//
// Buy pairs RECEIVED (goods here) with STOCKED (put away) and increments on the *second*.
// Sell pairs PACKED (pulled from the vault) with SHIPPED (gone) and decrements on the *first*.
// Both count the pessimistic edge of the transit window: gold coming toward us is not ours until
// accepted, gold going out stops being ours the moment it leaves the vault. Neither domain ever
// reports stock it does not physically hold.
//
// That symmetry governs *which edge moves stock*, and nothing else. It is not a reason for the
// two domains to expose the same number of endpoints: receiving and stocking are one moment on
// the floor, packing and shipping are not — a packed box waits for a courier — so buy fuses its
// pair behind one call and sell leaves its two as separate operator actions.
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
  // CANCELLED is reachable here, matching the buy side: nothing has moved yet, and forcing our
  // own mistakes through REJECTED would misreport them as the buyer walking away.
  CONFIRMED: ['PACKED', 'CANCELLED', 'REJECTED'],
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

// the move that sends gold back to us; requires a `returnReason`, as on the buy side
export const WHOLE_SELL_RETURN_STATUS = 'RETURNED' satisfies WholeSellStatusValue

/**
 * Statuses excluded from a list's totals. The test here is *did the gold end up gone* — the
 * inverse reading of the buy side's, because on a sell the company parts with the metal.
 *
 * `WRITTEN_OFF` is therefore the one bad terminal that still counts: the gold really did leave
 * and nothing brought it back. `RETURNED` does not, because its decrement was reversed.
 */
export const WHOLE_SELL_EXCLUDED_FROM_TOTALS: readonly WholeSellStatusValue[] =
  ['CANCELLED', 'REJECTED', 'RETURNED']

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
  // Only read on a move into DISPUTED: the weight the *buyer* says their scale read. Packing
  // takes no weight — we packed our own gold from our own vault, so there is no independent
  // figure to capture and nothing to compare against. The buyer's number is the one weight on a
  // sell that is genuinely someone else's measurement.
  actualWeight: z.number().positive().optional(),
  // only read on a move into PAID: what the buyer actually settled, when it differs from
  // totalAmount. BU's "paid a different amount and we closed it anyway" case — a field, not a
  // status, because an accepted shortfall closes the deal exactly like an exact payment does.
  settledAmount: z.number().positive().optional(),
  // required on a move into RETURNED
  returnReason: returnReasonSchema.optional(),
})

export type AdvanceWholeSellStatusReq = z.infer<typeof advanceWholeSellStatusSchema>
