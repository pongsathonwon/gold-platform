import { useQuery } from "@tanstack/react-query";
import { client } from "../api/client";

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
  movedAt: string;
  movedBy: string;
}

export interface InventoryMovementFilter {
  purityId?: string;
  brandId?: string;
  origin?: "domestic" | "foreign";
  productTypeId?: string;
  referenceType?: string;
}

export function useInventoryVolume() {
  return useQuery({
    queryKey: ["inventory", "volume"],
    queryFn: async () => {
      const res = await client.inventory.volume.$get();
      if (!res.ok) throw new Error("Failed to fetch inventory volume");
      return (await res.json()) as { data: InventoryVolumeRow[] };
    },
  });
}

export function useInventoryMovements(filter: InventoryMovementFilter = {}) {
  return useQuery({
    queryKey: ["inventory", "movements", filter],
    queryFn: async () => {
      const res = await client.inventory.movements.$get({ query: filter });
      if (!res.ok) throw new Error("Failed to fetch inventory movements");
      return (await res.json()) as { data: InventoryMovementRow[] };
    },
  });
}
