import { useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { Box, Button, Card, CardContent, TextField, Typography, Alert } from "@mui/material";
import { loginSchema } from "@gold-platform/types";
import { useAuth } from "../auth/AuthContext";

export function LoginPage() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setSubmitError(null);

    const parsed = loginSchema.safeParse({ username, password });
    if (!parsed.success) {
      setFieldError(parsed.error.issues[0]?.message ?? "Invalid input");
      return;
    }
    setFieldError(null);

    setIsSubmitting(true);
    try {
      await login(username, password);
      navigate("/inventory");
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : "Login failed");
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
          <Box component="form" onSubmit={handleSubmit} sx={{ display: "flex", flexDirection: "column", gap: 2 }}>
            <TextField
              label="Username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoFocus
              fullWidth
            />
            <TextField
              label="Password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              fullWidth
            />
            {fieldError && <Alert severity="error">{fieldError}</Alert>}
            {submitError && <Alert severity="error">{submitError}</Alert>}
            <Button type="submit" disabled={isSubmitting} fullWidth>
              {isSubmitting ? "Logging in…" : "Log In"}
            </Button>
          </Box>
        </CardContent>
      </Card>
    </Box>
  );
}
