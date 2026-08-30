import { z } from "zod";
import { roundMoney, roundTo, roundWeight, WEIGHT_SCALE } from "./decimal.js";

export {
  FACTOR_SCALE, MONEY_SCALE, WEIGHT_SCALE,
  roundMoney, roundTo, roundWeight,
} from "./decimal.js";
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

/**
 * What a login may do. `OPERATOR` runs the trading day; `ADMIN` additionally holds the powers
 * that rewrite the books (the manual inventory adjustments) or hand out access (creating users).
 */
export const USER_ROLES = [
  { value: 'ADMIN', label: 'ผู้ดูแลระบบ' },
  { value: 'OPERATOR', label: 'ผู้ปฏิบัติงาน' },
] as const

export const userRoleSchema = z.enum(['ADMIN', 'OPERATOR'])

export type UserRoleValue = z.infer<typeof userRoleSchema>

export const userRoleLabel = (value: string) =>
  USER_ROLES.find((r) => r.value === value)?.label ?? value

/**
 * Creating a login. This is **not** self-service registration — the endpoint behind it requires an
 * authenticated `ADMIN`. Gold moves on the say-so of whoever holds an account, so accounts are
 * issued, not claimed.
 *
 * `role` is optional and defaults to `OPERATOR` at the database. Privilege has to be asked for
 * explicitly; forgetting the field can only ever produce the *less* powerful account.
 */
export const registerSchema = z.object({
  name: z.string().min(1, "Name is required"),
  username: z.string().min(1, "Username is required"),
  password: z.string().min(8, "Password must be at least 8 characters"),
  role: userRoleSchema.optional(),
});

export const loginSchema = z.object({
  username: z.string().min(1, "Username is required"),
  password: z.string().min(1, "Password is required"),
});

export type RegisterInput = z.infer<typeof registerSchema>;
export type LoginInput = z.infer<typeof loginSchema>;

export const publicUserSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1),
  username: z.string().min(1),
  role: userRoleSchema,
  /**
   * Whether the account can sign in. False means deactivated — the row is kept so the username
   * stays reserved and the audit trail keeps naming one person, but the login is refused.
   *
   * Defaulted, because a token minted before this field existed decodes without it and the holder
   * should not be treated as deactivated for the remaining hour of their session.
   */
  active: z.boolean().default(true),
})

export const LoginResponseSchema = z.object({
  user: publicUserSchema,
  token: z.string().jwt()
})

export type PublicUser = z.infer<typeof publicUserSchema>

export type AuthResponse = z.infer<typeof LoginResponseSchema>

// --- Business date ---

/**
 * Two dates, not one. Recording something is not the same event as it happening: on day one the
 * shop is documenting operations that already took place, and even under full adoption an entry
 * can land the morning after. So every record the operator creates carries
 *
 *  - `transactionDate` — the day the business event happened, picked by the operator, defaulting
 *    to today. It is what the settlement period is derived from and what reports read.
 *  - the insert timestamp (`recordedAt` / `auditedAt`) — when the row reached the database,
 *    written by the server and never supplied by a caller.
 *
 * Under a proper workflow the two agree, and nothing in the UI draws attention to them. When they
 * differ, the difference *is* the audit trail: it says this was written up after the fact.
 *
 * A day, not an instant. The only thing the picked date decides is which Fri–Thu settlement period
 * the record falls in, and that boundary is a day boundary — a time of day adds no information to
 * it, only a timezone to get wrong.
 */
export const BUSINESS_TIME_ZONE = 'Asia/Bangkok'

/**
 * Bangkok's fixed offset from UTC, as an ISO suffix.
 *
 * Lives beside the zone name because it is the *other* half of the same fact, and the two must
 * never drift. Thailand has observed UTC+7 with no daylight saving since 1920, so an offset is a
 * complete description of the zone — which is what lets a wall-clock time in Bangkok be turned
 * back into an instant by string concatenation (`nextAutoConfirmAt`) rather than by iterating
 * `Intl` offsets around a DST seam that does not exist here.
 *
 * `businessDateOf` still goes through `BUSINESS_TIME_ZONE`: reading a zone is what `Intl` is for,
 * and the named zone stays the source of truth for anything that formats.
 */
