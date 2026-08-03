import { AppBar, Toolbar, Typography, Button, Box } from "@mui/material";
import { NavLink, useNavigate } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";

const navLinks = [
  { to: "/inventory", label: "Inventory" },
  { to: "/wholesale-buy", label: "ซื้อส่ง" },
];

export function NavBar() {
  const { isAuthenticated, logout } = useAuth();
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
        <Button color="inherit" variant="text" onClick={handleLogout}>
          Logout
        </Button>
      </Toolbar>
    </AppBar>
  );
}
