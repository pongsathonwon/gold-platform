import { useQuery } from "@tanstack/react-query";
import { assertOk, client } from "../api/client";

/**
 * Queries for both retail domains.
 *
 * One file, one row shape. Retail buy and retail sell are the same record read in two directions,
 * so a `RetailBuyTransaction` and a `RetailSellTransaction` interface would be the same fields typed
 * twice — and the two would eventually drift for no reason anyone could name.
 */

export interface RetailTransaction {
  id: string;
  branchCode: string;
  purityId: string;
  productTypeId: string;
  /** Always null today: retail moves no stock, so there is no pool for a brand to key. */
  brandId: string | null;
  weightGb: number;
  weightGm: number;
  conversionFactor: number;
  /** What the trade was dealt at, per gold baht. */
  pricePerGb: number;
  /** `weightGb × pricePerGb` — gold value only. The fee below is deliberately not in it. */
  totalAmount: number;
  /** ค่าบล็อค and the like, in THB. Null when none was charged. */
  operationFee: number | null;
  // the day the trade happened, `YYYY-MM-DD` — what the settlement period is derived from and what
  // lists and reports read. Distinct from recordedAt, which is when the row was written; they agree
  // unless the entry was made after the fact.
  transactionDate: string;
  settlementPeriod: string;
  currentStatus: string;
  /** How the row arrived. `MANUAL` today; a POS feed will register its own value. */
  source: string;
  notes: string | null;
  recordedBy: string;
  recordedAt: string;
}

export interface RetailStatusEntry {
  id: string;
  transactionId: string;
  status: string;
  note: string | null;
  createdBy: string;
  createdAt: string;
}

export interface RetailFilter {
  currentStatus?: string;
  settlementPeriod?: string;
  branchCode?: string;
  // window over transactionDate, both ends inclusive — the operator's own view of their work,
  // which is a span of days rather than a settlement period
  from?: string;
  to?: string;
}

async function unwrap<T>(res: Response, fallback: string): Promise<T> {
  // assertOk owns the failure path — it is what distinguishes an expired session (401) from a
  // refusal (403) from an ordinary error, and it reads the API's own message for all three.
  await assertOk(res, fallback);
  const body = (await res.json().catch(() => null)) as { data?: T } | null;
  if (!body) throw new Error(fallback);
  return body.data as T;
}

export function useRetailBuyList(filter: RetailFilter = {}) {
  return useQuery({
    queryKey: ["retail-buy", filter],
    queryFn: async () => {
      const res = await client["retail-buy"].$get({ query: filter });
      return unwrap<RetailTransaction[]>(res, "โหลดรายการซื้อปลีกไม่สำเร็จ");
    },
  });
}

export function useRetailBuyDetail(id: string) {
  return useQuery({
    queryKey: ["retail-buy", id],
    enabled: !!id,
    queryFn: async () => {
      const res = await client["retail-buy"][":id"].$get({ param: { id } });
      return unwrap<{ transaction: RetailTransaction; statuses: RetailStatusEntry[] }>(
        res,
        "โหลดรายการไม่สำเร็จ",
      );
    },
  });
}

export function useRetailSellList(filter: RetailFilter = {}) {
  return useQuery({
    queryKey: ["retail-sell", filter],
    queryFn: async () => {
      const res = await client["retail-sell"].$get({ query: filter });
      return unwrap<RetailTransaction[]>(res, "โหลดรายการขายปลีกไม่สำเร็จ");
    },
  });
}

export function useRetailSellDetail(id: string) {
  return useQuery({
    queryKey: ["retail-sell", id],
    enabled: !!id,
    queryFn: async () => {
      const res = await client["retail-sell"][":id"].$get({ param: { id } });
      return unwrap<{ transaction: RetailTransaction; statuses: RetailStatusEntry[] }>(
        res,
        "โหลดรายการไม่สำเร็จ",
      );
    },
  });
}
