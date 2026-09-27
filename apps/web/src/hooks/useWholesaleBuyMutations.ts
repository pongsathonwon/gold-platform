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

async function postStatus(id: string, req: AdvanceWholeBuyStatusReq) {
  const res = await client["wholesale-buy"][":id"].status.$post({ param: { id }, json: req });
  await assertOk(res, "ทำรายการไม่สำเร็จ");
  return res.json();
}

export function useAdvanceWholesaleBuyStatus(id: string) {
  const invalidate = useInvalidateWholesaleBuy();
  return useMutation({
    mutationFn: (req: AdvanceWholeBuyStatusReq) => postStatus(id, req),
    onSuccess: invalidate,
  });
}

/**
 * The same move with the row in the variables. The list's quick advance does not know which row
 * until the click, and a hook cannot be called per row, so one mutation serves the whole table.
 */
export function useQuickAdvanceWholesaleBuyStatus() {
  const invalidate = useInvalidateWholesaleBuy();
  return useMutation({
    mutationFn: ({ id, ...req }: { id: string } & AdvanceWholeBuyStatusReq) => postStatus(id, req),
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
async function postReceiveStock(id: string, req: ReceiveStockWholeBuyReq) {
  const res = await client["wholesale-buy"][":id"]["receive-stock"].$post({
    param: { id }, json: req,
  });
  await assertOk(res, "ทำรายการไม่สำเร็จ");
  return res.json();
}

export function useReceiveStockWholesaleBuy(id: string) {
  const invalidate = useInvalidateWholesaleBuy();
  return useMutation({
    mutationFn: (req: ReceiveStockWholeBuyReq) => postReceiveStock(id, req),
    onSuccess: invalidate,
  });
}

/** Receive + stock with the row in the variables, for the list's quick advance from PAID. */
export function useQuickReceiveStockWholesaleBuy() {
  const invalidate = useInvalidateWholesaleBuy();
  return useMutation({
    mutationFn: ({ id, ...req }: { id: string } & ReceiveStockWholeBuyReq) => postReceiveStock(id, req),
    onSuccess: invalidate,
  });
}
