import { Navigate, Outlet, useLocation } from "react-router-dom";
import { Alert, Container } from "@mui/material";
import { useAuth } from "./AuthContext";

export function AuthGuard() {
  const { isAuthenticated } = useAuth();
  const location = useLocation();

  // Remember where they were headed, so signing back in returns them there rather than dumping
  // them on the default page. An expiring session should cost an operator a password, not their
  // place in the work.
  if (!isAuthenticated) {
    return <Navigate to="/login" replace state={{ from: location }} />;
  }
  return <Outlet />;
}

/**
 * Routes only an ADMIN may open.
 *
 * A courtesy, not a security boundary — the API re-checks the token's own role claim on every
 * request and this cannot weaken that. It exists so an operator is told up front rather than
 * after filling in a form, which is what happened when the inventory adjustment pages were
 * reachable by everyone and the server refused them at submit.
 */
export function AdminGuard() {
  const { isAdmin } = useAuth();

  if (!isAdmin) {
    return (
      <Container sx={{ py: 4 }}>
        <Alert severity="warning">
          หน้านี้สำหรับผู้ดูแลระบบเท่านั้น — หากต้องการปรับสต๊อก กรุณาติดต่อผู้ดูแลระบบ
        </Alert>
      </Container>
    );
  }
  return <Outlet />;
}
