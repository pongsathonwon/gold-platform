import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
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

export function useComputeSnapshot() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      const res = await client.inventory.snapshots.compute.$post();
      if (!res.ok) throw new Error("Failed to compute snapshot");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["inventory", "volume"] });
    },
  });
}
