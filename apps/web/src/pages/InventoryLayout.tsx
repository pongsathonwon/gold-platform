import { Box, Tabs, Tab } from "@mui/material";
import { Link as RouterLink, Outlet, useLocation } from "react-router-dom";

const tabs = [
  { label: "คลังทองคำแท่ง", to: "/inventory" },
  { label: "ความเคลื่อนไหวทองแท่ง", to: "/inventory/movements" },
  { label: "ปรับเพิ่มทองคำแท่ง", to: "/inventory/gain" },
  { label: "ปรับลดทองคำแท่ง", to: "/inventory/loss" },
  { label: "ปรับยี่ห้อทองคำแท่ง", to: "/inventory/switch" },
];

export function InventoryLayout() {
  const { pathname } = useLocation();
  const currentTab = tabs.find((tab) => tab.to === pathname)?.to ?? false;

  return (
    <Box sx={{ display: "flex" }}>
      <Tabs
        orientation="vertical"
        variant="scrollable"
        value={currentTab}
        sx={{ borderRight: 1, borderColor: "divider", minWidth: 200, pt: 2 }}
      >
        {tabs.map((tab) => (
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
