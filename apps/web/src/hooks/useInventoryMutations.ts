import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { StockGainReq, StockLossReq, ProductSwitchReq } from "@gold-platform/types";
import { client } from "../api/client";

async function parseErrorMessage(res: Response) {
  const body: unknown = await res.json().catch(() => null);
  if (typeof body === "object" && body !== null && "error" in body) {
    return String((body as { error: unknown }).error);
  }
  return "Request failed";
}

export function useStockGain() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (req: StockGainReq) => {
      const res = await client.inventory.gain.$post({ json: req });
      if (!res.ok) throw new Error(await parseErrorMessage(res));
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["inventory", "volume"] });
    },
  });
}

export function useStockLoss() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (req: StockLossReq) => {
      const res = await client.inventory.loss.$post({ json: req });
      if (!res.ok) throw new Error(await parseErrorMessage(res));
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["inventory", "volume"] });
    },
  });
}

export function useProductSwitch() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (req: ProductSwitchReq) => {
      const res = await client.inventory["product-switch"].$post({ json: req });
      if (!res.ok) throw new Error(await parseErrorMessage(res));
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["inventory", "volume"] });
    },
  });
}
