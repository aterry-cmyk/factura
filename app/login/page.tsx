import { LoginForm } from "@/components/LoginForm";

export default function LoginPage() {
  return (
    <main className="wrap" style={{ maxWidth: 420, paddingTop: 72 }}>
      <div className="brand" style={{ justifyContent: "center", marginBottom: 18 }}>
        <span className="brand-mark">F</span> Factura
      </div>
      <div className="card">
        <LoginForm />
      </div>
    </main>
  );
}
