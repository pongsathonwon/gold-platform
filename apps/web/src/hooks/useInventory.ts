import { useQuery } from "@tanstack/react-query";
import { assertOk, client } from "../api/client";

export interface InventoryVolumeRow {
  purityId: string;
  brandId: string;
  origin: string;
  productTypeId: string;
  totalWeightGb: number;
  totalWeightGm: number;
  totalCost: number;
}

export interface InventoryMovementRow {
  id: string;
  purityId: string;
  brandId: string;
  origin: string;
  productTypeId: string;
  referenceType: string;
  referenceId: string;
  weightGbDelta: number;
  weightGmDelta: number;
  costDelta: number;
  notes: string | null;
  // the trading day this movement belongs to (`YYYY-MM-DD`) — what the window filters on, and
  // what a backdated adjustment carries. `movedAt` is when the row was written.
  movementDate: string;
  movedAt: string;
  movedBy: string;
}

export interface InventoryMovementFilter {
  purityId?: string;
  brandId?: string;
  origin?: "domestic" | "foreign";
  productTypeId?: string;
  referenceType?: string;
  // business days (`YYYY-MM-DD`) bounding the window [from, to] inclusive, matched against each
  // movement's movementDate — no times, so the last day of a range cannot fall off the end
  from?: string;
  to?: string;
}

export interface MovementOpening {
  purityId: string;
  weightGb: number;
  weightGm: number;
}

export function useInventoryVolume() {
  return useQuery({
    queryKey: ["inventory", "volume"],
    queryFn: async () => {
      const res = await client.inventory.volume.$get();
      await assertOk(res, "Failed to fetch inventory volume");
      return (await res.json()) as { data: InventoryVolumeRow[] };
    },
  });
}

type SuccessResponse<T> = {
  data: T
  error: never
}

type ErrorResponse<T> = {
  data: never
  error : string
}

type APIResponse<T> = SuccessResponse<T> | ErrorResponse<T>

const isError = <T>(res: APIResponse<T>) : res is ErrorResponse<T> => typeof res.error === 'string'

const isSuccess = <T>(res: APIResponse<T>) : res is SuccessResponse<T> => !!res.data

export function useInventoryMovements(filter: InventoryMovementFilter = {}) {
  return useQuery({
    queryKey: ["inventory", "movements", filter],
    queryFn: async () => {
      const res = await client.inventory.movements.$get({ query: filter });
      await assertOk(res, "Failed to fetch inventory movements");
      // movements are ascending by (movedAt, id); opening seeds the per-purity running balance
      const jsonData = (await res.json()) as APIResponse<{ movements: InventoryMovementRow[]; opening: MovementOpening[] }>;
      if(isError(jsonData)) throw new Error(jsonData.error)
      return jsonData.data
    },
  });
}
