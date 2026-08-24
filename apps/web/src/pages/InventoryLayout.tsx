import { Box, Tabs, Tab } from "@mui/material";
import { Link as RouterLink, Outlet, useLocation } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";

// `adminOnly` mirrors what the API restricts to ADMIN: the three adjustment forms move gold on the
// books with no counterparty behind them. Offering an operator a tab whose form the server will
// refuse at submit wastes their time and reads as a bug.
const tabs = [
  { label: "คลังทองคำแท่ง", to: "/inventory", adminOnly: false },
  { label: "ความเคลื่อนไหวทองแท่ง", to: "/inventory/movements", adminOnly: false },
  { label: "ปรับเพิ่มทองคำแท่ง", to: "/inventory/gain", adminOnly: true },
  { label: "ปรับลดทองคำแท่ง", to: "/inventory/loss", adminOnly: true },
  { label: "ปรับยี่ห้อทองคำแท่ง", to: "/inventory/switch", adminOnly: true },
];

export function InventoryLayout() {
  const { pathname } = useLocation();
  const { isAdmin } = useAuth();
  const visibleTabs = tabs.filter((tab) => isAdmin || !tab.adminOnly);
  // `false` keeps MUI from warning about a value with no matching tab — which is what an admin-only
  // path would be if an operator reached it by typing the URL. AdminGuard renders the refusal.
  const currentTab = visibleTabs.find((tab) => tab.to === pathname)?.to ?? false;

  return (
    <Box sx={{ display: "flex" }}>
      <Tabs
        orientation="vertical"
        variant="scrollable"
        value={currentTab}
        sx={{ borderRight: 1, borderColor: "divider", minWidth: 200, pt: 2 }}
      >
        {visibleTabs.map((tab) => (
          <Tab
            key={tab.to}
            label={tab.label}
            value={tab.to}
            component={RouterLink}
            to={tab.to}
            sx={{ alignItems: "flex-start" }}
          />
        ))}
      </Tabs>
      <Box sx={{ flexGrow: 1, minWidth: 0 }}>
        <Outlet />
      </Box>
    </Box>
  );
}
