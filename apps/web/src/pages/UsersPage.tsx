import { useState } from "react";
import {
  Alert, Box, Button, Chip, CircularProgress, Dialog, DialogActions, DialogContent,
  DialogContentText, DialogTitle, MenuItem, Paper, Stack, Table, TableBody, TableCell,
  TableContainer, TableHead, TableRow, TextField, Typography,
} from "@mui/material";
import { registerSchema, userRoleLabel, type UserRoleValue } from "@gold-platform/types";
import { useAuth } from "../auth/AuthContext";
import { useToast } from "../components/ToastContext";
import {
  useCreateUser, useDeactivateUser, useRestoreUser, useUsers, type AdminUser,
} from "../hooks/useUsers";

const MIN_PASSWORD = 8;

const emptyForm = { name: "", username: "", password: "", role: "OPERATOR" as UserRoleValue };

/**
 * Account administration — the only way to issue a staff login without a shell.
 *
 * Until this page existed the shop had exactly one account, the seeded admin, and adding an
 * operator meant a hand-rolled POST with a bearer token. That is a fine way to create the first
 * account and a poor way to run a business with forty-seven branches.
 *
 * Deactivating is not deleting: the row stays, the username stays reserved, and the login stops
 * working. Every domain records who did something as a username *string* rather than a foreign key,
 * so removing a row would leave those records readable but no longer attributable — and would free
 * the name to be handed to somebody else, at which point two people share one identity in the audit
 * trail. The page says ปิดใช้งาน throughout for that reason, never ลบ.
 */
