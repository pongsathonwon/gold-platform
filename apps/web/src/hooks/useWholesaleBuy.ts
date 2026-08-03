import { useQuery } from "@tanstack/react-query";
import { client } from "../api/client";

export interface WholeBuyTransaction {
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
  actualWeightGb: number | null;
  actualWeightGm: number | null;
  actualAmount: number | null;
  settlementPeriod: string;
  currentStatus: string;
  confirmDueAt: string;
  notes: string | null;
  recordedBy: string;
  recordedAt: string;
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
      return unwrap<{ transaction: WholeBuyTransaction; statuses: WholeBuyStatusEntry[] }>(
        res,
        "Failed to fetch transaction",
      );
    },
  });
}
