import { AppBar, Toolbar, Typography, Button, Box } from "@mui/material";
import { NavLink, useNavigate } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";

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
        <Box
          component={NavLink}
          to="/inventory"
          sx={{
            color: "inherit",
            textDecoration: "none",
            fontWeight: 600,
            "&.active": { textDecoration: "underline" },
          }}
        >
          Inventory
        </Box>
        <Button color="inherit" variant="text" onClick={handleLogout}>
          Logout
        </Button>
      </Toolbar>
    </AppBar>
  );
}
