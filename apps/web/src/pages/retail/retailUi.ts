import {
  createRetailBuySchema, createRetailSellSchema,
  RETAIL_BUY_STATUSES, RETAIL_SELL_STATUSES,
  type CreateRetailBuyReq,
} from "@gold-platform/types";
import type { RetailFilter, RetailStatusEntry, RetailTransaction } from "../../hooks/useRetail";
import {
  RETAIL_BUY_REPORT, RETAIL_SELL_REPORT, type TransactionReportConfig,
} from "../../utils/transactionExport";
import {
  buyCountsTowardTotal, buyNextStatuses, buyRequiresNote, buyStatusLabel,
  sellCountsTowardTotal, sellNextStatuses, sellRequiresNote, sellStatusLabel,
} from "../../utils/retailStatus";
import {
  useRetailBuyDetail, useRetailBuyList, useRetailSellDetail, useRetailSellList,
} from "../../hooks/useRetail";
import {
  useAdvanceRetailBuyStatus, useAdvanceRetailSellStatus,
  useCreateRetailBuy, useCreateRetailSell,
} from "../../hooks/useRetailMutations";

/**
 * What distinguishes the retail-buy screens from the retail-sell ones.
 *
 * The two domains render the same three pages against the same row shape — they are one record read
 * in two directions — so the pages are written once and take this config, exactly as the four
 * transaction reports share one builder. Six near-identical page files would drift, and the drift
 * would land in the arithmetic the whole feature exists to produce.
 *
 * The hooks travel in the config, which is why `RetailListPage` and friends are wrapped in a
 * distinct exported component per domain (`RetailBuyListPage`, `RetailSellListPage`). Routing
 * between two paths that rendered the *same* component type with a different config would let React
 * reconcile rather than remount, and the hook call order would swap underneath.
 */
export interface RetailUiConfig {
  key: "retail-buy" | "retail-sell";
  basePath: string;
  listTitle: string;
  createTitle: string;
  detailTitle: string;
  createAction: string;
  createdToast: string;
  /** "ราคารับซื้อ" against "ราคาขาย" — the same column, from the two sides of the counter. */
  priceLabel: string;
  feeLabel: string;
  feeHelper: string;
  statuses: readonly { value: string; label: string }[];
  report: TransactionReportConfig;
  statusLabel: (status: string) => string;
  countsTowardTotal: (status: string) => boolean;
  nextStatuses: (status: string) => string[];
  requiresNote: (status: string) => boolean;
  createSchema: typeof createRetailBuySchema;
  useList: (filter: RetailFilter) => QueryLike<RetailTransaction[]>;
  useDetail: (id: string) => QueryLike<RetailDetail>;
  useCreate: () => MutationLike<CreateRetailBuyReq>;
  useAdvance: (id: string) => MutationLike<{ toStatus: string; note?: string }>;
}

/**
 * The hooks are typed by what these pages read, not as `typeof useRetailBuyList` and friends.
 *
 * Borrowing the buy hooks' exact types looks tidier and does not compile: the two domains' status
 * unions differ by `SHIPPED`, so the sell hooks are not assignable to the buy ones. Describing the
 * surface the pages use keeps both domains satisfying one config, and `toStatus: string` is honest
 * about the fact that the page passes through whatever the shared transition map offered.
 */
interface QueryLike<T> {
  data: T | undefined;
  isPending: boolean;
  isError: boolean;
  error: unknown;
}

interface MutationLike<TVars> {
  mutate: (
    vars: TVars,
    opts?: { onSuccess?: () => void; onError?: (err: Error) => void },
  ) => void;
  isPending: boolean;
}

type RetailDetail = { transaction: RetailTransaction; statuses: RetailStatusEntry[] };

export const RETAIL_BUY_UI: RetailUiConfig = {
  key: "retail-buy",
  basePath: "/retail-buy",
  listTitle: "ซื้อปลีก",
  createTitle: "บันทึกรายการซื้อปลีก",
  detailTitle: "รายละเอียดรายการซื้อปลีก",
  createAction: "บันทึกรายการ",
  createdToast: "บันทึกรายการซื้อปลีกแล้ว",
  priceLabel: "ราคารับซื้อต่อบาททอง",
  feeLabel: "ค่าดำเนินการ (บาท)",
  feeHelper: "ไม่รวมอยู่ในยอดรวม — ยอดรวมคือมูลค่าทองอย่างเดียว",
  statuses: RETAIL_BUY_STATUSES,
  report: RETAIL_BUY_REPORT,
  statusLabel: buyStatusLabel,
  countsTowardTotal: buyCountsTowardTotal,
  nextStatuses: buyNextStatuses,
  requiresNote: buyRequiresNote,
  createSchema: createRetailBuySchema,
  useList: useRetailBuyList,
  useDetail: useRetailBuyDetail,
  useCreate: useCreateRetailBuy,
  useAdvance: useAdvanceRetailBuyStatus,
};

export const RETAIL_SELL_UI: RetailUiConfig = {
  key: "retail-sell",
  basePath: "/retail-sell",
  listTitle: "ขายปลีก",
  createTitle: "บันทึกรายการขายปลีก",
  detailTitle: "รายละเอียดรายการขายปลีก",
  createAction: "บันทึกรายการ",
  createdToast: "บันทึกรายการขายปลีกแล้ว",
  priceLabel: "ราคาขายต่อบาททอง",
  feeLabel: "ค่าดำเนินการ (บาท)",
  feeHelper: "เช่น ค่าบล็อค — ไม่รวมอยู่ในยอดรวม",
  statuses: RETAIL_SELL_STATUSES,
  report: RETAIL_SELL_REPORT,
  statusLabel: sellStatusLabel,
  countsTowardTotal: sellCountsTowardTotal,
  nextStatuses: sellNextStatuses,
  requiresNote: sellRequiresNote,
  createSchema: createRetailSellSchema,
  useList: useRetailSellList,
  useDetail: useRetailSellDetail,
  useCreate: useCreateRetailSell,
  useAdvance: useAdvanceRetailSellStatus,
};
