import { useQuery } from "@tanstack/react-query";
import type { ReturnReasonValue } from "@gold-platform/types";
import { client } from "../api/client";

export interface WholeBuyTransaction {
  id: string;
  supplierId: string;
  purityId: string;
  productTypeId: string;
  weightGb: number;
  weightGm: number;
  conversionFactor: number;
  pricePerGb965: number;
  pricePerGb999: number;
  totalAmount: number;
  // the weight we contest, written only on a DISPUTED move and cleared again on acceptance
  actualWeightGb: number | null;
  actualWeightGm: number | null;
  actualAmount: number | null;
  // what was actually paid, when it differed from totalAmount; null means it matched
  settledAmount: number | null;
  // why the shipment went back; set on the move into RETURNED
  returnReason: ReturnReasonValue | null;
  // the day the order was placed, `YYYY-MM-DD` — what the settlement period is derived from and
  // what lists and reports read. Distinct from recordedAt below, which is when the row was
  // written; they agree unless the entry was made after the fact.
  transactionDate: string;
  settlementPeriod: string;
  currentStatus: string;
  confirmDueAt: string;
  notes: string | null;
  recordedBy: string;
  recordedAt: string;
}

/**
 * What a transaction actually moved, per branded pool — read back off the inventory movement
 * ledger rather than a column on the transaction, because the movements are where it was written.
 * Empty until the transition that moves stock has run.
 */
export interface BrandSplitLine {
  brandId: string;
  weightGb: number;
  weightGm: number;
}

export interface WholeBuyStatusEntry {
  id: string;
  transactionId: string;
  status: string;
  note: string | null;
  createdBy: string;
  createdAt: string;
}

export interface WholeBuyFilter {
  currentStatus?: string;
  settlementPeriod?: string;
  supplierId?: string;
}

async function unwrap<T>(res: Response, fallback: string): Promise<T> {
  const body = (await res.json().catch(() => null)) as { data?: T; error?: string } | null;
  if (!res.ok || !body) throw new Error(body?.error ?? fallback);
  return body.data as T;
}

export function useWholesaleBuyList(filter: WholeBuyFilter = {}) {
  return useQuery({
    queryKey: ["wholesale-buy", filter],
    queryFn: async () => {
      const res = await client["wholesale-buy"].$get({ query: filter });
      return unwrap<WholeBuyTransaction[]>(res, "Failed to fetch wholesale buy transactions");
    },
  });
}

export function useWholesaleBuyDetail(id: string) {
  return useQuery({
    queryKey: ["wholesale-buy", id],
    enabled: !!id,
    queryFn: async () => {
      const res = await client["wholesale-buy"][":id"].$get({ param: { id } });
      return unwrap<{ transaction: WholeBuyTransaction; statuses: WholeBuyStatusEntry[]; brandSplit: BrandSplitLine[] }>(
        res,
        "Failed to fetch transaction",
      );
    },
  });
}
