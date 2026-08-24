import { useMutation, useQueryClient } from "@tanstack/react-query";
import type {
  AdvanceRetailBuyStatusReq, AdvanceRetailSellStatusReq,
  CreateRetailBuyReq, CreateRetailSellReq,
} from "@gold-platform/types";
import { assertOk, client } from "../api/client";

/**
 * Retail mutations invalidate their own domain and **nothing else**.
 *
 * The wholesale hooks also invalidate `["inventory"]`, because their status moves book stock
 * movements. Retail books none — the balance is maintained by hand through the gain/loss forms — so
 * refetching it here would suggest a coupling that does not exist.
 */
function useInvalidateRetailBuy() {
  const queryClient = useQueryClient();
  return () => queryClient.invalidateQueries({ queryKey: ["retail-buy"] });
}

function useInvalidateRetailSell() {
  const queryClient = useQueryClient();
  return () => queryClient.invalidateQueries({ queryKey: ["retail-sell"] });
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

/** The only move a confirmed write-up has. The API refuses it without a note. */
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
