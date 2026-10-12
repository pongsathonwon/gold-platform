import {
  Alert, Box, Card, CardContent, CircularProgress, Container, Paper, Table, TableBody, TableCell,
  TableContainer, TableHead, TableRow, Typography,
} from "@mui/material";
import { todayBusinessDate } from "@gold-platform/types";
import { useTransactionRows } from "../hooks/useTransactionRows";
import { useInventoryVolume } from "../hooks/useInventory";
import { splitPurity, type TradingRow } from "../utils/trading";
import { splitByPurity, type VolumeRow } from "../utils/inventoryVolume";
import { buildGoldBalance, type BalanceGroup } from "../utils/goldBalance";
import { formatBusinessDate, formatNumber, formatWeight } from "../utils/format";

/**
 * งบดุลทองคำ — the gold the business holds and is owed, as of now.
 *
 * A balance sheet in metal: the inventory ledger is the on-hand figure (the "cash" of the sheet),
 * open buys waiting to be paid or delivered are what the shop is owed, open sells not yet pulled
 * from the vault are what it owes, and the net is the position once everything open settles. The
 * placement rules live in `utils/goldBalance.ts`.
 *
 * **No date window.** A balance is a point in time, and an order placed six weeks ago that is still
 * waiting for delivery is exactly as open as one placed this morning — a window would hide the old
 * ones, which are the ones most worth seeing. So every transaction is read and the settled ones
 * drop out by status.
 */

type Unit = "gb" | "kg";

const ALL_TIME = { from: "", to: "" };

const weightIn = (unit: Unit, w: { weightGb: number; weightGm: number }) =>
  unit === "gb" ? w.weightGb : w.weightGm / 1000;

const signed = (n: number) => `${n > 0 ? "+" : ""}${formatWeight(n)}`;

function Figure({ label, value, note, tone }: {
  label: string;
  value: string;
  note: string;
  tone?: "positive" | "negative";
}) {
  return (
    <Paper variant="outlined" sx={{ p: 2, flex: "1 1 180px" }}>
      <Typography variant="caption" color="text.secondary">
        {label}
      </Typography>
      <Typography
        variant="h4"
        sx={{
          fontVariantNumeric: "tabular-nums",
          mt: 0.5,
          color: tone === "positive" ? "success.main" : tone === "negative" ? "error.main" : undefined,
        }}
      >
        {value}
      </Typography>
      <Typography variant="caption" color="text.secondary" sx={{ display: "block" }}>
        {note}
      </Typography>
    </Paper>
  );
}

const num = { fontVariantNumeric: "tabular-nums" } as const;

/** Shared by the sheet and the memo below it, so their columns line up and read the same. */
function ColumnHeads({ unitLabel }: { unitLabel: string }) {
  return (
    <TableHead>
      <TableRow>
        <TableCell sx={{ width: "32%" }}>รายการ</TableCell>
        <TableCell sx={{ width: "23%" }}>สถานะ</TableCell>
        <TableCell align="right" sx={{ width: "13%" }}>จำนวนรายการ</TableCell>
        <TableCell align="right" sx={{ width: "14%" }}>น้ำหนัก ({unitLabel})</TableCell>
        <TableCell align="right" sx={{ width: "18%" }}>มูลค่า (บาท)</TableCell>
      </TableRow>
    </TableHead>
  );
}

/** A section heading row: ก. / ข. / ค., with its subtotal on the same line. */
function HeadingRow({ label, count, weight, amount }: {
  label: string;
  count?: number;
  weight: number;
  amount?: number;
}) {
  return (
    <TableRow sx={{ bgcolor: "action.hover" }}>
      <TableCell colSpan={2} sx={{ fontWeight: 700 }}>{label}</TableCell>
      <TableCell align="right" sx={{ ...num, fontWeight: 700 }}>{count ?? ""}</TableCell>
      <TableCell align="right" sx={{ ...num, fontWeight: 700 }}>{formatWeight(weight)}</TableCell>
      <TableCell align="right" sx={{ ...num, fontWeight: 700 }}>
        {amount === undefined ? "" : formatNumber(amount)}
      </TableCell>
    </TableRow>
  );
}

