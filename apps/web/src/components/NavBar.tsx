import { AppBar, Toolbar, Typography, Button, Box, Chip } from "@mui/material";
import { NavLink, useNavigate } from "react-router-dom";
import { userRoleLabel } from "@gold-platform/types";
import { useAuth } from "../auth/AuthContext";

// Buy beside buy and sell beside sell: the comparison the manager is here to make runs across the
// wholesale/retail line, not along it.
const navLinks = [
  { to: "/inventory", label: "คลังทองคำแท่ง" },
  { to: "/wholesale-buy", label: "ซื้อส่ง" },
  { to: "/wholesale-sell", label: "ขายส่ง" },
  { to: "/retail-buy", label: "ซื้อปลีก" },
  { to: "/retail-sell", label: "ขายปลีก" },
];

export function NavBar() {
  const { isAuthenticated, user, logout } = useAuth();
  const navigate = useNavigate();

  if (!isAuthenticated) return null;

  function handleLogout() {
    logout();
    navigate("/login");
  }

  return (
    <AppBar position="static">
      <Toolbar sx={{ gap: 2 }}>
        <Typography variant="h5" sx={{ flexGrow: 1, color: "inherit" }}>
          GoldOffice
        </Typography>
        {navLinks.map((link) => (
          <Box
            key={link.to}
            component={NavLink}
            to={link.to}
            sx={{
              color: "inherit",
              textDecoration: "none",
              fontWeight: 600,
              "&.active": { textDecoration: "underline" },
            }}
          >
            {link.label}
          </Box>
        ))}
        {/* Who is signed in, and as what. The role is worth showing because it decides which
            actions the app offers — an operator who cannot find the adjustment pages should be
            able to see why without asking. */}
        {user && (
          <Box sx={{ display: "flex", alignItems: "center", gap: 1, ml: 1 }}>
            <Typography variant="body2" sx={{ color: "inherit" }}>
              {user.name}
            </Typography>
            <Chip
              size="small"
              label={userRoleLabel(user.role)}
              sx={{ color: "inherit", borderColor: "currentColor" }}
              variant="outlined"
            />
          </Box>
        )}
        <Button color="inherit" variant="text" onClick={handleLogout}>
          ออกจากระบบ
        </Button>
      </Toolbar>
    </AppBar>
  );
}
