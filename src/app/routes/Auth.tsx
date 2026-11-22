import { useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router";
import { Button } from "../components/Button.tsx";
import { Field } from "../components/Field.tsx";
import { ApiError } from "../lib/api.ts";
import { useLogin, useSignup } from "../lib/session.ts";
import s from "./screens.module.css";

type Mode = "login" | "signup";

const copy = {
  login: { title: "Sign in", submit: "Sign in", pending: "Signing in…", switchText: "New to Carnet?", switchLink: "Create an account", switchTo: "/signup" },
  signup: { title: "Create an account", submit: "Create account", pending: "Creating…", switchText: "Already have an account?", switchLink: "Sign in", switchTo: "/login" },
} as const;

function AuthForm({ mode }: { mode: Mode }) {
  const login = useLogin();
  const signup = useSignup();
  const mutation = mode === "login" ? login : signup;
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const t = copy[mode];

  const error = mutation.error instanceof ApiError ? mutation.error : mutation.error ? new ApiError(0, "internal", mutation.error.message) : null;
  const fieldError = (field: string) => (error?.field === field ? error.message : null);
  const formError = error && !error.field ? error.message : null;

  const submit = (event: FormEvent) => {
    event.preventDefault();
    mutation.mutate({ email, password }, { onSuccess: () => navigate("/", { replace: true }) });
  };

  return (
    <div className={s.auth}>
      <div className={s.authCard}>
        <p className={s.wordmark}>Carnet</p>
        <h1 className={s.title}>{t.title}</h1>
        <form className={s.authForm} onSubmit={submit} noValidate>
          {formError ? (
            <p className={s.formError} role="alert">
              {formError}
            </p>
          ) : null}
          <Field
            label="Email"
            type="email"
            autoComplete="email"
            inputMode="email"
            autoCapitalize="none"
            spellCheck={false}
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            error={fieldError("email")}
          />
          <Field
            label="Password"
            type="password"
            autoComplete={mode === "login" ? "current-password" : "new-password"}
            required
            minLength={mode === "signup" ? 8 : undefined}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            hint={mode === "signup" ? "At least 8 characters." : undefined}
            error={fieldError("password")}
          />
          <Button type="submit" variant="primary" block disabled={mutation.isPending}>
            {mutation.isPending ? t.pending : t.submit}
          </Button>
        </form>
        <p className={s.switch}>
          {t.switchText} <Link to={t.switchTo}>{t.switchLink}</Link>
        </p>
      </div>
    </div>
  );
}

export const Login = () => <AuthForm mode="login" />;
export const Signup = () => <AuthForm mode="signup" />;
