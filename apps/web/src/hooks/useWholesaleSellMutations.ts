import { useMutation, useQueryClient } from "@tanstack/react-query";
import type {
  AdvanceWholeSellStatusReq, CreateWholeSellReq, UpdateWholeSellReq,
} from "@gold-platform/types";
import { client } from "../api/client";

async function parseErrorMessage(res: Response) {
  const body: unknown = await res.json().catch(() => null);
  if (typeof body === "object" && body !== null && "error" in body) {
    return String((body as { error: unknown }).error);
  }
  return "Request failed";
}

// every wholesale-sell mutation invalidates the domain's lists and detail views; a status move
// can also change inventory, so the balance queries go with them
function useInvalidateWholesaleSell() {
  const queryClient = useQueryClient();
  return () => {
    queryClient.invalidateQueries({ queryKey: ["wholesale-sell"] });
    queryClient.invalidateQueries({ queryKey: ["inventory"] });
  };
}

export function useCreateWholesaleSell() {
  const invalidate = useInvalidateWholesaleSell();
  return useMutation({
    mutationFn: async (req: CreateWholeSellReq) => {
      const res = await client["wholesale-sell"].$post({ json: req });
      if (!res.ok) throw new Error(await parseErrorMessage(res));
      return res.json();
    },
    onSuccess: invalidate,
  });
}

export function useUpdateWholesaleSell(id: string) {
  const invalidate = useInvalidateWholesaleSell();
  return useMutation({
    mutationFn: async (req: UpdateWholeSellReq) => {
      const res = await client["wholesale-sell"][":id"].$patch({ param: { id }, json: req });
      if (!res.ok) throw new Error(await parseErrorMessage(res));
      return res.json();
    },
    onSuccess: invalidate,
  });
}

export function useAdvanceWholesaleSellStatus(id: string) {
  const invalidate = useInvalidateWholesaleSell();
  return useMutation({
    mutationFn: async (req: AdvanceWholeSellStatusReq) => {
      const res = await client["wholesale-sell"][":id"].status.$post({ param: { id }, json: req });
      if (!res.ok) throw new Error(await parseErrorMessage(res));
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
export function useConfirmAllWholesaleSell() {
  const invalidate = useInvalidateWholesaleSell();
  return useMutation({
    mutationFn: async () => {
      const res = await client["wholesale-sell"]["confirm-all"].$post({ query: { manual: "true" } });
      if (!res.ok) throw new Error(await parseErrorMessage(res));
      return (await res.json()) as { data: { confirmed: number; ids: string[] } };
    },
    onSuccess: invalidate,
  });
}
