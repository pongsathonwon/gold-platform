import { useMutation, useQueryClient } from "@tanstack/react-query";
import type {
  AdvanceWholeBuyStatusReq, CreateWholeBuyReq,
  ReceiveStockWholeBuyReq, UpdateWholeBuyReq,
} from "@gold-platform/types";
import { assertOk, client } from "../api/client";

// every wholesale-buy mutation invalidates the domain's lists and detail views; a status move
// can also change inventory, so the balance queries go with them
function useInvalidateWholesaleBuy() {
  const queryClient = useQueryClient();
  return () => {
    queryClient.invalidateQueries({ queryKey: ["wholesale-buy"] });
    queryClient.invalidateQueries({ queryKey: ["inventory"] });
  };
}

export function useCreateWholesaleBuy() {
  const invalidate = useInvalidateWholesaleBuy();
  return useMutation({
    mutationFn: async (req: CreateWholeBuyReq) => {
      const res = await client["wholesale-buy"].$post({ json: req });
      await assertOk(res, "ทำรายการไม่สำเร็จ");
      return res.json();
    },
    onSuccess: invalidate,
  });
}

export function useUpdateWholesaleBuy(id: string) {
  const invalidate = useInvalidateWholesaleBuy();
  return useMutation({
    mutationFn: async (req: UpdateWholeBuyReq) => {
      const res = await client["wholesale-buy"][":id"].$patch({ param: { id }, json: req });
      await assertOk(res, "ทำรายการไม่สำเร็จ");
      return res.json();
    },
    onSuccess: invalidate,
  });
}

export function useAdvanceWholesaleBuyStatus(id: string) {
  const invalidate = useInvalidateWholesaleBuy();
  return useMutation({
    mutationFn: async (req: AdvanceWholeBuyStatusReq) => {
      const res = await client["wholesale-buy"][":id"].status.$post({ param: { id }, json: req });
      await assertOk(res, "ทำรายการไม่สำเร็จ");
      return res.json();
    },
    onSuccess: invalidate,
  });
}

/**
 * Manual mid-day run of the same bulk confirm the nightly job performs: every transaction still
 * in CREATED moves to CONFIRMED. `manual=true` is what makes the log attribute it to the operator
 * instead of BOT-CONFIRM.
 */
export function useConfirmAllWholesaleBuy() {
  const invalidate = useInvalidateWholesaleBuy();
  return useMutation({
    mutationFn: async () => {
      const res = await client["wholesale-buy"]["confirm-all"].$post({ query: { manual: "true" } });
      await assertOk(res, "ทำรายการไม่สำเร็จ");
      return (await res.json()) as { data: { confirmed: number; ids: string[] } };
    },
    onSuccess: invalidate,
  });
}

// Receive + stock in one action — the two status entries are still recorded server-side.
// It carries no weight: accepting means the delivery matched its document, and one that did not
// was refused at the door before custody transferred.
export function useReceiveStockWholesaleBuy(id: string) {
  const invalidate = useInvalidateWholesaleBuy();
  return useMutation({
    mutationFn: async (req: ReceiveStockWholeBuyReq) => {
      const res = await client["wholesale-buy"][":id"]["receive-stock"].$post({
        param: { id }, json: req,
      });
      await assertOk(res, "ทำรายการไม่สำเร็จ");
      return res.json();
    },
    onSuccess: invalidate,
  });
}
