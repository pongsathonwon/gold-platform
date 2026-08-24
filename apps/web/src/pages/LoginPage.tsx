import React, { useState } from "react";
import { useLocation, useNavigate, type Location } from "react-router-dom";
import {
  Box,
  Button,
  Card,
  CardContent,
  TextField,
  Typography,
  Alert,
} from "@mui/material";
import { loginSchema } from "@gold-platform/types";
import { useAuth } from "../auth/AuthContext";

export function LoginPage() {
  const { login, sessionExpired, clearSessionExpired } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Where the guard turned them away from, so signing back in resumes the work rather than
  // restarting it. Falls back to the default page on a fresh visit to /login.
  const from = (location.state as { from?: Location } | null)?.from?.pathname ?? "/inventory";

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setIsSubmitting(true);
    setSubmitError(null);

    const parsed = loginSchema.safeParse({ username, password });
    if (!parsed.success) {
      setFieldError(parsed.error.issues[0]?.message ?? "ข้อมูลไม่ถูกต้อง");
      setIsSubmitting(false);
      return;
    }
    setFieldError(null);

    try {
      await login(username, password);
      clearSessionExpired();
      navigate(from, { replace: true });
    } catch (err) {
      console.error(err);
      setSubmitError(err instanceof Error ? err.message : "เข้าสู่ระบบไม่สำเร็จ");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <Box
      sx={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        minHeight: "100vh",
        backgroundColor: "background.default",
      }}
    >
      <Card sx={{ width: 360 }}>
        <CardContent>
          <Typography variant="h3" sx={{ mb: 3 }}>
            GoldOffice Login
          </Typography>
          <Box
            component="form"
            onSubmit={handleSubmit}
            sx={{ display: "flex", flexDirection: "column", gap: 2 }}
          >
            {/* A session that ended on its own is not an error the operator made, and saying so
                is the difference between "log in again" and "why did it stop working". */}
            {sessionExpired && (
              <Alert severity="info">เซสชันหมดอายุ กรุณาเข้าสู่ระบบอีกครั้ง</Alert>
            )}
            {/* name + autoComplete let a password manager offer to fill and to save; without them
                it cannot recognise the form at all. */}
            <TextField
              label="ชื่อผู้ใช้"
              name="username"
              autoComplete="username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoFocus
              fullWidth
            />
            <TextField
              label="รหัสผ่าน"
              name="password"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              fullWidth
            />
            {fieldError && <Alert severity="error">{fieldError}</Alert>}
            {submitError && <Alert severity="error">{submitError}</Alert>}
            <Button type="submit" disabled={isSubmitting} fullWidth>
              {isSubmitting ? "กำลังเข้าสู่ระบบ…" : "เข้าสู่ระบบ"}
            </Button>
          </Box>
        </CardContent>
      </Card>
    </Box>
  );
}
