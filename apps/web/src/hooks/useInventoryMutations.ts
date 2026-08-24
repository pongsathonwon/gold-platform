import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { StockGainReq, StockLossReq, ProductSwitchReq } from "@gold-platform/types";
import { assertOk, client } from "../api/client";

export function useStockGain() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (req: StockGainReq) => {
      const res = await client.inventory.gain.$post({ json: req });
      await assertOk(res, "ทำรายการไม่สำเร็จ");
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
      await assertOk(res, "ทำรายการไม่สำเร็จ");
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
      await assertOk(res, "ทำรายการไม่สำเร็จ");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["inventory", "volume"] });
    },
  });
}
