import { useMutation, useQueryClient } from "@tanstack/react-query";
import type {
  AdvanceRetailBuyStatusReq, AdvanceRetailSellStatusReq,
  CreateRetailBuyReq, CreateRetailSellReq,
} from "@gold-platform/types";
import { assertOk, client } from "../api/client";

/**
 * Retail mutations invalidate their own domain and the inventory queries, as the wholesale hooks
 * do: a status move into `STOCKED` or `PACKED` books stock movements, so a balance page open in
 * another tab has to refetch. Creating or voiding moves nothing, but invalidating on every
 * mutation is cheaper than teaching each hook which one did.
 */
function useInvalidateRetailBuy() {
  const queryClient = useQueryClient();
  return () => {
    queryClient.invalidateQueries({ queryKey: ["retail-buy"] });
    queryClient.invalidateQueries({ queryKey: ["inventory"] });
  };
}

function useInvalidateRetailSell() {
  const queryClient = useQueryClient();
  return () => {
    queryClient.invalidateQueries({ queryKey: ["retail-sell"] });
    queryClient.invalidateQueries({ queryKey: ["inventory"] });
  };
}

export function useCreateRetailBuy() {
  const invalidate = useInvalidateRetailBuy();
  return useMutation({
    mutationFn: async (req: CreateRetailBuyReq) => {
      const res = await client["retail-buy"].$post({ json: req });
      await assertOk(res, "บันทึกรายการไม่สำเร็จ");
      return res.json();
    },
    onSuccess: invalidate,
  });
}

/** Stock the gold (with its brand split) or void the write-up — the API refuses a void without a note. */
export function useAdvanceRetailBuyStatus(id: string) {
  const invalidate = useInvalidateRetailBuy();
  return useMutation({
    mutationFn: async (req: AdvanceRetailBuyStatusReq) => {
      const res = await client["retail-buy"][":id"].status.$post({ param: { id }, json: req });
      await assertOk(res, "ทำรายการไม่สำเร็จ");
      return res.json();
    },
    onSuccess: invalidate,
  });
}

export function useCreateRetailSell() {
  const invalidate = useInvalidateRetailSell();
  return useMutation({
    mutationFn: async (req: CreateRetailSellReq) => {
      const res = await client["retail-sell"].$post({ json: req });
      await assertOk(res, "บันทึกรายการไม่สำเร็จ");
      return res.json();
    },
    onSuccess: invalidate,
  });
}

export function useAdvanceRetailSellStatus(id: string) {
  const invalidate = useInvalidateRetailSell();
  return useMutation({
    mutationFn: async (req: AdvanceRetailSellStatusReq) => {
      const res = await client["retail-sell"][":id"].status.$post({ param: { id }, json: req });
      await assertOk(res, "ทำรายการไม่สำเร็จ");
      return res.json();
    },
    onSuccess: invalidate,
  });
}