export const BUSINESS_UTC_OFFSET = '+07:00'

/**
 * The Bangkok day an instant falls in, as `YYYY-MM-DD`.
 *
 * Pinned to the shop's timezone rather than the machine's: the server may run in UTC and a
 * browser anywhere, but a Thai trading day is a Thai trading day. It is also the only correct way
 * to ask whether an insert timestamp and a picked date describe the same day — slicing the first
 * ten characters off an ISO string answers that question in UTC, which is a different calendar
 * for seven hours out of every twenty-four. `en-CA` formats as `YYYY-MM-DD`.
 */
export function businessDateOf(at: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: BUSINESS_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(at)
}

/** Today on the shop's calendar — the default every picked date starts at. */
export const todayBusinessDate = (at: Date = new Date()) => businessDateOf(at)

/**
 * The business day `delta` days from `day` — `shiftBusinessDate('2026-06-18', -6) === '2026-06-12'`.
 *
 * A business day is a calendar date with no instant behind it, so the arithmetic runs in UTC:
 * midnight UTC never crosses a DST seam, and the result is formatted back off the same UTC
 * accessors it was built from. Reading the day in Bangkok and then stepping it in local time
 * would apply a timezone twice.
 *
 * This is how report windows are anchored — a list defaulting to "the last seven days" asks for
 * `shiftBusinessDate(todayBusinessDate(), -6)`, six back plus today inclusive.
 */
export function shiftBusinessDate(day: string, delta: number): string {
  const at = new Date(`${day}T00:00:00Z`)
  at.setUTCDate(at.getUTCDate() + delta)
  return at.toISOString().slice(0, 10)
}

// A floor no real record predates, so a mistyped year (0226, 1026) is rejected as input rather
// than silently filed 1,800 years back. It cannot catch a plausible-looking wrong year, and is
// not meant to — the not-future rule is the one that carries weight.
export const EARLIEST_BUSINESS_DATE = '2000-01-01'

/** A `YYYY-MM-DD` day, shape only. Report windows use this — a range may reach into the future. */
export const businessDaySchema = z.string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'วันที่ต้องอยู่ในรูปแบบ YYYY-MM-DD')

/**
 * A picked business day *on a record*. Backdating is the point, so there is no floor on how far
 * back an entry may be filed — but the future is not documentation, it is a typo or a guess.
 *
 * ISO dates compare correctly as strings, so none of this parses anything.
 */
export const businessDateSchema = businessDaySchema
  .refine((d) => d >= EARLIEST_BUSINESS_DATE, { message: 'วันที่เก่าเกินกว่าจะเป็นไปได้' })
  .refine((d) => d <= todayBusinessDate(), { message: 'วันที่ทำรายการต้องไม่เป็นวันในอนาคต' })

//inventory

/**
 * Where 99.9% gold came from — the dimension its pools are keyed by, in place of brand.
 *
 * `domestic` is smelted in-house (ทองใน), `foreign` is everything bought in (ทองนอก). The stored
 * values are English because they are an enum in the database; these are what a Thai operator
 * reads. The inventory tables rendered the raw `foreign` / `domestic` in a column of Thai brands.
 */
export const ORIGINS = [
  { value: 'domestic', label: 'ทองใน' },
  { value: 'foreign', label: 'ทองนอก' },
] as const

export type OriginValue = (typeof ORIGINS)[number]['value']

export const originLabel = (value: string) =>
  ORIGINS.find((o) => o.value === value)?.label ?? value