/**
 * One bucket, then its deals grouped by status beneath it. An empty bucket still renders with 0:
 * "nothing is waiting for delivery" is worth reading, and a line item that comes and goes makes two
 * days' sheets hard to compare.
 */
function GroupRows({ group, unit }: { group: BalanceGroup; unit: Unit }) {
  return (
    <>
      <TableRow>
        <TableCell sx={{ pl: 3, fontWeight: 600 }} colSpan={2}>{group.label}</TableCell>
        <TableCell align="right" sx={{ ...num, fontWeight: 600 }}>{group.count}</TableCell>
        <TableCell align="right" sx={{ ...num, fontWeight: 600 }}>{formatWeight(weightIn(unit, group))}</TableCell>
        <TableCell align="right" sx={{ ...num, fontWeight: 600 }}>{formatNumber(group.amount)}</TableCell>
      </TableRow>
      {group.lines.map((line) => (
        <TableRow key={line.status}>
          <TableCell sx={{ pl: 6 }} />
          <TableCell sx={{ color: "text.secondary" }}>{line.statusLabel}</TableCell>
          <TableCell align="right" sx={{ ...num, color: "text.secondary" }}>{line.count}</TableCell>
          <TableCell align="right" sx={{ ...num, color: "text.secondary" }}>{formatWeight(weightIn(unit, line))}</TableCell>
          <TableCell align="right" sx={{ ...num, color: "text.secondary" }}>{formatNumber(line.amount)}</TableCell>
        </TableRow>
      ))}
    </>
  );
}

function Section({ title, unit, rows, inventory, productTypeName }: {
  title: string;
  unit: Unit;
  rows: TradingRow[];
  inventory: VolumeRow[];
  productTypeName: (id: string) => string;
}) {
  const balance = buildGoldBalance(rows, inventory);
  const unitLabel = unit === "gb" ? "บาททอง" : "กก.";
  const onHand = weightIn(unit, balance.physicalTotal);
  const incoming = weightIn(unit, balance.incomingTotal);
  const outgoing = weightIn(unit, balance.outgoingTotal);
  const net = weightIn(unit, balance.net);

  return (
    <Box sx={{ mb: 5 }}>
      <Typography variant="h3" sx={{ mb: 2 }}>
        {title}
      </Typography>

      <Box sx={{ display: "flex", gap: 1.5, mb: 2, flexWrap: "wrap" }}>
        <Figure label="ทองในคลัง" value={formatWeight(onHand)} note={`${unitLabel} · ทองที่มีอยู่จริง`} />
        <Figure label="รอรับเข้า" value={`+${formatWeight(incoming)}`} note={`${unitLabel} · ${balance.incomingTotal.count} รายการ`} />
        <Figure label="ค้างส่งมอบ" value={`−${formatWeight(outgoing)}`} note={`${unitLabel} · ${balance.outgoingTotal.count} รายการ`} />
        <Figure
          label="ฐานะทองสุทธิ"
          value={formatWeight(net)}
          note={`${unitLabel} · รายการค้างสุทธิ ${signed(incoming - outgoing)}`}
          tone={net >= 0 ? "positive" : "negative"}
        />
      </Box>

      <TableContainer component={Paper} variant="outlined">
        <Table size="small">
          <ColumnHeads unitLabel={unitLabel} />
          <TableBody>
            {/* The value column changes meaning down the sheet, so each heading says which: book
                cost here, the deal's own price below. They are never added together. */}
            <HeadingRow label="ก. ทองในคลัง (ต้นทุน WAC)" weight={onHand} amount={balance.physicalTotal.cost} />
            {balance.physical.map((line) => (
              <TableRow key={line.productTypeId}>
                <TableCell sx={{ pl: 3 }} colSpan={3}>{productTypeName(line.productTypeId)}</TableCell>
                <TableCell align="right" sx={num}>{formatWeight(weightIn(unit, line))}</TableCell>
                <TableCell align="right" sx={num}>{formatNumber(line.cost)}</TableCell>
              </TableRow>
            ))}

            <HeadingRow
              label="ข. บวก ทองรอรับเข้า (ราคาตามรายการ)"
              count={balance.incomingTotal.count}
              weight={incoming}
              amount={balance.incomingTotal.amount}
            />
            {balance.incoming.map((g) => <GroupRows key={g.key} group={g} unit={unit} />)}

            <HeadingRow
              label="ค. หัก ทองค้างส่งมอบ (ราคาตามรายการ)"
              count={balance.outgoingTotal.count}
              weight={outgoing}
              amount={balance.outgoingTotal.amount}
            />
            {balance.outgoing.map((g) => <GroupRows key={g.key} group={g} unit={unit} />)}

            <TableRow>
              <TableCell colSpan={3} sx={{ fontWeight: 700, borderTop: 2, borderColor: "text.primary" }}>
                ฐานะทองสุทธิ (ก + ข − ค)
              </TableCell>
              <TableCell
                align="right"
                sx={{
                  ...num,
                  fontWeight: 700,
                  borderTop: 2,
                  borderColor: "text.primary",
                  color: net >= 0 ? "success.main" : "error.main",
                }}
              >
                {formatWeight(net)}
              </TableCell>
              <TableCell sx={{ borderTop: 2, borderColor: "text.primary" }} />
            </TableRow>
          </TableBody>
        </Table>
      </TableContainer>

      <Typography variant="subtitle2" sx={{ mt: 3, mb: 1 }}>
        รายการเปิดที่ไม่นับในฐานะทอง
      </Typography>
      <Typography variant="caption" color="text.secondary" sx={{ display: "block", mb: 1 }}>
        ทองของรายการเหล่านี้ออกจากสต๊อก (หรือคืนผู้ขาย) ไปแล้ว สิ่งที่ยังค้างอยู่คือเงิน ไม่ใช่ทอง
        จึงไม่นำมาหักหรือบวกซ้ำ
      </Typography>
      <TableContainer component={Paper} variant="outlined">
        <Table size="small">
          <ColumnHeads unitLabel={unitLabel} />
          <TableBody>
            {balance.memo.map((g) => <GroupRows key={g.key} group={g} unit={unit} />)}
          </TableBody>
        </Table>
      </TableContainer>
    </Box>
  );
}

