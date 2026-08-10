import { useQuery } from "@tanstack/react-query";
import type { ReturnReasonValue } from "@gold-platform/types";
import { client } from "../api/client";

export interface WholeSellTransaction {
  id: string;
  supplierId: string;
  purityId: string;
  brandId: string;
  productTypeId: string;
  weightGb: number;
  weightGm: number;
  conversionFactor: number;
  pricePerGb965: number;
  pricePerGb999: number;
  totalAmount: number;
  // the buyer's contested weight, written only on a DISPUTED move
  actualWeightGb: number | null;
  actualWeightGm: number | null;
  actualAmount: number | null;
  // what the buyer actually settled, when it differed from totalAmount; null means it matched
  settledAmount: number | null;
  // why the gold came home; set on the move into RETURNED
  returnReason: ReturnReasonValue | null;
  settlementPeriod: string;
  currentStatus: string;
  confirmDueAt: string;
  notes: string | null;
  recordedBy: string;
  recordedAt: string;
}

export interface WholeSellStatusEntry {
  id: string;
  transactionId: string;
  status: string;
  note: string | null;
  createdBy: string;
  createdAt: string;
}

export interface WholeSellFilter {
  currentStatus?: string;
  settlementPeriod?: string;
  supplierId?: string;
}

async function unwrap<T>(res: Response, fallback: string): Promise<T> {
  const body = (await res.json().catch(() => null)) as { data?: T; error?: string } | null;
  if (!res.ok || !body) throw new Error(body?.error ?? fallback);
  return body.data as T;
}

export function useWholesaleSellList(filter: WholeSellFilter = {}) {
  return useQuery({
    queryKey: ["wholesale-sell", filter],
    queryFn: async () => {
      const res = await client["wholesale-sell"].$get({ query: filter });
      return unwrap<WholeSellTransaction[]>(res, "Failed to fetch wholesale sell transactions");
    },
  });
}

export function useWholesaleSellDetail(id: string) {
  return useQuery({
    queryKey: ["wholesale-sell", id],
    enabled: !!id,
    queryFn: async () => {
      const res = await client["wholesale-sell"][":id"].$get({ param: { id } });
      return unwrap<{ transaction: WholeSellTransaction; statuses: WholeSellStatusEntry[] }>(
        res,
        "Failed to fetch transaction",
      );
    },
  });
}