// Combined transaction-type list used as the "remark" dropdown on the gain/loss forms.
// The selected value becomes the movement's referenceType. Each type migrates to its own
// dedicated module later; until then all movements are recorded through gain/loss.
//
// `direction` says which of those two forms may offer the option: 'gain' | 'loss' | 'both'.
// 'none' means the value is written by the system, never chosen by an operator, so it appears in
// neither dropdown — but it still needs a label, because it reaches the movement ledger and the
// ledger is read by people. PRODUCT_SWITCH and WHOLESALE_SELL_RETURN are both of that kind.
export const TRANSACTION_TYPES = [
  { value: 'WHOLESALE_BUY', label: 'ซื้อส่ง', direction: 'gain' },
  { value: 'WHOLESALE_SELL', label: 'ขายส่ง', direction: 'loss' },
  { value: 'RETAIL_BUY', label: 'ซื้อปลีก', direction: 'gain' },
  { value: 'RETAIL_SELL', label: 'ขายปลีก', direction: 'loss' },
  { value: 'RECEIVED', label: 'รับเข้า', direction: 'gain' },
  { value: 'SMELTING', label: 'หลอม', direction: 'gain' },
  { value: 'CONVERT_OUT', label: 'แปรสภาพออก', direction: 'loss' },
  { value: 'PRODUCT_SWITCH', label: 'สลับสินค้า', direction: 'none' },
  // Booked by `reverseDecrement` when a wholesale sale is returned — the gold coming back into
  // the pools it left. System-written, so it is not selectable, but it lands in the ledger and
  // without an entry here the movements page renders the raw constant among Thai labels.
  { value: 'WHOLESALE_SELL_RETURN', label: 'ตีกลับคืนสต๊อก (ขายส่ง)', direction: 'none' },
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
  // the day the discrepancy is being corrected *for* — a stock count done Friday and typed up
  // Monday is Friday's correction. Omit to file it under today. The balance still moves now:
  // this dates the record, it does not rewrite history. See `businessDateSchema`.
  transactionDate: businessDateSchema.optional(),
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
  // as on the gain form — the day the loss belongs to, not the day it was typed
  transactionDate: businessDateSchema.optional(),
  notes: z.string().optional(),
})

export type StockLossReq = z.infer<typeof stockLossSchema>

// A switch moves weight between two brand pools of the same purity + product type. It runs in
// either direction — a stamped bar reclassified into the fungible pool, or fungible weight
// identified as a stamp — so both ends are named. Same-pool is not a move.
export const productSwitchSchema = z
  .object({
    purityId: z.string(),
    productTypeId: z.string(),
    fromBrandId: z.string(),
    toBrandId: z.string(),
    weight: z.number().int().positive(),
    notes: z.string().optional(),
  })
  .refine((v) => v.fromBrandId !== v.toBrandId, {
    message: 'ยี่ห้อต้นทางและปลายทางต้องไม่ซ้ำกัน',
    path: ['toBrandId'],
  })

export type ProductSwitchReq = z.infer<typeof productSwitchSchema>

// --- shared across both wholesale domains ---

/**
 * The fungible sentinel brand. It is the pool everything unstamped lands in, and the residual
 * every brand split drains into — never something an operator picks or types.
 */
export const NA_BRAND = 'NA'

/**
 * One line of a brand split: how much of a transaction's weight carried this particular stamp.
 *
 * Only the *named* brands appear here. `NA` is never sent — the server computes it as whatever
 * the named brands did not account for, which is the whole reason a split can never come out
 * unequal to the transaction weight. There is no total field to disagree with, and no way to
 * express a residual other than the one subtraction produces.
 */
export const brandSplitEntrySchema = z.object({
  brandId: z.string().min(1),
  // in the same unit the transaction's weight was entered in (gold baht for 96.5%)
  weight: z.number().positive(),
})

export type BrandSplitEntry = z.infer<typeof brandSplitEntrySchema>

/**
 * The named-brand lines of a split, sent on the transition that moves stock.
 *
 * Omit it entirely and the whole weight goes to `NA`. A `brandLock` supplier ignores it — their
 * one registered brand takes 100% and the server rejects anything sent alongside, because a
 * field that permits exactly one value is a field that can only be got wrong.
 */
export const brandSplitSchema = z.array(brandSplitEntrySchema)

