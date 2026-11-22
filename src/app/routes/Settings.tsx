import { useNavigate } from "react-router";
import { Button } from "../components/Button.tsx";
import { useToast } from "../components/Toast.tsx";
import { useLogout, useMe } from "../lib/session.ts";
import s from "./screens.module.css";

export default function Settings() {
  const { data: me } = useMe();
  const logout = useLogout();
  const toast = useToast();
  const navigate = useNavigate();

  const signOut = () =>
    logout.mutate(undefined, {
      onSuccess: () => {
        toast("Signed out.");
        navigate("/login", { replace: true });
      },
      onError: (err) => toast(err.message),
    });

  return (
    <div className={s.screen}>
      <header className={s.header}>
        <h1 className={s.wordmark}>Settings</h1>
      </header>

      <section className={s.section} aria-labelledby="account-label">
        <h2 id="account-label" className={s.label}>
          Account
        </h2>
        <div className={s.rows}>
          <div className={s.row}>
            <span>Email</span>
            <span>{me?.email}</span>
          </div>
          <div className={s.row}>
            <span>Time zone</span>
            <span>{me?.timezone}</span>
          </div>
        </div>
      </section>

      <Button onClick={signOut} disabled={logout.isPending}>
        {logout.isPending ? "Signing out…" : "Sign out"}
      </Button>
    </div>
  );
}
