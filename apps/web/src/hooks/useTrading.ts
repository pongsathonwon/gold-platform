import { useMemo } from "react";
import { useWholesaleBuyList } from "./useWholesaleBuy";
import { useWholesaleSellList } from "./useWholesaleSell";
import { useRetailBuyList, useRetailSellList } from "./useRetail";
import { useBranches, useProductTypes, usePurities, useSuppliers } from "./useMasterData";
import {
  fromRetail, fromWholesaleBuy, fromWholesaleSell, type TradingRow,
} from "../utils/trading";

export interface TradingWindow {
  from: string;
  to: string;
}

/**
 * One window, read across all four transaction domains.
 *
 * The four list endpoints are queried in parallel and their rows normalised into `TradingRow`, which
 * is where every domain rule is applied. Everything downstream — all three trading views — reads
 * this one array, so they cannot show different numbers for the same week.
 *
 * There is no combined endpoint to call instead: none exists, and the per-domain queries are already
 * cached by the list pages under the same keys, so opening this page after browsing a domain costs
 * nothing extra.
 */
export function useTrading({ from, to }: TradingWindow) {
  const filter = useMemo(
    () => ({ ...(from ? { from } : {}), ...(to ? { to } : {}) }),
    [from, to],
  );

  const wholesaleBuy = useWholesaleBuyList(filter);
  const wholesaleSell = useWholesaleSellList(filter);
  const retailBuy = useRetailBuyList(filter);
  const retailSell = useRetailSellList(filter);

  const { data: suppliersRes } = useSuppliers();
  const { data: branchesRes } = useBranches();
  const { data: puritiesRes } = usePurities();
  const { data: productTypesRes } = useProductTypes();

  const lookups = useMemo(() => {
    const suppliers = new Map((suppliersRes?.data ?? []).map((s) => [s.id, s.supplierName]));
    const branches = new Map((branchesRes?.data ?? []).map((b) => [b.branchCode, b.branchName]));
    const purities = new Map((puritiesRes?.data ?? []).map((p) => [p.id, p.percent]));
    const productTypes = new Map((productTypesRes?.data ?? []).map((p) => [p.id, p.productType]));
    return {
      // fall back to the raw id rather than a blank: a code is ugly but it is not a lie, and it
      // survives a branch that has since been retired
      supplierName: (id: string) => suppliers.get(id) ?? id,
      branchName: (code: string) => branches.get(code) ?? code,
      productTypeName: (id: string) => productTypes.get(id) ?? id,
      isNineNineNine: (purityId: string) => purities.get(purityId) === 99.9,
    };
  }, [suppliersRes, branchesRes, puritiesRes, productTypesRes]);

  const rows: TradingRow[] = useMemo(() => {
    const { supplierName, branchName, isNineNineNine } = lookups;
    return [
      ...fromWholesaleBuy(wholesaleBuy.data ?? [], supplierName, isNineNineNine),
      ...fromWholesaleSell(wholesaleSell.data ?? [], supplierName, isNineNineNine),
      ...fromRetail(retailBuy.data ?? [], "RETAIL_BUY", branchName),
      ...fromRetail(retailSell.data ?? [], "RETAIL_SELL", branchName),
    ];
  }, [wholesaleBuy.data, wholesaleSell.data, retailBuy.data, retailSell.data, lookups]);

  const queries = [wholesaleBuy, wholesaleSell, retailBuy, retailSell];

  return {
    rows,
    productTypeName: lookups.productTypeName,
    isNineNineNine: lookups.isNineNineNine,
    /**
     * Pending until **every** domain has answered. A partial window would quietly report a spread
     * against a side whose rows had not arrived — a number that looks like an answer and is not.
     */
    isPending: queries.some((q) => q.isPending),
    isError: queries.some((q) => q.isError),
    error: queries.find((q) => q.isError)?.error,
  };
}