export type BrandSplit = z.infer<typeof brandSplitSchema>

/**
 * What the fungible pool would absorb, given a total and the named lines so far.
 *
 * Shared with the UI so the remainder it displays is the remainder the server will book. It is
 * derived, never entered: the split UI shows this as a read-only row and clamps each named input
 * to what is left, so an operator cannot construct a split that sums to anything but `total`.
 */
export const brandSplitRemainder = (total: number, entries: BrandSplit) => {
  const named = entries.reduce((sum, e) => sum + (Number.isFinite(e.weight) ? e.weight : 0), 0)
  // strip binary floating-point residue so 12 - 8 - 4 reads as 0, not 1e-15
  return roundWeight(total - named)
}

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
  roundMoney(pricePerGb965 * PURITY_RATIO_999_TO_965)

// No brand here. What stamp the gold carries is not known when the order is placed — it is what
// physically turns up, and it can be a mix. Brand is recorded on the transition that moves stock
// (see `brandSplitSchema`), against the pools it actually lands in.
export const createWholeBuySchema = z.object({
  supplierId: z.string().uuid(),
  purityId: z.string().min(1),
  productTypeId: z.string().min(1),
  // in the unit product_type_purities defines for this pairing (kg or gold baht)
  weight: z.number().int().positive(),
  // the only price the operator enters. The 99.9% quote is derived from it server-side;
  // both end up stored, and the item's purity decides which one drives the amount.
  pricePerGb965: z.number().positive(),
  // The day the order was actually placed, which on day one is routinely not the day it is being
  // typed in. Omit and the server files it under today. **This is what the settlement period is
  // derived from** — backdating that did not move the period would be decoration.
  transactionDate: businessDateSchema.optional(),
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
  // Only read on a move into STOCKED: which stamps the delivery actually carried. Omit for a
  // brandLock supplier (their one brand takes all of it) and for 99.9%, whose pools are keyed by
  // origin rather than brand.
  brandSplit: brandSplitSchema.optional(),
})

export type AdvanceWholeBuyStatusReq = z.infer<typeof advanceWholeBuyStatusSchema>