export function GoldBalancePage() {
  const { rows, productTypeName, isNineNineNine, isPending, isError, error } = useTransactionRows(ALL_TIME);
  const volume = useInventoryVolume();

  const inventory = volume.data?.data ?? [];
  const { nineSixFive, nineNineNine } = splitPurity(rows, isNineNineNine);
  const pools = splitByPurity(inventory, (pool) => isNineNineNine(pool.purityId));

  // Both halves are needed before the sheet means anything: on-hand without the open deals is just
  // the inventory page, and open deals without on-hand is a net against nothing.
  const pending = isPending || volume.isPending;
  const failed = isError || volume.isError;
  const failure = error ?? volume.error;

  return (
    <Container sx={{ py: 4 }}>
      <Typography variant="h2" sx={{ mb: 1 }}>
        งบดุลทองคำ
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
        ทองในคลัง + ทองที่รอรับเข้า − ทองที่ค้างส่งมอบ ณ {formatBusinessDate(todayBusinessDate())} ·
        นับทุกรายการที่ยังไม่เข้า/ออกสต๊อก ไม่จำกัดช่วงวันที่
      </Typography>

      {pending && (
        <Box sx={{ display: "flex", justifyContent: "center", py: 6 }}>
          <CircularProgress />
        </Box>
      )}
      {failed && (
        <Alert severity="error">{failure instanceof Error ? failure.message : "โหลดข้อมูลไม่สำเร็จ"}</Alert>
      )}
      {!pending && !failed && (
        <Card variant="outlined">
          <CardContent>
            <Section
              title="ทอง 96.5%"
              unit="gb"
              rows={nineSixFive}
              inventory={pools.nineSixFive}
              productTypeName={productTypeName}
            />
            {/* written even when empty, like every other purity-split view: a missing section
                reads as a broken page rather than as a purity nobody holds */}
            <Section
              title="ทอง 99.9%"
              unit="kg"
              rows={nineNineNine}
              inventory={pools.nineNineNine}
              productTypeName={productTypeName}
            />
          </CardContent>
        </Card>
      )}
    </Container>
  );
}