export function UsersPage() {
  const { user: currentUser } = useAuth();
  const { showToast } = useToast();
  const { data: users, isPending, isError, error } = useUsers();
  const createUser = useCreateUser();
  const deactivate = useDeactivateUser();
  const restore = useRestoreUser();

  const [form, setForm] = useState(emptyForm);
  const [formError, setFormError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<AdminUser | null>(null);

  const activeAdmins = (users ?? []).filter((u) => u.active && u.role === "ADMIN").length;

  function handleCreate() {
    const parsed = registerSchema.safeParse(form);
    if (!parsed.success) {
      setFormError(parsed.error.issues[0]?.message ?? "ข้อมูลไม่ถูกต้อง");
      return;
    }
    setFormError(null);
    createUser.mutate(parsed.data, {
      onSuccess: () => {
        showToast(`สร้างบัญชี ${form.username} แล้ว`, "success");
        setForm(emptyForm);
      },
      onError: (e) => showToast(e instanceof Error ? e.message : "สร้างผู้ใช้ไม่สำเร็จ", "error"),
    });
  }

  function handleDeactivate(target: AdminUser) {
    deactivate.mutate(target.id, {
      onSuccess: () => showToast(`ปิดใช้งาน ${target.username} แล้ว`, "success"),
      // The server owns the wording for both refusals — self-deactivation and the last admin —
      // so it is shown rather than replaced.
      onError: (e) => showToast(e instanceof Error ? e.message : "ปิดใช้งานไม่สำเร็จ", "error"),
      onSettled: () => setConfirming(null),
    });
  }

  function handleRestore(target: AdminUser) {
    restore.mutate(target.id, {
      onSuccess: () => showToast(`เปิดใช้งาน ${target.username} แล้ว`, "success"),
      onError: (e) => showToast(e instanceof Error ? e.message : "เปิดใช้งานไม่สำเร็จ", "error"),
    });
  }

  /**
   * Why a row's ปิดใช้งาน button is unavailable, or null when it is not.
   *
   * These mirror the two rules the API enforces. The API is the one that decides — this only saves
   * a round trip and, more usefully, says why *before* the click rather than in a toast after it.
   */
  function blockedReason(target: AdminUser): string | null {
    if (target.id === currentUser?.id) return "ปิดใช้งานบัญชีของตัวเองไม่ได้";
    if (target.role === "ADMIN" && activeAdmins <= 1) return "ต้องมีผู้ดูแลระบบอย่างน้อยหนึ่งบัญชี";
    return null;
  }

  return (
    <Box sx={{ p: 3 }}>
      <Typography variant="h5" sx={{ mb: 3 }}>ผู้ใช้งานระบบ</Typography>

      <Paper sx={{ p: 2, mb: 3 }}>
        <Typography variant="h6" sx={{ mb: 2 }}>เพิ่มผู้ใช้</Typography>
        <Stack
          direction={{ xs: "column", md: "row" }}
          spacing={2}
          sx={{ alignItems: "flex-start" }}
        >
          <TextField
            label="ชื่อ" size="small" value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
          />
          <TextField
            label="ชื่อผู้ใช้" size="small" value={form.username}
            onChange={(e) => setForm({ ...form, username: e.target.value })}
            helperText="ใช้ซ้ำไม่ได้ แม้บัญชีเดิมจะถูกปิดใช้งานแล้ว"
          />
          <TextField
            label="รหัสผ่าน" size="small" type="password" value={form.password}
            onChange={(e) => setForm({ ...form, password: e.target.value })}
            helperText={`อย่างน้อย ${MIN_PASSWORD} ตัวอักษร`}
          />
          <TextField
            label="สิทธิ์" size="small" select sx={{ minWidth: 160 }} value={form.role}
            onChange={(e) => setForm({ ...form, role: e.target.value as UserRoleValue })}
            helperText={form.role === "ADMIN" ? "ปรับสต๊อกและจัดการผู้ใช้ได้" : "ทำรายการซื้อขายได้"}
          >
            <MenuItem value="OPERATOR">{userRoleLabel("OPERATOR")}</MenuItem>
            <MenuItem value="ADMIN">{userRoleLabel("ADMIN")}</MenuItem>
          </TextField>
          <Button
            variant="contained" onClick={handleCreate} disabled={createUser.isPending}
            sx={{ mt: 0.5 }}
          >
            {createUser.isPending ? "กำลังบันทึก…" : "เพิ่มผู้ใช้"}
          </Button>
        </Stack>
        {formError && <Alert severity="error" sx={{ mt: 2 }}>{formError}</Alert>}
      </Paper>

      {isPending && <CircularProgress />}
      {isError && (
        <Alert severity="error">
          {error instanceof Error ? error.message : "โหลดรายชื่อผู้ใช้ไม่สำเร็จ"}
        </Alert>
      )}

      {users && (
        <TableContainer component={Paper}>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>ชื่อ</TableCell>
                <TableCell>ชื่อผู้ใช้</TableCell>
                <TableCell>สิทธิ์</TableCell>
                <TableCell>สถานะ</TableCell>
                <TableCell align="right">จัดการ</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {users.length === 0 && (
                <TableRow>
                  <TableCell colSpan={5} align="center">ไม่พบรายการ</TableCell>
                </TableRow>
              )}
              {users.map((u) => {
                const blocked = blockedReason(u);
                return (
                  <TableRow key={u.id} sx={{ opacity: u.active ? 1 : 0.6 }}>
                    <TableCell>
                      {u.name}
                      {u.id === currentUser?.id && (
                        <Chip size="small" label="คุณ" sx={{ ml: 1 }} variant="outlined" />
                      )}
                    </TableCell>
                    <TableCell>{u.username}</TableCell>
                    <TableCell>
                      <Chip
                        size="small"
                        label={userRoleLabel(u.role)}
                        color={u.role === "ADMIN" ? "primary" : "default"}
                        variant="outlined"
                      />
                    </TableCell>
                    <TableCell>
                      <Chip
                        size="small"
                        label={u.active ? "ใช้งานอยู่" : "ปิดใช้งาน"}
                        color={u.active ? "success" : "default"}
                      />
                    </TableCell>
                    <TableCell align="right">
                      {u.active ? (
                        <Button
                          size="small" color="error"
                          disabled={blocked !== null || deactivate.isPending}
                          title={blocked ?? undefined}
                          onClick={() => setConfirming(u)}
                        >
                          ปิดใช้งาน
                        </Button>
                      ) : (
                        <Button
                          size="small" disabled={restore.isPending}
                          onClick={() => handleRestore(u)}
                        >
                          เปิดใช้งาน
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </TableContainer>
      )}

      <Dialog open={confirming !== null} onClose={() => setConfirming(null)}>
        <DialogTitle>ปิดใช้งานผู้ใช้</DialogTitle>
        <DialogContent>
          <DialogContentText component="div">
            ปิดใช้งาน <strong>{confirming?.username}</strong> — บัญชีนี้จะเข้าสู่ระบบไม่ได้อีก
            <Box component="p" sx={{ mt: 2, mb: 0 }}>
              รายการที่บันทึกไว้ยังคงอยู่และยังคงแสดงชื่อผู้ใช้นี้
              ชื่อผู้ใช้จะถูกจองไว้ถาวรและนำไปใช้ซ้ำไม่ได้ เปิดใช้งานใหม่ได้ภายหลัง
            </Box>
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setConfirming(null)}>ยกเลิก</Button>
          <Button
            color="error" variant="contained" disabled={deactivate.isPending}
            onClick={() => confirming && handleDeactivate(confirming)}
          >
            ปิดใช้งาน
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