// Receive + stock as one operator action: the person who accepts the delivery is the person who
// puts it away, and BU would staff that role rather than split it. Both status entries are still
// written, so separating the steps later needs no migration.
//
// It takes no weight. The check that matters happens at the door, against the document, before
// custody transfers — a delivery whose weight, brand or purity disagrees is refused via
// PAID → RETURNED and never reaches this endpoint.
// It does take the brand split, because this is the moment the gold enters a pool and the stamp
// it carries is finally known. That is a different question from *how much* arrived: the split
// says how the agreed weight divides, never what it adds up to.
export const receiveStockWholeBuySchema = z.object({
  note: z.string().optional(),
  brandSplit: brandSplitSchema.optional(),
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
// No brand here either, and for the mirror-image reason: which stamps we hand over is decided
// when the vault is opened and the box is packed, out of whatever is actually on the shelf.
export const createWholeSellSchema = z.object({
  supplierId: z.string().uuid(),
  purityId: z.string().min(1),
  productTypeId: z.string().min(1),
  // in the unit product_type_purities defines for this pairing (kg or gold baht)
  weight: z.number().int().positive(),
  // the only price the operator enters. The 99.9% quote is derived from it server-side;
  // both end up stored, and the item's purity decides which one drives the amount.
  pricePerGb965: z.number().positive(),
  // as on the buy side: the day the deal was struck, defaulting to today, and the value the
  // settlement period is derived from
  transactionDate: businessDateSchema.optional(),
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
  // Only read on a move into PACKED: which pools the gold is drawn out of. Each named brand is a
  // separate decrement, so a pool short of stock fails the whole move — nothing half-packs.
  // RETURNED needs no split: the reversal replays the movements this booked.
  brandSplit: brandSplitSchema.optional(),
})

export type AdvanceWholeSellStatusReq = z.infer<typeof advanceWholeSellStatusSchema>

// ---------------------------------------------------------------------------
// retail — manual write-up of counter trades
// ---------------------------------------------------------------------------
//
// Retail exists here to answer one question: was the price we dealt at a good one. It is a record
// of a trade that already happened, not a counter system, and it is deliberately thin.
//
// Two things follow from that, and they are what make retail differ from wholesale:
//
//   1. **No status machine to speak of.** A write-up is a fact. `createTransaction` lands directly
//      on CONFIRMED and the only move left is voiding it. Wholesale's states exist because a
//      supplier order genuinely passes through them over days; a counter trade does not.
//   2. **No inventory coupling on either side.** Stock is adjusted manually through
//      /inventory/gain|loss. That is why neither domain carries a brand: brand keys a pool, and
//      there is no pool to key.
//
// DRAFT (both) and SHIPPED (sell) survive as enum values so a later POS feed and a later shipping
// flow re-enter without a migration. They are simply not reachable from CONFIRMED today.

export const RETAIL_BUY_STATUSES = [
  // Unreachable via createTransaction — kept for a POS feed, which does have a pending state.
  { value: 'DRAFT', label: 'ร่าง', kind: 'happy', terminal: false },
  { value: 'CONFIRMED', label: 'ยืนยันแล้ว', kind: 'happy', terminal: false },
  // The void. A manual entry cannot be edited into shape — cancel it, with a reason, and re-enter.
  { value: 'CANCELLED', label: 'ยกเลิก', kind: 'bad', terminal: true },
] as const

export const RETAIL_SELL_STATUSES = [
  { value: 'DRAFT', label: 'ร่าง', kind: 'happy', terminal: false },
  { value: 'CONFIRMED', label: 'ยืนยันแล้ว', kind: 'happy', terminal: false },
  // Reachable from nothing and leading nowhere until shipping is built. It is listed so historical
  // rows and dropdowns can still resolve a label for it.
  { value: 'SHIPPED', label: 'ส่งมอบแล้ว', kind: 'happy', terminal: true },
  { value: 'CANCELLED', label: 'ยกเลิก', kind: 'bad', terminal: true },
] as const

export const retailBuyStatusSchema = z.enum(
  RETAIL_BUY_STATUSES.map((s) => s.value) as [string, ...string[]]
)

export const retailSellStatusSchema = z.enum(
  RETAIL_SELL_STATUSES.map((s) => s.value) as [string, ...string[]]
)

export type RetailBuyStatusValue = (typeof RETAIL_BUY_STATUSES)[number]['value']
export type RetailSellStatusValue = (typeof RETAIL_SELL_STATUSES)[number]['value']

export const retailBuyStatusLabel = (value: string) =>
  RETAIL_BUY_STATUSES.find((s) => s.value === value)?.label ?? value

export const retailSellStatusLabel = (value: string) =>
  RETAIL_SELL_STATUSES.find((s) => s.value === value)?.label ?? value

// Voiding a record that already counted toward a week's figures has to say why. It is the only
// transition either domain has, so it is also the only thing the status log ever explains.
export const RETAIL_BUY_NOTE_REQUIRED: readonly string[] = RETAIL_BUY_STATUSES
  .filter((s) => s.kind === 'bad')
  .map((s) => s.value)

export const RETAIL_SELL_NOTE_REQUIRED: readonly string[] = RETAIL_SELL_STATUSES
  .filter((s) => s.kind === 'bad')
  .map((s) => s.value)

// The server re-validates every transition; this drives which buttons the UI offers.
//
// DRAFT keeps its outbound moves rather than being amputated: they are the right moves *if* a DRAFT
// row ever exists. What guarantees no draft step today is that createTransaction lands on CONFIRMED,
// not a hole in this map.
export const RETAIL_BUY_TRANSITIONS: Record<RetailBuyStatusValue, RetailBuyStatusValue[]> = {
  DRAFT: ['CONFIRMED', 'CANCELLED'],
  CONFIRMED: ['CANCELLED'],
  CANCELLED: [],
}

export const RETAIL_SELL_TRANSITIONS: Record<RetailSellStatusValue, RetailSellStatusValue[]> = {
  DRAFT: ['CONFIRMED', 'CANCELLED'],
  // No SHIPPED. Wiring it back means adding it here and restoring the decrement — nothing else.
  CONFIRMED: ['CANCELLED'],
  SHIPPED: [],
  CANCELLED: [],
}

// A cancelled trade did not happen, so it cannot inform what gold cost or fetched. It still renders
// in the body of a list and an export, with a นับในยอดรวม column — a total that says "excluding 2"
// and gives no way to see which two is not auditable.
export const RETAIL_BUY_EXCLUDED_FROM_TOTALS: readonly RetailBuyStatusValue[] = ['CANCELLED']
export const RETAIL_SELL_EXCLUDED_FROM_TOTALS: readonly RetailSellStatusValue[] = ['CANCELLED']

/**
 * Create is field-identical on both sides — a buy and a sell differ in direction, not in shape.
 *
 * Note what is absent versus `createWholeBuySchema`: no counterparty (a walk-in customer is not an
 * entity here), no brand, and no second price. Retail deals in gold baht at both purities, so the
 * 96.5/99.9 derivation wholesale needs has nothing to do here.
 */
const retailCreateShape = {
  branchCode: z.string().min(1),
  purityId: z.string().min(1),
  productTypeId: z.string().min(1),
  /**
   * In the unit product_type_purities defines for this pairing (kg or gold baht).
   *
   * Deliberately not `.int()`, which is what wholesale uses: an ordered weight is chosen off a
   * price list, a counter weight is whatever the scale read. The pairing's min/step rules are
   * skipped server-side for the same reason.
   */
  weight: z.number().positive(),
  // What the trade was actually dealt at, per gold baht. Drives totalAmount.
  pricePerGb: z.number().positive(),
  /**
   * ค่าบล็อค and the like, in THB — the whole fee for the row, not a rate.
   *
   * It is captured separately and stays *out* of totalAmount, so the price-per-gold-baht average
   * reads spread rather than fee, and so the total stays comparable against wholesale, which has no
   * fees at all. Whatever needs all-in cash adds the two. Blending them is unrecoverable after the
   * fact, which is why the field exists before anything reads it.
   */
  operationFee: z.number().nonnegative().optional(),
  // The business day the trade happened, defaulting to today. The settlement period is derived
  // from it, so backdating a week of write-ups lands them in the weeks they belong to.
  transactionDate: businessDateSchema.optional(),
  notes: z.string().optional(),
}

export const createRetailBuySchema = z.object(retailCreateShape)
export const createRetailSellSchema = z.object(retailCreateShape)

export type CreateRetailBuyReq = z.infer<typeof createRetailBuySchema>
export type CreateRetailSellReq = z.infer<typeof createRetailSellSchema>

// Present for symmetry with wholesale and unused by any route today: a confirmed write-up is voided
// and re-entered rather than edited, which keeps the correction in the status log where it is
// auditable instead of overwriting the figure a week was already reported on.
export const updateRetailBuySchema = createRetailBuySchema.partial()
export const updateRetailSellSchema = createRetailSellSchema.partial()

export type UpdateRetailBuyReq = z.infer<typeof updateRetailBuySchema>
export type UpdateRetailSellReq = z.infer<typeof updateRetailSellSchema>

// No actualWeight, settledAmount, returnReason or brandSplit: there is no second measurement, no
// settlement, no counterparty to blame and no pool to draw from.
export const advanceRetailBuyStatusSchema = z.object({
  toStatus: retailBuyStatusSchema,
  note: z.string().optional(),
})

export const advanceRetailSellStatusSchema = z.object({
  toStatus: retailSellStatusSchema,
  note: z.string().optional(),
})

export type AdvanceRetailBuyStatusReq = z.infer<typeof advanceRetailBuyStatusSchema>
export type AdvanceRetailSellStatusReq = z.infer<typeof advanceRetailSellStatusSchema>
